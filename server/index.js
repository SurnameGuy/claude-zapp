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
const writeStore = () => { try { fs.writeFileSync(STORE_FILE + '.tmp', JSON.stringify(store, BufferJSON.replacer)); fs.renameSync(STORE_FILE + '.tmp', STORE_FILE) } catch (e) { console.error('save:', e.message) } }
const saveStore = () => { clearTimeout(saveTimer); saveTimer = setTimeout(writeStore, 3000) }
const debounce = (fn, ms) => { let t; return () => { clearTimeout(t); t = setTimeout(fn, ms) } }
const tsOf = (t) => Number(t?.toNumber ? t.toNumber() : t || 0)
const numberOf = (jid = '') => jid.split('@')[0].split(':')[0]
const isIgnored = (j) => !j || j === 'status@broadcast' || j.endsWith('@newsletter') || j.endsWith('@broadcast')
const safe = (s) => String(s).replace(/[^\w.-]/g, '_')

/* ---- LID <-> número ---- */
function canon(jid) {
  if (!jid) return jid
  const n = jidNormalizedUser(jid)
  return n.endsWith('@lid') && store.alt[n] ? store.alt[n] : n
}
function mergeInto(from, to) {
  if (store.chats[from]) {
    const a = store.chats[from], b = (store.chats[to] ||= { id: to, lastTs: 0, unread: 0 })
    b.lastTs = Math.max(b.lastTs || 0, a.lastTs || 0); b.unread = (b.unread || 0) + (a.unread || 0); b.name ||= a.name
    delete store.chats[from]
  }
  if (store.messages[from]) {
    const list = (store.messages[to] ||= []), ids = new Set(list.map((m) => m.key.id))
    for (const m of store.messages[from]) if (!ids.has(m.key.id)) list.push(m)
    list.sort((x, y) => tsOf(x.messageTimestamp) - tsOf(y.messageTimestamp))
    delete store.messages[from]
  }
  for (const k of ['contacts', 'notify']) if (store[k][from]) { store[k][to] ||= store[k][from]; delete store[k][from] }
}
function link(a, b) {
  if (!a || !b) return
  let lid, pn
  for (const j of [a, b]) { if (j.endsWith('@lid')) lid = jidNormalizedUser(j); else if (j.endsWith('@s.whatsapp.net')) pn = jidNormalizedUser(j) }
  if (!lid || !pn || store.alt[lid] === pn) return
  store.alt[lid] = pn; store.alt[pn] = lid
  mergeInto(lid, pn); notifyChats()
}
function onContact(c) {
  if (!c?.id) return
  link(c.id, c.lid); link(c.id, c.jid); link(c.lid, c.jid)
  const id = canon(c.jid || c.id)
  if (c.name) store.contacts[id] = c.name
  if (c.notify) store.notify[id] = c.notify
  if (c.verifiedName && !store.contacts[id]) store.contacts[id] = c.verifiedName
}
function fmtNumber(jid) {
  if (!jid?.endsWith('@s.whatsapp.net')) return ''
  const n = numberOf(jid), m = n.match(/^55(\d{2})(9?\d{4})(\d{4})$/)
  return m ? `+55 ${m[1]} ${m[2]}-${m[3]}` : '+' + n
}
function nameOf(jid) {
  if (!jid) return ''
  const alt = store.alt[jid]
  return store.contacts[jid] || store.contacts[alt] || store.chats[jid]?.name || store.notify[jid] || store.notify[alt] || (jid.endsWith('@g.us') ? 'Grupo' : fmtNumber(jid) || 'Contato')
}
const mediaLabel = (t) => ({ image: '📷 Foto', video: '🎥 Vídeo', audio: '🎤 Áudio', document: '📄 Documento', sticker: 'Figurinha', location: '📍 Localização', contact: '👤 Contato', poll: '📊 Enquete' }[t] || '')

/* ============================== Mensagens ============================== */
const SKIP = new Set(['protocolMessage', 'senderKeyDistributionMessage', 'messageContextInfo', 'pollUpdateMessage', 'reactionMessage', 'keepInChatMessage'])
const VO = ['viewOnceMessage', 'viewOnceMessageV2', 'viewOnceMessageV2Extension']

function parseMessage(m, jidOverride) {
  const jid = jidOverride || canon(m.key.remoteJid)
  const partJid = m.key.participant ? canon(m.key.participant) : null
  const out = {
    id: m.key.id, jid, fromMe: !!m.key.fromMe, ts: tsOf(m.messageTimestamp),
    sender: m.key.fromMe ? 'Você' : partJid ? (nameOf(partJid) === 'Contato' && m.pushName ? '~' + m.pushName : nameOf(partJid)) : '',
    senderJid: partJid || '', type: 'text', text: '', status: m.status ?? (m.key.fromMe ? 2 : 0),
    starred: !!store.starred[m.key.id], edited: !!m._edited,
  }
  if (m._deleted) return { ...out, type: 'text', text: m.key.fromMe ? 'Você apagou esta mensagem' : 'Esta mensagem foi apagada', deleted: true }
  const content = normalizeMessageContent(m.message)
  if (!content) return null
  const type = getContentType(content)
  if (!type || SKIP.has(type)) return null
  const c = content[type]
  const rx = [...(m.reactions || []).map((r) => r.text), ...Object.values(m._rx || {})].filter(Boolean)
  if (rx.length) out.reactions = rx
  const ctx = c?.contextInfo
  if (ctx?.isForwarded) out.forwarded = true
  if (ctx?.quotedMessage) {
    const qc = normalizeMessageContent(ctx.quotedMessage), qt = qc && getContentType(qc), qq = qc?.[qt]
    out.quoted = { id: ctx.stanzaId, sender: ctx.participant ? nameOf(canon(ctx.participant)) : '', text: typeof qq === 'string' ? qq : qq?.text || qq?.caption || mediaLabel(qt?.replace('Message', '')) || '' }
  }
  const vo = VO.some((k) => m.message?.[k]) || !!c?.viewOnce
  switch (type) {
    case 'conversation': out.text = c; break
    case 'extendedTextMessage':
      out.text = c.text || ''
      if (c.backgroundArgb) out.bg = '#' + (c.backgroundArgb >>> 0).toString(16).padStart(8, '0').slice(2)
      break
    case 'imageMessage': case 'videoMessage': case 'audioMessage': case 'documentMessage': case 'stickerMessage':
      out.type = type.replace('Message', '')
      if (vo && out.type !== 'document' && out.type !== 'sticker') { out.viewOnce = true; out.text = ''; break }
      out.text = c.caption || ''; out.mime = c.mimetype; out.fileName = c.fileName || ''; out.ptt = !!c.ptt
      out.seconds = Number(c.seconds || 0); out.w = c.width || 0; out.h = c.height || 0; out.size = tsOf(c.fileLength)
      out.gif = !!c.gifPlayback
      if (c.jpegThumbnail) out.thumb = Buffer.from(c.jpegThumbnail).toString('base64')
      out.cached = fs.existsSync(path.join(MEDIA_DIR, safe(m.key.id)))
      break
    case 'contactMessage': out.type = 'contact'; out.text = c.displayName || 'Contato'; out.vcard = c.vcard || ''; break
    case 'locationMessage': out.type = 'location'; out.lat = c.degreesLatitude; out.lng = c.degreesLongitude; out.text = c.name || c.address || ''; break
    case 'pollCreationMessage': case 'pollCreationMessageV2': case 'pollCreationMessageV3':
      out.type = 'poll'; out.text = c.name || ''; out.options = (c.options || []).map((o) => o.optionName); break
    default: out.text = `[${type.replace('Message', '')}]`
  }
  return out
}

