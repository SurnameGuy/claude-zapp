/* ============================== ajustes ============================== */
const srow = (label, icon, bg, val, fn, o = {}) => h('div', { class: 'gr ico-l' + (o.red ? ' red' : ''), onclick: fn }, icon ? h('span', { class: 'ico', style: 'background:' + bg, html: ic(icon, 18) }) : null, h('span', {}, label), val !== undefined && val !== null ? h('span', { class: 'gv' + (o.tint ? ' tint' : '') }, val, fn ? h('span', { html: ic('chevron-forward', 16) }) : null) : null)
function switchRow(label, icon, bg, on, set) {
  const sw = h('span', { class: 'sw' + (on ? ' on' : '') })
  return h('div', { class: 'gr ico-l', onclick: () => { on = !on; sw.classList.toggle('on', on); haptic(8); set(on) } }, icon ? h('span', { class: 'ico', style: 'background:' + bg, html: ic(icon, 18) }) : null, h('span', {}, label), sw)
}
const THEMES = { auto: 'Automático', light: 'Claro', dark: 'Escuro' }
const SIZES = { 0.92: 'Pequeno', 1: 'Padrão', 1.1: 'Grande', 1.2: 'Muito grande' }

function renderSettings() {
  const num = fmtPhone(S.me)
  $('#setBody').replaceChildren(
    h('div', { class: 'gbox', style: 'margin-top:4px' }, h('div', { class: 'gr', style: 'min-height:84px', onclick: profileScreen }, avatar(S.me, 62), h('div', { style: 'min-width:0;flex:1' }, h('div', { style: 'font-size:20px;font-weight:600' }, S.name || 'Meu perfil'), h('div', { style: 'color:var(--sub);font-size:15px' }, num)), h('span', { class: 'gv', html: ic('chevron-forward', 16) }))),
    h('div', { class: 'gbox' }, srow('Mensagens favoritas', 'star', '#FFCC00', null, openStarred), srow('Listas de transmissão', 'megaphone-outline', '#25D366', null, openLists)),
    h('div', { class: 'gbox' }, srow('Privacidade', 'lock-closed-outline', '#007AFF', null, privacyScreen), srow('Conversas', 'chatbubbles-outline', '#25D366', null, chatsSettings), srow('Notificações', 'notifications-outline', '#FF3B30', null, notifScreen), srow('Armazenamento e dados', 'server-outline', '#34C759', null, storageScreen)),
    h('div', { class: 'gbox' }, srow('Ajuda e informações', 'help-circle-outline', '#5AC8FA', null, aboutScreen)),
    h('div', { class: 'gbox' }, h('div', { class: 'gr red', onclick: logout }, 'Desconectar este aparelho')),
    h('div', { class: 'foot' }, 'Ao desconectar, a sessão é apagada daqui e será preciso vincular de novo.'))
}
function logout() {
  sheet([h('div', { class: 'grp' }, sheetInfo('Desconectar?', 'A sessão será apagada deste aparelho e você precisará gerar um novo código.'), h('button', { class: 'opt red', onclick: async () => { closeSheet(); await post('/api/logout').catch(() => {}) } }, h('span', { class: 'lbl', style: 'color:var(--red);text-align:center' }, 'Desconectar'))), cancelOpt()])
}

