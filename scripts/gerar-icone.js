// Gera build/icon.png (512px, janela e instalador) e build/icon.ico (16-256px, executável)
// a partir de build/icon.svg. Só precisa rodar de novo se mudar o SVG: npm run icone
const fs = require('fs')
const path = require('path')
const sharp = require('sharp')
const pngToIco = require('png-to-ico').default ?? require('png-to-ico')

const PASTA = path.join(__dirname, '..', 'build')

async function main() {
  const svg = fs.readFileSync(path.join(PASTA, 'icon.svg'))
  await sharp(svg, { density: 1200 }).resize(512, 512).png().toFile(path.join(PASTA, 'icon.png'))
  const tamanhos = await Promise.all([16, 24, 32, 48, 64, 128, 256].map((t) =>
    sharp(svg, { density: 1200 }).resize(t, t).png().toBuffer()))
  fs.writeFileSync(path.join(PASTA, 'icon.ico'), await pngToIco(tamanhos))
  console.log('build/icon.png e build/icon.ico gerados')
}

main().catch((erro) => { console.error(erro); process.exit(1) })