function upsertChat(jid, patch = {}) {
  if (isIgnored(jid)) return null
  const c = (store.chats[jid] ||= { id: jid, lastTs: 0, unread: 0 })
  for (const [k, v] of Object.entries(patch)) if (v !== undefined && v !== null) c[k] = v
  return c
}
function addReaction(m) {
  const r = m.message?.reactionMessage
  if (!r?.key?.id) return
  const jid = canon(r.key.remoteJid || m.key.remoteJid)
  const target = (store.messages[jid] || []).find((x) => x.key.id === r.key.id)
  if (!target) return
  target._rx ||= {}
  const who = m.key.fromMe ? 'me' : m.key.participant || m.key.remoteJid
  if (r.text) target._rx[who] = r.text; else delete target._rx[who]
  saveStore()
  const p = parseMessage(target)
  if (p) broadcast('message', { chat: chatView(jid), message: p })
}

function addMessage(m, { notify = false } = {}) {
  if (!m?.key || !m.message) return null
  const raw = m.key.remoteJid
  link(raw, m.key.senderPn); link(raw, m.key.senderLid)
  if (m.key.participant) { link(m.key.participant, m.key.participantPn); link(m.key.participant, m.key.participantLid) }
  if (raw === 'status@broadcast') return addStatus(m)
  if (isIgnored(raw)) return null
  if (m.message.reactionMessage) { addReaction(m); return null }
  const jid = canon(raw)
  const parsed = parseMessage(m, jid)
  if (!parsed) return null
  const list = (store.messages[jid] ||= [])
  if (list.some((x) => x.key.id === m.key.id)) return null
  list.push(m)
  const n = list.length
  if (n > 1 && tsOf(list[n - 2].messageTimestamp) > tsOf(m.messageTimestamp)) list.sort((a, b) => tsOf(a.messageTimestamp) - tsOf(b.messageTimestamp))
  if (n > MAX_MSGS) list.splice(0, n - MAX_MSGS)
  const chat = upsertChat(jid)
  chat.lastTs = Math.max(chat.lastTs || 0, parsed.ts)
  if (notify && !m.key.fromMe) chat.unread = (chat.unread || 0) + 1
  if (!m.key.fromMe && m.pushName) { const who = jid.endsWith('@g.us') ? canon(m.key.participant) : jid; if (who) store.notify[who] ||= m.pushName }
  if (parsed.type === 'sticker' && m.message?.stickerMessage) rememberSticker(m)
  saveStore()
  return parsed
}
function rememberSticker(m) {
  const sha = Buffer.from(m.message.stickerMessage.fileSha256 || []).toString('base64')
  if (!sha || store.stickers.some((s) => s.sha === sha)) return
  store.stickers.unshift({ sha, id: m.key.id, raw: m })
  store.stickers.length = Math.min(store.stickers.length, 80)
}
function addStatus(m) {
  const poster = m.key.fromMe ? me : canon(m.key.participant || '')
  if (!poster || !parseMessage(m, 'status@broadcast')) return null
  const now = Date.now() / 1000
  if (tsOf(m.messageTimestamp) < now - DAY || store.statuses.some((x) => x.key.id === m.key.id)) return null
  if (m.pushName && !m.key.fromMe) store.notify[poster] ||= m.pushName
  m._poster = poster
  store.statuses.push(m)
  store.statuses = store.statuses.filter((x) => tsOf(x.messageTimestamp) > now - DAY).slice(-400)
  saveStore(); broadcast('statuses', null)
  return null
}
const rawOf = (jid, id) => (store.messages[canon(jid)] || []).find((x) => x.key.id === id)

function chatView(jid) {
  const c = store.chats[jid] || {}
  const msgs = store.messages[jid] || []
  let p = null
  for (let i = msgs.length - 1; i >= 0 && !p; i--) p = parseMessage(msgs[i], jid)
  if (jid.endsWith('@g.us') && !store.chats[jid]?.name) ensureGroup(jid)
  return {
    id: jid, name: nameOf(jid), number: fmtNumber(jid), isGroup: jid.endsWith('@g.us'),
    lastTs: Math.max(c.lastTs || 0, p?.ts || 0), unread: c.unread || 0, markedUnread: !!c.markedUnread,
    pinned: !!c.pinned, muted: (c.mutedUntil || 0) > Date.now() / 1000, archived: !!c.archived, blocked: store.blocked.includes(jid),
    preview: p ? (p.deleted ? p.text : p.viewOnce ? '📷 Visualização única' : p.type !== 'text' && !p.text ? mediaLabel(p.type) : p.text) : '',
    lastFromMe: !!p?.fromMe, lastStatus: p?.status ?? 0,
  }
}
const groupTried = new Set()
function ensureGroup(jid) {
  if (groupTried.has(jid) || !sock || status !== 'open') return
  groupTried.add(jid)
  sock.groupMetadata(jid).then((g) => { upsertChat(jid, { name: g.subject }); saveStore(); notifyChats() }).catch(() => {})
}

/* ============================== HTTP + WebSocket ============================== */
const app = express()
const server = http.createServer(app)
const cookieOf = (req) => (req.headers.cookie || '').split(';').map((s) => s.trim()).find((s) => s.startsWith('wak='))?.slice(4)
const authed = (req) => !KEY || cookieOf(req) === KEY || req.headers['x-wa-key'] === KEY
const wss = new WebSocketServer({ noServer: true })
server.on('upgrade', (req, sk, head) => {
  if (req.url !== '/ws' || !authed(req)) return sk.destroy()
  wss.handleUpgrade(req, sk, head, (ws) => wss.emit('connection', ws, req))
})
const broadcast = (type, data) => { const s = JSON.stringify({ type, data }); for (const c of wss.clients) if (c.readyState === 1) c.send(s) }
const notifyChats = debounce(() => broadcast('chats', null), 400)

