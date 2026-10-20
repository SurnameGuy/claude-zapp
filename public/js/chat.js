/* ============================== conversa: mensagens, mídia, envio, gravação ============================== */
$('#back').innerHTML = ic('chevron-back', 28) + '<span id="backN"></span>'
$('#vcall').innerHTML = ic('videocam-outline', 28); $('#acall').innerHTML = ic('call-outline', 24)
$('#plus').innerHTML = ic('add', 30); $('#stkIc').innerHTML = ic('happy-outline', 24)
$('#camBtn').innerHTML = ic('camera-outline', 26); $('#micBtn').innerHTML = ic('mic-outline', 26)
$('#sendBtn').innerHTML = ic('send', 18); $('#recCancel').innerHTML = ic('trash-outline', 24)
$('#pvX').innerHTML = ic('close', 22); $('#pvSend').innerHTML = ic('send', 22); $('#replyX').innerHTML = ic('close-circle', 22); $('#fIc').innerHTML = ic('search', 16)
$('#vcall').onclick = () => dialSheet(true); $('#acall').onclick = () => dialSheet(false)

const localMedia = new Map()   // id -> blob url (mídia enviada por mim, aparece na hora)
const pendingJobs = new Map()  // tmpId -> { abort() }
const URLRE = /(https?:\/\/[^\s]+)/g
const linkify = (t) => t.split(URLRE).map((p, i) => (i % 2 ? h('a', { href: p, target: '_blank' }, p) : p))
const mediaUrl = (m) => `/api/media/${enc(m.jid)}/${enc(m.id)}`
const scrollDown = () => { const m = $('#msgs'); m.scrollTop = m.scrollHeight }
const nearBottom = () => { const b = $('#msgs'); return b.scrollHeight - b.scrollTop - b.clientHeight < 220 }

async function openChat(c, jumpId) {
  S.cur = c; S.msgs = []; players.clear(); S.reply = null; S.editing = null; exitSel(true); closePanel()
  $('#app').classList.add('pushed'); $('#tabbar').parentElement.classList.remove('hidetabs')
  $('#hdAv').replaceChildren(avatar(c.id, 36, c.isGroup)); $('#hdName').textContent = c.name
  setHdSub(); $('#msgs').replaceChildren(); updateBackN(); resetComposer(); updateReplyBar()
  try { S.msgs = await api(`/api/chats/${enc(c.id)}/messages`) } catch {}
  renderMsgs(true)
  if (jumpId) setTimeout(() => jumpTo(jumpId), 200)
  const mine = S.chats.find((x) => x.id === c.id); if (mine) { mine.unread = 0; mine.markedUnread = false }
  c.unread = 0; renderChats(); updateBackN()
  post(`/api/chats/${enc(c.id)}/read`).catch(() => {}); post('/api/presence', { jid: c.id, state: 'subscribe' }).catch(() => {})
}
function setHdSub() {
  const c = S.cur, p = S.presence[c?.id], el = $('#hdSub')
  el.classList.toggle('live', !!p && p !== 'unavailable')
  el.textContent = p === 'composing' ? (c.isGroup ? 'alguém está digitando…' : 'digitando…') : p === 'recording' ? 'gravando áudio…' : p === 'available' ? 'online' : c.isGroup ? 'toque aqui para dados do grupo' : c.number && c.number !== c.name ? c.number : 'toque aqui para dados do contato'
}
let presT = {}
function onPresence({ jid, state }) {
  S.presence[jid] = state; clearTimeout(presT[jid])
  if (state === 'composing' || state === 'recording') presT[jid] = setTimeout(() => { S.presence[jid] = 'available'; if (S.cur?.id === jid) setHdSub() }, 7000)
  if (S.cur?.id === jid) setHdSub()
}
const updateBackN = () => { const n = unreadTotal() - (S.cur?.unread || 0); $('#backN').textContent = n > 0 ? n : '' }
$('#back').onclick = () => { $('#app').classList.remove('pushed'); S.cur = null; stopAllAudio(); if (rg) cancelRec(); closePanel(); exitSel(true); loadChats() }
$('#hd').onclick = () => S.cur && openInfo(S.cur)

