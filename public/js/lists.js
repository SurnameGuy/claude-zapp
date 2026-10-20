/* ============================== listas: conversas, chamadas, atualizações ============================== */
$('#editBtn').className = 'ibtn'; $('#editBtn').style.marginLeft = '-6px'; $('#editBtn').innerHTML = ic('ellipsis-horizontal-circle-outline', 27)

async function loadAll() { await Promise.all([loadChats(), loadCalls(), loadStatuses()]); renderSettings() }
async function loadChats() {
  const [a, b] = await Promise.all([api('/api/chats'), api('/api/chats?archived=1').catch(() => [])])
  S.chats = Array.isArray(a) ? a : []; S.archived = Array.isArray(b) ? b : []; renderChats()
}
const FILTERS = [['all', 'Todas'], ['unread', 'Não lidas'], ['groups', 'Grupos']]
function previewNode(c) {
  const kids = []
  if (c.lastFromMe && c.preview) kids.push(h('span', { class: 'tk' + (c.lastStatus >= 4 ? ' rd' : ''), style: 'flex:none;display:flex', html: c.lastStatus <= 1 ? clockSvg : tickSvg(c.lastStatus >= 3) }))
  kids.push(h('span', {}, c.preview || ''))
  return h('div', { class: 'pv' }, kids)
}
function chatRow(c, onclick, o = {}) {
  const unread = c.unread || (c.markedUnread ? 1 : 0)
  let t, long = false
  const row = h('div', { class: 'row', onclick: () => { if (!long) onclick(c) }, onpointerdown: (e) => { long = false; t = setTimeout(() => { long = true; haptic(15); chatMenu(c) }, 480) }, onpointerup: () => clearTimeout(t), onpointerleave: () => clearTimeout(t), onpointermove: (e) => { if (Math.abs(e.movementX) + Math.abs(e.movementY) > 6) clearTimeout(t) } },
    h('div', { style: 'padding:10px 0' }, avatar(c.id, 52, c.isGroup)),
    h('div', { class: 'body' },
      h('div', { class: 'l1' }, h('div', { class: 'nm' }, c.name), h('div', { class: 'tm' + (unread && !c.muted ? ' g' : '') }, listTime(c.lastTs))),
      h('div', { class: 'l2' }, previewNode(c), h('div', { class: 'mini' },
        c.muted ? h('span', { html: ic('notifications-off-outline', 16) }) : null, c.pinned ? h('span', { html: ic('pin', 16) }) : null,
        unread ? h('div', { class: 'ub' + (c.muted ? ' mute' : '') }, unread > 99 ? '99+' : c.markedUnread && !c.unread ? '' : unread) : null))))
  return row
}
function renderChats() {
  const q = $('#q').value.trim().toLowerCase()
  let list = S.chats.filter((c) => !q || c.name.toLowerCase().includes(q) || c.number.includes(q))
  if (S.filter === 'unread') list = list.filter((c) => c.unread || c.markedUnread)
  if (S.filter === 'groups') list = list.filter((c) => c.isGroup)
  $('#chips').replaceChildren(...FILTERS.map(([k, l]) => h('button', { class: 'chip' + (S.filter === k ? ' on' : ''), onclick: () => { S.filter = k; renderChats() } }, l)))
  $('#archRow').replaceChildren(S.archived.length && !q && S.filter === 'all' ? h('div', { class: 'linkrow', style: 'color:var(--txt)', onclick: openArchived }, icn('archive-outline', 22), h('span', { style: 'flex:1' }, 'Arquivadas'), h('span', { style: 'color:var(--sub)' }, S.archived.length)) : '')
  const box = $('#chatList')
  if (!list.length) box.replaceChildren(h('div', { class: 'empty' }, h('b', {}, q ? 'Nenhum resultado' : S.filter !== 'all' ? 'Nada por aqui' : 'Sem conversas'), q ? 'Tente outro nome.' : 'Suas conversas aparecem aqui. Toque no ícone no topo para iniciar uma nova.'))
  else box.replaceChildren(...list.map((c) => chatRow(c, openChat)))
  buildTabbar()
}
$('#q').oninput = renderChats

