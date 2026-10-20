/* ============================== núcleo: helpers, estado, login, abas ============================== */
const $ = (s) => document.querySelector(s)
function h(tag, a, ...kids) {
  const e = document.createElement(tag)
  for (const [k, v] of Object.entries(a || {})) {
    if (v == null || v === false) continue
    if (k === 'class') e.className = v
    else if (k === 'html') e.innerHTML = v
    else if (k === 'style') e.style.cssText = v
    else if (k.startsWith('on') || ['textContent', 'src', 'href', 'value', 'controls', 'preload', 'download', 'target', 'loading', 'poster', 'type', 'placeholder', 'autoplay', 'playsInline', 'muted', 'loop'].includes(k)) e[k] = v
    else e.setAttribute(k, v)
  }
  for (const kid of kids.flat(9)) if (kid != null && kid !== false) e.append(kid.nodeType ? kid : document.createTextNode(kid))
  return e
}
const ic = (n, s = 24, extra = '') => `<svg viewBox="0 0 512 512" width="${s}" height="${s}" fill="currentColor" ${extra}>${ION[n] || ''}</svg>`
const icn = (n, s = 24, cls = '') => h('span', { class: 'ic ' + cls, html: ic(n, s) })
const SILH = '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="9" r="4.2"/><path d="M3.5 24c0-5 3.8-8 8.5-8s8.5 3 8.5 8z"/></svg>'
const GRPS = '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="8.5" r="3.6"/><circle cx="5.5" cy="10" r="2.6"/><circle cx="18.5" cy="10" r="2.6"/><path d="M5 22c0-4.5 3.2-7 7-7s7 2.5 7 7z"/></svg>'
const UPD = '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9.5" stroke-dasharray="3.6 2.4"/><circle cx="12" cy="12" r="4" fill="currentColor" stroke="none"/></svg>'
const tickSvg = (d) => `<svg width="${d ? 17 : 13}" height="11" viewBox="0 0 ${d ? 17 : 13} 11" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1 5.8l3.4 3.4L11 1.5"/>${d ? '<path d="M6.4 8.7l.9.9L15.2 1.5"/>' : ''}</svg>`
const clockSvg = '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><circle cx="6" cy="6" r="5"/><path d="M6 3v3l2 1.2"/></svg>'
const failSvg = '<svg width="14" height="14" viewBox="0 0 14 14"><circle cx="7" cy="7" r="7" fill="#FF3B30"/><path d="M7 3.5v4M7 9.6v.1" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/></svg>'
function ticks(st) {
  if (st === -1) return h('span', { class: 'tk', html: failSvg })
  if (st === 0 || st === 1) return h('span', { class: 'tk', html: clockSvg })
  return h('span', { class: 'tk' + (st >= 4 ? ' rd' : ''), html: tickSvg(st >= 3) })
}

