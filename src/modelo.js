// Modelo de tradução (GGUF): usa o que já estiver em disco ou baixa do Hugging Face
// na primeira vez. O download é retomado de onde parou (arquivo .part + Range).
const fs = require('fs')
const path = require('path')
const { EventEmitter } = require('events')
const { Readable } = require('stream')
const { pipeline } = require('stream/promises')
const config = require('./config')

const eventos = new EventEmitter() // 'progresso' ({ baixado, total }), 'fim', 'erro'

async function baixar(destino) {
  const parcial = destino + '.part'
  fs.mkdirSync(path.dirname(destino), { recursive: true })
  const jaTem = fs.existsSync(parcial) ? fs.statSync(parcial).size : 0
  const r = await fetch(config.urlModelos + path.basename(destino), {
    headers: jaTem ? { Range: `bytes=${jaTem}-` } : {}
  })
  if (!r.ok) throw new Error(`download do modelo respondeu ${r.status}`)
  // 206 = o servidor aceitou continuar; 200 = mandou do zero
  const inicio = r.status === 206 ? jaTem : 0
  const total = inicio + Number(r.headers.get('content-length') || 0)
  let baixado = inicio
  let ultimo = 0
  const corpo = Readable.fromWeb(r.body)
  corpo.on('data', (pedaco) => {
    baixado += pedaco.length
    if (Date.now() - ultimo > 250) {
      ultimo = Date.now()
      eventos.emit('progresso', { baixado, total })
    }
  })
  await pipeline(corpo, fs.createWriteStream(parcial, { flags: inicio ? 'a' : 'w' }))
  if (total && fs.statSync(parcial).size !== total) throw new Error('download do modelo incompleto')
  fs.renameSync(parcial, destino)
}

// Caminho do modelo pronto pra uso; a mesma promessa vale pra todo mundo
let pronto = null
function garantir() {
  pronto ??= (async () => {
    const existente = config.candidatosModelo.find((c) => fs.existsSync(c))
    if (existente) return existente
    const destino = config.candidatosModelo.at(-1)
    try {
      await baixar(destino)
    } catch (erro) {
      eventos.emit('erro', erro)
      throw erro
    }
    eventos.emit('fim')
    return destino
  })()
  // Falhou (sem internet, por exemplo): tenta de novo depois de um tempo
  pronto.catch(() => setTimeout(() => { pronto = null }, 30_000))
  return pronto
}

const precisaBaixar = () => !config.candidatosModelo.some((c) => fs.existsSync(c))

module.exports = { garantir, precisaBaixar, eventos }