function chatMenu(c) {
  const act = (type, value) => async () => { try { await post(`/api/chats/${enc(c.id)}/action`, { type, value }); await loadChats() } catch (e) { toast(e.message) } }
  sheet([h('div', { class: 'grp' }, sheetInfo(c.name),
    opt(c.pinned ? 'Desafixar' : 'Fixar conversa', 'pin-outline', act(c.pinned ? 'unpin' : 'pin'), { bg: '#FF9500' }),
    opt(c.muted ? 'Ativar som' : 'Silenciar', c.muted ? 'notifications-outline' : 'notifications-off-outline', c.muted ? act('unmute') : () => muteChoice(c), { bg: '#8E8E93' }),
    opt(c.unread || c.markedUnread ? 'Marcar como lida' : 'Marcar como não lida', 'mail-unread-outline', c.unread || c.markedUnread ? async () => { await post(`/api/chats/${enc(c.id)}/read`); loadChats() } : act('markunread'), { bg: '#007AFF' }),
    opt(c.archived ? 'Desarquivar' : 'Arquivar', 'archive-outline', act(c.archived ? 'unarchive' : 'archive'), { bg: '#5E5CE6' }),
    opt('Apagar conversa', 'trash-outline', () => deleteChat(c), { bg: '#FF3B30' })), cancelOpt()])
}
function muteChoice(c, after) {
  choose('Silenciar notificações', [['8 horas', 28800], ['1 semana', 604800], ['Sempre', -1]], async (v) => { try { await post(`/api/chats/${enc(c.id)}/action`, { type: 'mute', value: v }); await loadChats(); after?.() } catch (e) { toast(e.message) } })
}
async function deleteChat(c) {
  if (await confirmDlg({ title: 'Apagar conversa?', msg: `A conversa com ${c.name} será apagada deste aparelho e do seu celular.`, ok: 'Apagar', danger: true })) {
    await post(`/api/chats/${enc(c.id)}/action`, { type: 'delete' }).catch((e) => toast(e.message)); await loadChats()
  }
}
function openArchived() {
  openScreen('Arquivadas', (body) => { body.append(S.archived.length ? S.archived.map((c) => chatRow(c, (x) => { openChat(x) })) : h('div', { class: 'empty' }, 'Nenhuma conversa arquivada')) }, { backLabel: 'Conversas' })
}

/* ---------- seletor de contatos (nova conversa, grupos, encaminhar…) ---------- */
async function pickContacts({ title, multi = true, source = 'contacts', okLabel = 'OK', top = [] }) {
  return new Promise(async (resolve) => {
    const lst = $('#fullL'); $('#fullT').textContent = title
    let items = []
    try { items = source === 'chats' ? [...S.chats.map((c) => ({ id: c.id, name: c.name, number: c.number, isGroup: c.isGroup })), ...(await api('/api/contacts')).filter((c) => !S.chats.some((x) => x.id === c.id))] : await api('/api/contacts') } catch {}
    const chosen = new Map(), inp = h('input', { placeholder: 'Pesquisar nome ou número', autocomplete: 'off' }), box = h('div'), ok = h('button', { class: 'tintbtn', style: 'width:70px;text-align:right;font-weight:600', onclick: () => finish(true) }, okLabel)
    const finish = (yes) => { closeFull(); $('#fullX').onclick = closeFull; ok.remove(); resolve(yes ? [...chosen.values()] : []) }
    const sync = () => { ok.style.opacity = chosen.size || !multi ? 1 : .35; $('#fullT').textContent = multi && chosen.size ? `${title} (${chosen.size})` : title }
    const render = () => {
      const q = inp.value.trim().toLowerCase(), digits = q.replace(/\D/g, ''), rows = []
      if (!q) rows.push(...top)
      if (!multi && digits.length >= 10) rows.push(h('div', { class: 'row', onclick: () => { chosen.set('n', { id: digits + '@s.whatsapp.net', name: '+' + digits, number: '+' + digits }); finish(true) } }, h('div', { style: 'padding:12px 0' }, avatar(null, 44)), h('div', { class: 'body', style: 'min-height:60px' }, h('div', { class: 'nm' }, 'Conversar com +' + digits))))
      items.filter((c) => !q || c.name.toLowerCase().includes(q) || (c.number || '').includes(q)).forEach((c) => {
        const on = chosen.has(c.id)
        rows.push(h('div', { class: 'row', onclick: () => { if (!multi) { chosen.set(c.id, c); return finish(true) } chosen.has(c.id) ? chosen.delete(c.id) : chosen.set(c.id, c); sync(); render() } },
          multi ? h('span', { class: 'chk', style: `display:flex;margin-right:12px;${on ? 'background:var(--tint);border-color:var(--tint)' : ''}`, html: on ? ic('checkmark', 16) : '' }) : null,
          h('div', { style: 'padding:7px 0' }, avatar(c.id, 42, c.isGroup)), h('div', { class: 'body', style: 'min-height:56px' }, h('div', { class: 'nm', style: 'font-weight:500' }, c.name), c.number ? h('div', { class: 'l2' }, c.number) : null)))
      })
      if (!rows.length) rows.push(h('div', { class: 'empty' }, source === 'contacts' ? 'Nenhum contato encontrado. Os contatos aparecem após a sincronização inicial.' : 'Nada encontrado'))
      box.replaceChildren(...rows)
    }
    $('#fullX').onclick = () => finish(false)
    $('#full .hdr').append(ok); if (!multi) ok.remove()
    lst.replaceChildren(h('label', { class: 'search', style: 'margin:10px 16px' }, h('span', { class: 'ic', html: ic('search', 17) }), inp), box)
    inp.oninput = render; sync(); render(); $('#full').classList.add('on')
  })
}
const closeFull = () => $('#full').classList.remove('on')
$('#fullX').onclick = closeFull

