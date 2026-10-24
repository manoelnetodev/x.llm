const { app, BrowserWindow, WebContentsView, dialog, ipcMain, session, shell } = require('electron')
const path = require('path')
const config = require('./config')
const modelo = require('./modelo')
const tradutor = require('./tradutor')
const imagens = require('./imagens')

// User agent de Chrome comum, sem "Electron/xx": vale pra sessão toda,
// inclusive pros popups de login (o Google recusa navegador embutido)
const USER_AGENT = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`
app.userAgentFallback = USER_AGENT

// Tweet traduzido: esconde o original e mostra o texto em PT no lugar,
// com a badge do X.LLM embaixo (insertCSS não esbarra no CSP do X)
const LARGURA_FEED = 720 // px; o X usa 600
const CSS_TRADUCAO = `
[data-testid="sidebarColumn"] { display: none !important; } /* coluna da direita (busca, Premium, trends, Who to follow) */
/* Sem a coluna da direita, os containers do X (fixos em 990px) encolhem pro feed,
   e o próprio X centraliza menu + feed na tela */
main[role="main"] > div, main[role="main"] > div > div, main[role="main"] > div > div > div { width: auto !important; }
[data-testid="primaryColumn"] { width: ${LARGURA_FEED}px !important; max-width: ${LARGURA_FEED}px !important; flex-grow: 0 !important; }
[data-testid="primaryColumn"] .r-1ye8kvj { max-width: none !important; } /* timeline e barras de ação: 600px */
button[data-testid="tweet-text-show-more-link"] { display: none !important; } /* o app expande sozinho */
[data-xel-anuncio] { display: none !important; } /* tweets "Ad" (marcados pelo preload) */
[data-testid="GrokDrawer"], [data-testid="chat-drawer-root"] { display: none !important; } /* botões flutuantes Grok/Chat (seguem no menu) */
/* Texto traduzido desenhado por cima das fotos (posições calculadas no preload) */
.xel-foto { position: absolute; inset: 0; z-index: 1; overflow: hidden; pointer-events: none; }
.xel-foto-bloco { position: absolute; box-sizing: border-box; display: flex; align-items: center; overflow: hidden;
  padding: 0 2px; border-radius: 3px; line-height: 1.15; font-weight: 600; overflow-wrap: anywhere;
  backdrop-filter: blur(6px); /* em fundo com textura o remendo fica suave em vez de recortado */
  font-family: TwitterChirp, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
[data-xel-foto="original"] .xel-foto-bloco { display: none; }
.xel-foto-linha { white-space: nowrap; }
.xel-rodape.xel-rodape-fotos { margin-top: 6px; } /* badge das fotos, logo abaixo delas */
[data-traducao="pt"] { display: none !important; }
[data-traducao="en"] + .xel-traducao .xel-texto { display: none; }
.xel-texto { white-space: pre-wrap; overflow-wrap: break-word; }
.xel-rodape { display: flex; align-items: center; gap: 8px; margin-top: 8px; user-select: none;
  font-family: TwitterChirp, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
.xel-badge { display: inline-flex; align-items: center; padding: 2px 8px; border-radius: 4px;
  font-size: 12px; line-height: 18px; font-weight: 700; letter-spacing: .01em;
  color: rgb(29, 155, 240); background: rgba(29, 155, 240, .12); border: 1px solid rgba(29, 155, 240, .35); }
[data-traducao="en"] + .xel-traducao .xel-badge { opacity: .45; }
.xel-alternar { margin-left: auto; font-size: 13px; line-height: 16px; color: rgb(113, 118, 123); cursor: pointer; }
.xel-alternar:hover { text-decoration: underline; }
`

const DO_X = /^https:\/\/([\w-]+\.)?(x|twitter)\.com\//
// Popups de login que precisam abrir DENTRO do app, com window.opener,
// pra devolver a autenticação pro X
const LOGIN = /^https:\/\/(accounts\.google\.com|accounts\.youtube\.com|appleid\.apple\.com)\//

// Decide o que fazer com cada window.open, na view principal e nos popups
function tratarPopups(wc, principal) {
  wc.setWindowOpenHandler(({ url }) => {
    if (LOGIN.test(url) || url === 'about:blank') {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: { width: 520, height: 700, autoHideMenuBar: true }
      }
    }
    if (DO_X.test(url)) principal.loadURL(url)
    else shell.openExternal(url)
    return { action: 'deny' }
  })
  wc.on('did-create-window', (popup) => tratarPopups(popup.webContents, principal))
}

function criarJanela() {
  session.fromPartition('persist:x').setUserAgent(USER_AGENT)

  const win = new BrowserWindow({
    width: 1200,
    height: 850,
    title: 'X',
    icon: config.icone,
    backgroundColor: '#000000',
    autoHideMenuBar: true
  })

  // O X roda numa view separada, com sessão salva em disco (login persiste)
  const view = new WebContentsView({
    webPreferences: { partition: 'persist:x', preload: path.join(__dirname, 'preload.js') }
  })
  win.contentView.addChildView(view)

  const ajustar = () => {
    const [w, h] = win.getContentSize()
    view.setBounds({ x: 0, y: 0, width: w, height: h })
  }
  ajustar()
  win.on('resize', ajustar)

  const wc = view.webContents
  tratarPopups(wc, wc)

  // Atalhos: Alt+← / Alt+→ navegam, F5 recarrega, F12 abre o DevTools
  wc.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return
    if (input.alt && input.key === 'ArrowLeft' && wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack()
    else if (input.alt && input.key === 'ArrowRight' && wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward()
    else if (input.key === 'F5') wc.reload()
    else if (input.key === 'F12') wc.openDevTools({ mode: 'detach' })
    else return
    e.preventDefault()
  })

  wc.on('dom-ready', () => wc.insertCSS(CSS_TRADUCAO))
  wc.on('page-title-updated', (_e, titulo) => { tituloX = titulo; atualizarTitulo(win) })
  wc.loadURL('https://x.com')
  return win
}

// Título = título da página do X, com o estado do download do modelo na frente
let tituloX = 'X'
let avisoTitulo = ''
function atualizarTitulo(win) {
  if (!win.isDestroyed()) win.setTitle(avisoTitulo ? `${avisoTitulo} — ${tituloX}` : tituloX)
}

// Primeira abertura: o modelo (2,5-3,2 GB) baixa em segundo plano. O X já fica
// usável; o progresso aparece na barra de tarefas e no título da janela.
function mostrarDownload(win) {
  if (!modelo.precisaBaixar()) return
  const gb = (n) => (n / 1024 ** 3).toFixed(2)
  modelo.eventos.on('progresso', ({ baixado, total }) => {
    if (win.isDestroyed()) return
    win.setProgressBar(total ? baixado / total : 2) // 2 = indeterminado
    avisoTitulo = `Baixando modelo de tradução: ${gb(baixado)} / ${gb(total)} GB`
    atualizarTitulo(win)
  })
  modelo.eventos.on('fim', () => {
    if (win.isDestroyed()) return
    win.setProgressBar(-1)
    avisoTitulo = ''
    atualizarTitulo(win)
  })
  modelo.eventos.on('erro', (erro) => {
    if (win.isDestroyed()) return
    win.setProgressBar(1, { mode: 'error' })
    avisoTitulo = `Falha ao baixar o modelo (${erro.message}), tentando de novo em 30 s`
    atualizarTitulo(win)
  })
}

// Erro que impede a tradução de funcionar (binário faltando etc.): avisa uma vez só
let avisou = false
function avisarErro(servico, erro) {
  console.error(`[${servico}]`, erro.message)
  if (avisou || /download do modelo|fetch failed/.test(erro.message)) return
  avisou = true
  dialog.showMessageBox({
    type: 'warning',
    title: 'X.LLM',
    message: 'A tradução não conseguiu iniciar',
    detail: `${erro.message}\n\nO X continua funcionando, só sem tradução. Logs em:\n${config.pastaLogs}`
  })
}

ipcMain.handle('traduzir', (_e, texto, lang) => tradutor.traduzir(texto, lang))
ipcMain.handle('traduzir-imagem', (_e, src) => imagens.traduzirImagem(src))

app.whenReady().then(() => {
  const win = criarJanela()
  mostrarDownload(win)
  tradutor.iniciar().catch((erro) => avisarErro('tradutor', erro))
  imagens.iniciar().catch((erro) => avisarErro('ocr', erro))
})
app.on('will-quit', () => { tradutor.parar(); imagens.parar() })
app.on('window-all-closed', () => app.quit())