/* ---------- perfil ---------- */
async function profileScreen() {
  openScreen('Perfil', async (body) => {
    let p = {}; try { p = await api('/api/profile') } catch {}
    const draw = () => body.replaceChildren(
      h('div', { class: 'hero', style: 'padding-top:14px' }, h('div', { onclick: () => $('#fAvatar').click() }, avatar(S.me, 110)), h('button', { class: 'tintbtn', style: 'font-size:15px', onclick: () => $('#fAvatar').click() }, 'Alterar foto')),
      h('div', { class: 'gbox' }, srow('Nome', null, '', p.name || S.name, async () => { const v = await askText({ title: 'Seu nome', value: p.name || '', ok: 'Salvar' }); if (v) { try { await post('/api/profile', { name: v }); p.name = S.name = v; draw(); renderSettings() } catch (e) { toast(e.message) } } }),
        srow('Recado', null, '', p.about || '—', async () => { const v = await askText({ title: 'Recado', value: p.about || '', ok: 'Salvar', multiline: true }); if (v != null) { try { await post('/api/profile', { about: v }); p.about = v; draw() } catch (e) { toast(e.message) } } }),
        srow('Número', null, '', p.number || '', null)))
    draw()
  }, { backLabel: 'Ajustes' })
}
$('#fAvatar').onchange = async (e) => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return
  try {
    const url = URL.createObjectURL(f), img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url })
    const c = document.createElement('canvas'); c.width = c.height = 640; const k = Math.max(640 / img.width, 640 / img.height)
    c.getContext('2d').drawImage(img, (640 - img.width * k) / 2, (640 - img.height * k) / 2, img.width * k, img.height * k); URL.revokeObjectURL(url)
    const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.85))
    await api('/api/profile/photo', { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: blob }); toast('Foto atualizada'); closeScreen(); renderSettings(); setTimeout(profileScreen, 450)
  } catch (er) { toast(er.message || 'Falha ao atualizar a foto') }
}

/* ---------- privacidade ---------- */
const PRIV_OPTS = { all: 'Todos', contacts: 'Meus contatos', contact_blacklist: 'Meus contatos, exceto…', none: 'Ninguém', match_last_seen: 'Igual ao “visto por último”' }
async function privacyScreen() {
  openScreen('Privacidade', async (body) => {
    let p = {}; try { p = (await api('/api/profile')) } catch {}
    const pv = p.privacy || {}
    const set = async (key, val) => { try { await post('/api/privacy', { key, value: val }); pv[key] = val; draw() } catch (e) { toast(e.message) } }
    const pick = (key, label, opts) => srow(label, null, '', PRIV_OPTS[pv[key]] || '—', () => choose(label, opts.map((o) => [PRIV_OPTS[o], o]), (v) => set(key, v), pv[key]))
    const draw = () => body.replaceChildren(
      h('div', { class: 'ghead', style: 'margin-top:14px' }, 'Quem pode ver minhas informações'),
      h('div', { class: 'gbox' }, pick('last', 'Visto por último', ['all', 'contacts', 'none']), pick('online', 'Online', ['all', 'match_last_seen']), pick('profile', 'Foto do perfil', ['all', 'contacts', 'none']), pick('status', 'Recado', ['all', 'contacts', 'none'])),
      h('div', { class: 'gbox' }, pick('groupadd', 'Grupos', ['all', 'contacts']), switchRow('Confirmações de leitura', null, '', pv.readreceipts !== 'none', (on) => set('readreceipts', on ? 'all' : 'none'))),
      h('div', { class: 'gfoot' }, 'Se você desativar as confirmações de leitura, não verá as dos outros. Em grupos, elas são sempre enviadas.'),
      h('div', { class: 'gbox' }, srow('Contatos bloqueados', 'ban-outline', '#FF3B30', (p.blocked || []).length, () => blockedScreen(p))))
    draw()
  }, { backLabel: 'Ajustes' })
}
function blockedScreen(p) {
  openScreen('Bloqueados', (body) => {
    const draw = () => body.replaceChildren((p.blocked || []).length ? h('div', { class: 'gbox', style: 'margin-top:14px' }, p.blocked.map((b) => h('div', { class: 'gr', style: 'min-height:56px', onclick: async () => { if (await confirmDlg({ title: 'Desbloquear ' + b.name + '?', ok: 'Desbloquear' })) { try { await post(`/api/chats/${enc(b.id)}/action`, { type: 'unblock' }); p.blocked = p.blocked.filter((x) => x.id !== b.id); draw() } catch (e) { toast(e.message) } } } }, avatar(b.id, 38), b.name, h('span', { class: 'gv tint' }, 'Desbloquear')))) : h('div', { class: 'empty' }, 'Nenhum contato bloqueado'))
    draw()
  }, { backLabel: 'Privacidade' })
}