const enc = encodeURIComponent
const api = async (url, o) => { const r = await fetch(url, o); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'Erro ' + r.status); return j }
const post = (u, b) => api(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) })
let toastT
const toast = (m) => { const t = $('#toast'); t.textContent = m; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 2800) }
const haptic = (ms = 10) => { try { window.Android?.haptic?.(ms) ?? navigator.vibrate?.(ms) } catch {} }
const pad = (n) => String(n).padStart(2, '0')
const fmtTime = (ts) => { const d = new Date(ts * 1000); return pad(d.getHours()) + ':' + pad(d.getMinutes()) }
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
const daysAgo = (ts) => Math.round((startOfDay(new Date()) - startOfDay(new Date(ts * 1000))) / 864e5)
const WD = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado']
const dayLabel = (ts) => { const n = daysAgo(ts), d = new Date(ts * 1000); return n === 0 ? 'Hoje' : n === 1 ? 'Ontem' : n < 7 ? WD[d.getDay()][0].toUpperCase() + WD[d.getDay()].slice(1) : d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' }) }
const listTime = (ts) => { if (!ts) return ''; const n = daysAgo(ts); return n === 0 ? fmtTime(ts) : n === 1 ? 'Ontem' : n < 7 ? WD[new Date(ts * 1000).getDay()].split('-')[0] : new Date(ts * 1000).toLocaleDateString('pt-BR') }
const fmtSize = (b) => !b ? '' : b < 1024 * 1024 ? Math.max(1, Math.round(b / 1024)) + ' KB' : (b / 1048576).toFixed(1).replace('.', ',') + ' MB'
const fmtPhone = (jid) => { const n = (jid || '').split('@')[0].split(':')[0], m = n.match(/^55(\d{2})(9?\d{4})(\d{4})$/); return m ? `+55 ${m[1]} ${m[2]}-${m[3]}` : n ? '+' + n : '' }
const mmss = (s) => { s = Math.round(s || 0); return Math.floor(s / 60) + ':' + pad(s % 60) }

function avatar(jid, size, isGroup, full) {
  const a = h('div', { class: 'av', style: `width:${size}px;height:${size}px`, html: isGroup ? GRPS : SILH })
  if (jid) a.append(h('img', { src: '/api/avatar/' + enc(jid) + (full ? '?full=1' : ''), loading: 'lazy', onerror() { this.remove() } }))
  return a
}
const hue = (s) => { let x = 0; for (const c of s || '') x = (x * 31 + c.charCodeAt(0)) >>> 0; return ['#c44ec6', '#0b9d6a', '#e5732d', '#3b82f6', '#d1306f', '#8e6bd8', '#c7a40b', '#1b9aaa', '#e0484a'][x % 9] }
const sysName = (n) => n

/* ---------- estado e preferências ---------- */
const S = { st: null, name: '', me: '', chats: [], archived: [], calls: [], statuses: [], cur: null, msgs: [], tab: 'chats', callF: 'all', filter: 'all', lgStep: null, cfg: {}, presence: {} }
const pref = (k, d) => { try { const v = localStorage.getItem('wa_' + k); return v == null ? d : JSON.parse(v) } catch { return d } }
const setPref = (k, v) => { try { localStorage.setItem('wa_' + k, JSON.stringify(v)) } catch { toast('Sem espaço para salvar a preferência') } }
const viewed = new Set(pref('viewed', []))
const unreadTotal = () => S.chats.reduce((a, c) => a + (c.muted ? 0 : c.unread || (c.markedUnread ? 1 : 0)), 0)
const NA = () => window.Android

const mq = matchMedia('(prefers-color-scheme: dark)')
function applyLook() {
  const t = pref('theme', 'auto'), dark = t === 'dark' || (t === 'auto' && mq.matches)
  const r = document.documentElement
  r.dataset.theme = dark ? 'dark' : 'light'
  r.dataset.glass = pref('glass', false) ? '1' : '0'
  r.style.setProperty('--fs', pref('fs', 1))
  document.querySelector('meta[name=theme-color]').content = dark ? '#18181A' : '#F7F7F7'
  try { NA()?.setBars?.(dark) } catch {}
  applyWallpaper()
}
function applyWallpaper() {
  const w = pref('wall', null), c = $('#chat')
  c.classList.toggle('wp-img', w?.t === 'img')
  c.style.backgroundImage = w?.t === 'img' ? `url(${w.v})` : w?.t === 'plain' ? 'none' : ''
  c.style.backgroundColor = w?.t === 'color' || w?.t === 'plain' ? w.v : ''
}
mq.addEventListener('change', applyLook)

/* ---------- teclado virtual ---------- */
if (window.visualViewport) {
  const vv = visualViewport
  const upd = () => {
    const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop), open = kb > 120
    const ph = $('#phone'); ph.classList.toggle('kb', open)
    ph.style.height = open ? vv.height + 'px' : ''
    if (open) { window.scrollTo(0, 0); if (S.cur) requestAnimationFrame(scrollDown) }
  }
  vv.addEventListener('resize', upd); vv.addEventListener('scroll', upd)
}

/* ---------- sheets, alertas e telas ---------- */
const sheet = (nodes) => { $('#sheet').replaceChildren(...nodes); $('#sheet').classList.add('on'); $('#scrim').classList.add('on') }
const closeSheet = () => { $('#sheet').classList.remove('on'); if (!$('#alert').classList.contains('on')) $('#scrim').classList.remove('on') }
$('#scrim').onclick = () => { closeSheet(); closeAlert() }
const opt = (label, icon, fn, o = {}) => h('button', { class: 'opt' + (o.red ? ' red' : ''), onclick: () => { closeSheet(); fn?.() } },
  icon ? h('span', { class: 'ico', style: 'background:' + (o.bg || 'var(--tint)'), html: ic(icon, 20) }) : null, h('span', { class: 'lbl', style: o.red ? 'color:var(--red);text-align:center' : '' }, label), o.right || null)