$('#compose').onclick = async () => {
  const top = [
    h('div', { class: 'linkrow', onclick: () => { closeFull(); newGroup() } }, h('span', { class: 'ico', style: 'background:var(--wa)', html: ic('people', 20) }), 'Novo grupo'),
    h('div', { class: 'linkrow', onclick: () => { closeFull(); newList() } }, h('span', { class: 'ico', style: 'background:var(--wa)', html: ic('megaphone-outline', 20) }), 'Nova lista de transmissão')]
  const [p] = await pickContacts({ title: 'Nova conversa', multi: false, top })
  if (p) startChat(p)
}
async function startChat(p) {
  let id = p.id
  if (p.name.startsWith('+') && !S.chats.some((c) => c.id === p.id)) { try { id = (await post('/api/resolve', { number: p.id.split('@')[0] })).jid } catch (e) { return toast(e.message) } }
  openChat(S.chats.find((c) => c.id === id) || { id, name: p.name, number: p.number || '', isGroup: false, unread: 0 })
}
function askText({ title, msg, value = '', ok = 'OK', placeholder = '', multiline = false }) {
  return new Promise((res) => {
    const inp = h(multiline ? 'textarea' : 'input', { value, placeholder, rows: 3, style: multiline ? 'min-height:90px;resize:none' : '', autocomplete: 'off' })
    let done = false; const fin = (v) => { if (done) return; done = true; closeSheet(); res(v) }
    sheet([h('div', { class: 'grp' }, sheetInfo(title, msg), h('div', { class: 'form' }, inp), h('button', { class: 'opt', style: 'justify-content:center;font-weight:600', onclick: () => fin(inp.value.trim()) }, ok)), h('button', { class: 'opt can', onclick: () => fin(null) }, 'Cancelar')])
    setTimeout(() => inp.focus(), 380)
  })
}
async function newGroup() {
  const ms = await pickContacts({ title: 'Adicionar participantes', okLabel: 'Avançar' }); if (!ms.length) return
  const name = await askText({ title: 'Novo grupo', msg: `${ms.length} participante(s). Dê um nome ao grupo.`, placeholder: 'Nome do grupo', ok: 'Criar grupo' }); if (!name) return
  try { const g = await post('/api/groups', { subject: name, participants: ms.map((m) => m.id) }); await loadChats(); openChat(S.chats.find((c) => c.id === g.id) || { id: g.id, name, number: '', isGroup: true, unread: 0 }) } catch (e) { toast(e.message) }
}
async function newList() {
  const ms = await pickContacts({ title: 'Nova lista', okLabel: 'Avançar' }); if (!ms.length) return
  const name = await askText({ title: 'Nova lista de transmissão', msg: 'Quem estiver na lista recebe a mensagem como uma conversa individual.', placeholder: 'Nome da lista', ok: 'Criar lista' }); if (!name) return
  try { await post('/api/lists', { name, members: ms.map((m) => m.id) }); toast('Lista criada'); openLists() } catch (e) { toast(e.message) }
}
async function openLists() {
  openScreen('Listas de transmissão', async (body) => {
    const render = async () => {
      let ls = []; try { ls = await api('/api/lists') } catch {}
      body.replaceChildren(h('div', { class: 'linkrow', style: 'margin-top:12px;border-radius:12px;margin:12px 16px;background:var(--row)', onclick: newList }, icn('add-circle', 24), 'Nova lista'),
        ls.length ? h('div', { class: 'gbox' }, ls.map((l) => h('div', { class: 'gr', onclick: () => openListChat(l, render) }, h('span', { class: 'ico', style: 'background:var(--wa)', html: ic('megaphone-outline', 18) }), h('div', {}, h('div', { style: 'font-weight:500' }, l.name), h('div', { style: 'color:var(--sub);font-size:13px' }, l.members.length + ' destinatários')), h('span', { class: 'gv', html: ic('chevron-forward', 18) })))) : h('div', { class: 'empty' }, h('b', {}, 'Sem listas'), 'Envie a mesma mensagem para vários contatos de uma vez.'))
    }
    render()
  }, { backLabel: 'Conversas' })
}
function openListChat(l, refresh) {
  const del = h('button', { class: 'tintbtn', style: 'color:var(--red)', onclick: async () => { if (await confirmDlg({ title: 'Apagar lista?', ok: 'Apagar', danger: true })) { await api('/api/lists/' + l.id, { method: 'DELETE' }); closeScreen(); refresh?.() } } }, 'Apagar')
  openScreen(l.name, (body) => {
    const hist = h('div', { style: 'padding:12px 16px;display:flex;flex-direction:column;gap:8px;min-height:50vh' }, ...(l.history || []).map((x) => h('div', { class: 'msg me', style: 'align-self:flex-end;position:relative' }, h('div', { class: 'txt' }, x.text), h('div', { class: 'meta' }, fmtTime(x.ts)))))
    const t = h('textarea', { rows: 1, placeholder: 'Mensagem para a lista', style: 'flex:1;background:var(--field);border-radius:18px;padding:9px 14px;max-height:100px' }), send = h('button', { style: 'width:36px;height:36px;border-radius:50%;background:var(--wa);color:#fff;display:flex;align-items:center;justify-content:center', html: ic('send', 18), onclick: async () => { const text = t.value.trim(); if (!text) return; t.value = ''; try { const r = await post(`/api/lists/${l.id}/send`, { text }); hist.append(h('div', { class: 'msg me', style: 'align-self:flex-end' }, h('div', { class: 'txt' }, text), h('div', { class: 'meta' }, fmtTime(Date.now() / 1000)))); toast(`Enviada para ${r.sent} de ${r.total}`) } catch (e) { toast(e.message) } } })
    body.append(h('div', { style: 'padding:10px 16px 0;color:var(--sub);font-size:13px' }, l.members.map((m) => m.name).join(', ')), hist, h('div', { style: 'position:sticky;bottom:0;display:flex;gap:8px;padding:8px 10px calc(8px + env(safe-area-inset-bottom));background:var(--bar);backdrop-filter:blur(24px)' }, t, send))
  }, { right: del })
}
$('#editBtn').onclick = () => sheet([h('div', { class: 'grp' },
  opt('Novo grupo', 'people', newGroup, { bg: '#25D366' }), opt('Nova lista de transmissão', 'megaphone-outline', newList, { bg: '#25D366' }), opt('Listas de transmissão', 'megaphone-outline', openLists, { bg: '#007AFF' }),
  opt('Mensagens favoritas', 'star', openStarred, { bg: '#FFCC00' }), opt('Arquivadas', 'archive-outline', openArchived, { bg: '#5E5CE6' })), cancelOpt()])