const sse = new Set()
const nativeEmit = (o) => { const s = `data: ${JSON.stringify(o)}\n\n`; for (const r of sse) r.write(s) }
setInterval(() => nativeEmit({ type: 'ping' }), 25000).unref?.()

/* ============================== Conexão WhatsApp ============================== */
let sock = null, status = 'connecting', me = null, myName = '', pairCode = null
let qrWaiters = [], qrReady = false, reconnectTimer = null, retries = 0, lastErr = ''
const getState = () => ({ status, me, name: myName, pairCode })
const setStatus = (s, extra = {}) => { status = s; if ('pairCode' in extra) pairCode = extra.pairCode; broadcast('state', getState()); nativeEmit({ type: 'state', status: s }) }
const BROWSERS = { macdesktop: () => Browsers.macOS('Desktop'), chrome: () => Browsers.macOS('Chrome'), ubuntu: () => Browsers.ubuntu('Chrome'), windows: () => Browsers.windows('Chrome') }

async function start() {
  clearTimeout(reconnectTimer)
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR)
  let version
  if (process.env.NOVERSION) console.log('Usando a versão padrão do Baileys')
  else try { const r = await Promise.race([fetchLatestBaileysVersion(), new Promise((_, no) => setTimeout(() => no(new Error('tempo esgotado')), 6000))]); version = r.version; console.log('Versão do WhatsApp Web:', version.join('.')) } catch (e) { console.log('Falha ao buscar versão do WhatsApp Web:', e.message) }

  const s = makeWASocket({
    ...(version ? { version } : {}), auth: state, logger,
    browser: BROWSERS[process.env.BROWSER || 'chrome'](),
    syncFullHistory: !process.env.NOHISTORY, shouldSyncHistoryMessage: () => true,
    markOnlineOnConnect: false, getMessage: async () => undefined,
  })
  sock = s; qrReady = false
  state.creds.registered ? setStatus('connecting') : setStatus('unpaired', { pairCode: null })
  s.ev.on('creds.update', saveCreds)

  s.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
    if (s !== sock) return
    if (qr) { qrReady = true; qrWaiters.forEach((f) => f()); qrWaiters = [] }
    if (connection === 'open') {
      retries = 0; lastErr = ''
      me = jidNormalizedUser(s.user?.id); myName = s.user?.name || ''
      setStatus('open', { pairCode: null }); console.log('Conectado como', me)
      s.fetchBlocklist().then((l) => { store.blocked = (l || []).map(canon); saveStore() }).catch(() => {})
    }
    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode
      lastErr = `${code ?? ''} ${lastDisconnect?.error?.message ?? ''}`.trim()
      console.log('Conexão fechada:', code, '-', lastDisconnect?.error?.message)
      me = null
      if (code === DisconnectReason.loggedOut) {
        fs.rmSync(AUTH_DIR, { recursive: true, force: true })
        store = freshStore(); writeStore()
        for (const d of [AV_DIR, MEDIA_DIR]) { fs.rmSync(d, { recursive: true, force: true }); fs.mkdirSync(d, { recursive: true }) }
        nativeEmit({ type: 'loggedout' })
      }
      const wait = Math.min(2000 * 2 ** retries++, 60000)
      console.log(`Reconectando em ${wait / 1000}s (tentativa ${retries})`)
      reconnectTimer = setTimeout(() => start().catch(console.error), wait)
    }
  })

  s.ev.on('messaging-history.set', ({ chats = [], contacts = [], messages = [], isLatest }) => {
    for (const c of contacts) onContact(c)
    for (const c of chats) {
      link(c.id, c.lidJid); link(c.id, c.pnJid)
      const id = canon(c.id), isGroup = id.endsWith('@g.us')
      if (!isGroup && c.name && !store.contacts[id]) store.contacts[id] = c.name
      upsertChat(id, { name: isGroup ? c.name || c.subject : undefined, lastTs: tsOf(c.conversationTimestamp) || undefined, unread: c.unreadCount ?? undefined, archived: !!c.archived, pinned: !!c.pinned, mutedUntil: tsOf(c.muteEndTime) || undefined })
    }
    for (const m of messages) addMessage(m)
    saveStore(); notifyChats()
    console.log(`Histórico: ${chats.length} conversas, ${messages.length} mensagens${isLatest ? ' (completo)' : ''}`)
  })
  s.ev.on('contacts.upsert', (cs) => { cs.forEach(onContact); saveStore(); notifyChats() })
  s.ev.on('contacts.update', (cs) => { cs.forEach(onContact); saveStore(); notifyChats() })
  s.ev.on('chats.phoneNumberShare', ({ lid, jid }) => link(lid, jid))
  s.ev.on('chats.upsert', (cs) => {
    for (const c of cs) { link(c.id, c.lidJid); upsertChat(canon(c.id), { name: c.id.endsWith('@g.us') ? c.name || c.subject : undefined, lastTs: tsOf(c.conversationTimestamp) || undefined }) }
    saveStore(); notifyChats()
  })
  s.ev.on('chats.update', (cs) => {
    for (const c of cs) {
      const ch = store.chats[canon(c.id)]; if (!ch) continue
      if (c.name && c.id.endsWith('@g.us')) ch.name = c.name
      if (c.unreadCount != null) ch.unread = Math.max(0, c.unreadCount)
      if (c.archived != null) ch.archived = !!c.archived
      if (c.pinned != null) ch.pinned = !!c.pinned
      if (c.muteEndTime != null) ch.mutedUntil = tsOf(c.muteEndTime)
    }
    saveStore(); notifyChats()
  })
  s.ev.on('messages.upsert', ({ messages, type }) => {
    for (const m of messages) {
      const p = addMessage(m, { notify: type === 'notify' })
      if (!p) continue
      broadcast('message', { chat: chatView(p.jid), message: p })
      const ch = store.chats[p.jid]
      if (type === 'notify' && !p.fromMe && (store.cfg.notif ?? true) && !((ch?.mutedUntil || 0) > Date.now() / 1000) && !store.blocked.includes(p.jid))
        nativeEmit({ type: 'msg', id: p.id, jid: p.jid, chat: nameOf(p.jid), group: p.jid.endsWith('@g.us'), sender: p.sender, ts: p.ts, text: store.cfg.previews === false ? 'Nova mensagem' : p.viewOnce ? '📷 Visualização única' : p.text || mediaLabel(p.type) || 'Nova mensagem' })
    }
  })
  s.ev.on('messages.update', (ups) => {
    for (const { key, update } of ups) {
      const jid = canon(key.remoteJid), m = (store.messages[jid] || []).find((x) => x.key.id === key.id)
      if (!m) continue
      if (update?.status != null) { m.status = update.status; broadcast('mstatus', { jid, id: key.id, status: update.status }) }
      const em = update?.message?.editedMessage?.message
      if (em) { m.message = em; m._edited = true; const p = parseMessage(m, jid); p && broadcast('message', { chat: chatView(jid), message: p }) }
      if (update?.messageStubType === 1 || update?.message === null) { m._deleted = true; const p = parseMessage(m, jid); p && broadcast('message', { chat: chatView(jid), message: p }) }
      saveStore()
    }
  })
  s.ev.on('presence.update', ({ id, presences }) => {
    const st = Object.values(presences || {})[0]?.lastKnownPresence
    broadcast('presence', { jid: canon(id), state: st })
  })
  s.ev.on('call', (events) => {
    for (const ev of events) {
      const jid = canon(ev.groupJid || ev.chatId || ev.from)
      let e = store.calls.find((x) => x.id === ev.id)
      if (!e) { e = { id: ev.id, jid, from: ev.from, isVideo: !!ev.isVideo, isGroup: !!ev.isGroup, ts: Math.floor(new Date(ev.date).getTime() / 1000) || Math.floor(Date.now() / 1000), result: 'ringing', accepted: false }; store.calls.unshift(e) }
      if (ev.status === 'accept') { e.accepted = true; e.result = 'answered' }
      else if (ev.status === 'reject') e.result = e.accepted ? 'answered' : 'declined'
      else if (ev.status === 'timeout') e.result = e.accepted ? 'answered' : 'missed'
      else if (ev.status === 'terminate') e.result = e.accepted ? 'answered' : e.result === 'declined' ? 'declined' : 'missed'
      store.calls = store.calls.slice(0, 200); saveStore()
      const live = ev.status === 'offer' || ev.status === 'ringing'
      broadcast('call', { ...e, name: nameOf(e.jid), live })
      nativeEmit({ type: 'call', id: e.id, from: e.from, jid, name: nameOf(jid), video: e.isVideo, live, result: e.result })
    }
  })
}
const ensureConnected = () => { if (!sock || status !== 'open') throw new Error('WhatsApp não está conectado') }
const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => { console.error(req.path, e.message); res.status(400).json({ error: e.message }) })