/* ---------- renderização ---------- */
function renderMsgs(jump) {
  const box = $('#msgs'), frag = document.createDocumentFragment()
  let last = null
  S.msgs.forEach((m, i) => { const d = daysAgo(m.ts); if (d !== last) { frag.append(h('div', { class: 'day' }, dayLabel(m.ts))); last = d } frag.append(msgRow(m, i)) })
  box.replaceChildren(frag)
  if (jump) { scrollDown(); setTimeout(scrollDown, 120); setTimeout(scrollDown, 400) }
}
function msgRow(m, i) {
  const prev = S.msgs[i - 1]
  const first = !(prev && prev.fromMe === m.fromMe && prev.senderJid === m.senderJid && m.ts - prev.ts < 300 && daysAgo(prev.ts) === daysAgo(m.ts))
  const row = h('div', { class: 'mrow ' + (first ? 'first ' : '') + (m.fromMe ? 'me' : 'in') + (selMode && sel.has(m.id) ? ' sel' : ''), 'data-id': m.id },
    h('span', { class: 'chk', html: selMode && sel.has(m.id) ? ic('checkmark', 15) : '' }), h('div', { class: 'rpl', html: ic('arrow-undo-outline', 18) }), bubble(m))
  return row
}
function bubble(m) {
  const url = mediaUrl(m), isMedia = ['image', 'video'].includes(m.type) && !m.viewOnce
  const cls = ['msg', m.fromMe ? 'me' : 'in']
  if (m.type === 'sticker') cls.push('stk'); if (m.deleted) cls.push('deleted'); if (m.reactions?.length) cls.push('hasrx')
  if (isMedia && !m.text) cls.push('nocap')
  const k = []
  if (!m.fromMe && S.cur?.isGroup && m.sender) k.push(h('div', { class: 'who', style: 'color:' + hue(m.senderJid || m.sender) }, m.sender))
  if (m.forwarded) k.push(h('div', { class: 'fwd' }, icn('arrow-redo-outline', 13), 'Encaminhada'))
  if (m.quoted) k.push(h('div', { class: 'quote', onclick: (e) => { e.stopPropagation(); m.quoted.id && jumpTo(m.quoted.id) } }, m.quoted.sender ? h('b', {}, m.quoted.sender) : null, m.quoted.text))
  if (m.viewOnce) k.push(h('div', { class: 'vo' }, h('span', { class: 'ic', html: ic(m.type === 'audio' ? 'mic-outline' : 'eye-off-outline', 18) }), h('div', {}, h('div', { style: 'color:var(--txt)' }, m.type === 'audio' ? 'Áudio de visualização única' : m.type === 'video' ? 'Vídeo de visualização única' : 'Foto de visualização única'), h('div', { style: 'font-size:13px' }, 'Abra no celular'))))
  else if (m.type === 'image') k.push(imageNode(m))
  else if (m.type === 'video') k.push(videoNode(m))
  else if (m.type === 'sticker') k.push(stickerNode(m))
  else if (m.type === 'audio') k.push(audioNode(m))
  else if (m.type === 'document') k.push(docNode(m))
  else if (m.type === 'location') k.push(h('div', { class: 'card2' }, h('div', { class: 'map', html: ic('location-outline', 44) }), m.text ? h('div', { class: 'pad' }, m.text) : null, h('div', { class: 'act', onclick: () => openExternal(`geo:${m.lat},${m.lng}?q=${m.lat},${m.lng}`, `https://maps.google.com/?q=${m.lat},${m.lng}`) }, 'Abrir no mapa')))
  else if (m.type === 'contact') { const wa = (m.vcard.match(/waid=(\d+)/) || [])[1]; k.push(h('div', { class: 'card2' }, h('div', { class: 'pad', style: 'display:flex;gap:10px;align-items:center' }, avatar(null, 40), h('div', {}, h('div', { style: 'font-weight:600' }, m.text), wa ? h('div', { style: 'color:var(--sub);font-size:13px' }, '+' + wa) : null)), wa ? h('div', { class: 'act', onclick: () => startChat({ id: wa + '@s.whatsapp.net', name: m.text, number: '+' + wa }) }, 'Conversar') : null)) }
  else if (m.type === 'poll') k.push(h('div', { class: 'card2 poll' }, h('div', { class: 'pad' }, h('b', {}, '📊 ' + m.text), (m.options || []).map((o) => h('div', { class: 'op' }, h('i'), o)), h('div', { style: 'color:var(--sub);font-size:12px;margin-top:6px' }, 'Vote pelo celular'))))
  if (m.text && !['location', 'contact', 'poll'].includes(m.type)) k.push(h('div', { class: 'txt', style: `--sp:${m.fromMe ? 78 : 52}px` }, linkify(m.text)))
  else if (!isMedia && !['audio', 'sticker', 'location', 'contact', 'poll'].includes(m.type) && !m.viewOnce) k.push(h('div', { class: 'txt' }))
  if (m.translation) k.push(h('div', { class: 'trans' }, '🌐 ' + m.translation))
  k.push(h('div', { class: 'meta' }, m.starred ? h('span', { class: 'star', html: ic('star', 11) }) : null, m.edited ? 'editada ' : null, fmtTime(m.ts), m.fromMe ? ticks(m.pending && m.status > 0 ? 0 : m.status) : null))
  if (m.reactions?.length) k.push(h('div', { class: 'rx' }, [...new Set(m.reactions)].join('') + (m.reactions.length > 1 ? ' ' + m.reactions.length : '')))
  const el = h('div', { class: cls.join(' ') }, k)
  if (m.status === -1) { el.onclick = () => retrySheet(m) }
  return el
}

