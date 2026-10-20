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
fs.cpSync('public', path.join(out, 'public'), { recursive: true })
fs.writeFileSync(path.join(out, 'version.txt'), String(Date.now()))
console.log('assets OK:', (fs.statSync(path.join(out, 'server.cjs')).size / 1048576).toFixed(1), 'MB')
