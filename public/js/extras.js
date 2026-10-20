/* ============================== gestos, menu de contexto, seleção, painéis, dados do contato ============================== */
let selMode = false; const sel = new Set()
const copyText = async (t) => { try { await navigator.clipboard.writeText(t) } catch { const a = h('textarea', { style: 'position:fixed;opacity:0' }); a.value = t; document.body.append(a); a.select(); document.execCommand('copy'); a.remove() } toast('Copiado') }
const shareText = (t) => { try { if (NA()?.share) return NA().share(t) } catch {} navigator.share ? navigator.share({ text: t }).catch(() => {}) : copyText(t) }
const msgById = (id) => S.msgs.find((x) => x.id === id)
const isReal = (m) => m && !m.pending && !String(m.id).startsWith('tmp-')

/* ---------- responder / editar ---------- */
function setReply(m) {
  if (!isReal(m) || m.deleted) return
  S.editing = null; S.reply = { id: m.id, sender: m.fromMe ? 'Você' : m.sender || S.cur.name, text: m.text || mediaText(m) }
  updateReplyBar(); $('#txt').focus()
}
function startEdit(m) { S.reply = null; S.editing = { id: m.id }; $('#txt').value = m.text; syncComposer(); updateReplyBar(); $('#txt').focus() }
function updateReplyBar() {
  const bar = $('#replyBar'), r = S.reply, e = S.editing
  bar.hidden = !(r || e)
  if (r) $('#replyQ').replaceChildren(h('b', {}, r.sender), r.text)
  if (e) $('#replyQ').replaceChildren(h('b', {}, 'Editando mensagem'), 'Faça a alteração e toque em enviar')
}
$('#replyX').onclick = () => { if (S.editing) { $('#txt').value = ''; syncComposer() } S.reply = null; S.editing = null; updateReplyBar() }

/* ---------- gestos: deslizar p/ responder, segurar p/ menu ---------- */
let g = null
const msgsEl = $('#msgs')
msgsEl.addEventListener('pointerdown', (e) => {
  const row = e.target.closest('.mrow'); if (!row || e.target.closest('.play,.wave,.dlb,video,a,.act')) return
  const m = msgById(row.dataset.id); if (!m) return
  g = { row, m, x0: e.clientX, y0: e.clientY, mode: null, done: false }
  g.t = setTimeout(() => { if (!g || g.mode) return; const gg = g; g = null; haptic(18); selMode ? toggleSel(gg.m.id) : openCtx(gg.row, gg.m) }, 420)
})
msgsEl.addEventListener('pointermove', (e) => {
  if (!g) return
  const dx = e.clientX - g.x0, dy = e.clientY - g.y0
  if (!g.mode && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) { clearTimeout(g.t); g.mode = Math.abs(dx) > Math.abs(dy) * 1.2 && dx > 0 && !selMode ? 'swipe' : 'scroll' }
  if (g.mode === 'swipe') {
    const d = Math.min(84, dx * .7), b = g.row.querySelector('.msg'), r = g.row.querySelector('.rpl'), p = Math.min(1, d / 52)
    b.style.transition = 'none'; b.style.transform = `translateX(${d}px)`; r.style.opacity = p; r.style.transform = `scale(${.4 + .6 * p})`
    if (d >= 52 && !g.hit) { g.hit = true; haptic(12) } g.d = d
  }
})
const endG = (cancel) => {
  if (!g) return; clearTimeout(g.t); const gg = g; g = null
  if (gg.mode === 'swipe') { const b = gg.row.querySelector('.msg'); b.style.transition = 'transform .28s var(--ease)'; b.style.transform = ''; gg.row.querySelector('.rpl').style.opacity = 0; if (!cancel && gg.d >= 52) setReply(gg.m) }
  else if (!gg.mode && !cancel && selMode) toggleSel(gg.m.id)
}
msgsEl.addEventListener('pointerup', () => endG(false)); msgsEl.addEventListener('pointercancel', () => endG(true))