/* ============================== API ============================== */
app.use((req, res, next) => {
  if (KEY) {
    if (req.query.k === KEY) { res.setHeader('Set-Cookie', `wak=${KEY}; Path=/; HttpOnly; SameSite=Strict`); return res.redirect('/') }
    if (!authed(req)) return res.status(403).send('Acesso negado')
  }
  next()
})
app.use(express.json({ limit: '2mb' }))
app.use(express.static(PUBLIC, { maxAge: 0, etag: true }))
const rawBody = express.raw({ type: '*/*', limit: '100mb' })

app.get('/api/state', (_, res) => res.json(getState()))
app.post('/api/pair', wrap(async (req, res) => {
  const number = String(req.body.number || '').replace(/\D/g, '')
  if (number.length < 10) throw new Error('Número inválido. Use DDI + DDD + número, ex.: 5511999998888')
  if (!sock || sock.authState.creds.registered) throw new Error('Já existe uma sessão')
  const s = sock
  const limit = (p, ms) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error('timeout')), ms))])
  let raw
  try { raw = await limit(s.requestPairingCode(number), 40000) }
  catch (e) { throw new Error('Não foi possível conectar ao WhatsApp' + (lastErr ? ` (${lastErr})` : ' — verifique a internet do aparelho') + '. Tente de novo.') }
  const code = raw.match(/.{1,4}/g).join('-')
  setStatus('pairing', { pairCode: code }); res.json({ code })
}))
app.post('/api/logout', wrap(async (_, res) => { try { await sock?.logout() } catch {} res.json({ ok: true }) }))