const cancelOpt = () => h('button', { class: 'opt can', onclick: closeSheet }, 'Cancelar')
const sheetInfo = (t, d) => h('div', { class: 'info' }, h('b', {}, t), d || '')
function choose(title, items, onPick, current) {
  sheet([h('div', { class: 'grp' }, title ? sheetInfo(title) : null, items.map(([label, val]) =>
    h('button', { class: 'opt', onclick: () => { closeSheet(); onPick(val) } }, h('span', { class: 'lbl' }, label), String(val) === String(current) ? h('span', { class: 'check', html: ic('checkmark', 22) }) : null))), cancelOpt()])
}
function closeAlert() { $('#alert').classList.remove('on'); if (!$('#sheet').classList.contains('on')) $('#scrim').classList.remove('on') }
function confirmDlg({ title, msg, ok = 'OK', danger = false, cancel = 'Cancelar' }) {
  return new Promise((res) => {
    const a = $('#alert')
    a.replaceChildren(h('div', { class: 't' }, h('b', {}, title), msg || ''), h('div', { class: 'bs' },
      h('button', { onclick: () => { closeAlert(); res(false) } }, cancel), h('button', { class: danger ? 'red' : '', onclick: () => { closeAlert(); res(true) } }, ok)))
    a.classList.add('on'); $('#scrim').classList.add('on')
  })
}
const screens = []
function openScreen(title, build, o = {}) {
  const body = h('div'), el = h('div', { class: 'scr scrolled' },
    h('div', { class: 'nb' }, h('button', { class: 'back', onclick: closeScreen, html: ic('chevron-back', 26) + `<span>${o.backLabel || 'Voltar'}</span>` }), h('span', { class: 't' }, title), h('span', { class: 'side' }, o.right || '')), body)
  $('#app').append(el); screens.push(el); build(body, el)
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('in')))
  return { el, body }
}
function closeScreen() {
  const el = screens.pop(); if (!el) return false
  el.classList.remove('in'); setTimeout(() => el.remove(), 420); return true
}
const grow = (ta) => { ta.style.height = '36px'; ta.style.height = Math.min(ta.scrollHeight, 120) + 'px' }

/* ---------- login (fluxo igual ao do WhatsApp para iOS) ---------- */
function renderLogin() {
  const el = $('#login'), st = S.st
  if (st === 'unpaired' && !S.lgStep) S.lgStep = 'welcome'
  if (st !== 'unpaired') S.lgStep = null
  if (st === 'unpaired' && S.lgStep === 'welcome') {
    el.replaceChildren(h('div', { class: 'lg' },
      h('h1', {}, 'Bem-vindo ao WhatsApp'),
      h('div', { class: 'mid' }, h('div', { class: 'logo', html: ic('logo-whatsapp', 104) })),
      h('p', { class: 'terms' }, 'Leia nossa ', h('b', {}, 'Política de Privacidade'), '. Toque em “Concordar e continuar” para aceitar os ', h('b', {}, 'Termos de Serviço'), '.'),
      h('button', { class: 'pbtn', onclick: () => { S.lgStep = 'number'; renderLogin() } }, 'Concordar e continuar')))
  } else if (st === 'unpaired') {
    const cc = h('input', { type: 'tel', value: '+55', inputmode: 'tel', style: 'max-width:62px;color:var(--tint);font-size:19px' }), num = h('input', { type: 'tel', inputmode: 'numeric', placeholder: 'número de telefone', autocomplete: 'off' })
    const go = h('button', { disabled: true, onclick: async () => {
      $('#lerr').textContent = ''; go.disabled = true; go.textContent = 'Gerando…'
      try { await post('/api/pair', { number: cc.value.replace(/\D/g, '') + num.value.replace(/\D/g, '') }) }
      catch (e) { $('#lerr').textContent = e.message; go.disabled = false; go.textContent = 'Avançar' }
    } }, 'Avançar')
    num.oninput = () => (go.disabled = (cc.value + num.value).replace(/\D/g, '').length < 10)
    el.replaceChildren(h('div', { class: 'lgnav' }, h('button', { onclick: () => { S.lgStep = 'welcome'; renderLogin() }, html: ic('chevron-back', 24) }), h('b', {}, 'Seu número de telefone'), go),
      h('div', { class: 'lgbody' }, h('div', { class: 'note' }, 'Confirme o código do país e digite seu número de telefone para vincular este aparelho à sua conta.'),
        h('div', { class: 'box' }, h('div', {}, h('span', {}, 'País'), h('span', { style: 'margin-left:auto;color:var(--sub)' }, 'Brasil')), h('div', {}, cc, num)), h('div', { id: 'lerr' })))
    setTimeout(() => num.focus(), 350)
  } else if (st === 'pairing') {
    const boxes = h('div', { class: 'codeBoxes' })
    ;(S.pairCode || '').split('').forEach((c) => boxes.append(c === '-' ? h('i') : h('b', {}, c)))
    el.replaceChildren(h('div', { class: 'lgnav' }, h('span'), h('b', {}, 'Digite o código'), h('span')), h('div', { class: 'lgbody' },
      h('div', { class: 'note' }, 'Digite este código no seu celular para concluir a conexão.'), boxes,
      h('ol', { class: 'steps' }, h('li', {}, 'Abra o WhatsApp no celular'), h('li', {}, 'Vá em ', h('b', {}, 'Configurações › Aparelhos conectados')), h('li', {}, 'Toque em ', h('b', {}, 'Conectar um aparelho')), h('li', {}, 'Escolha ', h('b', {}, 'Conectar com número de telefone'))), h('div', { id: 'lerr' })))
  } else el.replaceChildren(h('div', { class: 'lgbody', style: 'background:var(--bg)' }, h('div', { class: 'spin' }), h('div', { class: 'note' }, 'Conectando…')))
}

