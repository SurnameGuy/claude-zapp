// Gera os arquivos que vão dentro do APK: servidor (1 arquivo) + interface.
import { build } from 'esbuild'
import fs from 'fs'
import path from 'path'

const out = path.resolve('android/app/src/main/assets')
fs.rmSync(out, { recursive: true, force: true })
fs.mkdirSync(out, { recursive: true })

await build({
  entryPoints: ['server/index.js'],
  outfile: path.join(out, 'server.cjs'),
  bundle: true, platform: 'node', target: 'node18', format: 'cjs', minify: true, legalComments: 'none',
  external: ['jimp', 'sharp', 'audio-decode', 'link-preview-js', 'bufferutil', 'utf-8-validate'],
  logOverride: { 'empty-import-meta': 'silent' },
  banner: { js: 'if(!globalThis.crypto)globalThis.crypto=require("node:crypto").webcrypto;var __importMetaUrl=require("url").pathToFileURL(__filename).href;' },
  define: { 'import.meta.url': '__importMetaUrl' },
})
// boot.cjs: roda antes do servidor, registra erros e impede que um erro de JavaScript derrube o app inteiro
fs.writeFileSync(path.join(out, 'boot.cjs'), `
'use strict'
const t0 = Date.now()
const say = (...a) => console.log('[boot]', ...a)
process.on('uncaughtException', (e) => console.error('[uncaught]', e && e.stack || e))
process.on('unhandledRejection', (e) => console.error('[unhandled]', e && e.stack || e))
const realExit = process.exit
process.exit = function (c) { console.error('[boot] process.exit(' + c + ') bloqueado\\n' + new Error().stack) }
say('Node', process.version, process.platform, process.arch, 'uptime', process.uptime().toFixed(1) + 's')
say('WA_ROOT=' + process.env.WA_ROOT, 'WA_DATA=' + process.env.WA_DATA, 'PORT=' + process.env.PORT, 'key=' + (process.env.WA_KEY ? 'ok' : 'FALTANDO'))
try {
  require('./server.cjs')
  say('servidor carregado em', Date.now() - t0, 'ms')
} catch (e) {
  console.error('[boot] FALHA ao carregar o servidor:', e && e.stack || e)
  setInterval(() => {}, 60000) // mantém o processo vivo para o relatório de diagnóstico
}
`)
fs.cpSync('public', path.join(out, 'public'), { recursive: true })
fs.writeFileSync(path.join(out, 'version.txt'), String(Date.now()))
console.log('assets OK:', (fs.statSync(path.join(out, 'server.cjs')).size / 1048576).toFixed(1), 'MB')