/* ---------- mídia: blur + progresso + cancelar ---------- */
const warm = async (url, signal) => { const r = await fetch(url, { method: 'HEAD', signal }); if (!r.ok) throw new Error('Falha ao baixar a mídia') }
function dlButton(box, ctl, o) {
  const dl = h('div', { class: 'dl' }); box.append(dl)
  return (s) => {
    if (s === 'idle') dl.replaceChildren(h('button', { class: 'dlb', html: o.icon || ic('arrow-down', 24), onclick: (e) => { e.stopPropagation(); ctl.start() } }), o.label ? h('span', { class: 'szl' }, o.label) : '')
    else if (s === 'loading') dl.replaceChildren(h('button', { class: 'dlb', onclick: (e) => { e.stopPropagation(); ctl.cancel() }, html: ic('close', 22) }, h('i', { class: 'rg' })), o.label ? h('span', { class: 'szl' }, o.label) : '')
    else dl.replaceChildren()
  }
}
function imageNode(m) {
  const url = mediaUrl(m), box = h('div', { class: 'media blur', style: m.w && m.h ? `aspect-ratio:${m.w}/${m.h}` : 'aspect-ratio:4/3' })
  const bl = h('div', { class: 'bl', style: m.thumb ? `background-image:url(data:image/jpeg;base64,${m.thumb})` : '' }), img = h('img', { alt: '' })
  box.append(bl, img)
  const lu = m.localUrl || localMedia.get(m.id)
  const done = (src) => { img.onload = () => { box.classList.remove('blur'); bl.remove(); box.querySelector('.dl')?.remove(); if (m._near || nearBottom()) scrollDown() }; img.onerror = () => { img.remove(); setS('idle') }; img.src = src }
  let ac = null
  const ctl = { start: async () => { ac = new AbortController(); setS('loading'); try { await warm(url, ac.signal); done(url) } catch (e) { setS('idle'); if (e.name !== 'AbortError') toast(e.message) } }, cancel: () => ac?.abort() }
  const setS = dlButton(box, ctl, { label: fmtSize(m.size) })
  box.onclick = () => { if (!box.classList.contains('blur')) openLightbox(img.src) }
  if (lu) done(lu)
  else if (m.cached || pref('autodl', 'all') !== 'none') ctl.start(); else setS('idle')
  if (m.pending) pendingOverlay(box, m)
  return box
}
function pendingOverlay(box, m) { box.append(h('div', { class: 'dl' }, h('button', { class: 'dlb', onclick: (e) => { e.stopPropagation(); cancelPending(m) }, html: ic('close', 22) }, h('i', { class: 'rg' })))) }
function videoNode(m) {
  const url = mediaUrl(m), box = h('div', { class: 'media blur', style: m.w && m.h ? `aspect-ratio:${m.w}/${m.h}` : 'aspect-ratio:16/9' })
  const bl = h('div', { class: 'bl', style: m.thumb ? `background-image:url(data:image/jpeg;base64,${m.thumb})` : '' }); box.append(bl)
  const play = (src) => { const v = h('video', { src, controls: !m.gif, autoplay: true, playsInline: true, loop: m.gif, muted: m.gif, preload: 'auto' }); box.classList.remove('blur'); box.replaceChildren(v) }
  let ac = null
  const ctl = { start: async () => { ac = new AbortController(); setS('loading'); try { await warm(url, ac.signal); play(url) } catch (e) { setS('idle'); if (e.name !== 'AbortError') toast(e.message) } }, cancel: () => ac?.abort() }
  const setS = dlButton(box, ctl, { icon: ic('play', 26), label: [m.seconds ? mmss(m.seconds) : '', fmtSize(m.size)].filter(Boolean).join(' · ') })
  const lu = m.localUrl || localMedia.get(m.id)
  if (lu) play(lu); else if (m.cached || m.gif) ctl.start(); else setS('idle')
  if (m.pending) pendingOverlay(box, m)
  return box
}
function stickerNode(m) {
  const url = mediaUrl(m), img = h('img', { alt: '', style: 'min-height:150px' }), lu = m.localUrl || localMedia.get(m.id)
  img.src = lu || url; img.onerror = () => { img.style.opacity = .3 }
  return h('div', { style: 'position:relative;width:150px' }, img)
}
function docNode(m) {
  const url = mediaUrl(m), ext = ((m.fileName || '').split('.').pop() || 'file').slice(0, 5)
  return h('a', { class: 'doc', href: m.localUrl || url, target: '_blank', download: m.fileName || '' }, h('span', { style: 'color:var(--tint)', html: ic('document-outline', 34) }), h('span', { class: 'ft' }, m.fileName || 'Documento', h('small', {}, ext + (m.size ? ' · ' + fmtSize(m.size) : ''))))
}