/* ---------- menu de contexto estilo iOS (blur + reações) ---------- */
const QUICK = ['👍', '❤️', '😂', '😮', '😢', '🙏']
function closeCtx() { const c = $('#ctx'); c.classList.remove('on'); setTimeout(() => c.replaceChildren(), 240) }
$('#ctx').addEventListener('pointerdown', (e) => { if (e.target === $('#ctx')) closeCtx() })
function openCtx(row, m) {
  const ctx = $('#ctx'), P = $('#phone').getBoundingClientRect(), r = row.querySelector('.msg').getBoundingClientRect()
  const real = isReal(m), canText = !!m.text && !m.deleted
  const clone = bubble(m); clone.style.margin = '0'; clone.style.maxWidth = 'none'
  const cb = h('div', { class: 'cb' }, h('div', { class: 'mrow ' + (m.fromMe ? 'me' : 'in'), style: 'margin:0' }, clone))
  const items = []
  const act = (label, icon, fn, red) => items.push(h('button', { class: red ? 'red' : '', onclick: () => { closeCtx(); setTimeout(fn, 80) } }, label, h('span', { html: ic(icon, 21) })))
  if (real && !m.deleted) act('Responder', 'arrow-undo-outline', () => setReply(m))
  if (real && !m.deleted) act('Encaminhar', 'arrow-redo-outline', () => forwardMsgs([m]))
  if (canText) act('Copiar', 'copy-outline', () => copyText(m.text))
  if (real && !m.deleted) act(m.starred ? 'Remover favorita' : 'Favoritar', m.starred ? 'star' : 'star-outline', () => starMsgs([m], !m.starred))
  if (canText) act('Traduzir', 'language-outline', () => translateMsg(m))
  if (canText) act('Compartilhar', 'share-outline', () => shareText(m.text))
  if (real && m.fromMe && m.type === 'text' && !m.deleted && Date.now() / 1000 - m.ts < 900) act('Editar', 'create-outline', () => startEdit(m))
  act('Selecionar…', 'checkmark-circle', () => enterSel(m.id))
  if (!m.deleted || real) act('Apagar', 'trash-outline', () => deleteMsgs([m]), true)
  const menu = h('div', { class: 'menuc' }, items)
  const bar = real && !m.deleted ? h('div', { class: 'rxbar' }, QUICK.map((e) => h('button', { onclick: async () => { closeCtx(); try { await post('/api/react', { jid: S.cur.id, id: m.id, emoji: e }) } catch (er) { toast(er.message) } } }, e)),
    h('button', { style: 'font-size:22px;color:var(--sub)', onclick: () => { closeCtx(); pickEmoji(async (e) => { try { await post('/api/react', { jid: S.cur.id, id: m.id, emoji: e }) } catch (er) { toast(er.message) } }) }, html: ic('add', 24) })) : null
  ctx.replaceChildren(cb, ...(bar ? [bar] : []), menu); ctx.classList.add('on')
  const W = P.width, H = P.height, top0 = r.top - P.top, bh = Math.min(r.height, H * .36), mh = menu.offsetHeight, barh = bar ? 54 : 0, gap = 10, safe = 12
  let top = Math.max(top0, safe + barh + gap)
  if (top + bh + gap + mh > H - safe) top = Math.max(safe + barh + gap, H - safe - mh - gap - bh)
  cb.style.cssText = `left:${r.left - P.left}px;top:${top}px;width:${r.width}px;max-height:${bh}px;overflow:${r.height > bh ? 'hidden' : 'visible'};border-radius:14px`
  if (bar) bar.style.cssText = `top:${top - barh - 6}px;${m.fromMe ? `right:${safe}px` : `left:${safe}px`}`
  menu.style.cssText = `top:${top + bh + gap}px;${m.fromMe ? `right:${safe}px` : `left:${Math.min(r.left - P.left, W - 244 - safe)}px`}`
  cb.style.transform = 'scale(.96)'; requestAnimationFrame(() => (cb.style.transform = 'scale(1)'))
}
async function translateMsg(m) {
  toast('Traduzindo…')
  try { const r = await post('/api/translate', { text: m.text }); if (!r.text) return toast('Sem tradução disponível'); m.translation = r.text; const i = S.msgs.indexOf(m); rowFor(m.id)?.replaceWith(msgRow(m, i)) } catch (e) { toast(e.message) }
}
async function starMsgs(ms, on) { try { await post('/api/star', { jid: S.cur.id, ids: ms.map((m) => m.id), on }); ms.forEach((m) => (m.starred = on)); toast(on ? 'Mensagem favoritada' : 'Removida das favoritas') } catch (e) { toast(e.message) } }
async function forwardMsgs(ms) {
  const to = await pickContacts({ title: 'Encaminhar para', source: 'chats', okLabel: 'Enviar' }); if (!to.length) return
  try { await post('/api/forward', { items: ms.map((m) => ({ jid: S.cur.id, id: m.id })), to: to.map((t) => t.id) }); toast('Encaminhada'); exitSel() } catch (e) { toast(e.message) }
}
function deleteMsgs(ms) {
  const real = ms.filter(isReal), mine = real.length && real.every((m) => m.fromMe && !m.deleted && Date.now() / 1000 - m.ts < 172800)
  const run = async (mode) => {
    ms.filter((m) => !isReal(m)).forEach(cancelPending)
    if (real.length) try { await post('/api/delete', { jid: S.cur.id, ids: real.map((m) => m.id), mode }) } catch (e) { return toast(e.message) }
    if (mode === 'me') { real.forEach((m) => { const i = S.msgs.indexOf(m); if (i >= 0) S.msgs.splice(i, 1); rowFor(m.id)?.remove() }) }
    exitSel(); loadChats()
  }
  sheet([h('div', { class: 'grp' }, sheetInfo(ms.length > 1 ? `Apagar ${ms.length} mensagens?` : 'Apagar mensagem?'),
    mine ? h('button', { class: 'opt red', onclick: () => { closeSheet(); run('all') } }, h('span', { class: 'lbl', style: 'color:var(--red);text-align:center' }, 'Apagar para todos')) : null,
    h('button', { class: 'opt red', onclick: () => { closeSheet(); run('me') } }, h('span', { class: 'lbl', style: 'color:var(--red);text-align:center' }, 'Apagar para mim'))), cancelOpt()])
}