/* ---- conversas ---- */
app.get('/api/chats', (req, res) => {
  const arch = req.query.archived === '1'
  const list = Object.keys(store.chats)
    .filter((j) => !isIgnored(j) && !!store.chats[j].archived === arch && ((store.messages[j]?.length || 0) > 0 || store.chats[j].lastTs > 0))
    .map(chatView)
  list.sort((a, b) => (b.pinned - a.pinned) || b.lastTs - a.lastTs)
  res.json(list)
})
app.get('/api/chats/:jid/messages', (req, res) => {
  const jid = canon(req.params.jid)
  res.json((store.messages[jid] || []).map((m) => parseMessage(m, jid)).filter(Boolean))
})
app.post('/api/chats/:jid/read', wrap(async (req, res) => {
  const jid = canon(req.params.jid), c = store.chats[jid]
  if (c) { c.unread = 0; c.markedUnread = false; saveStore() }
  nativeEmit({ type: 'read', jid })
  try { const last = [...(store.messages[jid] || [])].reverse().find((m) => !m.key.fromMe); if (last && status === 'open') await sock.readMessages([last.key]) } catch {}
  res.json({ ok: true })
}))
const lastMsgs = (jid) => { const m = (store.messages[jid] || []).at(-1); return m ? [{ key: m.key, messageTimestamp: m.messageTimestamp }] : [] }
app.post('/api/chats/:jid/action', wrap(async (req, res) => {
  const jid = canon(req.params.jid), { type, value } = req.body, c = upsertChat(jid) || {}
  const mod = async (o) => { try { ensureConnected(); await sock.chatModify(o, jid) } catch (e) { console.log('chatModify', type, e.message) } }
  switch (type) {
    case 'pin': c.pinned = true; await mod({ pin: true }); break
    case 'unpin': c.pinned = false; await mod({ pin: false }); break
    case 'mute': { const s = Number(value) || 0; c.mutedUntil = s < 0 ? 4102444800 : Math.floor(Date.now() / 1000) + s; await mod({ mute: s < 0 ? 4102444800000 : Date.now() + s * 1000 }); break }
    case 'unmute': c.mutedUntil = 0; await mod({ mute: null }); break
    case 'archive': c.archived = true; await mod({ archive: true, lastMessages: lastMsgs(jid) }); break
    case 'unarchive': c.archived = false; await mod({ archive: false, lastMessages: lastMsgs(jid) }); break
    case 'markunread': c.markedUnread = true; await mod({ markRead: false, lastMessages: lastMsgs(jid) }); break
    case 'clear': { const lm = lastMsgs(jid); store.messages[jid] = []; await mod({ clear: true, lastMessages: lm }); break }
    case 'delete': { const lm = lastMsgs(jid); delete store.chats[jid]; delete store.messages[jid]; await mod({ delete: true, lastMessages: lm }); break }
    case 'block': ensureConnected(); await sock.updateBlockStatus(jid, 'block'); if (!store.blocked.includes(jid)) store.blocked.push(jid); break
    case 'unblock': ensureConnected(); await sock.updateBlockStatus(jid, 'unblock'); store.blocked = store.blocked.filter((j) => j !== jid); break
    case 'disappear': ensureConnected(); await sock.sendMessage(jid, { disappearingMessagesInChat: Number(value) || false }); c.ephemeral = Number(value) || 0; break
    default: throw new Error('Ação desconhecida')
  }
  saveStore(); notifyChats(); res.json({ ok: true })
}))
app.get('/api/chats/:jid/export', (req, res) => {
  const jid = canon(req.params.jid)
  const lines = (store.messages[jid] || []).map((m) => parseMessage(m, jid)).filter(Boolean).map((p) => `[${new Date(p.ts * 1000).toLocaleString('pt-BR')}] ${p.fromMe ? 'Você' : p.sender || nameOf(jid)}: ${p.text || mediaLabel(p.type)}`)
  res.setHeader('Content-Type', 'text/plain; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="Conversa com ${safe(nameOf(jid))}.txt"`)
  res.send(lines.join('\n'))
})

/* ---- contatos / info ---- */
app.get('/api/contacts', (_, res) => {
  res.json(Object.entries(store.contacts).filter(([j, n]) => j.endsWith('@s.whatsapp.net') && n && j !== me)
    .map(([id, name]) => ({ id, name, number: fmtNumber(id) })).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')))
})
app.post('/api/resolve', wrap(async (req, res) => {
  ensureConnected()
  const [r] = (await sock.onWhatsApp(String(req.body.number || '').replace(/\D/g, ''))) || []
  if (!r?.exists) throw new Error('Este número não está no WhatsApp')
  res.json({ jid: canon(r.jid) })
}))
app.get('/api/info/:jid', wrap(async (req, res) => {
  const jid = canon(req.params.jid), isGroup = jid.endsWith('@g.us')
  const out = { id: jid, name: nameOf(jid), number: fmtNumber(jid), isGroup, blocked: store.blocked.includes(jid), muted: (store.chats[jid]?.mutedUntil || 0) > Date.now() / 1000, pinned: !!store.chats[jid]?.pinned, archived: !!store.chats[jid]?.archived, ephemeral: store.chats[jid]?.ephemeral || 0 }
  const msgs = (store.messages[jid] || []).map((m) => parseMessage(m, jid)).filter(Boolean)
  out.counts = { media: msgs.filter((m) => ['image', 'video'].includes(m.type)).length, docs: msgs.filter((m) => m.type === 'document').length, links: msgs.filter((m) => /https?:\/\//.test(m.text || '')).length, starred: msgs.filter((m) => m.starred).length }
  if (status === 'open') {
    if (isGroup) {
      try {
        const g = await sock.groupMetadata(jid)
        out.name = g.subject; out.desc = g.desc || ''; out.created = g.creation; out.owner = g.owner ? nameOf(canon(g.owner)) : ''
        out.participants = g.participants.map((p) => { const id = canon(p.jid || p.id); return { id, name: id === me ? 'Você' : nameOf(id), admin: !!p.admin, number: fmtNumber(id) } })
      } catch {}
    } else {
      try { const r = await sock.fetchStatus(jid); const s = Array.isArray(r) ? r[0]?.status : r?.status; out.about = s?.status || ''; out.aboutAt = s?.setAt ? new Date(s.setAt).getTime() / 1000 : 0 } catch {}
      try { const b = await sock.getBusinessProfile(jid); if (b) out.business = { description: b.description, category: b.category, website: (b.website || [])[0], email: b.email, address: b.address } } catch {}
    }
  }
  res.json(out)
}))
app.get('/api/avatar/:jid', async (req, res) => {
  const jid = canon(req.params.jid), f = path.join(AV_DIR, safe(jid) + '.jpg')
  const fresh = () => { try { return Date.now() - fs.statSync(f).mtimeMs < 7 * DAY * 1000 } catch { return false } }
  res.setHeader('Cache-Control', 'private, max-age=3600')
  if (req.query.full) res.setHeader('Cache-Control', 'no-cache')
  const kind = req.query.full ? 'image' : 'preview', file = req.query.full ? f.replace('.jpg', '.full.jpg') : f
  if (fs.existsSync(file) && (req.query.full || fresh())) return res.sendFile(file)
  if (store.avMiss[jid] && Date.now() - store.avMiss[jid] < DAY * 1000 && !req.query.full) return res.sendStatus(404)
  if (status !== 'open') return res.sendStatus(404)
  await avSlot()
  try {
    const url = await sock.profilePictureUrl(jid, kind)
    if (!url) throw new Error('sem foto')
    const r = await fetch(url); if (!r.ok) throw new Error('http ' + r.status)
    fs.writeFileSync(file, Buffer.from(await r.arrayBuffer())); avFree(); return res.sendFile(file)
  } catch { store.avMiss[jid] = Date.now(); saveStore(); avFree(); res.sendStatus(404) }
})
let avBusy = 0; const avWait = []
const avSlot = async () => { if (avBusy >= 3) await new Promise((r) => avWait.push(r)); avBusy++ }
const avFree = () => { avBusy--; avWait.shift()?.() }

/* ---- envio ---- */
function afterSend(jid, sent) {
  const p = sent && addMessage(sent)
  if (p) broadcast('message', { chat: chatView(jid), message: p })
  return sent?.key?.id
}
const quotedOpt = (jid, id) => { const q = id && rawOf(jid, id); return q ? { quoted: q } : {} }
async function sendTo(jid, content, opts = {}) { ensureConnected(); jid = canon(jid); return afterSend(jid, await sock.sendMessage(jid, content, opts)) }
const mediaFile = (id) => path.join(MEDIA_DIR, safe(id))
const thumbOf = (req) => { const t = req.headers['x-thumb'], d = String(req.headers['x-dim'] || '').split('x').map(Number); return { ...(t ? { jpegThumbnail: Buffer.from(t, 'base64') } : {}), ...(d[0] ? { width: d[0], height: d[1] } : {}) } }

app.post('/api/send', wrap(async (req, res) => {
  const { jid, text, quotedId } = req.body
  if (!jid || !text?.trim()) throw new Error('Mensagem vazia')
  res.json({ ok: true, id: await sendTo(jid, { text }, quotedOpt(canon(jid), quotedId)) })
}))
app.post('/api/send-media', rawBody, wrap(async (req, res) => {
  const jid = canon(req.query.jid), caption = req.query.caption || '', filename = req.query.filename || 'arquivo'
  const mime = (req.headers['content-type'] || 'application/octet-stream').split(';')[0]
  if (!jid || !Buffer.isBuffer(req.body) || !req.body.length) throw new Error('Arquivo vazio')
  const th = thumbOf(req)
  let content
  if (mime.startsWith('image/') && mime !== 'image/gif') content = { image: req.body, caption, mimetype: mime, ...th }
  else if (mime.startsWith('video/') || mime === 'image/gif') content = { video: req.body, caption, mimetype: mime === 'image/gif' ? 'video/mp4' : mime, gifPlayback: req.query.gif === '1', ...th }
  else if (mime.startsWith('audio/')) content = { audio: req.body, mimetype: mime, ptt: false }
  else content = { document: req.body, mimetype: mime, fileName: filename, caption }
  const id = await sendTo(jid, content, quotedOpt(jid, req.query.quotedId))
  if (id) fs.writeFile(mediaFile(id), req.body, () => {})
  res.json({ ok: true, id })
}))
app.post('/api/send-audio', rawBody, wrap(async (req, res) => {
  const jid = canon(req.query.jid)
  if (!jid || !Buffer.isBuffer(req.body) || !req.body.length) throw new Error('Áudio vazio')
  let ogg = req.body
  if (isWebm(ogg)) ogg = webmToOgg(ogg)
  else if (!(ogg.subarray(0, 4).toString() === 'OggS')) throw new Error('Formato de áudio não suportado neste navegador. Use o app Android ou o Chrome.')
  const id = await sendTo(jid, { audio: ogg, ptt: true, mimetype: 'audio/ogg; codecs=opus' }, quotedOpt(jid, req.query.quotedId))
  if (id) fs.writeFile(mediaFile(id), ogg, () => {})
  res.json({ ok: true, id })
}))
app.post('/api/send-sticker', rawBody, wrap(async (req, res) => {
  const jid = canon(req.query.jid)
  if (!Buffer.isBuffer(req.body) || !req.body.length) throw new Error('Imagem vazia')
  res.json({ ok: true, id: await sendTo(jid, { sticker: req.body }) })
}))
app.post('/api/send-location', wrap(async (req, res) => {
  const { jid, lat, lng, name } = req.body
  res.json({ ok: true, id: await sendTo(jid, { location: { degreesLatitude: lat, degreesLongitude: lng, name } }) })
}))
app.post('/api/send-contact', wrap(async (req, res) => {
  const { jid, contactJid } = req.body, n = numberOf(contactJid), name = nameOf(canon(contactJid))
  const vcard = `BEGIN:VCARD\nVERSION:3.0\nFN:${name}\nTEL;type=CELL;waid=${n}:+${n}\nEND:VCARD`
  res.json({ ok: true, id: await sendTo(jid, { contacts: { displayName: name, contacts: [{ displayName: name, vcard }] } }) })
}))
app.post('/api/send-poll', wrap(async (req, res) => {
  const { jid, name, options, multi } = req.body
  if (!name || (options || []).length < 2) throw new Error('A enquete precisa de uma pergunta e ao menos 2 opções')
  res.json({ ok: true, id: await sendTo(jid, { poll: { name, values: options, selectableCount: multi ? 0 : 1 } }) })
}))
app.post('/api/react', wrap(async (req, res) => {
  const { jid, id, emoji } = req.body, raw = rawOf(jid, id)
  if (!raw) throw new Error('Mensagem não encontrada')
  ensureConnected()
  await sock.sendMessage(canon(jid), { react: { text: emoji || '', key: raw.key } })
  raw._rx ||= {}; if (emoji) raw._rx.me = emoji; else delete raw._rx.me
  const p = parseMessage(raw, canon(jid)); p && broadcast('message', { chat: chatView(canon(jid)), message: p }); saveStore()
  res.json({ ok: true })
}))
app.post('/api/edit', wrap(async (req, res) => {
  const { jid, id, text } = req.body, raw = rawOf(jid, id)
  if (!raw?.key.fromMe) throw new Error('Só é possível editar suas mensagens')
  ensureConnected()
  await sock.sendMessage(canon(jid), { text, edit: raw.key })
  raw.message = { conversation: text }; raw._edited = true
  const p = parseMessage(raw, canon(jid)); p && broadcast('message', { chat: chatView(canon(jid)), message: p }); saveStore()
  res.json({ ok: true })
}))
app.post('/api/delete', wrap(async (req, res) => {
  const { jid: j, ids, mode } = req.body, jid = canon(j)
  ensureConnected()
  for (const id of ids) {
    const raw = rawOf(jid, id); if (!raw) continue
    if (mode === 'all') {
      await sock.sendMessage(jid, { delete: raw.key }); raw._deleted = true
      const p = parseMessage(raw, jid); p && broadcast('message', { chat: chatView(jid), message: p })
    } else {
      try { await sock.chatModify({ deleteForMe: { deleteMedia: false, key: raw.key, timestamp: tsOf(raw.messageTimestamp) } }, jid) } catch (e) { console.log('deleteForMe', e.message) }
      store.messages[jid] = store.messages[jid].filter((x) => x.key.id !== id)
    }
  }
  saveStore(); notifyChats(); res.json({ ok: true })
}))
app.post('/api/forward', wrap(async (req, res) => {
  ensureConnected()
  for (const { jid, id } of req.body.items) {
    const raw = rawOf(jid, id); if (!raw) continue
    for (const to of req.body.to) afterSend(canon(to), await sock.sendMessage(canon(to), { forward: raw }))
  }
  res.json({ ok: true })
}))
app.post('/api/star', wrap(async (req, res) => {
  const { jid: j, ids, on } = req.body, jid = canon(j)
  for (const id of ids) {
    if (on) store.starred[id] = true; else delete store.starred[id]
    const raw = rawOf(jid, id)
    if (raw && status === 'open') try { await sock.chatModify({ star: { messages: [{ id, fromMe: raw.key.fromMe }], star: !!on } }, jid) } catch {}
    const p = raw && parseMessage(raw, jid); p && broadcast('message', { chat: chatView(jid), message: p })
  }
  saveStore(); res.json({ ok: true })
}))
app.post('/api/presence', wrap(async (req, res) => {
  if (status === 'open') { const jid = canon(req.body.jid); if (req.body.state === 'subscribe') await sock.presenceSubscribe(jid); else await sock.sendPresenceUpdate(req.body.state, jid) }
  res.json({ ok: true })
}))
app.post('/api/translate', wrap(async (req, res) => {
  const r = await fetch('https://api.mymemory.translated.net/get?q=' + encodeURIComponent(String(req.body.text).slice(0, 450)) + '&langpair=autodetect|' + (req.body.to || 'pt-BR'))
  const j = await r.json()
  res.json({ text: j?.responseData?.translatedText || '' })
}))

/* ---- stickers e GIFs ---- */
app.get('/api/stickers', (_, res) => res.json(store.stickers.map((s) => ({ id: s.id, sha: s.sha }))))
async function downloadRaw(raw) {
  const f = mediaFile(raw.key.id)
  if (fs.existsSync(f)) return f
  ensureConnected()
  const buf = await downloadMediaMessage(raw, 'buffer', {}, { logger, reuploadRequest: sock.updateMediaMessage })
  fs.writeFileSync(f, buf); return f
}
app.get('/api/sticker/:id', wrap(async (req, res) => {
  const s = store.stickers.find((x) => x.id === req.params.id); if (!s) return res.sendStatus(404)
  res.type('image/webp').set('Cache-Control', 'private, max-age=86400').sendFile(await downloadRaw(s.raw))
}))
app.post('/api/send-sticker-ref', wrap(async (req, res) => {
  const s = store.stickers.find((x) => x.id === req.body.id); if (!s) throw new Error('Figurinha não encontrada')
  res.json({ ok: true, id: await sendTo(req.body.jid, { sticker: fs.readFileSync(await downloadRaw(s.raw)) }) })
}))
app.get('/api/gifs', wrap(async (req, res) => {
  const key = store.cfg.gifKey, q = String(req.query.q || '').trim()
  if (!key) return res.json({ needKey: true, items: [] })
  const prov = store.cfg.gifProvider || 'giphy'
  let items = []
  if (prov === 'tenor') {
    const j = await (await fetch(`https://tenor.googleapis.com/v2/${q ? 'search' : 'featured'}?key=${encodeURIComponent(key)}&client_key=zapp&limit=30&media_filter=tinygif,mp4&locale=pt_BR&q=${encodeURIComponent(q)}`)).json()
    items = (j.results || []).map((r) => ({ id: r.id, preview: r.media_formats?.tinygif?.url, mp4: r.media_formats?.mp4?.url })).filter((x) => x.mp4)
  } else {
    const j = await (await fetch(`https://api.giphy.com/v1/gifs/${q ? 'search' : 'trending'}?api_key=${encodeURIComponent(key)}&limit=30&rating=pg-13&lang=pt&q=${encodeURIComponent(q)}`)).json()
    items = (j.data || []).map((r) => ({ id: r.id, preview: r.images?.fixed_width_small?.url || r.images?.fixed_width?.url, mp4: r.images?.original_mp4?.mp4 || r.images?.fixed_height?.mp4 })).filter((x) => x.mp4)
  }
  res.json({ items })
}))
app.post('/api/send-gif', wrap(async (req, res) => {
  const u = new URL(req.body.url)
  if (!/(^|\.)(giphy\.com|tenor\.com|googleapis\.com)$/.test(u.hostname) || u.protocol !== 'https:') throw new Error('Origem de GIF inválida')
  const buf = Buffer.from(await (await fetch(u)).arrayBuffer())
  res.json({ ok: true, id: await sendTo(req.body.jid, { video: buf, gifPlayback: true, mimetype: 'video/mp4' }) })
}))

/* ---- mídia (com cache em disco e suporte a Range) ---- */
const inflight = new Map()
app.get('/api/media/:jid/:id', async (req, res) => {
  try {
    const isStatus = req.params.jid === 'status@broadcast', jid = isStatus ? null : canon(req.params.jid)
    const raw = isStatus ? store.statuses.find((x) => x.key.id === req.params.id) : rawOf(jid, req.params.id)
    if (!raw) return res.status(404).send('Mensagem não encontrada')
    const p = parseMessage(raw, jid || 'status@broadcast')
    if (!p || p.viewOnce) return res.status(403).send('Esta mídia só pode ser aberta no celular')
    const f = mediaFile(raw.key.id)
    if (!fs.existsSync(f)) {
      if (!inflight.has(raw.key.id)) inflight.set(raw.key.id, downloadRaw(raw).finally(() => inflight.delete(raw.key.id)))
      await inflight.get(raw.key.id)
    }
    res.type((p.mime || 'application/octet-stream').split(';')[0]).set({ 'Content-Disposition': `inline; filename="${encodeURIComponent(p.fileName || p.id)}"`, 'Cache-Control': 'private, max-age=86400' })
    res.sendFile(f)
  } catch (e) { res.status(500).send('Não foi possível baixar a mídia: ' + e.message) }
})

/* ---- chamadas ---- */
app.get('/api/calls', (_, res) => res.json(store.calls.map((c) => ({ ...c, name: nameOf(c.jid) }))))
const rejectCall = async (id, from) => { ensureConnected(); await sock.rejectCall(id, from); const e = store.calls.find((c) => c.id === id); if (e) { e.result = 'declined'; saveStore() } }
app.post('/api/calls/reject', wrap(async (req, res) => { await rejectCall(req.body.id, req.body.from); res.json({ ok: true }) }))

/* ---- status ---- */
app.get('/api/statuses', (_, res) => {
  const now = Date.now() / 1000, by = new Map()
  for (const m of store.statuses) {
    if (tsOf(m.messageTimestamp) < now - DAY) continue
    const p = parseMessage(m, 'status@broadcast'); if (!p) continue
    const who = m.key.fromMe ? me : canon(m.key.participant) || m._poster
    p.sender = undefined
    if (!by.has(who)) by.set(who, { jid: who, name: m.key.fromMe ? 'Meu status' : nameOf(who), mine: !!m.key.fromMe, items: [] })
    by.get(who).items.push(p)
  }
  const out = [...by.values()].map((g) => ({ ...g, last: Math.max(...g.items.map((i) => i.ts)) }))
  out.forEach((g) => g.items.sort((a, b) => a.ts - b.ts)); out.sort((a, b) => (b.mine - a.mine) || b.last - a.last)
  res.json(out)
})
const statusAudience = () => [...new Set([...Object.keys(store.contacts), ...Object.keys(store.chats)].filter((j) => j.endsWith('@s.whatsapp.net')).concat(me ? [me] : []))]
async function postStatus(content, opts = {}) {
  ensureConnected()
  const sent = await sock.sendMessage('status@broadcast', content, { statusJidList: statusAudience(), ...opts })
  sent.key.participant ||= me; addStatus(sent); return sent?.key?.id
}
app.post('/api/status/text', wrap(async (req, res) => {
  const { text, bg, font } = req.body
  if (!text?.trim()) throw new Error('Escreva algo para o status')
  res.json({ ok: true, id: await postStatus({ text }, { backgroundColor: bg || '#128C7E', font: font ?? 0 }) })
}))
app.post('/api/status/media', rawBody, wrap(async (req, res) => {
  const mime = (req.headers['content-type'] || '').split(';')[0], caption = req.query.caption || '', th = thumbOf(req)
  const content = mime.startsWith('video/') ? { video: req.body, caption, mimetype: mime, ...th } : { image: req.body, caption, mimetype: mime, ...th }
  res.json({ ok: true, id: await postStatus(content) })
}))

/* ---- grupos e listas de transmissão ---- */
app.post('/api/groups', wrap(async (req, res) => {
  ensureConnected()
  const { subject, participants } = req.body
  if (!subject?.trim() || !(participants || []).length) throw new Error('Informe o nome do grupo e ao menos um participante')
  const g = await sock.groupCreate(subject.trim(), participants)
  upsertChat(g.id, { name: g.subject || subject, lastTs: Math.floor(Date.now() / 1000) }); saveStore(); notifyChats()
  res.json({ ok: true, id: g.id, name: g.subject || subject })
}))
app.get('/api/lists', (_, res) => res.json(store.lists.map((l) => ({ ...l, members: l.members.map((id) => ({ id, name: nameOf(id) })) }))))
app.post('/api/lists', wrap(async (req, res) => {
  const { name, members } = req.body
  if (!name?.trim() || !(members || []).length) throw new Error('Dê um nome à lista e escolha ao menos um contato')
  const l = { id: 'bl-' + randomBytes(4).toString('hex'), name: name.trim(), members: members.map(canon), history: [] }
  store.lists.push(l); saveStore(); res.json({ ok: true, id: l.id })
}))
app.delete('/api/lists/:id', (req, res) => { store.lists = store.lists.filter((l) => l.id !== req.params.id); saveStore(); res.json({ ok: true }) })
app.post('/api/lists/:id/send', wrap(async (req, res) => {
  const l = store.lists.find((x) => x.id === req.params.id); if (!l) throw new Error('Lista não encontrada')
  if (!req.body.text?.trim()) throw new Error('Mensagem vazia')
  let ok = 0
  for (const jid of l.members) { try { await sendTo(jid, { text: req.body.text }); ok++ } catch (e) { console.log('lista', e.message) } }
  l.history.push({ text: req.body.text, ts: Math.floor(Date.now() / 1000), ok, total: l.members.length }); l.history = l.history.slice(-50); saveStore()
  res.json({ ok: true, sent: ok, total: l.members.length })
}))

/* ---- perfil, privacidade e configurações ---- */
app.get('/api/profile', wrap(async (_, res) => {
  const out = { name: myName, number: fmtNumber(me), me, about: '', privacy: {}, blocked: store.blocked.map((id) => ({ id, name: nameOf(id) })), cfg: store.cfg }
  if (status === 'open') {
    try { const r = await sock.fetchStatus(me); const s = Array.isArray(r) ? r[0]?.status : r?.status; out.about = s?.status || '' } catch {}
    try { out.privacy = await sock.fetchPrivacySettings(true) } catch {}
  }
  res.json(out)
}))
app.post('/api/profile', wrap(async (req, res) => {
  ensureConnected()
  if (req.body.name != null) { await sock.updateProfileName(req.body.name); myName = req.body.name }
  if (req.body.about != null) await sock.updateProfileStatus(req.body.about)
  res.json({ ok: true })
}))
app.post('/api/profile/photo', rawBody, wrap(async (req, res) => {
  ensureConnected()
  await sock.query({ tag: 'iq', attrs: { to: '@s.whatsapp.net', type: 'set', xmlns: 'w:profile:picture' }, content: [{ tag: 'picture', attrs: { type: 'image' }, content: req.body }] })
  for (const f of fs.readdirSync(AV_DIR)) if (f.startsWith(safe(me))) fs.rmSync(path.join(AV_DIR, f), { force: true })
  delete store.avMiss[me]; res.json({ ok: true })
}))
const PRIV = { last: 'updateLastSeenPrivacy', online: 'updateOnlinePrivacy', profile: 'updateProfilePicturePrivacy', status: 'updateStatusPrivacy', readreceipts: 'updateReadReceiptsPrivacy', groupadd: 'updateGroupsAddPrivacy' }
app.post('/api/privacy', wrap(async (req, res) => {
  ensureConnected()
  const fn = PRIV[req.body.key]; if (!fn) throw new Error('Opção inválida')
  await sock[fn](req.body.value); res.json({ ok: true })
}))
app.post('/api/config', (req, res) => { Object.assign(store.cfg, req.body || {}); saveStore(); res.json(store.cfg) })


/* ---- cache de mídia ---- */
const dirSize = (d) => { let n = 0; try { for (const f of fs.readdirSync(d)) n += fs.statSync(path.join(d, f)).size } catch {} return n }
app.get('/api/cache', (_, res) => res.json({ bytes: dirSize(MEDIA_DIR) + dirSize(AV_DIR) }))
app.post('/api/cache/clear', (_, res) => { for (const d of [MEDIA_DIR, AV_DIR]) for (const f of fs.readdirSync(d)) fs.rmSync(path.join(d, f), { force: true }); res.json({ ok: true }) })

/* ---- ponte com o app Android (notificações) ---- */
app.get('/native/events', (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
  res.write(`data: ${JSON.stringify({ type: 'state', status })}\n\n`)
  sse.add(res); req.on('close', () => sse.delete(res))
})
app.post('/native/reply', wrap(async (req, res) => { await sendTo(req.body.jid, { text: req.body.text }); nativeEmit({ type: 'read', jid: canon(req.body.jid) }); res.json({ ok: true }) }))
app.post('/native/read', wrap(async (req, res) => { const jid = canon(req.body.jid); if (store.chats[jid]) store.chats[jid].unread = 0; try { const l = [...(store.messages[jid] || [])].reverse().find((m) => !m.key.fromMe); if (l && status === 'open') await sock.readMessages([l.key]) } catch {} saveStore(); notifyChats(); res.json({ ok: true }) }))
app.post('/native/reject-call', wrap(async (req, res) => { await rejectCall(req.body.id, req.body.from); res.json({ ok: true }) }))

wss.on('connection', (ws) => ws.send(JSON.stringify({ type: 'state', data: getState() })))
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { writeStore(); process.exit(0) })
process.on('unhandledRejection', (e) => console.error('unhandledRejection:', e?.message || e))
process.on('uncaughtException', (e) => console.error('uncaughtException:', e?.message || e))
server.on('error', (e) => console.error('[server] erro no servidor HTTP:', e.message))
server.listen(PORT, HOST, () => console.log(`Servidor em http://${HOST}:${PORT}`))
start().catch((e) => console.error('Falha ao iniciar:', e))