async function openStarred() {
  openScreen('Mensagens favoritas', async (body) => {
    const out = []
    for (const c of [...S.chats, ...S.archived].slice(0, 60)) {
      try { const ms = (await api(`/api/chats/${enc(c.id)}/messages`)).filter((m) => m.starred); ms.forEach((m) => out.push({ c, m })) } catch {}
    }
    out.sort((a, b) => b.m.ts - a.m.ts)
    body.replaceChildren(out.length ? h('div', { class: 'gbox', style: 'margin-top:12px' }, out.map(({ c, m }) => h('div', { class: 'gr col', onclick: () => { closeScreen(); openChat(c, m.id) } }, h('div', { style: 'font-weight:600;font-size:15px' }, c.name + ' · ' + listTime(m.ts)), h('div', { style: 'color:var(--sub)' }, m.text || mediaText(m))))) : h('div', { class: 'empty' }, h('b', {}, 'Sem favoritas'), 'Segure uma mensagem e toque em Favoritar.'))
  }, { backLabel: 'Conversas' })
}
const mediaText = (m) => ({ image: '📷 Foto', video: '🎥 Vídeo', audio: '🎤 Áudio', document: '📄 ' + (m.fileName || 'Documento'), sticker: 'Figurinha', location: '📍 Localização', contact: '👤 ' + m.text, poll: '📊 ' + m.text }[m.type] || '')