/* ---------- conversas e aparência ---------- */
function chatsSettings() {
  openScreen('Conversas', (body) => {
    const draw = () => {
      body.replaceChildren(
        h('div', { class: 'ghead', style: 'margin-top:14px' }, 'Aparência'),
        h('div', { class: 'gbox' },
          srow('Tema', 'moon-outline', '#5E5CE6', THEMES[pref('theme', 'auto')], () => choose('Tema', Object.entries(THEMES).map(([k, v]) => [v, k]), (v) => { setPref('theme', v); applyLook(); draw() }, pref('theme', 'auto'))),
          switchRow('Liquid Glass', 'sparkles-outline', '#007AFF', pref('glass', false), (on) => { setPref('glass', on); applyLook() }),
          srow('Tamanho do texto', 'text-outline', '#FF9500', SIZES[pref('fs', 1)] || 'Padrão', () => choose('Tamanho do texto', Object.entries(SIZES).map(([k, v]) => [v, k]), (v) => { setPref('fs', Number(v)); applyLook(); draw() }, pref('fs', 1)))),
        h('div', { class: 'gfoot' }, 'O Liquid Glass deixa as barras, o menu de abas e os menus translúcidos e flutuantes, como no iOS mais recente.'),
        h('div', { class: 'gbox' }, srow('Papel de parede', 'color-palette-outline', '#5AC8FA', null, wallpaperPicker)),
        h('div', { class: 'ghead' }, 'Mensagens'),
        h('div', { class: 'gbox' }, switchRow('Enter envia a mensagem', 'send', '#25D366', pref('enter', true), (on) => setPref('enter', on)),
          srow('Baixar fotos automaticamente', 'cloud-download-outline', '#34C759', pref('autodl', 'all') === 'all' ? 'Sempre' : 'Nunca', () => choose('Baixar fotos automaticamente', [['Sempre', 'all'], ['Nunca', 'none']], (v) => { setPref('autodl', v); draw() }, pref('autodl', 'all')))),
        h('div', { class: 'gfoot' }, 'Vídeos, áudios e documentos são baixados quando você toca neles.'))
    }
    draw()
  }, { backLabel: 'Ajustes' })
}
const WALLS = ['#EFEAE2', '#DCE8D8', '#D8E4EE', '#EEDDE6', '#F3E7C8', '#C9D2D9', '#1F2C34', '#0B141A']
function wallpaperPicker() {
  openScreen('Papel de parede', (body) => {
    const cur = pref('wall', null)
    const draw = () => body.replaceChildren(
      h('div', { class: 'walls' }, h('div', { class: !cur ? 'on' : '', style: 'background:var(--wall) var(--doodle);background-size:80px', onclick: () => { setPref('wall', null); applyWallpaper(); toast('Papel de parede padrão') } }),
        ...WALLS.map((c) => h('div', { style: `background:${c}`, onclick: () => { setPref('wall', { t: 'plain', v: c }); applyWallpaper(); toast('Papel de parede alterado') } }))),
      h('div', { class: 'gbox' }, srow('Escolher da galeria', 'images-outline', '#007AFF', null, () => $('#fWall').click()), srow('Redefinir', 'refresh-outline', '#FF3B30', null, () => { setPref('wall', null); applyWallpaper(); toast('Papel de parede redefinido') })))
    draw()
  }, { backLabel: 'Voltar' })
}
$('#fWall').onchange = async (e) => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return
  try {
    const url = URL.createObjectURL(f), img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url })
    for (const [w, q] of [[1080, 0.8], [720, 0.7], [480, 0.6]]) {
      const k = Math.min(1, w / Math.max(img.width, img.height)), c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k)
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); const data = c.toDataURL('image/jpeg', q)
      try { localStorage.setItem('wa_wall', JSON.stringify({ t: 'img', v: data })); applyWallpaper(); toast('Papel de parede alterado'); break } catch { /* tenta menor */ }
    }
    URL.revokeObjectURL(url)
  } catch { toast('Não foi possível usar esta imagem') }
}

