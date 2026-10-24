// Gera o instalador de uma variante em dist\: X.LLM-<CPU|GPU>-Setup-<versão>.exe
// Uso: node scripts/empacotar.js <cpu|gpu>
const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')
const { Arch, Platform, build } = require('electron-builder')

const RAIZ = path.join(__dirname, '..')
const variante = process.argv[2]
if (!['cpu', 'gpu'].includes(variante)) {
  console.error('uso: node scripts/empacotar.js <cpu|gpu>')
  process.exit(1)
}

// Binários da variante (só baixa/gera o que ainda não existe)
execFileSync(process.execPath, [path.join(__dirname, 'preparar.js'), variante], { stdio: 'inherit' })

const vendor = path.join(RAIZ, 'vendor', variante)
const SUFIXO = variante.toUpperCase()

build({
  targets: Platform.WINDOWS.createTarget('nsis', Arch.x64),
  config: {
    appId: 'io.github.manoelnetodev.xllm',
    productName: 'X.LLM',
    publish: null, // o release é feito pelo workflow (o app não tem atualização automática)
    // Grava a variante no package.json de dentro do app (lido por src/config.js)
    extraMetadata: { variante },
    directories: { output: 'dist', buildResources: 'build' },
    files: ['src/**', 'build/icon.png', 'package.json'],
    extraResources: [
      { from: path.join(vendor, 'llama'), to: 'llama' },
      { from: path.join(vendor, 'ocr'), to: 'ocr' }
    ],
    win: { icon: 'build/icon.ico', executableName: 'X.LLM' },
    nsis: {
      oneClick: false,
      perMachine: false, // instala em %LOCALAPPDATA%, sem pedir administrador
      allowToChangeInstallationDirectory: true,
      artifactName: `\${productName}-${SUFIXO}-Setup-\${version}.\${ext}`,
      shortcutName: 'X.LLM',
      uninstallDisplayName: `X.LLM (${SUFIXO})`
    }
  }
}).then((arquivos) => {
  for (const a of arquivos.filter((a) => a.endsWith('.exe'))) {
    console.log(`${path.relative(RAIZ, a)} (${(fs.statSync(a).size / 1024 ** 2).toFixed(0)} MB)`)
  }
}).catch((erro) => { console.error(erro); process.exit(1) })