/* ---------- áudio ---------- */
const players = new Set()
const stopAllAudio = () => players.forEach((a) => a.pause())
function audioNode(m) {
  const url = mediaUrl(m), lu = m.localUrl || localMedia.get(m.id), N = 32
  let seed = 0; for (const c of String(m.id)) seed = (seed * 33 + c.charCodeAt(0)) >>> 0
  const bars = Array.from({ length: N }, () => { seed = (seed * 1664525 + 1013904223) >>> 0; return h('i', { style: `height:${4 + (seed >>> 24) % 20}px` }) })
  const au = h('audio', { preload: 'none' }); players.add(au)
  const btn = h('button', { class: 'play', html: ic('play', 24) }), wave = h('div', { class: 'wave' }, bars), dur = h('span', { class: 'dur' }, mmss(m.seconds))
  const paint = () => { const r = isFinite(au.duration) && au.duration ? au.currentTime / au.duration : 0; bars.forEach((b, i) => b.classList.toggle('on', i / N < r)); dur.textContent = mmss(!au.paused ? au.currentTime : m.seconds || (isFinite(au.duration) ? au.duration : 0)) }
  let loading = false
  const ensure = async () => { if (au.src) return true; if (lu) { au.src = lu; return true } loading = true; btn.innerHTML = '<span class="dlb" style="width:30px;height:30px;background:none;color:var(--meta)"><i class="rg" style="border-color:rgba(128,128,128,.3);border-top-color:var(--meta)"></i></span>'; try { await warm(url); au.src = url; return true } catch (e) { toast('Não foi possível carregar o áudio'); btn.innerHTML = ic('play', 24); return false } finally { loading = false } }
  btn.onclick = async () => { if (loading) return; if (!au.paused) return au.pause(); if (!(await ensure())) return; players.forEach((a) => a !== au && a.pause()); au.play().catch((e) => { toast('Não foi possível reproduzir'); btn.innerHTML = ic('play', 24) }) }
  au.onplay = () => (btn.innerHTML = ic('pause', 24)); au.onpause = () => { btn.innerHTML = ic('play', 24); paint() }
  au.onended = () => { au.currentTime = 0; btn.innerHTML = ic('play', 24); bars.forEach((b) => b.classList.remove('on')); dur.textContent = mmss(m.seconds) }
  au.ontimeupdate = paint
  wave.onclick = async (e) => { if (!(await ensure())) return; const r = wave.getBoundingClientRect(), d = isFinite(au.duration) ? au.duration : m.seconds; if (d) au.currentTime = ((e.clientX - r.left) / r.width) * d }
  const lead = m.fromMe && !m.ptt ? null : h('div', { class: 'mic', html: ic('mic', 18) })
  return h('div', { class: 'aud' }, m.fromMe ? btn : btn, wave, lead, dur)
}

