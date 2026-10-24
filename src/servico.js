// Serviço local (llama-server, OCR...) que sobe junto com o app e fecha quando ele fecha.
const { spawn, spawnSync } = require('child_process')
const fs = require('fs')
const path = require('path')
const config = require('./config')

function criarServico({ nome, exe, args, porta, env = {} }) {
  const url = `http://127.0.0.1:${porta}`
  let processo = null
  let pronto = null

  async function saudavel() {
    try {
      const r = await fetch(`${url}/health`, { signal: AbortSignal.timeout(1500) })
      return r.ok
    } catch {
      return false
    }
  }

  // Sobe o processo (ou reaproveita um que já esteja respondendo na porta).
  // A saída vai pra %APPDATA%\X.LLM\logs\<nome>.log, útil pra relatar problemas.
  function iniciar() {
    pronto ??= (async () => {
      if (await saudavel()) return
      if (!fs.existsSync(exe)) throw new Error(`${nome}: não achei ${exe}`)
      fs.mkdirSync(config.pastaLogs, { recursive: true })
      const log = fs.openSync(path.join(config.pastaLogs, `${nome}.log`), 'w')
      processo = spawn(exe, args, { env: { ...process.env, ...env }, windowsHide: true, stdio: ['ignore', log, log] })
      fs.closeSync(log)
      processo.on('exit', () => { processo = null; pronto = null })
      // Até 5 min: carregar o modelo de um HD lento demora
      for (let i = 0; i < 600; i++) {
        if (await saudavel()) return
        if (!processo) break
        await new Promise((r) => setTimeout(r, 500))
      }
      pronto = null
      throw new Error(`${nome} não subiu na porta ${porta} (veja ${nome}.log em ${config.pastaLogs})`)
    })()
    return pronto
  }

  // Mata a árvore toda: o python.exe de um venv no Windows é só um lançador que
  // abre o Python de verdade como filho, e kill() sozinho deixaria o filho órfão
  function parar() {
    if (!processo) return
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/PID', String(processo.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
    } else {
      processo.kill()
    }
  }

  return { url, iniciar, parar }
}

module.exports = { criarServico }
