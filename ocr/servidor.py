"""OCR local pro X.LLM: recebe uma imagem, devolve os blocos de texto com posição e cores.

POST /ocr  (corpo = bytes da imagem)  ->  {"largura", "altura", "blocos": [...]}
GET  /health                           ->  ok

Cada bloco é um parágrafo (linhas próximas e alinhadas juntas), com a caixa em
fração da imagem (0..1), o texto, a altura de linha e as cores do fundo e da letra
amostradas da própria imagem, pra o app desenhar a tradução por cima.
"""
import json
import re
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import cv2
import numpy as np
from rapidocr import RapidOCR

PORTA = int(sys.argv[sys.argv.index("--porta") + 1]) if "--porta" in sys.argv else 8097
CONFIANCA_MINIMA = 0.6
CJK = re.compile(r"[぀-ヿ㐀-鿿가-힯]")

# GPU via DirectML: ~160 ms por imagem contra ~1200 ms na CPU (mesmas linhas lidas).
# --cpu (versão CPU do app) nem tenta: o onnxruntime dela não tem DirectML.
try:
    if "--cpu" in sys.argv:
        raise RuntimeError("CPU pedida")
    motor = RapidOCR(params={"Global.log_level": "warning", "EngineConfig.onnxruntime.use_dml": True})
except Exception:  # noqa: BLE001 - sem DirectML, cai pra CPU
    motor = RapidOCR(params={"Global.log_level": "warning"})
trava = threading.Lock()  # o motor não é thread-safe: um OCR por vez


def cores(img, x0, y0, x1, y1):
    """Fundo = mediana de um anel em volta da caixa; letra = pixels de dentro
    mais diferentes do fundo."""
    h, w = img.shape[:2]
    m = 3
    ax0, ay0, ax1, ay1 = max(x0 - m, 0), max(y0 - m, 0), min(x1 + m, w), min(y1 + m, h)
    regiao = img[ay0:ay1, ax0:ax1].reshape(-1, 3).astype(np.int32)
    mascara = np.ones((ay1 - ay0, ax1 - ax0), bool)
    mascara[y0 - ay0:y1 - ay0, x0 - ax0:x1 - ax0] = False
    anel = img[ay0:ay1, ax0:ax1][mascara].astype(np.int32)
    fundo = np.median(anel if len(anel) else regiao, axis=0)
    dentro = img[y0:y1, x0:x1].reshape(-1, 3).astype(np.int32)
    if not len(dentro):
        return fundo, 255 - fundo
    dist = np.abs(dentro - fundo).sum(axis=1)
    # Só o miolo das letras: a borda borrada (antialias/JPEG) puxa a cor pro fundo
    corte = np.percentile(dist, 96)
    letra = np.median(dentro[dist >= corte], axis=0)
    # Pouco contraste (texto fino, compressão): força preto ou branco
    if np.abs(letra - fundo).sum() < 120:
        letra = np.array([0, 0, 0]) if fundo.mean() > 128 else np.array([255, 255, 255])
    return fundo, letra


def agrupar(linhas):
    """Junta linhas em parágrafos: logo abaixo da anterior, altura parecida,
    mesmo alinhamento, e a anterior "cheia" (o texto quebrou de linha ali).
    Itens de lista/menu são curtos e de largura variada: ficam cada um no seu
    bloco, pra tradução não misturar um item com o outro."""
    linhas = sorted(linhas, key=lambda l: (l["y0"], l["x0"]))
    blocos = []
    for l in linhas:
        alvo = None
        for b in reversed(blocos):
            u = b[-1]
            hu, hl = u["y1"] - u["y0"], l["y1"] - l["y0"]
            gap = l["y0"] - u["y1"]
            alturas_parecidas = max(hu, hl) / max(min(hu, hl), 1) < 1.5
            largura_max = max(max(x["x1"] - x["x0"] for x in b), l["x1"] - l["x0"])
            anterior_cheia = (u["x1"] - u["x0"]) >= 0.7 * largura_max
            alinhada = (abs(u["x0"] - l["x0"]) < hu  # à esquerda
                        or abs((u["x0"] + u["x1"]) - (l["x0"] + l["x1"])) / 2 < hu)  # centralizada
            if -0.3 * hu < gap < 0.6 * hu and alturas_parecidas and anterior_cheia and alinhada:
                alvo = b
                break
        if alvo is None:
            blocos.append([l])
        else:
            alvo.append(l)
    return blocos


def ocr(dados):
    img = cv2.imdecode(np.frombuffer(dados, np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("imagem inválida")
    img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    h, w = img.shape[:2]
    with trava:
        r = motor(img)
    linhas = []
    for caixa, texto, conf in zip(r.boxes if r.boxes is not None else [], r.txts or [], r.scores or []):
        if conf < CONFIANCA_MINIMA or not texto.strip():
            continue
        xs, ys = [p[0] for p in caixa], [p[1] for p in caixa]
        linhas.append({"x0": int(max(min(xs), 0)), "y0": int(max(min(ys), 0)),
                       "x1": int(min(max(xs), w)), "y1": int(min(max(ys), h)), "texto": texto.strip()})
    blocos = []
    for grupo in agrupar(linhas):
        x0, y0 = min(l["x0"] for l in grupo), min(l["y0"] for l in grupo)
        x1, y1 = max(l["x1"] for l in grupo), max(l["y1"] for l in grupo)
        sep = "" if CJK.search(grupo[0]["texto"]) else " "
        texto = sep.join(l["texto"] for l in grupo)
        fundos, letras = zip(*(cores(img, l["x0"], l["y0"], l["x1"], l["y1"]) for l in grupo))
        blocos.append({
            "x": x0 / w, "y": y0 / h, "w": (x1 - x0) / w, "h": (y1 - y0) / h,
            "alturaLinha": float(np.median([l["y1"] - l["y0"] for l in grupo])) / h,
            "linhas": len(grupo), "texto": texto,
            "fundo": [int(c) for c in np.median(fundos, axis=0)],
            "letra": [int(c) for c in np.median(letras, axis=0)],
        })
    return {"largura": w, "altura": h, "blocos": blocos}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def responder(self, codigo, corpo, tipo="application/json"):
        dados = corpo.encode() if isinstance(corpo, str) else corpo
        self.send_response(codigo)
        self.send_header("Content-Type", tipo)
        self.send_header("Content-Length", str(len(dados)))
        self.end_headers()
        self.wfile.write(dados)

    def do_GET(self):
        if self.path == "/health":
            self.responder(200, "ok", "text/plain")
        else:
            self.responder(404, "{}")

    def do_POST(self):
        if self.path != "/ocr":
            return self.responder(404, "{}")
        try:
            dados = self.rfile.read(int(self.headers.get("Content-Length", 0)))
            self.responder(200, json.dumps(ocr(dados), ensure_ascii=False))
        except Exception as e:  # noqa: BLE001 - devolve o erro pro app em vez de derrubar o servidor
            self.responder(500, json.dumps({"erro": str(e)}))


if __name__ == "__main__":
    ThreadingHTTPServer(("127.0.0.1", PORTA), Handler).serve_forever()