/* ---------- atualizações em tempo real ---------- */
function rowFor(id) { return document.querySelector(`#msgs .mrow[data-id="${CSS.escape(id)}"]`) }
function onMessage({ chat, message: m }) {
  const viewing = S.cur?.id === chat.id && $('#app').classList.contains('pushed')
  if (viewing) {
    const box = $('#msgs'), near = nearBottom()
    const idx = S.msgs.findIndex((x) => x.id === m.id)
    if (idx >= 0) { Object.assign(S.msgs[idx], m, { pending: false, localUrl: S.msgs[idx].localUrl }); const old = rowFor(m.id); old?.replaceWith(msgRow(S.msgs[idx], idx)) }
    else if (m.fromMe && adoptPending(m)) { /* a mensagem otimista virou a real */ }
    else {
      m._near = near || m.fromMe
      const prev = S.msgs[S.msgs.length - 1]; S.msgs.push(m)
      if (m.ts >= (prev?.ts || 0)) {
        if (!prev || daysAgo(prev.ts) !== daysAgo(m.ts)) box.append(h('div', { class: 'day' }, dayLabel(m.ts)))
        box.append(msgRow(m, S.msgs.length - 1))
      } else { S.msgs.sort((a, b) => a.ts - b.ts); renderMsgs(false) }
      if (near || m.fromMe) scrollDown()
    }
    chat.unread = 0
    if (!m.fromMe) post(`/api/chats/${enc(chat.id)}/read`).catch(() => {})
  } else if (!m.fromMe && !NA() && pref('notif', false) && document.hidden && window.Notification && Notification.permission === 'granted' && !chat.muted) new Notification(chat.name, { body: m.text || chat.preview, tag: chat.id })
  const i = S.chats.findIndex((c) => c.id === chat.id); if (i >= 0) { const old = S.chats[i]; S.chats.splice(i, 1); chat.pinned = old.pinned }
  S.chats.push(chat); S.chats.sort((a, b) => (b.pinned - a.pinned) || b.lastTs - a.lastTs); renderChats(); updateBackN()
}
function adoptPending(m) {
  const i = S.msgs.findIndex((x) => x.pending && !x.settled && x.type === m.type && (x.text || '') === (m.text || ''))
  if (i < 0) return false
  const t = S.msgs[i], lu = t.localUrl; pendingJobs.delete(t.id)
  Object.assign(t, m, { pending: false, settled: true, localUrl: lu }); if (lu) localMedia.set(m.id, lu)
  const old = document.querySelector(`#msgs .mrow[data-id="${CSS.escape(t.tmp)}"]`); old?.replaceWith(msgRow(t, i)); return true
}
function onMStatus({ jid, id, status }) {
  if (S.cur?.id === jid) {
    const m = S.msgs.find((x) => x.id === id); if (m) m.status = status
    const el = rowFor(id)?.querySelector('.meta')
    if (el && m?.fromMe) { el.lastChild?.classList?.contains('tk') && el.lastChild.remove(); el.append(ticks(status)) }
  }
  const c = S.chats.find((x) => x.id === jid); if (c && c.lastFromMe) { c.lastStatus = Math.max(c.lastStatus, status); renderChats() }
}
function jumpTo(id) {
  const r = rowFor(id); if (!r) return toast('Mensagem antiga não carregada')
  const box = $('#msgs'); box.scrollTo({ top: Math.max(0, r.offsetTop - box.clientHeight / 2 + r.offsetHeight / 2), behavior: 'smooth' }); const b = r.querySelector('.msg'); b.classList.remove('flash'); void b.offsetWidth; b.classList.add('flash')
}

