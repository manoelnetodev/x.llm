// Prepara os binários de uma variante em vendor\<variante>\:
//   llama\  llama-server do último release do llama.cpp (CPU ou Vulkan)
//   ocr\    servidor.py congelado pelo PyInstaller (onnxruntime ou onnxruntime-directml)
//
// Uso: node scripts/preparar.js <cpu|gpu> [--forcar] [--llama=bNNNN]
// Precisa de: Windows x64, internet e uv (https://docs.astral.sh/uv/), que baixa o Python sozinho.
const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const RAIZ = path.join(__dirname, '..')
const LLAMA = {
  cpu: /^llama-b\d+-bin-win-cpu-x64\.zip$/,
  gpu: /^llama-b\d+-bin-win-vulkan-x64\.zip$/ // Vulkan: NVIDIA, AMD e Intel com o mesmo binário
}

function rodar(cmd, args, opcoes = {}) {
  console.log(`> ${cmd} ${args.join(' ')}`)
  execFileSync(cmd, args, { stdio: 'inherit', cwd: RAIZ, ...opcoes })
}

async function baixarArquivo(url, destino) {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`${url} respondeu ${r.status}`)
  fs.writeFileSync(destino, Buffer.from(await r.arrayBuffer()))
}

async function prepararLlama(variante, pasta) {
  const destino = path.join(pasta, 'llama')
  const headers = process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}
  // --llama=b11868 fixa a versão. Sem isso, pega o build mais recente: o "latest"
  // do repositório às vezes é um release sem binários, e os builds bNNNN vêm
  // marcados como pre-release
  const tag = process.argv.find((a) => a.startsWith('--llama='))?.split('=')[1]
  const api = 'https://api.github.com/repos/ggml-org/llama.cpp/releases'
  const r = await fetch(tag ? `${api}/tags/${tag}` : `${api}?per_page=20`, { headers })
  if (!r.ok) throw new Error(`API do GitHub respondeu ${r.status}`)
  const releases = [].concat(await r.json()).filter((rel) => !rel.draft)
  const release = releases.find((rel) => rel.assets.some((a) => LLAMA[variante].test(a.name)))
  if (!release) throw new Error(`nenhum release do llama.cpp com build ${variante} pra Windows`)
  const asset = release.assets.find((a) => LLAMA[variante].test(a.name))

  console.log(`llama.cpp ${release.tag_name}: ${asset.name}`)
  const zip = path.join(pasta, asset.name)
  await baixarArquivo(asset.browser_download_url, zip)
  fs.rmSync(destino, { recursive: true, force: true })
  fs.mkdirSync(destino, { recursive: true })
  // O tar do Windows 10+ abre zip (o do Git Bash, que pode vir antes no PATH, não)
  rodar(path.join(process.env.SystemRoot, 'System32', 'tar.exe'), ['-xf', zip, '-C', destino])
  fs.rmSync(zip)

  // O zip vem com todas as ferramentas; o app só usa o llama-server
  for (const arq of fs.readdirSync(destino)) {
    const outroExe = arq.endsWith('.exe') && arq !== 'llama-server.exe'
    const implDeOutro = arq.endsWith('-impl.dll') && arq !== 'llama-server-impl.dll'
    if (outroExe || implDeOutro) fs.rmSync(path.join(destino, arq), { recursive: true })
  }
  if (!fs.existsSync(path.join(destino, 'llama-server.exe'))) throw new Error('llama-server.exe não veio no zip')
  fs.writeFileSync(path.join(destino, 'VERSAO.txt'), `${release.tag_name}\n${asset.name}\n`)
}

function prepararOcr(variante, pasta) {
  const trabalho = path.join(pasta, 'build-ocr')
  const venv = path.join(trabalho, '.venv')
  const python = path.join(venv, 'Scripts', 'python.exe')
  fs.rmSync(trabalho, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 })
  rodar('uv', ['venv', '--python', '3.12', venv])
  rodar('uv', ['pip', 'install', '--python', python, '-r', `ocr/requirements-${variante}.txt`, 'pyinstaller'])
  // O RapidOCR baixa os modelos (PP-OCRv6) no primeiro uso, pra dentro do pacote:
  // força agora pra eles irem junto no executável
  rodar(python, ['-c', 'from rapidocr import RapidOCR; RapidOCR()'])
  rodar(python, [
    '-m', 'PyInstaller', '--noconfirm', '--clean', '--onedir', '--name', 'servidor',
    '--distpath', trabalho, '--workpath', path.join(trabalho, 'work'), '--specpath', trabalho,
    '--collect-all', 'rapidocr', '--collect-binaries', 'onnxruntime',
    'ocr/servidor.py'
  ])
  const destino = path.join(pasta, 'ocr')
  fs.rmSync(destino, { recursive: true, force: true })
  // Copia em vez de mover: o antivírus costuma segurar o .exe recém-gerado
  fs.cpSync(path.join(trabalho, 'servidor'), destino, { recursive: true })
  fs.rmSync(trabalho, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 })
}

async function main() {
  const variante = process.argv[2]
  if (!LLAMA[variante]) {
    console.error('uso: node scripts/preparar.js <cpu|gpu> [--forcar]')
    process.exit(1)
  }
  const forcar = process.argv.includes('--forcar')
  const pasta = path.join(RAIZ, 'vendor', variante)
  fs.mkdirSync(pasta, { recursive: true })

  if (forcar || !fs.existsSync(path.join(pasta, 'llama', 'llama-server.exe'))) await prepararLlama(variante, pasta)
  else console.log(`vendor/${variante}/llama já existe (use --forcar pra baixar de novo)`)

  if (forcar || !fs.existsSync(path.join(pasta, 'ocr', 'servidor.exe'))) prepararOcr(variante, pasta)
  else console.log(`vendor/${variante}/ocr já existe (use --forcar pra gerar de novo)`)

  console.log(`vendor/${variante} pronto`)
}

main().catch((erro) => { console.error(erro.message); process.exit(1) })