/* ---------- seleção múltipla ---------- */
function enterSel(id) {
  selMode = true; sel.clear(); sel.add(id); closePanel()
  $('#msgs').classList.add('selmode'); $('#selNav').hidden = false; $('#comp').hidden = true; $('#selBar').hidden = false; refreshSel()
}
function toggleSel(id) { sel.has(id) ? sel.delete(id) : sel.add(id); sel.size ? refreshSel() : exitSel() }
function exitSel(silent) {
  if (!selMode && silent) return
  selMode = false; sel.clear(); $('#msgs').classList.remove('selmode'); $('#selNav').hidden = true; $('#comp').hidden = false; $('#selBar').hidden = true
  document.querySelectorAll('.mrow.sel').forEach((r) => { r.classList.remove('sel'); r.querySelector('.chk').innerHTML = '' })
}
function refreshSel() {
  $('#selCount').textContent = sel.size === 1 ? '1 selecionada' : sel.size + ' selecionadas'
  document.querySelectorAll('#msgs .mrow').forEach((r) => { const on = sel.has(r.dataset.id); r.classList.toggle('sel', on); r.querySelector('.chk').innerHTML = on ? ic('checkmark', 15) : '' })
  const ms = [...sel].map(msgById).filter(Boolean), texts = ms.filter((m) => m.text).map((m) => m.text), allStar = ms.length && ms.every((m) => m.starred)
  const b = (label, icon, fn, cls, dis) => h('button', { class: cls || '', disabled: dis, onclick: fn, html: ic(icon, 25) + `<span>${label}</span>` })
  $('#selBar').replaceChildren(b(allStar ? 'Desfavoritar' : 'Favoritar', allStar ? 'star' : 'star-outline', () => { starMsgs(ms, !allStar).then(exitSel) }, '', !ms.every(isReal)),
    b('Copiar', 'copy-outline', () => { copyText(texts.join('\n')); exitSel() }, '', !texts.length), b('Encaminhar', 'arrow-redo-outline', () => forwardMsgs(ms), '', !ms.every(isReal)), b('Apagar', 'trash-outline', () => deleteMsgs(ms), 'del'))
}
$('#selCancel').onclick = () => exitSel()

/* ---------- pesquisar na conversa ---------- */
let findHits = [], findI = 0
function findInChat() {
  $('#findBar').hidden = false; const inp = $('#findIn'); inp.value = ''; inp.focus()
  inp.oninput = () => { const q = inp.value.trim().toLowerCase(); findHits = q ? S.msgs.filter((m) => (m.text || '').toLowerCase().includes(q)).map((m) => m.id) : []; findI = findHits.length - 1; if (findHits.length) jumpTo(findHits[findI]) }
  inp.onkeydown = (e) => { if (e.key === 'Enter' && findHits.length) { findI = (findI - 1 + findHits.length) % findHits.length; jumpTo(findHits[findI]) } }
}
$('#findX').onclick = () => { $('#findBar').hidden = true }