/* ---------- envio otimista (relógio → ✓ → ✓✓) ---------- */
function addPending(m) {
  m.tmp = m.id = 'tmp-' + Date.now() + Math.random().toString(36).slice(2, 6)
  Object.assign(m, { jid: S.cur.id, fromMe: true, ts: Math.floor(Date.now() / 1000), status: 0, pending: true, sender: 'Você', senderJid: '' })
  const prev = S.msgs[S.msgs.length - 1]; S.msgs.push(m)
  const box = $('#msgs'); if (!prev || daysAgo(prev.ts) !== daysAgo(m.ts)) box.append(h('div', { class: 'day' }, dayLabel(m.ts)))
  box.append(msgRow(m, S.msgs.length - 1)); scrollDown(); return m
}
function settle(m, realId) {
  if (m.settled) return
  m.settled = true; m.pending = false; pendingJobs.delete(m.tmp)
  const existing = S.msgs.find((x) => x !== m && x.id === realId)
  if (existing) { S.msgs.splice(S.msgs.indexOf(m), 1); document.querySelector(`#msgs .mrow[data-id="${CSS.escape(m.tmp)}"]`)?.remove(); return }
  if (m.localUrl && realId) localMedia.set(realId, m.localUrl)
  m.id = realId || m.id; m.status = Math.max(m.status, 1)
  const old = document.querySelector(`#msgs .mrow[data-id="${CSS.escape(m.tmp)}"]`); if (old) { const i = S.msgs.indexOf(m); old.replaceWith(msgRow(m, i)) }
}
function failMsg(m, err) {
  pendingJobs.delete(m.tmp); m.pending = false; m.status = -1; m.error = err?.message
  const i = S.msgs.indexOf(m), old = document.querySelector(`#msgs .mrow[data-id="${CSS.escape(m.tmp)}"]`); if (old && i >= 0) old.replaceWith(msgRow(m, i))
  toast(err?.message || 'Falha ao enviar')
}
function cancelPending(m) { pendingJobs.get(m.tmp)?.abort(); const i = S.msgs.indexOf(m); if (i >= 0) S.msgs.splice(i, 1); document.querySelector(`#msgs .mrow[data-id="${CSS.escape(m.tmp)}"]`)?.remove(); pendingJobs.delete(m.tmp) }
function retrySheet(m) {
  sheet([h('div', { class: 'grp' }, sheetInfo('Mensagem não enviada', m.error || 'Verifique a conexão e tente novamente.'),
    opt('Reenviar', 'refresh-outline', () => { const f = m.retry; cancelPending(m); f?.() }, { bg: '#007AFF' }), opt('Apagar', 'trash-outline', () => cancelPending(m), { red: true })), cancelOpt()])
}
function replyOpt() { const r = S.reply; S.reply = null; updateReplyBar(); return r?.id }
async function sendText(textArg) {
  if (!S.cur) return
  const text = (textArg ?? $('#txt').value).trim(); if (!text) return
  if (S.editing) { const e = S.editing; S.editing = null; updateReplyBar(); $('#txt').value = ''; syncComposer(); try { await post('/api/edit', { jid: S.cur.id, id: e.id, text }) } catch (er) { toast(er.message) } return }
  if (textArg == null) { $('#txt').value = ''; syncComposer() }
  const jid = S.cur.id, rep = S.reply, quotedId = replyOpt()
  const m = addPending({ type: 'text', text, quoted: rep ? { id: rep.id, sender: rep.sender, text: rep.text } : null })
  m.retry = () => { $('#txt').value = text; sendText() }
  try { const r = await post('/api/send', { jid, text, quotedId }); settle(m, r.id) } catch (e) { failMsg(m, e) }
}
const mimeType = (f) => f.type.startsWith('image/') && f.type !== 'image/gif' ? 'image' : f.type.startsWith('video/') || f.type === 'image/gif' ? 'video' : f.type.startsWith('audio/') ? 'audio' : 'document'
async function makeThumb(file) {
  try {
    const type = mimeType(file); if (type !== 'image' && type !== 'video') return {}
    const src = URL.createObjectURL(file)
    const el = await new Promise((res, rej) => { const t = setTimeout(rej, 4000); const e = type === 'image' ? new Image() : document.createElement('video'); e.muted = true; e.preload = 'auto'; e.playsInline = true; e.onerror = rej; if (type === 'image') e.onload = () => { clearTimeout(t); res(e) }; else { e.onloadeddata = () => { e.currentTime = 0.05 }; e.onseeked = () => { clearTimeout(t); res(e) } } e.src = src })
    const w = el.naturalWidth || el.videoWidth, hh = el.naturalHeight || el.videoHeight, k = 72 / Math.max(w, hh), c = document.createElement('canvas')
    c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(hh * k)); c.getContext('2d').drawImage(el, 0, 0, c.width, c.height)
    URL.revokeObjectURL(src)
    return { thumb: c.toDataURL('image/jpeg', 0.5).split(',')[1], w, h: hh }
  } catch { return {} }
}
function xhrSend(url, body, headers, job) {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest(); x.open('POST', url)
    for (const [k, v] of Object.entries(headers)) x.setRequestHeader(k, v)
    x.onload = () => { try { const j = JSON.parse(x.responseText); x.status < 300 ? resolve(j) : reject(new Error(j.error || 'Erro ' + x.status)) } catch { reject(new Error('Resposta inválida')) } }
    x.onerror = () => reject(new Error('Sem conexão com o servidor')); x.onabort = () => reject(Object.assign(new Error('cancelado'), { name: 'AbortError' }))
    job.abort = () => x.abort(); x.send(body)
  })
}
async function sendMedia(file, caption = '', { quotedId } = {}) {
  if (!S.cur) return
  const jid = S.cur.id, type = mimeType(file), th = await makeThumb(file), lu = URL.createObjectURL(file)
  const m = addPending({ type, text: caption, localUrl: lu, mime: file.type, fileName: file.name, size: file.size, thumb: th.thumb, w: th.w, h: th.h, viewOnce: false })
  const job = {}; pendingJobs.set(m.tmp, job)
  const q = new URLSearchParams({ jid, filename: file.name, caption }); if (quotedId) q.set('quotedId', quotedId)
  const headers = { 'Content-Type': file.type || 'application/octet-stream' }; if (th.thumb) { headers['X-Thumb'] = th.thumb; headers['X-Dim'] = th.w + 'x' + th.h }
  m.retry = () => sendMedia(file, caption)
  try { const r = await xhrSend('/api/send-media?' + q, file, headers, job); settle(m, r.id) } catch (e) { if (e.name === 'AbortError') return; failMsg(m, e) }
}
async function sendVoice(blob, seconds) {
  const jid = S.cur.id, quotedId = replyOpt(), lu = URL.createObjectURL(blob)
  const m = addPending({ type: 'audio', ptt: true, seconds, localUrl: lu })
  const job = {}; pendingJobs.set(m.tmp, job); m.retry = () => sendVoice(blob, seconds)
  const q = new URLSearchParams({ jid }); if (quotedId) q.set('quotedId', quotedId)
  try { const r = await xhrSend('/api/send-audio?' + q, blob, { 'Content-Type': blob.type || 'audio/webm' }, job); settle(m, r.id) } catch (e) { if (e.name !== 'AbortError') failMsg(m, e) }
}

