// Roda dentro da página do X: acha tweets e bios em outros idiomas que entram
// na tela e mostra a tradução em português no lugar do texto original.
const { contextBridge, ipcRenderer } = require('electron')

// Sem autoplay de vídeo: o play() da página só vale se vier de um clique
// (userActivation). Vídeo que você já deu play fica liberado, pra o X poder
// retomar depois de carregar. Roda no mundo da página, antes dos scripts do X.
contextBridge.executeInMainWorld({
  func: () => {
    const play = HTMLMediaElement.prototype.play
    const liberados = new WeakSet()
    HTMLMediaElement.prototype.play = function () {
      if (navigator.userActivation?.isActive) liberados.add(this)
      if (liberados.has(this)) return play.call(this)
      return Promise.reject(new DOMException('Autoplay desativado', 'NotAllowedError'))
    }
  }
})

// Tweets: o próprio X marca o idioma no atributo lang (o tradutor ignora pt e
// os códigos especiais). Bios não têm lang: o idioma é detectado no tradutor.
const SELETOR = [
  '[data-testid="tweetText"][lang]',
  '[data-testid="UserDescription"]', // bio no perfil
  '[data-testid="UserCell"] > div > div > div[dir="auto"]' // bio no "Who to follow" e listas
].map((s) => s + ':not([data-traducao])').join(', ')

// Monta o texto do tweet. Links, @menções e #hashtags (todos <a> no X) viram
// marcadores {1}, {2}... pra não serem traduzidos; emoji vem do alt da imagem.
function extrair(el) {
  const links = []
  let comMarcadores = ''
  let cru = ''
  let palavras = ''
  const andar = (no) => {
    for (const filho of no.childNodes) {
      if (filho.nodeType === Node.TEXT_NODE) {
        comMarcadores += filho.data
        cru += filho.data
        palavras += filho.data
      } else if (filho.nodeName === 'IMG') {
        comMarcadores += filho.alt
        cru += filho.alt
      } else if (filho.nodeName === 'A') {
        links.push(filho)
        comMarcadores += `{${links.length}}`
        cru += filho.textContent
      } else {
        andar(filho)
      }
    }
  }
  andar(el)
  return { comMarcadores, cru, links, temPalavras: /\p{L}{2,}/u.test(palavras) }
}

// Monta a tradução recolocando os links/menções/hashtags originais (clonados,
// continuam clicáveis) no lugar dos marcadores; null se algum marcador sumiu
function montarComLinks(saida, links) {
  const partes = saida.split(/\{(\d+)\}/)
  const usados = new Set()
  const frag = document.createDocumentFragment()
  partes.forEach((parte, i) => {
    if (i % 2 === 0) return parte && frag.append(parte)
    const link = links[Number(parte) - 1]
    if (link) { frag.append(link.cloneNode(true)); usados.add(link) } else frag.append(`{${parte}}`)
  })
  return usados.size === links.length ? frag : null
}

// Textos longos vão em blocos de parágrafos, traduzidos em paralelo:
// mais rápido e não estoura o contexto do modelo em posts enormes
const LIMITE_BLOCO = 1500
async function traduzirTexto(texto, lang) {
  const pedacos = texto.split(/(\n{2,})/) // [parágrafo, separador, parágrafo, ...]
  const blocos = []
  const juntas = [] // separador entre um bloco e o seguinte
  let atual = ''
  let sepPendente = ''
  for (let i = 0; i < pedacos.length; i += 2) {
    const paragrafo = pedacos[i]
    if (atual && atual.length + paragrafo.length > LIMITE_BLOCO) {
      blocos.push(atual)
      juntas.push(sepPendente)
      atual = paragrafo
    } else {
      atual += sepPendente + paragrafo
    }
    sepPendente = pedacos[i + 1] ?? ''
  }
  blocos.push(atual)
  const traduzidos = await Promise.all(blocos.map((b) => (b.trim() ? ipcRenderer.invoke('traduzir', b, lang) : null)))
  // null = bloco que não precisa de tradução (já está em português): fica o original
  if (traduzidos.every((t) => t == null)) return null
  return traduzidos.reduce((acc, t, i) => acc + (i ? juntas[i - 1] : '') + (t ?? blocos[i]), '')
}

