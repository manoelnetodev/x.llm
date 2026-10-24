// Tradução do texto dentro das fotos: OCR local (RapidOCR / PP-OCRv6, em ocr\servidor.py)
// acha os blocos de texto, o TranslateGemma traduz, e o preload desenha por cima.
const config = require('./config')
const { criarServico } = require('./servico')
const tradutor = require('./tradutor')

const LIMITE_CACHE = 500

const ocr = criarServico({
  nome: 'ocr',
  exe: config.ocr.exe,
  args: [...config.ocr.args, '--porta', String(config.portaOcr), ...(config.ocrGpu ? [] : ['--cpu'])],
  porta: config.portaOcr
})

// pbs.twimg.com/media/ID?format=jpg&name=small -> versão "medium" (~1200px), boa pro OCR
function urlParaOcr(src) {
  const u = new URL(src)
  u.searchParams.set('name', 'medium')
  return u.toString()
}

// O CDN às vezes derruba a conexão ("fetch failed"): tenta de novo uma vez
async function baixar(url) {
  for (let tentativa = 1; ; tentativa++) {
    try {
      const r = await fetch(url)
      if (!r.ok) throw new Error(`imagem respondeu ${r.status}`)
      return Buffer.from(await r.arrayBuffer())
    } catch (erro) {
      if (tentativa >= 2) throw erro
      await new Promise((r) => setTimeout(r, 500))
    }
  }
}

const CJK = /[぀-ヿ㐀-鿿가-힯]/

// Palavra "de verdade": só letras (pontuação nas pontas é ok). Não contam nomes
// técnicos e números como FMLA32, 1/2, apache-2.0, Qwen3.6-35B-A3B
const PALAVRA = /^[\p{P}]*\p{L}+(['’]\p{L}+)?[\p{P}]*$/u

// Palavra solta é quase sempre marca, rótulo de interface ou marca d'água
// ("LALIGA", "Monitor", "channel"), e bloco técnico vira lixo ("1/2" -> "0,5"):
// só traduz com 2+ palavras de verdade. Título gigante e curto (arte de pôster)
// também fica: redesenhado por cima ele cobre a imagem inteira.
function valeTraduzir(bloco) {
  // Ideograma sozinho num print quase sempre é ícone mal lido pelo OCR ("+" vira
  // 十, ícone vira 金/品): CJK precisa de 2+ caracteres
  const cjk = bloco.texto.match(new RegExp(CJK.source, 'g'))?.length ?? 0
  if (cjk) return cjk >= 2
  const palavras = bloco.texto.trim().split(/\s+/).filter((t) => PALAVRA.test(t)).length
  if (palavras < 2) return false
  return !(palavras <= 2 && bloco.alturaLinha > 0.08)
}

async function processar(src) {
  const img = await baixar(urlParaOcr(src))
  await ocr.iniciar()
  const r = await fetch(`${ocr.url}/ocr`, { method: 'POST', body: img })
  if (!r.ok) throw new Error(`OCR respondeu ${r.status}`)
  const { largura, altura, blocos } = await r.json()

  // Idioma da imagem inteira (bloco solto costuma ser curto demais pra detectar)
  let comTexto = blocos.filter(valeTraduzir)
  if (!comTexto.length) return null
  const codigo = await tradutor.detectar(comTexto.map((b) => b.texto).join('\n'))
  if (!codigo || codigo.startsWith('pt')) return null

  // Imagem mista: bloco que sozinho já é português (com texto suficiente pra
  // confiar na detecção) fica como está, senão o modelo reescreve
  const ehPortugues = await Promise.all(comTexto.map(async (b) =>
    b.texto.split(/\s+/).length >= 3 && (await tradutor.detectar(b.texto))?.startsWith('pt')))
  comTexto = comTexto.filter((_, i) => !ehPortugues[i])

  const traduzidos = await Promise.all(comTexto.map(async (b) => {
    const pt = await tradutor.traduzir(b.texto, codigo, 'baixa')
    return pt && pt.trim() !== b.texto.trim() ? { ...b, original: b.texto, texto: pt } : null
  }))
  const final = traduzidos.filter(Boolean)
  return final.length ? { largura, altura, blocos: final } : null
}

// Mesma foto aparece de novo ao rolar: cache pelo id da mídia.
// Com a tradução de imagens desligada (padrão na versão CPU), resolve null = não traduzir.
const cache = new Map()
function traduzirImagem(src) {
  if (!config.traduzirImagens) return Promise.resolve(null)
  const chave = new URL(src).pathname
  if (cache.has(chave)) return cache.get(chave)
  const promessa = processar(src)
  promessa.catch(() => cache.delete(chave))
  cache.set(chave, promessa)
  if (cache.size > LIMITE_CACHE) cache.delete(cache.keys().next().value)
  return promessa
}

const iniciar = async () => { if (config.traduzirImagens) await ocr.iniciar() }

module.exports = { iniciar, parar: ocr.parar, traduzirImagem }