/* ============================== painel: emoji, GIF e figurinhas ============================== */
const EMO = {
  '😀': ['Rostos', '😀 😃 😄 😁 😆 😅 😂 🤣 🥲 ☺️ 😊 😇 🙂 🙃 😉 😌 😍 🥰 😘 😗 😙 😚 😋 😛 😝 😜 🤪 🤨 🧐 🤓 😎 🥸 🤩 🥳 😏 😒 😞 😔 😟 😕 🙁 ☹️ 😣 😖 😫 😩 🥺 😢 😭 😤 😠 😡 🤬 🤯 😳 🥵 🥶 😱 😨 😰 😥 😓 🤗 🤔 🫣 🤭 🫢 🤫 🫠 🤥 😶 😐 😑 😬 🙄 😯 😦 😧 😮 😲 🥱 😴 🤤 😪 😵 🤐 🥴 🤢 🤮 🤧 😷 🤒 🤕 🤑 🤠 😈 👿 👹 👺 🤡 💩 👻 💀 ☠️ 👽 👾 🤖 🎃'],
  '👋': ['Pessoas', '👋 🤚 🖐️ ✋ 🖖 👌 🤌 🤏 ✌️ 🤞 🤟 🤘 🤙 👈 👉 👆 🖕 👇 ☝️ 👍 👎 ✊ 👊 🤛 🤜 👏 🙌 👐 🤲 🤝 🙏 ✍️ 💅 🤳 💪 🦾 🧠 👀 👁️ 👅 👄 💋 👶 🧒 👦 👧 🧑 👨 👩 🧓 👴 👵 🙍 🙎 🙅 🙆 💁 🙋 🙇 🤦 🤷 💃 🕺 👯 🧘'],
  '🐶': ['Animais e natureza', '🐶 🐱 🐭 🐹 🐰 🦊 🐻 🐼 🐨 🐯 🦁 🐮 🐷 🐸 🐵 🙈 🙉 🙊 🐔 🐧 🐦 🐤 🦆 🦅 🦉 🦇 🐺 🐗 🐴 🦄 🐝 🐛 🦋 🐌 🐞 🐜 🐢 🐍 🦎 🐙 🦑 🦐 🦀 🐠 🐟 🐬 🐳 🦈 🐊 🐘 🦒 🦓 🐪 🌵 🎄 🌲 🌳 🌴 🌱 🌿 🍀 🍁 🍂 🌺 🌻 🌹 🌷 🌸 🌼 🌞 🌝 🌙 ⭐ ☀️ ⛅ ☁️ 🌈 ❄️ ⛄ 🌊'],
  '🍕': ['Comidas e bebidas', '🍏 🍎 🍐 🍊 🍋 🍌 🍉 🍇 🍓 🫐 🍒 🍑 🥭 🍍 🥥 🥝 🍅 🥑 🍆 🥕 🌽 🌶️ 🥔 🍞 🥐 🧀 🍳 🥞 🥓 🍔 🍟 🍕 🌭 🥪 🌮 🌯 🥗 🍝 🍜 🍲 🍛 🍣 🍱 🍤 🍙 🍚 🍦 🍧 🍨 🍩 🍪 🎂 🍰 🧁 🍫 🍬 🍭 🍮 ☕ 🍵 🥛 🍺 🍻 🥂 🍷 🥃 🍸 🍹 🍾'],
  '⚽': ['Atividades', '⚽ 🏀 🏈 ⚾ 🎾 🏐 🏉 🎱 🏓 🏸 🥊 🥋 ⛳ 🎣 🛹 🏂 🏄 🏊 🚴 🏆 🥇 🥈 🥉 🏅 🎖️ 🎫 🎭 🎨 🎬 🎤 🎧 🎼 🎹 🥁 🎷 🎺 🎸 🎻 🎲 🎯 🎳 🎮 🎰 🧩'],
  '🚗': ['Viagens e lugares', '🚗 🚕 🚙 🚌 🏎️ 🚓 🚑 🚒 🚚 🚜 🏍️ 🚲 🛵 🚨 🚂 ✈️ 🛫 🛬 🚀 🛸 🚁 ⛵ 🚤 🛳️ ⚓ 🏠 🏡 🏢 🏥 🏦 🏨 🏫 ⛪ 🕌 🗼 🗽 🗻 🏖️ 🏝️ 🏕️ ⛺ 🌋 🗺️ 🧭 ⏰ 🌃 🌆 🎡 🎢'],
  '💡': ['Objetos', '⌚ 📱 💻 ⌨️ 🖥️ 🖨️ 💾 💿 📷 📹 🎥 📞 ☎️ 📺 📻 🔋 🔌 💡 🔦 🕯️ 💸 💵 💳 💎 ⚖️ 🔧 🔨 ⚙️ 💣 🔪 🛡️ 🔮 💊 💉 🧬 🔬 🔭 🧹 🛒 🚪 🛏️ 🛋️ 🚽 🚿 🛁 🔑 🎁 🎈 🎉 🎊 ✉️ 📦 📝 📅 📌 📎 ✂️ 📚 🔒 🔓'],
  '❤️': ['Símbolos', '❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 💟 ☮️ ✝️ ☪️ ☯️ 🔥 ✨ 🌟 💫 ⚡ 💥 💢 💦 💤 💯 ✅ ❌ ❓ ❗ ‼️ ⚠️ 🔔 🔕 ➕ ➖ ➗ ✖️ ♾️ 💲 ©️ ®️ ™️ 🔴 🟠 🟡 🟢 🔵 🟣 ⚫ ⚪ 🔶 🔷'],
  '🏁': ['Bandeiras', '🇧🇷 🇵🇹 🇺🇸 🇦🇷 🇨🇱 🇨🇴 🇲🇽 🇪🇸 🇫🇷 🇮🇹 🇩🇪 🇬🇧 🇯🇵 🇨🇳 🇰🇷 🇮🇳 🇷🇺 🇨🇦 🇦🇺 🏳️ 🏴 🏁 🚩 🏳️‍🌈'],
}
const emojiList = (k) => EMO[k][1].split(' ')
const pushRecent = (e) => setPref('recent', [e, ...pref('recent', []).filter((x) => x !== e)].slice(0, 24))
function emojiPicker(onPick) {
  const wrap = h('div'), cap = h('div', { class: 'ecap' }), grid = h('div', { class: 'egrid' }), cats = h('div', { class: 'ecats' })
  const show = (k) => {
    const list = k === 'rec' ? pref('recent', []) : emojiList(k); cap.textContent = k === 'rec' ? 'Usados recentemente' : EMO[k][0]
    grid.replaceChildren(...list.map((e) => h('button', { onclick: () => { pushRecent(e); onPick(e) } }, e)))
    cats.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.k === k))
  }
  cats.append(h('button', { 'data-k': 'rec', html: ic('time-outline', 20), onclick: () => show('rec') }), ...Object.keys(EMO).map((k) => h('button', { 'data-k': k, onclick: () => show(k) }, k)))
  wrap.append(cap, grid); show(pref('recent', []).length ? 'rec' : '😀')
  return { cats, wrap }
}
function pickEmoji(cb) {
  const { cats, wrap } = emojiPicker((e) => { closeSheet(); cb(e) })
  sheet([h('div', { class: 'grp', style: 'height:56vh;display:flex;flex-direction:column;background:var(--bg)' }, cats, h('div', { style: 'flex:1;overflow-y:auto;padding:0 8px' }, wrap)), cancelOpt()])
}
let panelTab = 'emoji'
function openPanel(tab) {
  panelTab = tab || panelTab; const p = $('#panel'); p.hidden = false; $('#phone').classList.add('panelopen'); $('#txt').blur(); $('#stkIc').classList.add('on')
  const body = h('div', { class: 'pbody' }), tabs = h('div', { class: 'ptabs' })
  const t = (k, label) => h('button', { class: panelTab === k ? 'on' : '', onclick: () => openPanel(k) }, label)
  tabs.append(t('emoji', h('span', { html: ic('happy-outline', 24) })), t('gif', h('b', { style: 'font-size:15px' }, 'GIF')), t('sticker', h('span', { html: ic('albums-outline', 24) })))
  if (panelTab === 'emoji') tabs.append(h('button', { html: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M9 5h11a1 1 0 011 1v12a1 1 0 01-1 1H9l-6-7 6-7z"/><path d="M13 9.5l5 5m0-5l-5 5" stroke-linecap="round"/></svg>', onclick: () => { const t = $('#txt'), v = Array.from(t.value); v.pop(); t.value = v.join(''); syncComposer() } }))
  p.replaceChildren(body, tabs)
  if (panelTab === 'emoji') {
    const { cats, wrap } = emojiPicker((e) => { const t = $('#txt'), a = t.selectionStart ?? t.value.length, b = t.selectionEnd ?? a; t.value = t.value.slice(0, a) + e + t.value.slice(b); t.selectionStart = t.selectionEnd = a + e.length; syncComposer() })
    body.append(cats, wrap)
  } else if (panelTab === 'gif') gifTab(body)
  else stickerTab(body)
  setTimeout(() => nearBottom() || scrollDown(), 50)
}
function closePanel() { $('#panel').hidden = true; $('#phone').classList.remove('panelopen'); $('#stkIc').classList.remove('on') }
$('#stkIc').onclick = () => ($('#panel').hidden ? openPanel() : (closePanel(), $('#txt').focus()))
async function gifTab(body) {
  const inp = h('input', { placeholder: 'Pesquisar GIFs', style: 'width:100%;font-size:16px;color:var(--txt)' }), grid = h('div', { class: 'ggrid' })
  const load = async (q = '') => {
    grid.replaceChildren(h('div', { class: 'pmsg' }, 'Carregando…'))
    try {
      const r = await api('/api/gifs?q=' + enc(q))
      if (r.needKey) return grid.replaceChildren(gifSetup(() => gifTab(body.replaceChildren() || body)))
      grid.replaceChildren(...(r.items.length ? r.items.map((it) => h('img', { src: it.preview, loading: 'lazy', onclick: async () => { closePanel(); try { await post('/api/send-gif', { jid: S.cur.id, url: it.mp4 }) } catch (e) { toast(e.message) } } })) : [h('div', { class: 'pmsg' }, 'Nenhum GIF encontrado')]))
    } catch (e) { grid.replaceChildren(h('div', { class: 'pmsg' }, 'Não foi possível carregar os GIFs. ' + e.message)) }
  }
  let t; inp.oninput = () => { clearTimeout(t); t = setTimeout(() => load(inp.value), 450) }
  body.replaceChildren(h('label', { class: 'search', style: 'margin:6px 4px' }, h('span', { class: 'ic', html: ic('search', 16) }), inp), grid); load()
}
function gifSetup(done) {
  let prov = 'giphy'; const key = h('input', { placeholder: 'Cole sua chave de API' })
  const pb = h('div', { class: 'seg', style: 'margin:10px 0' }, h('button', { class: 'on', onclick: (e) => { prov = 'giphy'; pb.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === e.target)) } }, 'GIPHY'), h('button', { onclick: (e) => { prov = 'tenor'; pb.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === e.target)) } }, 'Tenor'))
  return h('div', { class: 'pmsg' }, h('b', { style: 'color:var(--txt);font-size:17px' }, 'Ative a busca de GIFs'), h('div', { style: 'margin-top:6px' }, 'Os GIFs vêm de um serviço gratuito. Crie uma chave em developers.giphy.com (ou no Tenor) e cole aqui uma única vez.'), pb, key,
    h('button', { class: 'pbtn', style: 'margin-top:6px;padding:11px', onclick: async () => { if (!key.value.trim()) return; await post('/api/config', { gifKey: key.value.trim(), gifProvider: prov }); toast('Chave salva'); done() } }, 'Salvar'))
}
async function stickerTab(body) {
  let list = []; try { list = await api('/api/stickers') } catch {}
  const grid = h('div', { class: 'sgrid' }, h('button', { class: 'new', html: ic('add', 34), onclick: () => $('#fSticker').click() }),
    ...list.map((s) => h('img', { src: '/api/sticker/' + enc(s.id), loading: 'lazy', onclick: async () => { try { await post('/api/send-sticker-ref', { jid: S.cur.id, id: s.id }) } catch (e) { toast(e.message) } } })))
  body.replaceChildren(h('div', { class: 'ecap' }, 'Suas figurinhas'), grid, list.length ? null : h('div', { class: 'pmsg' }, 'As figurinhas que você recebe aparecem aqui. Toque em + para criar uma a partir de uma foto.'))
}
$('#fSticker').onchange = async (e) => {
  const f = e.target.files[0]; e.target.value = ''; if (!f || !S.cur) return
  try {
    const url = URL.createObjectURL(f), img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url })
    const c = document.createElement('canvas'); c.width = c.height = 512; const x = c.getContext('2d'), k = Math.min(512 / img.width, 512 / img.height)
    x.drawImage(img, (512 - img.width * k) / 2, (512 - img.height * k) / 2, img.width * k, img.height * k)
    const blob = await new Promise((res) => c.toBlob(res, 'image/webp', 0.9)); URL.revokeObjectURL(url)
    if (!blob || blob.type !== 'image/webp') return toast('Este navegador não gera figurinhas (WebP)')
    const m = addPending({ type: 'sticker', localUrl: URL.createObjectURL(blob) }), job = {}; pendingJobs.set(m.tmp, job)
    try { const r = await xhrSend('/api/send-sticker?jid=' + enc(S.cur.id), blob, { 'Content-Type': 'image/webp' }, job); settle(m, r.id) } catch (er) { failMsg(m, er) }
  } catch { toast('Não foi possível criar a figurinha') }
}

