// Configuração do app: variante (cpu | gpu), caminhos dos binários e ajustes do usuário.
//
// A variante vem do build (campo "variante" do package.json, gravado pelo
// scripts/empacotar.js) ou, rodando do código, de "--variante=cpu" na linha de comando.
// Qualquer valor abaixo pode ser sobrescrito em %APPDATA%\X.LLM\config.json.
const { app } = require('electron')
const fs = require('fs')
const path = require('path')
const pkg = require('../package.json')

const RAIZ = path.join(__dirname, '..')

const argVariante = process.argv.find((a) => a.startsWith('--variante='))?.split('=')[1]
const VARIANTE = argVariante || pkg.variante || 'gpu'
if (!['cpu', 'gpu'].includes(VARIANTE)) throw new Error(`variante inválida: ${VARIANTE}`)

const PADROES = {
  gpu: {
    modelo: 'translategemma-4b-it.Q6_K.gguf', // 3,2 GB
    camadasGpu: 99, // modelo inteiro na placa de vídeo
    simultaneos: 4, // traduções em paralelo (slots do llama-server)
    contexto: 16384, // dividido entre os slots
    ocrGpu: true, // OCR via DirectML
    traduzirImagens: true
  },
  cpu: {
    modelo: 'translategemma-4b-it.Q4_K_M.gguf', // 2,5 GB, mais leve pra CPU
    camadasGpu: 0,
    simultaneos: 2,
    contexto: 8192,
    ocrGpu: false,
    // Cada foto vira OCR + uma tradução por bloco de texto: na CPU isso deixa o
    // processador no talo o tempo todo. Dá pra ligar no config.json.
    traduzirImagens: false
  }
}

const COMUNS = {
  urlModelos: 'https://huggingface.co/mradermacher/translategemma-4b-it-GGUF/resolve/main/',
  llamaServer: null, // caminho de outro llama-server.exe (ex.: um build CUDA seu)
  dispositivo: null, // --device do llama-server (ex.: "CUDA1", "Vulkan0"); null = automático
  threads: null, // --threads do llama-server; null = automático
  portaLlm: 8099,
  portaOcr: 8097
}

const ARQUIVO_USUARIO = path.join(app.getPath('userData'), 'config.json')

function lerUsuario() {
  try {
    return JSON.parse(fs.readFileSync(ARQUIVO_USUARIO, 'utf8'))
  } catch (erro) {
    if (erro.code !== 'ENOENT') console.error('[config] config.json ignorado:', erro.message)
    return {}
  }
}

const config = { ...COMUNS, ...PADROES[VARIANTE], ...lerUsuario(), variante: VARIANTE }

// Binários: no app instalado ficam em resources\; rodando do código, em vendor\<variante>\
// (criado por "npm run preparar:gpu" / "preparar:cpu")
const BINARIOS = app.isPackaged ? process.resourcesPath : path.join(RAIZ, 'vendor', VARIANTE)
config.llamaServer ??= path.join(BINARIOS, 'llama', 'llama-server.exe')

// OCR: executável congelado pelo PyInstaller; rodando do código sem ele, usa o
// Python do venv em ocr\.venv direto no servidor.py
const ocrExe = path.join(BINARIOS, 'ocr', 'servidor.exe')
if (app.isPackaged || fs.existsSync(ocrExe)) {
  config.ocr = { exe: ocrExe, args: [] }
} else {
  config.ocr = {
    exe: path.join(RAIZ, 'ocr', '.venv', 'Scripts', 'python.exe'),
    args: [path.join(RAIZ, 'ocr', 'servidor.py')]
  }
}

// Onde procurar o modelo: caminho absoluto no config.json, pasta modelo\ do
// código (desenvolvimento) e, por fim, a pasta do usuário (onde o app baixa)
config.pastaModelos = path.join(app.getPath('userData'), 'modelos')
config.candidatosModelo = path.isAbsolute(config.modelo)
  ? [config.modelo]
  : [...(app.isPackaged ? [] : [path.join(RAIZ, 'modelo', config.modelo)]), path.join(config.pastaModelos, config.modelo)]

config.pastaLogs = path.join(app.getPath('userData'), 'logs')
config.icone = path.join(RAIZ, 'build', 'icon.png')

module.exports = config