/* ---------- composer ---------- */
let rg = null, lastTyping = 0
function syncComposer() {
  const has = !!$('#txt').value.trim()
  $('#rt').hidden = has || !!rg; $('#rtSend').hidden = !has && !rg; grow($('#txt'))
}
function resetComposer() { $('#txt').value = ''; syncComposer() }
$('#txt').addEventListener('input', () => {
  syncComposer(); if (!S.cur) return
  const now = Date.now(); if (now - lastTyping > 4000 && $('#txt').value) { lastTyping = now; post('/api/presence', { jid: S.cur.id, state: 'composing' }).catch(() => {}) }
})
$('#txt').addEventListener('blur', () => { lastTyping = 0; S.cur && post('/api/presence', { jid: S.cur.id, state: 'paused' }).catch(() => {}) })
$('#txt').addEventListener('focus', () => { closePanel(); setTimeout(scrollDown, 300) })
$('#txt').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && innerWidth > 760 && pref('enter', true)) { e.preventDefault(); sendText() } })
$('#sendBtn').onclick = () => (rg ? finishRec(true) : sendText())
$('#camBtn').onclick = () => $('#fCam').click()

/* ---------- gravação: segurar e soltar / deslizar p/ cancelar / arrastar p/ cima ou tocar para travar ---------- */
const mic = $('#micBtn')
function showRec(on, locked) {
  $('#camBtn').hidden = on; $('#recBar').hidden = !on; $('#pill').hidden = on; $('#plus').style.visibility = on ? 'hidden' : ''
  mic.classList.toggle('rec', on && !locked); $('#rt').hidden = on ? locked : !!$('#txt').value.trim(); $('#rtSend').hidden = on ? !locked : !$('#txt').value.trim()
  $('#recHint').textContent = locked ? 'Gravando…' : '‹ Deslize para cancelar'; $('#recHint').style.opacity = 1
  const lk = $('#recLock'); lk.hidden = !on || locked
  if (on && !locked) lk.innerHTML = `<span>${ic('lock-closed-outline', 18)}</span><span style="opacity:.6">${ic('chevron-down', 16).replace('<svg', '<svg style="transform:rotate(180deg)"')}</span>`
  if (!on) { lk.hidden = true; mic.style.transform = '' }
}
async function beginRec() {
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { toast('Gravação indisponível neste navegador'); return null }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
    const mime = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/webm'].find((t) => MediaRecorder.isTypeSupported(t)) || ''
    const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : {}), chunks = []
    mr.ondataavailable = (e) => e.data.size && chunks.push(e.data)
    return { mr, stream, chunks }
  } catch { toast('Permita o uso do microfone para gravar áudios'); return null }
}
function startTimer() { const t0 = Date.now(); rg.timer = setInterval(() => { $('#recTime').textContent = mmss((Date.now() - t0) / 1000) }, 250); $('#recTime').textContent = '0:00' }
function finishRec(send) {
  if (!rg || !rg.mr) return
  const r = rg; r.send = send; clearInterval(r.timer)
  r.mr.onstop = () => {
    r.stream.getTracks().forEach((t) => t.stop())
    const secs = (Date.now() - r.t0) / 1000
    if (r.send && secs > 0.7 && S.cur?.id === r.jid) sendVoice(new Blob(r.chunks, { type: r.mr.mimeType || 'audio/webm' }), Math.round(secs))
    else if (r.send && secs <= 0.7) toast('Segure o botão para gravar')
  }
  if (r.mr.state !== 'inactive') r.mr.stop()
  rg = null; showRec(false); syncComposer(); post('/api/presence', { jid: r.jid, state: 'paused' }).catch(() => {})
}
const cancelRec = () => { if (rg) finishRec(false) }
mic.addEventListener('pointerdown', async (e) => {
  e.preventDefault(); if (rg || !S.cur) return
  mic.setPointerCapture(e.pointerId)
  const g = (rg = { x0: e.clientX, y0: e.clientY, t0: Date.now(), jid: S.cur.id, locked: false, released: false, pending: true, cancelled: false })
  haptic(12); showRec(true, false); post('/api/presence', { jid: g.jid, state: 'recording' }).catch(() => {})
  const r = await beginRec()
  if (!r) { if (rg === g) { rg = null; showRec(false); syncComposer() } return }
  if (rg !== g) { r.stream.getTracks().forEach((t) => t.stop()); return }
  Object.assign(g, r, { pending: false, t0: Date.now() }); g.mr.start(250); startTimer()
  if (g.released) onRelease(g)
})
mic.addEventListener('pointermove', (e) => {
  const g = rg; if (!g || g.locked || g.cancelled) return
  const dx = e.clientX - g.x0, dy = e.clientY - g.y0
  mic.style.transform = `translate(${Math.min(0, dx) * .4}px,${Math.min(0, dy) * .4}px)`
  $('#recHint').style.opacity = String(Math.max(0, 1 + dx / 110)); $('#recLock').style.transform = `translateY(${Math.min(0, dy) * .3}px)`
  if (dy < -70) { g.locked = true; haptic(15); showRec(true, true) }
  else if (dx < -100) { g.cancelled = true; haptic(15); if (g.mr) cancelRec(); else { rg = null; showRec(false); syncComposer() } }
})
const onRelease = (g) => { if (g.locked || g.cancelled) return; if (Date.now() - g.t0 < 400) { g.locked = true; showRec(true, true) } else finishRec(true) }
mic.addEventListener('pointerup', () => { const g = rg; if (!g) return; g.released = true; if (!g.pending) onRelease(g); else if (Date.now() - g.t0 < 400) { g.locked = true; showRec(true, true) } })
mic.addEventListener('pointercancel', () => { const g = rg; if (g && !g.locked) { g.released = true; if (!g.pending) onRelease(g) } })
$('#recCancel').onclick = cancelRec