/* ============================== anexos ============================== */
$('#plus').onclick = () => { closePanel(); sheet([h('div', { class: 'grp' },
  opt('Fotos e vídeos', 'image-outline', () => $('#fMedia').click(), { bg: '#007AFF' }), opt('Câmera', 'camera-outline', () => $('#fCam').click(), { bg: '#5E5CE6' }),
  opt('Documento', 'document-text-outline', () => $('#fDoc').click(), { bg: '#8E8E93' }), opt('Localização', 'location-outline', sendLocation, { bg: '#34C759' }),
  opt('Contato', 'person-outline', sendContact, { bg: '#FF9500' }), opt('Enquete', 'bar-chart-outline', pollForm, { bg: '#FF9F0A' }), opt('Figurinha', 'happy-outline', () => openPanel('sticker'), { bg: '#FF2D55' })), cancelOpt()]) }
function sendLocation() {
  if (!navigator.geolocation) return toast('Localização indisponível')
  toast('Obtendo localização…'); const jid = S.cur.id
  navigator.geolocation.getCurrentPosition(async (p) => { try { await post('/api/send-location', { jid, lat: p.coords.latitude, lng: p.coords.longitude, name: '' }) } catch (e) { toast(e.message) } }, () => toast('Permita o acesso à localização'), { enableHighAccuracy: true, timeout: 15000 })
}
async function sendContact() { const [p] = await pickContacts({ title: 'Enviar contato', multi: false }); if (p) try { await post('/api/send-contact', { jid: S.cur.id, contactJid: p.id }) } catch (e) { toast(e.message) } }
function pollForm() {
  const q = h('input', { placeholder: 'Pergunta' }), opts = [h('input', { placeholder: 'Opção 1' }), h('input', { placeholder: 'Opção 2' })], box = h('div', {}, opts); let multi = false
  const sw = h('span', { class: 'sw', onclick: () => { multi = !multi; sw.classList.toggle('on', multi) } })
  sheet([h('div', { class: 'grp' }, sheetInfo('Nova enquete'), h('div', { class: 'form' }, q, box,
    h('button', { class: 'tintbtn', style: 'padding:6px 0', onclick: () => { if (opts.length < 12) { const i = h('input', { placeholder: 'Opção ' + (opts.length + 1) }); opts.push(i); box.append(i) } } }, '+ Adicionar opção'),
    h('div', { style: 'display:flex;align-items:center;justify-content:space-between;padding:8px 0' }, 'Permitir várias respostas', sw)),
    h('button', { class: 'opt', style: 'justify-content:center;font-weight:600', onclick: async () => { try { await post('/api/send-poll', { jid: S.cur.id, name: q.value.trim(), options: opts.map((o) => o.value.trim()).filter(Boolean), multi }); closeSheet() } catch (e) { toast(e.message) } } }, 'Enviar')), cancelOpt()])
}