const BADGE = 'Traduzido por X.LLM'
const ALTERNAR_PT = 'ver original'
const ALTERNAR_ORIGINAL = 'ver tradução'

// Texto que cada tweet tinha quando foi traduzido; se mudar (Show more), traduz de novo
const traduzidoDe = new WeakMap()
const emAndamento = new WeakSet()

async function traduzirElemento(el) {
  if (emAndamento.has(el)) return
  const { comMarcadores, cru, links, temPalavras } = extrair(el)
  if (!temPalavras) return
  const snapshot = el.textContent
  const lang = el.getAttribute('lang') || 'auto'
  emAndamento.add(el)

  try {
    let conteudo
    if (links.length) {
      const pt = await traduzirTexto(comMarcadores, lang)
      if (pt == null) return
      conteudo = montarComLinks(pt, links)
    }
    if (!conteudo) {
      const pt = await traduzirTexto(cru, lang)
      if (!pt || pt.trim() === cru.trim()) return
      conteudo = pt
    }
    // O texto mudou enquanto traduzia (ex.: Show more no meio): começa de novo
    if (!el.isConnected) return
    if (el.textContent !== snapshot) {
      emAndamento.delete(el)
      return traduzirElemento(el)
    }

    // Mesma fonte, tamanho e cor do texto original (muda entre timeline e tweet aberto).
    // Se o original já está escondido, mostra ele por um instante só pra medir.
    const estadoAnterior = el.dataset.traducao
    if (estadoAnterior === 'pt') el.dataset.traducao = 'en'
    const estilo = getComputedStyle(el)
    const caixa = document.createElement('div')
    caixa.className = 'xel-traducao'
    const texto = document.createElement('div')
    texto.className = 'xel-texto'
    for (const p of ['fontFamily', 'fontSize', 'lineHeight', 'color', 'fontWeight']) texto.style[p] = estilo[p]
    texto.append(conteudo)
    // Respeita a escolha de quem clicou em "ver original" antes do Show more
    const mostrandoOriginal = estadoAnterior === 'en'
    const rodape = document.createElement('div')
    rodape.className = 'xel-rodape'
    const badge = document.createElement('span')
    badge.className = 'xel-badge'
    badge.textContent = BADGE
    const alternar = document.createElement('span')
    alternar.className = 'xel-alternar'
    alternar.textContent = mostrandoOriginal ? ALTERNAR_ORIGINAL : ALTERNAR_PT
    // Alterna original/tradução sem deixar o clique abrir o tweet
    alternar.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      const emPt = el.dataset.traducao === 'pt'
      el.dataset.traducao = emPt ? 'en' : 'pt'
      alternar.textContent = emPt ? ALTERNAR_ORIGINAL : ALTERNAR_PT
    })
    rodape.append(badge, alternar)
    caixa.append(texto, rodape)
    // Troca a tradução antiga (se houver) pela nova de uma vez, sem piscar
    const antiga = el.nextElementSibling
    if (antiga?.classList.contains('xel-traducao')) antiga.replaceWith(caixa)
    else el.after(caixa)
    el.dataset.traducao = mostrandoOriginal ? 'en' : 'pt'
    traduzidoDe.set(el, snapshot)
  } catch (erro) {
    console.warn('[xbr] falha ao traduzir:', erro)
  } finally {
    emAndamento.delete(el)
  }
}

// Tweets já traduzidos cujo texto mudou depois (Show more expande no mesmo elemento)
function conferirMudancas() {
  for (const el of document.querySelectorAll('[data-traducao="pt"], [data-traducao="en"]')) {
    if (traduzidoDe.has(el) && traduzidoDe.get(el) !== el.textContent) traduzirElemento(el)
  }
}

// Só traduz o que está na tela (ou quase), pra não gastar com o que você nunca vai ver
const naTela = new IntersectionObserver((entradas) => {
  for (const e of entradas) {
    if (!e.isIntersecting) continue
    naTela.unobserve(e.target)
    traduzirElemento(e.target)
  }
}, { rootMargin: '600px 0px' })

