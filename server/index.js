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
const KEY = process.env.WA_KEY || ''
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
const writeStore = () => {
  try {
    fs.writeFileSync(STORE_FILE + '.tmp', JSON.stringify(store, BufferJSON.replacer))
    fs.renameSync(STORE_FILE + '.tmp', STORE_FILE)
  } catch (e) {
    console.error('[store] falha ao salvar:', e.message)
  }
}
const saveStore = () => { clearTimeout(saveTimer); saveTimer = setTimeout(writeStore, 3000) }
const debounce = (fn, ms) => { let t; return () => { clearTimeout(t); t = setTimeout(fn, ms) } }
const tsOf = (t) => Number(t?.toNumber ? t.toNumber() : t || 0)
const numberOf = (jid = '') => jid.split('@')[0].split(':')[0]
const isIgnored = (j) => !j || j === 'status@broadcast' || j.endsWith('@newsletter') || j.endsWith('@broadcast')
const safe = (s) => String(s).replace(/[^\w.-]/g, '_')

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
const mediaLabel = (t) => ({ image: '📷 Foto', video: '🎥 Vídeo', audio: '🎤 Áudio', document: '📄 Documento', sticker: 'Figurinha', location: '📍 Localização', contact: '👤 Conta', poll: '📊 Enquete' })[t] || 'Arquivo'

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

let sock = null, status = 'unpaired', me = null, myName = '', pairCode = null
let qrWaiters = [], qrReady = false, reconnectTimer = null, retries = 0, lastErr = ''
const getState = () => ({ status, me, name: myName, pairCode })
const setStatus = (s, extra = {}) => { status = s; if ('pairCode' in extra) pairCode = extra.pairCode; broadcast('state', getState()); nativeEmit({ type: 'state', status: s }) }
const BROWSERS = { macdesktop: () => Browsers.macOS('Desktop'), chrome: () => Browsers.macOS('Chrome'), ubuntu: () => Browsers.ubuntu('Chrome'), windows: () => Browsers.windows('Chrome') }

function resetStaleSession(reason = '') {
  console.log('[session] resetando sessão quebrada', reason || '')
  if (sock) {
    try { sock.ev?.removeAllListeners?.() } catch {}
    try { sock.ws?.close?.() } catch {}
  }
  sock = null
  me = null
  myName = ''
  pairCode = null
  qrReady = false
  qrWaiters = []
  status = 'unpaired'
  lastErr = ''
  if (fs.existsSync(AUTH_DIR)) {
    try { fs.rmSync(AUTH_DIR, { recursive: true, force: true }) } catch {}
  }
  store = freshStore(); writeStore()
  for (const d of [AV_DIR, MEDIA_DIR]) {
    try { fs.rmSync(d, { recursive: true, force: true }) } catch {}
    fs.mkdirSync(d, { recursive: true })
  }
  nativeEmit({ type: 'loggedout' })
  setStatus('unpaired', { pairCode: null })
}