/* ============================== dados do contato / grupo ============================== */
async function openInfo(c) {
  const { body } = openScreen(c.isGroup ? 'Dados do grupo' : 'Dados do contato', () => {}, { backLabel: 'Conversa' })
  body.replaceChildren(h('div', { class: 'empty' }, 'Carregando…'))
  let info; try { info = await api('/api/info/' + enc(c.id)) } catch (e) { return body.replaceChildren(h('div', { class: 'empty' }, e.message)) }
  const refresh = async () => { closeScreen(); setTimeout(() => openInfo(c), 450) }
  const act = (type, value, then) => async () => { try { await post(`/api/chats/${enc(c.id)}/action`, { type, value }); await loadChats(); then ? then() : refresh() } catch (e) { toast(e.message) } }
  const row = (label, icon, bg, val, fn, red) => h('div', { class: 'gr ico-l' + (red ? ' red' : ''), onclick: fn }, icon ? h('span', { class: 'ico', style: 'background:' + bg, html: ic(icon, 18) }) : null, h('span', {}, label), val != null ? h('span', { class: 'gv' }, val, h('span', { html: ic('chevron-forward', 16) })) : null)
  const dis = { 0: 'Desativadas', 86400: '24 horas', 604800: '7 dias', 7776000: '90 dias' }
  const kids = [
    h('div', { class: 'hero' }, h('div', { onclick: () => openLightbox('/api/avatar/' + enc(c.id) + '?full=1') }, avatar(c.id, 124, c.isGroup, false)), h('h2', {}, info.name), h('p', {}, c.isGroup ? `Grupo · ${(info.participants || []).length} participantes` : info.number || '')),
    h('div', { class: 'acts3' },
      h('button', { html: ic('call-outline', 24) + '<span>Áudio</span>', onclick: () => dialSheet(false) }), h('button', { html: ic('videocam-outline', 24) + '<span>Vídeo</span>', onclick: () => dialSheet(true) }), h('button', { html: ic('search-outline', 24) + '<span>Buscar</span>', onclick: () => { closeScreen(); setTimeout(findInChat, 300) } })),
    info.about ? h('div', {}, h('div', { class: 'ghead' }, 'Recado'), h('div', { class: 'gbox' }, h('div', { class: 'gr col' }, h('div', {}, info.about), info.aboutAt ? h('div', { style: 'color:var(--sub);font-size:13px' }, new Date(info.aboutAt * 1000).toLocaleDateString('pt-BR')) : null))) : null,
    info.desc ? h('div', {}, h('div', { class: 'ghead' }, 'Descrição'), h('div', { class: 'gbox' }, h('div', { class: 'gr col' }, h('div', { style: 'white-space:pre-wrap' }, info.desc)))) : null,
    info.business ? h('div', {}, h('div', { class: 'ghead' }, 'Empresa'), h('div', { class: 'gbox' }, h('div', { class: 'gr col' }, info.business.category ? h('div', { style: 'color:var(--sub)' }, info.business.category) : null, h('div', {}, info.business.description || ''), info.business.website ? h('a', { href: info.business.website, target: '_blank', style: 'color:var(--tint)' }, info.business.website) : null))) : null,
    h('div', { class: 'gbox' }, row('Mídia, links e documentos', 'images-outline', '#007AFF', info.counts.media + info.counts.docs + info.counts.links, () => openGallery(c)), row('Mensagens favoritas', 'star', '#FFCC00', info.counts.starred || 'Nenhuma', () => openStarredChat(c))),
    h('div', { class: 'gbox' }, row('Silenciar', info.muted ? 'notifications-off-outline' : 'notifications-outline', '#FF3B30', info.muted ? 'Sim' : 'Não', () => (info.muted ? act('unmute')() : muteChoice(c, refresh))),
      row('Mensagens temporárias', 'timer-outline', '#007AFF', dis[info.ephemeral] || 'Desativadas', () => choose('Mensagens temporárias', Object.entries(dis).map(([v, l]) => [l, v]), (v) => act('disappear', Number(v))(), info.ephemeral)),
      row('Papel de parede', 'color-palette-outline', '#5AC8FA', null, wallpaperPicker), row(info.pinned ? 'Desafixar conversa' : 'Fixar conversa', 'pin-outline', '#FF9500', null, act(info.pinned ? 'unpin' : 'pin')), row(info.archived ? 'Desarquivar' : 'Arquivar', 'archive-outline', '#5E5CE6', null, act(info.archived ? 'unarchive' : 'archive', null, () => { closeScreen(); $('#back').click() }))),
  ]
  if (c.isGroup && info.participants) kids.push(h('div', {}, h('div', { class: 'ghead' }, `${info.participants.length} participantes`), h('div', { class: 'gbox' }, info.participants.map((p) => h('div', { class: 'gr', style: 'min-height:58px', onclick: () => { if (p.id !== S.me) { closeScreen(); startChat({ id: p.id, name: p.name, number: p.number }) } } }, avatar(p.id, 38), h('div', { style: 'flex:1;min-width:0' }, h('div', { style: 'font-weight:500' }, p.name), h('div', { style: 'color:var(--sub);font-size:13px' }, p.number)), p.admin ? h('span', { style: 'color:var(--ink);font-size:12px;border:1px solid var(--ink);border-radius:5px;padding:1px 6px' }, 'admin') : null)))))
  kids.push(h('div', { class: 'gbox' },
    h('div', { class: 'gr', onclick: () => { const a = h('a', { href: `/api/chats/${enc(c.id)}/export`, download: '' }); document.body.append(a); a.click(); a.remove() } }, h('span', { style: 'color:var(--tint)' }, 'Exportar conversa')),
    h('div', { class: 'gr red', onclick: async () => { if (await confirmDlg({ title: 'Limpar conversa?', msg: 'Todas as mensagens serão apagadas deste aparelho e do celular. Isso não pode ser desfeito.', ok: 'Limpar', danger: true })) { await act('clear', null, () => { S.msgs = []; renderMsgs(); closeScreen() })() } } }, 'Limpar conversa'),
    !c.isGroup ? h('div', { class: 'gr red', onclick: async () => { const b = info.blocked; if (await confirmDlg({ title: (b ? 'Desbloquear ' : 'Bloquear ') + info.name + '?', msg: b ? 'Este contato poderá enviar mensagens e ligar para você.' : 'Você não receberá mais mensagens nem chamadas deste contato.', ok: b ? 'Desbloquear' : 'Bloquear', danger: !b })) await act(b ? 'unblock' : 'block')() } }, info.blocked ? 'Desbloquear contato' : 'Bloquear contato') : null,
    h('div', { class: 'gr red', onclick: async () => { if (await confirmDlg({ title: 'Apagar conversa?', msg: 'A conversa será removida da sua lista.', ok: 'Apagar', danger: true })) await act('delete', null, () => { closeScreen(); $('#back').click() })() } }, 'Apagar conversa')))
  body.replaceChildren(...kids.filter(Boolean), h('div', { style: 'height:40px' }))
}
async function openStarredChat(c) {
  openScreen('Favoritas', async (body) => {
    const ms = (await api(`/api/chats/${enc(c.id)}/messages`)).filter((m) => m.starred)
    body.append(ms.length ? h('div', { class: 'gbox', style: 'margin-top:12px' }, ms.map((m) => h('div', { class: 'gr col', onclick: () => { while (closeScreen()); jumpTo(m.id) } }, h('div', { style: 'font-weight:600;font-size:14px' }, (m.fromMe ? 'Você' : m.sender || c.name) + ' · ' + listTime(m.ts)), h('div', { style: 'color:var(--sub)' }, m.text || mediaText(m))))) : h('div', { class: 'empty' }, 'Nenhuma mensagem favorita'))
  }, { backLabel: 'Dados' })
}
function openGallery(c) {
  openScreen('Mídia, links e documentos', async (body) => {
    const ms = await api(`/api/chats/${enc(c.id)}/messages`); let tab = 'm'
    const seg = h('div', { class: 'seg', style: 'margin:12px 16px' }, [['m', 'Mídia'], ['d', 'Docs'], ['l', 'Links']].map(([k, l]) => h('button', { class: k === tab ? 'on' : '', onclick: (e) => { tab = k; seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === e.target)); show() } }, l))), out = h('div')
    const show = () => {
      if (tab === 'm') { const list = ms.filter((m) => ['image', 'video'].includes(m.type) && !m.viewOnce).reverse(); out.replaceChildren(list.length ? h('div', { class: 'mgrid' }, list.map((m) => h('div', { style: m.thumb ? `background-image:url(data:image/jpeg;base64,${m.thumb})` : '', onclick: () => (m.type === 'image' ? openLightbox(mediaUrl(m)) : (openLightbox(''), $('#pvStage').replaceChildren(h('video', { src: mediaUrl(m), controls: true, autoplay: true })))) }, m.type === 'video' ? h('span', { html: ic('play', 18) }) : null))) : h('div', { class: 'empty' }, 'Nenhuma mídia')) }
      else if (tab === 'd') { const list = ms.filter((m) => m.type === 'document').reverse(); out.replaceChildren(list.length ? h('div', { class: 'gbox' }, list.map((m) => h('a', { class: 'gr', href: mediaUrl(m), download: m.fileName, style: 'color:inherit;text-decoration:none' }, h('span', { style: 'color:var(--tint)', html: ic('document-outline', 28) }), h('div', { style: 'min-width:0' }, h('div', { style: 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis' }, m.fileName || 'Documento'), h('div', { style: 'color:var(--sub);font-size:13px' }, fmtSize(m.size) + ' · ' + listTime(m.ts)))))) : h('div', { class: 'empty' }, 'Nenhum documento')) }
      else { const links = []; ms.forEach((m) => (m.text || '').match(URLRE)?.forEach((u) => links.push({ u, ts: m.ts }))); links.reverse(); out.replaceChildren(links.length ? h('div', { class: 'gbox' }, links.map((l) => h('a', { class: 'gr', href: l.u, target: '_blank', style: 'color:var(--tint);text-decoration:none;word-break:break-all;padding:10px 14px' }, l.u))) : h('div', { class: 'empty' }, 'Nenhum link')) }
    }
    body.append(seg, out); show()
  }, { backLabel: 'Dados' })
}