// "Show more" que expande no próprio tweet: clica sozinho (o botão fica escondido
// pelo CSS) pra traduzir o texto inteiro de primeira. O que é link pra página do
// tweet (<a>) não expande aqui, então fica como está.
const expandidos = new WeakSet()
function expandirTudo() {
  for (const b of document.querySelectorAll('button[data-testid="tweet-text-show-more-link"]')) {
    if (expandidos.has(b)) continue
    expandidos.add(b)
    b.click()
  }
}

// Anúncios: o X não marca no DOM (os testids de anúncio também aparecem em tweet
// normal com vídeo), só pelo rótulo "Ad" no canto. Esconde a célula inteira.
const ROTULO_AD = /^(Ad|Promoted|Anúncio|Promovido)$/
const ehAnuncio = new WeakMap() // article -> boolean, pra checar cada tweet uma vez só
function esconderAnuncios() {
  for (const art of document.querySelectorAll('[data-testid="cellInnerDiv"] article')) {
    if (!ehAnuncio.has(art)) {
      ehAnuncio.set(art, [...art.querySelectorAll('span')].some((s) => !s.children.length && ROTULO_AD.test(s.textContent.trim())))
    }
    // A célula pode ser reaproveitada pra outro tweet: marca/desmarca sempre
    const celula = art.closest('[data-testid="cellInnerDiv"]')
    if (ehAnuncio.get(art)) celula.dataset.xelAnuncio = '1'
    else delete celula.dataset.xelAnuncio
  }
}

// ---- Texto dentro das fotos ----
// O X desenha a foto como fundo com background-size: cover centralizado, então a
// posição de cada bloco (em fração da imagem original) passa pela mesma conta.
function posicionarCamada(foto, camada, dados) {
  const cw = foto.clientWidth
  const ch = foto.clientHeight
  if (!cw || !ch) return
  const escala = Math.max(cw / dados.largura, ch / dados.altura)
  const ox = (cw - dados.largura * escala) / 2
  const oy = (ch - dados.altura * escala) / 2
  const naoCabe = (div) => div.scrollHeight > div.clientHeight + 1 || div.scrollWidth > div.clientWidth + 1
  for (const div of camada.querySelectorAll('.xel-foto-bloco')) {
    const b = dados.blocos[Number(div.dataset.indice)]
    const linha = b.alturaLinha * dados.altura * escala
    // Folga pra cobrir a borda das letras originais; pouca na vertical pra não
    // comer a linha de cima/baixo (título + descrição coladas, por exemplo)
    const folgaX = linha * 0.15
    const folgaY = linha * 0.08
    const left = ox + b.x * dados.largura * escala - folgaX
    div.style.left = `${left}px`
    div.style.top = `${oy + b.y * dados.altura * escala - folgaY}px`
    div.style.width = `${b.w * dados.largura * escala + folgaX * 2}px`
    div.style.height = `${b.h * dados.altura * escala + folgaY * 2}px`
    // Começa no tamanho da letra original e encolhe até a tradução caber
    const inicial = Math.max(linha * 0.8, 7)
    let fonte = inicial
    div.style.fontSize = `${fonte}px`
    if (b.linhas === 1) {
      // Linha única continua linha única: encolhe até 75% e, se ainda não
      // couber, cresce pra direita em vez de quebrar e invadir a linha de cima
      div.classList.add('xel-foto-linha')
      while (fonte > inicial * 0.75 && naoCabe(div)) div.style.fontSize = `${(fonte *= 0.94)}px`
      if (naoCabe(div)) div.style.width = `${Math.min(div.scrollWidth + 4, cw - left)}px`
    }
    while (fonte > 6 && naoCabe(div)) div.style.fontSize = `${(fonte *= 0.92)}px`
  }
}

const camadas = new WeakMap() // foto -> { camada, dados }
const redimensionou = new ResizeObserver((entradas) => {
  for (const e of entradas) {
    const c = camadas.get(e.target)
    if (c) posicionarCamada(e.target, c.camada, c.dados)
  }
})