/* ---------- abas ---------- */
const TABS = [['updates', 'Atualizações'], ['calls', 'Chamadas'], ['chats', 'Conversas'], ['settings', 'Ajustes']]
function buildTabbar() {
  const n = unreadTotal()
  $('#tabbar').replaceChildren(...TABS.map(([id, label]) =>
    h('button', { class: id === S.tab ? 'on' : '', onclick: () => setTab(id) },
      id === 'updates' ? h('span', { html: UPD }) : h('span', { html: ic(id === 'calls' ? (id === S.tab ? 'call' : 'call-outline') : id === 'settings' ? (id === S.tab ? 'settings' : 'settings-outline') : id === S.tab ? 'chatbubbles' : 'chatbubbles-outline', 26) }),
      label, id === 'chats' && n ? h('i', { class: 'bdg' }, n > 99 ? '99+' : n) : null)))
  try { NA()?.setBadge?.(n) } catch {}
}
function setTab(id) {
  S.tab = id
  document.querySelectorAll('.page').forEach((p) => p.classList.toggle('on', p.id === 'pg-' + id))
  buildTabbar()
  if (id === 'updates') loadStatuses()
  if (id === 'calls') loadCalls()
  if (id === 'settings') renderSettings()
}
document.querySelectorAll('.page').forEach((p) => p.addEventListener('scroll', () => p.classList.toggle('scrolled', p.scrollTop > 36), { passive: true }))
$('#sIc').innerHTML = ic('search', 17); $('#compose').innerHTML = ic('create-outline', 25); $('#newCall').innerHTML = ic('call-outline', 25); $('#addStatus').innerHTML = ic('camera-outline', 26)

/* ---------- estado do servidor e tempo real ---------- */
function applyState(s) {
  const was = S.st
  S.st = s.status; S.name = s.name || ''; S.me = s.me || ''; S.pairCode = s.pairCode
  const open = s.status === 'open'
  $('#app').hidden = !open; $('#login').hidden = open
  if (!open) renderLogin()
  else if (was !== 'open') loadAll()
}
let reloadT
const softReload = () => { clearTimeout(reloadT); reloadT = setTimeout(() => S.st === 'open' && loadChats(), 250) }
function connectWS() {
  const ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws')
  ws.onmessage = (ev) => {
    const { type, data } = JSON.parse(ev.data)
    if (type === 'state') applyState(data)
    else if (type === 'chats') softReload()
    else if (type === 'statuses') S.st === 'open' && loadStatuses()
    else if (type === 'message') onMessage(data)
    else if (type === 'mstatus') onMStatus(data)
    else if (type === 'call') onCall(data)
    else if (type === 'presence') onPresence(data)
  }
  ws.onclose = () => setTimeout(connectWS, 2000)
}

/* ---------- navegação nativa (botão voltar do Android / toque na notificação) ---------- */
window.zappBack = () => {
  if ($('#ctx').classList.contains('on')) return closeCtx(), true
  if ($('#alert').classList.contains('on')) return closeAlert(), true
  if ($('#sheet').classList.contains('on')) return closeSheet(), true
  if ($('#pv').classList.contains('on')) return $('#pvX').click(), true
  if ($('#sv').classList.contains('on')) return closeStatus(), true
  if ($('#full').classList.contains('on')) return closeFull(), true
  if (closeScreen()) return true
  if (!$('#panel').hidden) return closePanel(), true
  if (selMode) return exitSel(), true
  if ($('#app').classList.contains('pushed')) return $('#back').click(), true
  if (S.tab !== 'chats') return setTab('chats'), true
  return false
}
window.zappOpen = async (jid) => {
  let c = S.chats.find((x) => x.id === jid)
  if (!c) { await loadChats(); c = S.chats.find((x) => x.id === jid) }
  if (c) { while (closeScreen()); setTab('chats'); openChat(c) }
}

function boot() {
  applyLook()
  buildTabbar(); connectWS()
  fetch('/api/state').then((r) => r.json()).then(applyState).catch(() => {})
  document.addEventListener('contextmenu', (e) => e.preventDefault())
}