/* ---------- anexos ---------- */
let pvFile = null, pvUrl = null
function openPreview(f) {
  pvFile = f; pvUrl = URL.createObjectURL(f); const st = $('#pvStage')
  st.replaceChildren(f.type.startsWith('image/') ? h('img', { src: pvUrl }) : f.type.startsWith('video/') ? h('video', { src: pvUrl, controls: true }) :
    h('div', { style: 'text-align:center;color:#fff' }, h('div', { html: ic('document-outline', 90) }), h('div', { style: 'margin-top:10px;font-size:17px' }, f.name), h('div', { style: 'opacity:.6;font-size:14px' }, fmtSize(f.size))))
  $('#pvTxt').value = ''; $('#pvCap').hidden = false; $('#pv').classList.add('on')
}
const closePreview = () => { $('#pv').classList.remove('on'); $('#pvStage').replaceChildren(); if (pvUrl) URL.revokeObjectURL(pvUrl); pvFile = null; statusMode = false; $('#pvCap').hidden = false; $('#pvX').onclick = closePreview }
$('#pvX').onclick = closePreview
$('#pvSend').onclick = async () => {
  const f = pvFile, caption = $('#pvTxt').value; if (!f) return
  const forStatus = statusMode, quotedId = S.reply?.id; closePreview()
  if (forStatus) { toast('Publicando status…'); try { await api('/api/status/media?' + new URLSearchParams({ caption }), { method: 'POST', headers: { 'Content-Type': f.type }, body: f }); toast('Status publicado'); loadStatuses() } catch (e) { toast(e.message) } return }
  if (quotedId) replyOpt()
  sendMedia(f, caption, { quotedId })
}
function openLightbox(src) { pvFile = null; $('#pvCap').hidden = true; $('#pvStage').replaceChildren(h('img', { src })); $('#pv').classList.add('on'); $('#pvX').onclick = closePreview }
for (const id of ['#fMedia', '#fCam', '#fDoc']) $(id).onchange = (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) openPreview(f) }
