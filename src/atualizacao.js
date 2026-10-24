// Atualização: ao abrir, confere o último release no GitHub. Se tiver versão nova,
// pergunta; "Atualizar agora" baixa o instalador da mesma variante (CPU/GPU), instala
// por cima em modo silencioso e reabre o app. Login, modelo e config.json ficam.
const { app, dialog, shell } = require('electron')
const { spawn } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { Readable } = require('stream')
const { pipeline } = require('stream/promises')
const config = require('./config')
const pkg = require('../package.json')

const REPO = pkg.repository.url.match(/github\.com\/(.+?)(\.git)?$/)[1]
const ARQUIVO_ESTADO = path.join(app.getPath('userData'), 'atualizacao.json')

// "v0.1.10" > "0.1.9"
function maisNova(a, b) {
  const pa = a.replace(/^v/, '').split('.').map(Number)
  const pb = b.replace(/^v/, '').split('.').map(Number)
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0)
  return false
}

function lerEstado() {
  try { return JSON.parse(fs.readFileSync(ARQUIVO_ESTADO, 'utf8')) } catch { return {} }
}

async function baixar(url, destino, aoProgresso) {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`download respondeu ${r.status}`)
  const total = Number(r.headers.get('content-length') || 0)
  let baixado = 0
  const corpo = Readable.fromWeb(r.body)
  corpo.on('data', (pedaco) => { baixado += pedaco.length; if (total) aoProgresso(baixado / total) })
  fs.mkdirSync(path.dirname(destino), { recursive: true })
  await pipeline(corpo, fs.createWriteStream(destino))
}

// win: janela principal (progresso na barra de tarefas); antesDeInstalar: para os
// serviços, senão o instalador não consegue substituir llama-server/OCR
async function verificar(win, antesDeInstalar) {
  const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: { 'User-Agent': 'X.LLM' }
  })
  if (!r.ok) throw new Error(`GitHub respondeu ${r.status}`)
  const release = await r.json()
  const nova = release.tag_name.replace(/^v/, '')
  if (!maisNova(nova, app.getVersion()) || lerEstado().pular === nova) return

  const sufixo = `-${config.variante.toUpperCase()}-Setup-`
  const instalador = release.assets.find((a) => a.name.includes(sufixo) && a.name.endsWith('.exe'))
  const { response } = await dialog.showMessageBox(win, {
    type: 'info',
    title: 'X.LLM',
    message: `Nova versão disponível: ${nova}`,
    detail: `Você está na ${app.getVersion()}.` +
      (release.body ? `\n\n${release.body.slice(0, 700)}` : '') +
      (instalador ? '' : '\n\nO instalador desta versão não está no release; baixe pela página.'),
    buttons: [instalador ? 'Atualizar agora' : 'Abrir página', 'Ver novidades', 'Depois', 'Pular esta versão'],
    defaultId: 0,
    cancelId: 2,
    noLink: true
  })
  if (response === 1) return shell.openExternal(release.html_url)
  if (response === 3) return fs.writeFileSync(ARQUIVO_ESTADO, JSON.stringify({ pular: nova }))
  if (response !== 0) return
  if (!instalador) return shell.openExternal(release.html_url)

  const destino = path.join(os.tmpdir(), 'X.LLM-atualizacao', instalador.name)
  try {
    await baixar(instalador.browser_download_url, destino, (p) => !win.isDestroyed() && win.setProgressBar(p))
  } catch (erro) {
    if (!win.isDestroyed()) win.setProgressBar(-1)
    dialog.showMessageBox(win, { type: 'error', title: 'X.LLM', message: 'Não deu pra baixar a atualização', detail: erro.message })
    return
  }
  antesDeInstalar()
  // /S = silencioso (mantém a pasta da instalação atual); --force-run abre o app no fim
  spawn(destino, ['/S', '--force-run'], { detached: true, stdio: 'ignore' }).unref()
  app.quit()
}

function iniciar(win, antesDeInstalar) {
  // Só no app instalado (rodando do código não tem instalador pra trocar)
  if (!app.isPackaged || config.verificarAtualizacoes === false) return
  setTimeout(() => {
    verificar(win, antesDeInstalar).catch((erro) => console.error('[atualizacao]', erro.message))
  }, 10_000)
}

module.exports = { iniciar, verificar, maisNova }