/* ============================== chamadas ============================== */
async function loadCalls() { try { const r = await api('/api/calls'); S.calls = Array.isArray(r) ? r : [] } catch {} renderCalls() }
const RES = { missed: 'Perdida', answered: 'Recebida', declined: 'Recusada', ringing: 'Chamando…' }
function renderCalls() {
  const list = S.calls.filter((c) => S.callF === 'all' || c.result === 'missed'), box = $('#callList')
  if (!list.length) return box.replaceChildren(h('div', { class: 'empty' }, h('b', {}, 'Sem chamadas'), 'As chamadas recebidas enquanto o app está conectado aparecem aqui.'))
  box.replaceChildren(...list.map((c) => h('div', { class: 'row', onclick: () => openChat(S.chats.find((x) => x.id === c.jid) || { id: c.jid, name: c.name, number: '', isGroup: !!c.isGroup, unread: 0 }) }, h('div', { style: 'padding:10px 0' }, avatar(c.jid, 48, c.isGroup)),
    h('div', { class: 'body', style: 'min-height:66px' }, h('div', { class: 'l1' }, h('div', { class: 'nm' + (c.result === 'missed' ? ' red' : '') }, c.name), h('div', { class: 'tm' }, listTime(c.ts))),
      h('div', { class: 'l2' }, h('div', { class: 'pv' }, h('span', { style: 'display:flex;flex:none', html: ic(c.isVideo ? 'videocam' : 'call', 14) }), h('span', {}, (c.isVideo ? 'Vídeo · ' : '') + RES[c.result])))))))
}
$('#callSeg').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; S.callF = b.dataset.f; document.querySelectorAll('#callSeg button').forEach((x) => x.classList.toggle('on', x === b)); renderCalls() }
let liveCall = null
function showIncoming(c) {
  liveCall = c; const el = $('#call')
  el.replaceChildren(avatar(c.jid, 120, c.isGroup), h('h2', {}, c.name), h('p', {}, c.isVideo ? 'Chamada de vídeo do WhatsApp' : 'Chamada de áudio do WhatsApp'),
    h('div', { class: 'note' }, 'Atenda no seu celular. Este aparelho só consegue recusar chamadas.'),
    h('div', { class: 'btns' }, h('div', {}, h('button', { style: 'background:#3a3a3c', onclick: hideIncoming, html: ic('close', 30) }), 'Fechar'),
      h('div', {}, h('button', { style: 'background:var(--red)', html: ic('call', 30).replace('<svg', '<svg style="transform:rotate(135deg)"'), onclick: async () => { try { await post('/api/calls/reject', { id: c.id, from: c.from }) } catch (e) { toast(e.message) } hideIncoming() } }), 'Recusar')))
  el.classList.add('on')
}
const hideIncoming = () => { $('#call').classList.remove('on'); liveCall = null }
function onCall(c) {
  const i = S.calls.findIndex((x) => x.id === c.id); if (i >= 0) S.calls[i] = c; else S.calls.unshift(c)
  renderCalls()
  if (c.live && !c.isGroup) showIncoming(c); else if (liveCall?.id === c.id) hideIncoming()
}
// chamadas pelo cabeçalho do chat: WhatsApp oficial ou ligação telefônica
function dialSheet(video) {
  const c = S.cur; if (!c) return
  const num = !c.isGroup && c.id.endsWith('@s.whatsapp.net') ? c.id.split('@')[0] : null
  if (!num) return sheet([h('div', { class: 'grp' }, sheetInfo('Chamada em grupo', 'Chamadas em grupo só podem ser iniciadas no app oficial do WhatsApp.'), opt('Abrir o WhatsApp', 'logo-whatsapp', () => openExternal('https://wa.me/'), { bg: '#25D366' })), cancelOpt()])
  sheet([h('div', { class: 'grp' }, sheetInfo(`Ligar para ${c.name}`, 'Escolha como fazer a chamada.'),
    opt(video ? 'Vídeo pelo WhatsApp' : 'Áudio pelo WhatsApp', 'logo-whatsapp', () => openExternal(`whatsapp://send?phone=${num}`, `https://wa.me/${num}`), { bg: '#25D366' }),
    opt('Ligação telefônica', 'call', () => openExternal('tel:+' + num), { bg: '#34C759' })), cancelOpt()])
}
function openExternal(url, fallback) {
  try { if (NA()?.openUrl) return NA().openUrl(url) } catch {}
  const w = window.open(url, '_blank'); if (!w && fallback) window.open(fallback, '_blank')
}
$('#newCall').onclick = async () => { const [p] = await pickContacts({ title: 'Nova chamada', multi: false }); if (p) { S.cur = { id: p.id, name: p.name, isGroup: false }; dialSheet(false) } }