async function start() {
  clearTimeout(reconnectTimer)
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR)
  let version
  if (process.env.NOVERSION) console.log('Usando a versão padrão do Baileys')
  else try { const r = await Promise.race([fetchLatestBaileysVersion(), new Promise((_, no) => setTimeout(() => no(new Error('tempo esgotado')), 6000))]); version = r.version; console.log('Versão do Baileys:', version) } catch (e) { console.log('Não foi possível obter a versão do Baileys:', e.message) }

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

      const stale = code === DisconnectReason.loggedOut || /stale|invalid session|bad session|connection terminated/i.test(lastErr)
      if (stale) {
        resetStaleSession(lastErr || `code:${code}`)
        return
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
      upsertChat(id, { name: isGroup ? c.name || c.subject : undefined, lastTs: tsOf(c.conversationTimestamp) || undefined, unread: c.unreadCount ?? undefined, archived: !!c.archived, pinned: !!c.pinned, mutedUntil: c.muteEndTime ? tsOf(c.muteEndTime) : undefined })
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
        nativeEmit({ type: 'msg', id: p.id, jid: p.jid, chat: nameOf(p.jid), group: p.jid.endsWith('@g.us'), sender: p.sender, ts: p.ts, text: store.cfg.previews === false ? 'Nova mensagem' : p.text || mediaLabel(p.type) })
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
      if (!e) { e = { id: ev.id, jid, from: ev.from, isVideo: !!ev.isVideo, isGroup: !!ev.isGroup, ts: Math.floor(new Date(ev.date).getTime() / 1000) || Math.floor(Date.now() / 1000), result: 'missed' } }
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

async function maybeAutoStart() {
  const credsFile = path.join(AUTH_DIR, 'creds.json')
  if (!fs.existsSync(credsFile)) {
    console.log('[server] sem sessão persistida: aguardando emparelhamento')
    setStatus('unpaired', { pairCode: null })
    return
  }
  try {
    const creds = JSON.parse(fs.readFileSync(credsFile, 'utf8'))
    if (!creds?.registered) {
      console.log('[server] sessão persistida encontrada, mas não registrada: aguardando emparelhamento')
      setStatus('unpaired', { pairCode: null })
      return
    }
    console.log('[server] sessão persistida encontrada: iniciando conexão automática')
    await start()
  } catch (e) {
    console.log('[server] auth persistida inválida; aguardando novo emparelhamento:', e.message)
    setStatus('unpaired', { pairCode: null })
  }
}

const ensureConnected = () => { if (!sock || status !== 'open') throw new Error('WhatsApp não está conectado') }
const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => { console.error(req.path, e.message); res.status(400).json({ error: e.message }) })

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
  if (sock && (sock.authState?.creds?.registered || status === 'open' || status === 'pairing')) {
    throw new Error('Já existe uma sessão atual. Tente reiniciar o app e limpar a sessão antes de emparelhar novamente.')
  }
  if (!sock) {
    try { await start() } catch (e) {
      console.error('[pair] start falhou', e.message)
      throw new Error('Não foi possível iniciar a sessão do WhatsApp. Tente novamente.')
    }
  }

  console.log('[pair] Aguardando o socket WebSocket estabelecer conexão com a Meta...')
  let attempts = 0
  while ((!sock?.ws || sock.ws.readyState !== 1) && attempts < 50) {
    await new Promise((r) => setTimeout(r, 200))
    attempts++
  }

  const s = sock
  if (!s) throw new Error('Socket não inicializado.')

  const limit = (p, ms) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error('timeout')), ms))])
  let raw
  try { 
    raw = await limit(s.requestPairingCode(number), 40000) 
  } catch (e) {
    const reason = lastErr || e.message || 'sessão inválida'
    throw new Error('Não foi possível conectar ao WhatsApp (' + reason + '). Tente de novo.')
  }
  const code = raw.match(/.{1,4}/g).join('-')
  setStatus('pairing', { pairCode: code }); res.json({ code })
}))
app.post('/api/logout', wrap(async (_, res) => { try { await sock?.logout() } catch {} res.json({ ok: true }) }))

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
  const out = { id: jid, name: nameOf(jid), number: fmtNumber(jid), isGroup, blocked: store.blocked.includes(jid), muted: (store.chats[jid]?.mutedUntil || 0) > Date.now() / 1000, pinned: !!store.chats[jid]?.pinned }
  const msgs = (store.messages[jid] || []).map((m) => parseMessage(m, jid)).filter(Boolean)
  out.counts = { media: msgs.filter((m) => ['image', 'video'].includes(m.type)).length, docs: msgs.filter((m) => m.type === 'document').length, links: msgs.filter((m) => /https?:\/\//.test(m.text)).length }
  if (status === 'open') {
    if (isGroup) {
      try {
        const g = await sock.groupMetadata(jid)
        out.name = g.subject; out.desc = g.desc || ''; out.created = g.creation; out.owner = g.owner ? nameOf(canon(g.owner)) : ''
        out.participants = g.participants.map((p) => { const id = canon(p.jid || p.id); return { id, name: id === me ? 'Você' : nameOf(id), admin: !!p.admin, number: fmtNumber(id) } })
      } catch {}
    } else {
      try { const r = await sock.fetchStatus(jid); const s = Array.isArray(r) ? r[0]?.status : r?.status; out.about = s?.status || ''; out.aboutAt = s?.setAt ? new Date(s.setAt).getTime() / 1000 : undefined } catch {}
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

function afterSend(jid, sent) {
  const p = sent && addMessage(sent)
  if (p) broadcast('message', { chat: chatView(jid), message: p })
  return sent?.key?.id
}
const quotedOpt = (jid, id) => { const q = id && rawOf(jid, id); return q ? { quoted: q } : {} }
async function sendTo(jid, content, opts = {}) { ensureConnected(); jid = canon(jid); return afterSend(jid, await sock.sendMessage(jid, content, opts)) }
const mediaFile = (id) => path.join(MEDIA_DIR, safe(id))
const thumbOf = (req) => { const t = req.headers['x-thumb'], d = String(req.headers['x-dim'] || '').split('x').map(Number); return { ...(t ? { jpegThumbnail: Buffer.from(t, 'base64') } : {}), ...((d[0] && d[1]) ? { width: d[0], height: d[1] } : {}) } }

app.post('/api/send', wrap(async (req, res) => {
  const { jid, text, quotedId } = req.body
  if (!jid || !text?.trim()) throw new Error('Destinatário ou texto inválidos')
  const id = await sendTo(jid, { text: text.trim() }, quotedOpt(jid, quotedId))
  res.json({ ok: true, id })
}))

server.listen(PORT, HOST, () => {
  console.log(`[server] rodando em http://${HOST}:${PORT}`)
  maybeAutoStart()
})
