// Tradução de qualquer idioma -> PT-BR com TranslateGemma 4B rodando num llama-server local.
// O servidor sobe junto com o app e é encerrado quando o app fecha.
const config = require('./config')
const modelo = require('./modelo')
const { criarServico } = require('./servico')

const SIMULTANEOS = config.simultaneos // slots do llama-server = traduções em paralelo
const LIMITE_CACHE = 3000

// O servidor só é criado quando o modelo está em disco (pode estar baixando)
let servidor = null
async function iniciar() {
  const caminho = await modelo.garantir()
  servidor ??= criarServico({
    nome: 'llama-server',
    exe: config.llamaServer,
    args: [
      '-m', caminho, '--port', String(config.portaLlm),
      '-ngl', String(config.camadasGpu), '-c', String(config.contexto), '--parallel', String(SIMULTANEOS),
      // Placa escolhida só vale com camadas na GPU (a versão CPU ignora)
      ...(config.dispositivo && config.camadasGpu > 0 ? ['--device', config.dispositivo] : []),
      ...(config.threads ? ['--threads', String(config.threads)] : [])
    ],
    porta: config.portaLlm
  })
  return servidor.iniciar()
}
const parar = () => servidor?.parar()

// Códigos antigos que o X ainda usa no atributo lang
const CODIGOS_X = { in: 'id', iw: 'he', ji: 'yi' }
const nomeIdioma = new Intl.DisplayNames(['en'], { type: 'language' })

// Template oficial do TranslateGemma (o mesmo do chat_template embutido no GGUF)
function montarPrompt(texto, codigo) {
  const idioma = nomeIdioma.of(codigo)
  return `<start_of_turn>user\nYou are a professional ${idioma} (${codigo}) to Portuguese (pt-BR) translator. ` +
    `Your goal is to accurately convey the meaning and nuances of the original ${idioma} text while ` +
    'adhering to Portuguese grammar, vocabulary, and cultural sensitivities.\n' +
    'Produce only the Portuguese translation, without any additional explanations or commentary. ' +
    `Please translate the following ${idioma} text into Portuguese:\n\n\n` +
    texto.trim() + '<end_of_turn>\n<start_of_turn>model\n'
}

// Detector de idioma pra texto sem lang (bios). O próprio modelo não serve:
// ele reescreve texto que já está em português em vez de devolver igual.
let detector = null
async function detectar(texto) {
  detector ??= import('eld/medium').then((m) => m.eld)
  return (await detector).detect(texto).language || null
}

// Devolve o código do idioma de origem, ou null se não for pra traduzir.
// Códigos especiais do X (qht = só hashtags, qme = só mídia, und, zxx...) não
// são idiomas: o Intl devolve o próprio código como nome, e aí não traduz.
async function idiomaDeOrigem(texto, lang) {
  const codigo = lang === 'auto' ? await detectar(texto) : (CODIGOS_X[lang] ?? lang)
  if (!codigo || codigo.startsWith('pt') || ['und', 'zxx', 'mis', 'mul'].includes(codigo)) return null
  try {
    if (nomeIdioma.of(codigo) === codigo) return null
  } catch {
    return null
  }
  return codigo
}

async function executar(texto, codigo) {
  await iniciar()
  const r = await fetch(`${servidor.url}/completion`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt: montarPrompt(texto, codigo),
      temperature: 0,
      n_predict: 1024,
      stop: ['<end_of_turn>'],
      cache_prompt: true
    })
  })
  if (!r.ok) throw new Error(`llama-server respondeu ${r.status}`)
  return (await r.json()).content.trim()
}

// Fila com no máximo SIMULTANEOS pedidos ao servidor ao mesmo tempo. Texto de
// tweet passa na frente do texto de imagem (uma foto pode ter 15+ blocos).
const filas = { alta: [], baixa: [] }
let ativos = 0
function proximo() {
  while (ativos < SIMULTANEOS && (filas.alta.length || filas.baixa.length)) {
    const { texto, codigo, resolve, reject } = (filas.alta.length ? filas.alta : filas.baixa).shift()
    ativos++
    executar(texto, codigo).then(resolve, reject).finally(() => { ativos--; proximo() })
  }
}

// Mesmo tweet aparece várias vezes ao rolar: guarda a promessa por texto.
// lang = código do X (en, zh, ja...) ou 'auto' pra detectar. Resolve null = não traduzir.
const cache = new Map()
function traduzir(texto, lang = 'auto', prioridade = 'alta') {
  const chave = `${lang}\u0000${texto}`
  if (cache.has(chave)) return cache.get(chave)
  const promessa = idiomaDeOrigem(texto, lang).then((codigo) => codigo && new Promise((resolve, reject) => {
    filas[prioridade].push({ texto, codigo, resolve, reject })
    proximo()
  }))
  promessa.catch(() => cache.delete(chave))
  cache.set(chave, promessa)
  if (cache.size > LIMITE_CACHE) cache.delete(cache.keys().next().value)
  return promessa
}

module.exports = { iniciar, parar, traduzir, detectar }