/* ============================== atualizações (status) ============================== */
async function loadStatuses() { try { const r = await api('/api/statuses'); S.statuses = Array.isArray(r) ? r : [] } catch {} renderUpdates() }
function renderUpdates() {
  const box = $('#updList'), mine = S.statuses.find((g) => g.mine), others = S.statuses.filter((g) => !g.mine)
  const mk = (g) => {
    const seen = g.items.every((i) => viewed.has(i.id))
    return h('div', { class: 'row', onclick: () => openStatus(g) }, h('div', { style: 'padding:9px 0' }, h('div', { class: 'ring' + (seen || g.mine ? ' seen' : '') }, avatar(g.jid, 50))),
      h('div', { class: 'body', style: 'min-height:68px;margin-left:2px' }, h('div', { class: 'nm' }, g.name), h('div', { class: 'tm' }, (daysAgo(g.last) ? 'Ontem, ' : 'Hoje, ') + fmtTime(g.last))))
  }
  box.replaceChildren(
    mine ? mk(mine) : h('div', { class: 'row', onclick: statusSheet }, h('div', { style: 'padding:9px 0;position:relative' }, avatar(S.me, 52), h('span', { style: 'position:absolute;right:-2px;bottom:6px;width:22px;height:22px;border-radius:50%;background:var(--wa);color:#fff;display:flex;align-items:center;justify-content:center;border:2px solid var(--bg)', html: ic('add', 16) })), h('div', { class: 'body', style: 'min-height:68px;margin-left:2px' }, h('div', { class: 'nm' }, 'Meu status'), h('div', { class: 'l2' }, 'Toque para adicionar uma atualização'))),
    others.length ? h('div', { class: 'secH' }, 'Atualizações recentes') : h('div', { class: 'empty' }, h('b', {}, 'Sem atualizações'), 'Os status dos seus contatos aparecem aqui enquanto o app está conectado.'),
    ...others.map(mk))
}
const statusSheet = () => sheet([h('div', { class: 'grp' }, opt('Texto', 'text-outline', statusText, { bg: '#25D366' }), opt('Foto ou vídeo', 'images-outline', () => { statusMode = true; $('#fMedia').click() }, { bg: '#007AFF' }), opt('Câmera', 'camera-outline', () => { statusMode = true; $('#fCam').click() }, { bg: '#5E5CE6' })), cancelOpt()])
$('#addStatus').onclick = statusSheet
let statusMode = false
const SBG = ['#128C7E', '#7C4DFF', '#E91E63', '#FF9800', '#2196F3', '#455A64', '#8E24AA', '#43A047']
function statusText() {
  let ci = 0, fi = 0
  const ta = h('textarea', { placeholder: 'Digite um status', rows: 3, style: 'width:100%;background:none;color:#fff;font-size:32px;font-weight:600;text-align:center;resize:none;height:60%;-webkit-user-select:text' })
  const wrap = h('div', { style: `position:absolute;inset:0;z-index:48;background:${SBG[0]};display:flex;flex-direction:column;padding:calc(16px + env(safe-area-inset-top)) 18px calc(16px + env(safe-area-inset-bottom));color:#fff;animation:fadeUp .3s var(--ease)` },
    h('div', { style: 'display:flex;justify-content:space-between;align-items:center' }, h('button', { style: 'color:#fff', html: ic('close', 28), onclick: () => wrap.remove() }),
      h('div', { style: 'display:flex;gap:18px' }, h('button', { style: 'color:#fff', html: ic('text', 26), onclick: () => { fi = (fi + 1) % 5; ta.style.fontFamily = ['Inter', 'serif', 'monospace', 'cursive', 'fantasy'][fi] } }), h('button', { style: 'color:#fff', html: ic('color-palette-outline', 26), onclick: () => { ci = (ci + 1) % SBG.length; wrap.style.background = SBG[ci] } }))),
    h('div', { style: 'flex:1;display:flex;align-items:center' }, ta),
    h('div', { style: 'display:flex;justify-content:flex-end' }, h('button', { style: 'width:54px;height:54px;border-radius:50%;background:var(--wa);color:#fff;display:flex;align-items:center;justify-content:center', html: ic('send', 26), onclick: async () => { if (!ta.value.trim()) return; try { await post('/api/status/text', { text: ta.value, bg: SBG[ci], font: fi }); wrap.remove(); toast('Status publicado'); loadStatuses() } catch (e) { toast(e.message) } } })))
  $('#app').append(wrap); setTimeout(() => ta.focus(), 300)
}
let svT = null, svG = null, svI = 0
function openStatus(g) { svG = g; svI = g.items.findIndex((i) => !viewed.has(i.id)); if (svI < 0) svI = 0; $('#sv').classList.add('on'); playStatus() }
function closeStatus() { clearTimeout(svT); $('#sv').classList.remove('on'); $('#svSt').replaceChildren(); setPref('viewed', [...viewed].slice(-500)); renderUpdates() }
function playStatus() {
  clearTimeout(svT)
  const it = svG.items[svI]; if (!it) return closeStatus()
  viewed.add(it.id)
  const bars = svG.items.map((_, i) => h('i', {}, h('b', { style: `width:${i < svI ? 100 : 0}%` })))
  $('#svBars').replaceChildren(...bars)
  $('#svWho').replaceChildren(avatar(svG.jid, 38), h('div', {}, h('b', {}, svG.name), h('br'), h('small', {}, (daysAgo(it.ts) ? 'Ontem, ' : 'Hoje, ') + fmtTime(it.ts))), h('button', { onclick: closeStatus, html: ic('close', 26) }))
  const url = `/api/media/status@broadcast/${enc(it.id)}`, st = $('#svSt'), fill = bars[svI].firstChild
  $('#svCap').textContent = it.type !== 'text' ? it.text : ''
  const timed = (ms) => { fill.style.transition = `width ${ms}ms linear`; requestAnimationFrame(() => requestAnimationFrame(() => (fill.style.width = '100%'))); svT = setTimeout(nextStatus, ms) }
  if (it.type === 'image') { st.style.background = '#000'; st.replaceChildren(h('img', { src: url })); timed(5500) }
  else if (it.type === 'video') { st.style.background = '#000'; const v = h('video', { src: url, autoplay: true, playsInline: true }); v.ontimeupdate = () => { fill.style.width = (v.currentTime / (v.duration || 1)) * 100 + '%' }; v.onended = nextStatus; v.onerror = nextStatus; st.replaceChildren(v) }
  else { st.style.background = it.bg || '#128C7E'; st.replaceChildren(h('p', {}, it.text)); timed(5500) }
}
const nextStatus = () => { svI++; svI >= svG.items.length ? closeStatus() : playStatus() }
$('#svR').onclick = nextStatus
$('#svL').onclick = () => { svI = Math.max(0, svI - 1); playStatus() }