/* ---------- notificações ---------- */
async function notifScreen() {
  openScreen('Notificações', async (body) => {
    let p = {}; try { p = await api('/api/profile') } catch {}
    const cfg = p.cfg || {}, native = !!NA()
    const save = (o) => post('/api/config', o).catch((e) => toast(e.message))
    body.replaceChildren(
      h('div', { class: 'ghead', style: 'margin-top:14px' }, 'Mensagens'),
      h('div', { class: 'gbox' },
        switchRow('Notificações', 'notifications-outline', '#FF3B30', cfg.notif ?? true, async (on) => { save({ notif: on }); if (!native && on && window.Notification) { const r = await Notification.requestPermission(); setPref('notif', r === 'granted') } }),
        switchRow('Mostrar prévia', 'reader-outline', '#007AFF', cfg.previews ?? true, (on) => save({ previews: on }))),
      h('div', { class: 'gfoot' }, 'Com a prévia desligada, a notificação mostra apenas “Nova mensagem”. Conversas silenciadas não notificam.'),
      native ? h('div', {}, h('div', { class: 'gbox' },
        srow('Permitir notificações', 'notifications', '#34C759', null, () => NA().requestNotifPermission?.()),
        srow('Som e vibração', 'volume-mute-outline', '#FF9500', null, () => NA().openNotificationSettings?.()),
        srow('Manter ativo em segundo plano', 'phone-portrait-outline', '#5E5CE6', null, () => NA().requestBatteryExemption?.())),
        h('div', { class: 'gfoot' }, 'Para receber mensagens com o app fechado, permita as notificações e remova a restrição de bateria. Em alguns celulares (Xiaomi, Samsung, Huawei) também é preciso liberar a “inicialização automática” nas configurações do sistema.')) : h('div', { class: 'gfoot' }, 'No navegador, as notificações só funcionam com a aba aberta. Instale o app Android para receber com o app fechado.'))
  }, { backLabel: 'Ajustes' })
}

/* ---------- armazenamento ---------- */
async function storageScreen() {
  openScreen('Armazenamento e dados', async (body) => {
    let c = { bytes: 0 }, p = {}; try { c = await api('/api/cache'); p = await api('/api/profile') } catch {}
    const draw = () => body.replaceChildren(
      h('div', { class: 'ghead', style: 'margin-top:14px' }, 'Armazenamento'),
      h('div', { class: 'gbox' }, srow('Mídias em cache', 'folder-outline', '#34C759', fmtSize(c.bytes) || '0 KB', null), srow('Limpar cache de mídias', 'trash-outline', '#FF3B30', null, async () => { if (await confirmDlg({ title: 'Limpar cache?', msg: 'As mídias serão baixadas de novo quando você abri-las.', ok: 'Limpar', danger: true })) { await post('/api/cache/clear').catch(() => {}); c.bytes = 0; draw(); toast('Cache limpo') } })),
      h('div', { class: 'ghead' }, 'GIFs'),
      h('div', { class: 'gbox' }, srow('Chave da API de GIFs', 'globe-outline', '#007AFF', p.cfg?.gifKey ? 'Configurada' : 'Não configurada', async () => { const v = await askText({ title: 'Chave de GIFs', msg: 'GIPHY ou Tenor. Crie uma chave gratuita em developers.giphy.com.', placeholder: 'Cole a chave', ok: 'Salvar' }); if (v) { await post('/api/config', { gifKey: v }); p.cfg = { ...(p.cfg || {}), gifKey: v }; draw() } })))
    draw()
  }, { backLabel: 'Ajustes' })
}
function aboutScreen() {
  openScreen('Ajuda e informações', (body) => body.append(
    h('div', { class: 'hero', style: 'padding-top:30px' }, h('div', { class: 'logo', style: 'width:96px;height:96px;box-shadow:none', html: ic('logo-whatsapp', 56) }), h('h2', {}, 'WhatsApp'), h('p', {}, 'Cliente para aparelhos vinculados · versão 1.0')),
    h('div', { class: 'gbox' }, srow('Aparelho vinculado', 'phone-portrait-outline', '#34C759', S.st === 'open' ? 'Conectado' : 'Desconectado', null), srow('Número', 'call-outline', '#007AFF', fmtPhone(S.me), null)),
    h('div', { class: 'gfoot', style: 'margin-top:10px' }, 'Este app usa o recurso “Aparelhos conectados” do WhatsApp, como o WhatsApp Web. Mensagens de visualização única só podem ser abertas no celular.')), { backLabel: 'Ajustes' })
}