async function traduzirFoto(foto) {
  const img = foto.querySelector('img[src*="/media/"]')
  if (!img) return
  const src = img.src
  try {
    const dados = await ipcRenderer.invoke('traduzir-imagem', src)
    // A célula pode ter sido reaproveitada pra outra foto enquanto traduzia
    if (!dados || !foto.isConnected || foto.querySelector('img')?.src !== src) return

    const camada = document.createElement('div')
    camada.className = 'xel-foto'
    dados.blocos.forEach((b, i) => {
      const div = document.createElement('div')
      div.className = 'xel-foto-bloco'
      div.dataset.indice = i
      div.textContent = b.texto
      div.style.background = `rgb(${b.fundo.join(' ')} / .92)`
      div.style.color = `rgb(${b.letra.join(' ')})`
      camada.append(div)
    })
    foto.querySelector('.xel-foto')?.remove()
    foto.append(camada)
    foto.dataset.xelFoto = 'pt'
    posicionarCamada(foto, camada, dados)
    camadas.set(foto, { camada, dados })
    redimensionou.observe(foto)
    rodapeDasFotos(foto)?.fotos.add(foto)
  } catch (erro) {
    console.warn('[xbr] falha ao traduzir imagem:', erro)
  }
}

// Container das fotos do tweet (1 a 4 fotos): o filho, dentro do bloco do tweet
// que também tem a barra de ações, que contém a foto
function containerDasFotos(foto) {
  const grupo = foto.closest('article')?.querySelector('[role="group"]')
  if (!grupo) return null
  let e = foto
  while (e.parentElement && !e.parentElement.contains(grupo)) e = e.parentElement
  return [...e.children].find((c) => c.contains(foto)) ?? e
}

// Linha da badge logo abaixo das fotos, uma por tweet mesmo com 4 fotos traduzidas;
// "ver original" alterna todas juntas
const rodapes = new WeakMap() // container das fotos -> { rodape, fotos }
function rodapeDasFotos(foto) {
  const container = containerDasFotos(foto)
  if (!container) return null
  const existente = rodapes.get(container)
  if (existente?.rodape.isConnected) return existente

  const rodape = document.createElement('div')
  rodape.className = 'xel-rodape xel-rodape-fotos'
  const badge = document.createElement('span')
  badge.className = 'xel-badge'
  badge.textContent = BADGE
  const alternar = document.createElement('span')
  alternar.className = 'xel-alternar'
  alternar.textContent = ALTERNAR_PT
  const info = { rodape, fotos: new Set() }
  // O clique não pode abrir o tweet nem o visualizador de fotos
  rodape.addEventListener('click', (e) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.target !== alternar) return
    const emPt = alternar.textContent === ALTERNAR_PT
    for (const f of info.fotos) if (f.isConnected) f.dataset.xelFoto = emPt ? 'original' : 'pt'
    alternar.textContent = emPt ? ALTERNAR_ORIGINAL : ALTERNAR_PT
  })
  rodape.append(badge, alternar)
  container.after(rodape)
  rodapes.set(container, info)
  return info
}

const fotoNaTela = new IntersectionObserver((entradas) => {
  for (const e of entradas) {
    if (!e.isIntersecting) continue
    fotoNaTela.unobserve(e.target)
    traduzirFoto(e.target)
  }
}, { rootMargin: '400px 0px' })

function procurarFotos() {
  for (const foto of document.querySelectorAll('[data-testid="tweetPhoto"]:not([data-xel-foto])')) {
    if (!foto.querySelector('img[src*="/media/"]')) continue // vídeo, ou foto ainda carregando
    foto.dataset.xelFoto = '1'
    fotoNaTela.observe(foto)
  }
}

function procurar() {
  esconderAnuncios()
  expandirTudo()
  for (const el of document.querySelectorAll(SELETOR)) {
    el.dataset.traducao = '1'
    naTela.observe(el)
  }
  procurarFotos()
}

// O X muda o DOM o tempo todo; agrupa as mudanças em uma busca por frame
let agendado = false
function agendar() {
  if (agendado) return
  agendado = true
  requestAnimationFrame(() => { agendado = false; procurar(); conferirMudancas() })
}

window.addEventListener('DOMContentLoaded', () => {
  new MutationObserver(agendar).observe(document.body, { childList: true, subtree: true })
  agendar()
})
