import { webcrypto } from 'node:crypto'
if (!globalThis.crypto) globalThis.crypto = webcrypto
import makeWASocket, {
  useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, Browsers, BufferJSON,
  downloadMediaMessage, normalizeMessageContent, getContentType, jidNormalizedUser,
} from '@whiskeysockets/baileys'
import express from 'express'
import { WebSocketServer } from 'ws'
import http from 'http'
import fs from 'fs'
import path from 'path'
import { randomBytes } from 'node:crypto'
import { webmToOgg, isWebm } from './audio.js'

/* ============================== Configuração ============================== */
const ROOT = process.env.WA_ROOT || process.cwd()
const PUBLIC = process.env.WA_PUBLIC || path.join(ROOT, 'public')
const DATA = process.env.WA_DATA || path.join(ROOT, 'userdata')
const PORT = Number(process.env.PORT || 3000)
const HOST = process.env.HOST || '127.0.0.1'
const KEY = process.env.WA_KEY || ''        // no APK: token aleatório que protege o servidor local
const AUTH_DIR = path.join(DATA, 'auth'), MEDIA_DIR = path.join(DATA, 'media'), AV_DIR = path.join(DATA, 'avatars')
const STORE_FILE = path.join(DATA, 'store.json')
const MAX_MSGS = 300, DAY = 86400
for (const d of [DATA, MEDIA_DIR, AV_DIR]) fs.mkdirSync(d, { recursive: true })

console.log('[server] iniciando · Node', process.version, '· dados em', DATA)
const noop = () => {}
const logger = process.env.LOG
  ? new Proxy({ level: 'debug', child() { return logger } }, { get: (t, k) => t[k] ?? ((...a) => console.log(String(k), ...a)) })
  : { level: 'silent', trace: noop, debug: noop, info: noop, warn: noop, error: noop, fatal: noop, child() { return logger } }

/* ============================== Store (JSON em disco) ============================== */
const freshStore = () => ({ chats: {}, contacts: {}, notify: {}, alt: {}, messages: {}, statuses: [], calls: [], avMiss: {}, lists: [], stickers: [], starred: {}, blocked: [], cfg: {} })
let store = {}
try { store = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'), BufferJSON.reviver) } catch {}
store = { ...freshStore(), ...store }

let saveTimer
const writeStore = () => { try { fs.writeFileSync(STORE_FILE + '.tmp', JSON.stringify(store, BufferJSON.replacer)); fs.renameSync(STORE_FILE + '.tmp', STORE_FILE) } catch (e) { console.error('save[...