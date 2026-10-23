/* Vampir Köylü — oyuncu (telefon) arayüzü. Build adımı yok, vanilla JS.
 * GÜVENLİK: kullanıcı verisi (oyuncu adları vb.) SADECE textContent / text node ile yazılır. innerHTML kullanılmaz. */
(() => {
  'use strict';

  // ------------------------------------------------------------------ sabitler
  const TOKEN_KEY = 'vk_token';
  const MAX_NAME = 16;
  const PHASE_NAMES = {
    lobby: 'Lobi', rolereveal: 'Roller', night: 'Gece', dawn: 'Şafak', day: 'Gündüz',
    vote: 'Oylama', voteresult: 'Karar', ended: 'Oyun bitti',
  };
  const SKY = { night: 'night', dawn: 'day', day: 'day', vote: 'day', voteresult: 'day' };
  const TEAM = {
    koylu: { name: 'Köylüler', emoji: '🏘️' },
    vampir: { name: 'Vampirler', emoji: '🧛' },
    tarafsiz: { name: 'Tarafsızlar', emoji: '🎭' },
  };
  const FALLBACK_AVATARS = [['vampir', '🧛'], ['cadi', '🧙'], ['peri', '🧚'], ['elf', '🧝'], ['zombi', '🧟'], ['hayalet', '👻'],
    ['yarasa', '🦇'], ['kurt', '🐺'], ['baykus', '🦉'], ['kuzgun', '🐦‍⬛'], ['kedi', '🐈‍⬛'], ['yilan', '🐍'], ['orumcek', '🕷️'],
    ['kurukafa', '💀'], ['mum', '🕯️'], ['kabak', '🎃'], ['gul', '🥀'], ['ay', '🌙'], ['yildiz', '⭐'], ['ates', '🔥'],
    ['kilic', '🗡️'], ['kalkan', '🛡️'], ['kristal', '🔮'], ['mantar', '🍄']].map(([id, emoji]) => ({ id, emoji }));

  // ------------------------------------------------------------------ durum
  const S = {
    ws: null, connected: false, everConnected: false, retry: 0, retryTimer: null,
    token: load(TOKEN_KEY), playerId: null, joined: false, resuming: false, joining: false,
    view: null, offset: 0, avatars: FALLBACK_AVATARS, notice: null,
    lastDawn: null, // gündüz ekranında hatırlatmak için son şafak raporu
    screenKey: null,
  };
  const ui = {
    name: '', avatar: null,
    night: { abilityId: null, targetId: null }, nightSent: null, // nightSent: {kind:'pass'|'choice', abilityId, targetId}
    pendingVote: undefined, shootTarget: null, roleOpen: false, sheet: null, confirm: null,
    mini: null, // gece hafıza oyunu (sadece telefonda; oyuna etkisi yok)
  };

  function load(k) { try { return localStorage.getItem(k); } catch { return null; } }
  function save(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* gizli sekme */ } }

  // ------------------------------------------------------------------ DOM yardımcıları
  const $ = (id) => document.getElementById(id);
  /** Eleman üretir. Çocuk olarak verilen string'ler text node olur (XSS güvenli). */
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else if (v === true) el.setAttribute(k, '');
        else el.setAttribute(k, String(v));
      }
    }
    append(el, kids);
    return el;
  }
  function append(el, kids) {
    for (const k of kids.flat(Infinity)) {
      if (k == null || k === false) continue;
      el.append(k instanceof Node ? k : document.createTextNode(String(k)));
    }
  }
  const avatarEmoji = (id) => (S.avatars.find((a) => a.id === id) || { emoji: '❔' }).emoji;
  const avatar = (id, size = '') => h('span', { class: `avatar ${size}`, 'aria-hidden': 'true' }, avatarEmoji(id));
  const playerById = (id) => (S.view && S.view.players.find((p) => p.id === id)) || null;

  function toast(text, kind = 'error') {
    const t = $('toast');
    t.textContent = text;
    t.className = `toast ${kind}`;
    t.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { t.hidden = true; }, 3800);
  }

  // ------------------------------------------------------------------ bağlantı
  function connect() {
    clearTimeout(S.retryTimer);
    if (S.ws && (S.ws.readyState === 0 || S.ws.readyState === 1)) return;
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    let ws;
    try { ws = new WebSocket(`${proto}//${location.host}/ws?as=oyuncu`); } catch { return scheduleReconnect(); }
    S.ws = ws;
    if (S.token) S.resuming = true;
    ws.onopen = () => {
      S.connected = true; S.everConnected = true; S.retry = 0;
      setConnBand();
      if (S.token) send({ type: 'resume', token: S.token });
    };
    ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      onMessage(msg);
    };
    ws.onclose = () => {
      if (S.ws !== ws) return;
      S.connected = false; S.joining = false;
      setConnBand();
      scheduleReconnect();
    };
    ws.onerror = () => { /* onclose gelecek */ };
  }

  function scheduleReconnect() {
    clearTimeout(S.retryTimer);
    const base = Math.min(10000, 500 * 2 ** S.retry);
    S.retry = Math.min(S.retry + 1, 8);
    S.retryTimer = setTimeout(connect, base * (0.75 + Math.random() * 0.5));
  }

  function setConnBand() {
    const band = $('conn');
    band.hidden = S.connected;
    document.body.classList.toggle('has-conn', !S.connected);
    band.textContent = S.everConnected ? 'Yeniden bağlanıyor…' : 'Sunucuya bağlanılıyor…';
  }

  // Telefon uykudan uyanınca beklemeden tekrar dene
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !S.connected) { S.retry = 0; connect(); }
  });
  window.addEventListener('online', () => { if (!S.connected) { S.retry = 0; connect(); } });

  function send(obj) {
    if (!S.ws || S.ws.readyState !== 1) { toast('Bağlantı yok, yeniden bağlanılıyor…'); return false; }
    S.ws.send(JSON.stringify(obj));
    return true;
  }

  function onMessage(msg) {
    switch (msg.type) {
      case 'token':
        S.token = msg.token; S.playerId = msg.playerId; S.resuming = false; S.joining = false; S.notice = null;
        save(TOKEN_KEY, msg.token);
        break;
      case 'resumeFailed':
        S.resuming = false; S.token = null; S.playerId = null;
        save(TOKEN_KEY, null);
        S.notice = 'Önceki oturumun bulunamadı (oyun sıfırlanmış olabilir). Yeniden katıl.';
        render();
        break;
      case 'kicked':
        S.token = null; S.playerId = null; S.joined = false;
        save(TOKEN_KEY, null);
        S.notice = 'Moderatör seni oyundan çıkardı. İstersen yeniden katılabilirsin.';
        break;
      case 'state':
        S.offset = (msg.serverNow || Date.now()) - Date.now();
        S.joined = !!msg.joined;
        onState(msg.view);
        break;
      case 'error':
        S.joining = false;
        toast(msg.message || 'Bir hata oluştu.');
        if (S.view) render();
        break;
      default: break;
    }
  }

  // ------------------------------------------------------------------ durum değişimi
  function onState(view) {
    const prev = S.view;
    S.view = view;
    const phaseChanged = !prev || prev.phase !== view.phase || prev.day !== view.day;
    if (phaseChanged) {
      ui.night = { abilityId: null, targetId: null };
      ui.nightSent = null; ui.pendingVote = undefined; ui.shootTarget = null; ui.roleOpen = false; ui.mini = null;
      if (ui.sheet === 'confirm') closeSheet();
    }
    if (view.phase === 'dawn' && view.report) S.lastDawn = view.report;
    if (view.phase === 'lobby') S.lastDawn = null;
    const me = view.me;
    if (me && view.phase === 'night') {
      // sunucudaki kayıtlı seçimi yerel seçime yansıt (sayfa yenilendiyse)
      if (me.nightChoice && !ui.night.abilityId) {
        ui.night = { abilityId: me.nightChoice.abilityId, targetId: me.nightChoice.targetId };
        ui.nightSent = { kind: 'choice', ...ui.night };
      }
    }
    if (me && view.phase === 'vote' && ui.pendingVote !== undefined && me.myVote === ui.pendingVote) ui.pendingVote = undefined;
    render();
  }

  // ------------------------------------------------------------------ zamanlayıcı
  function tick() {
    const el = $('topTimer');
    const v = S.view;
    if (!v || !v.phaseEndsAt || !['night', 'dawn', 'day', 'vote', 'voteresult'].includes(v.phase)) { el.textContent = ''; el.className = 'timer'; return; }
    const left = Math.round((v.phaseEndsAt - (Date.now() + S.offset)) / 1000);
    if (left <= 0) { el.textContent = 'Süre doldu'; el.className = 'timer over'; return; }
    const m = Math.floor(left / 60), s = left % 60;
    el.textContent = `${m}:${String(s).padStart(2, '0')}`;
    el.className = left <= 10 ? 'timer low' : 'timer';
  }
  setInterval(tick, 500);

  // ------------------------------------------------------------------ çizim
  function screenOf(v) {
    if (!v) return 'loading';
    if (S.resuming) return 'loading';
    if (!S.joined || !v.me) return 'join';
    if (v.phase === 'lobby') return 'lobby';
    if (v.phase === 'ended') return 'ended';
    if (!v.me.role) return 'lobby';
    if (!v.me.alive) return 'dead';
    return v.phase;
  }

  function render() {
    const v = S.view;
    const key = screenOf(v);
    document.body.dataset.phase = v ? v.phase : 'lobby';
    document.body.dataset.sky = (v && SKY[v.phase]) || 'dusk';
    document.body.classList.toggle('is-dead', key === 'dead');
    renderTop(v, key);
    const root = $('app');
    if (key === 'join' && S.screenKey === 'join' && root.firstChild) {
      updateJoin(root);
    } else {
      const sameScreen = key === S.screenKey;
      const y = window.scrollY;
      root.replaceChildren(SCREENS[key](v));
      if (sameScreen) window.scrollTo(0, y); else window.scrollTo(0, 0);
    }
    S.screenKey = key;
    if (ui.sheet) renderSheet();
    tick();
  }

  function renderTop(v, key) {
    const top = $('top');
    const me = v && v.me;
    const show = !!(me && S.joined && key !== 'join' && key !== 'loading');
    top.hidden = !show;
    if (!show) return;
    $('topAvatar').textContent = avatarEmoji(me.avatar);
    $('topName').textContent = me.name;
    let label = PHASE_NAMES[v.phase] || '';
    if (['night', 'day'].includes(v.phase) && v.day) label = `${v.day}. ${label.toLocaleLowerCase('tr')}`;
    $('topPhase').textContent = label;
    $('btnRole').hidden = !me.role;
    $('btnLog').hidden = !me.role;
    const unread = Math.max(0, (me.log || []).length - Number(load(`vk_seen_${me.id}`) || 0));
    const badge = $('logBadge');
    badge.hidden = unread === 0 || ui.sheet === 'log';
    badge.textContent = unread > 9 ? '9+' : String(unread);
  }

  // ---- ortak parçalar
  function card(cls, ...kids) { return h('section', { class: `card ${cls || ''}` }, ...kids); }
  function title(text, sub) {
    return [h('h1', { class: 'title' }, text), sub ? h('p', { class: 'sub' }, sub) : null];
  }
  function teamBadge(team) {
    const t = TEAM[team] || { name: team, emoji: '' };
    return h('span', { class: `team-badge team-${team}` }, `${t.emoji} ${t.name}`);
  }
  function roleMini(role) {
    if (!role) return h('span', { class: 'role-mini hidden-role' }, 'Rol gizli');
    return h('span', { class: `role-mini team-${role.team}` }, `${role.emoji} ${role.name}`);
  }
  function playerRow(p, extra = {}) {
    const me = S.view.me;
    return h('li', { class: `prow ${p.alive ? '' : 'dead'} ${extra.cls || ''}` },
      avatar(p.avatar),
      h('span', { class: 'pname' }, p.name, me && p.id === me.id ? h('small', { class: 'you' }, ' (sen)') : null),
      p.alive ? null : h('span', { class: 'tomb', 'aria-label': 'ölü' }, '✝'),
      !p.alive && extra.showRole !== false ? roleMini(p.role) : null,
      p.connected === false && p.alive ? h('span', { class: 'offline', title: 'Bağlantısı yok' }, 'çevrimdışı') : null,
      extra.right || null);
  }
  function playersList(players, opts = {}) {
    const alive = players.filter((p) => p.alive);
    const dead = players.filter((p) => !p.alive);
    return h('div', { class: 'plist-wrap' },
      h('h3', { class: 'section-title' }, opts.title || `Köy (${alive.length} hayatta${dead.length ? `, ${dead.length} ölü` : ''})`),
      h('ul', { class: 'plist' }, [...alive, ...dead].map((p) => playerRow(p))));
  }
  /** Rapor kartı: ölüm kartları + (kartlarda olmayan) ek duyuru satırları. */
  function reportCard(text, deaths) {
    let rest = text || '';
    for (const d of deaths) rest = rest.replace(d.text, '');
    rest = rest.trim();
    return card('report',
      rest ? h('p', { class: 'report-text' }, rest) : null,
      deaths.length ? deathCards(deaths) : null);
  }
  function deathCards(deaths) {
    return h('ul', { class: 'deaths' }, deaths.map((d) => {
      const p = playerById(d.playerId);
      const role = p && p.role;
      return h('li', { class: 'death' },
        avatar(d.avatar, 'lg'),
        h('div', { class: 'death-body' },
          h('strong', null, d.name),
          h('p', null, d.text),
          role ? roleMini(role) : h('span', { class: 'role-mini hidden-role' }, 'Rolü gizli kaldı')));
    }));
  }
  function whispers(v, filter) {
    const entries = (v.me.log || []).filter(filter);
    if (!entries.length) return null;
    return card('whisper',
      h('h3', { class: 'section-title' }, '🕯️ Sana fısıldananlar'),
      h('ul', { class: 'log' }, entries.map((e) => h('li', null, e.text))));
  }
  function btn(text, props = {}) { return h('button', { ...props, type: 'button', class: `btn ${props.class || ''}` }, text); }

  // ------------------------------------------------------------------ ekranlar
  const SCREENS = {
    loading() {
      return card('center', h('div', { class: 'candle', 'aria-hidden': 'true' }, '🕯️'), h('p', { class: 'sub' }, 'Köye bağlanılıyor…'));
    },

    join(v) {
      const root = h('div', { class: 'join' });
      root.append(h('div', { class: 'brand' },
        h('div', { class: 'brand-mark', 'aria-hidden': 'true' }, '🦇'),
        h('h1', { class: 'brand-title' }, 'Vampir Köylü'),
        h('p', { class: 'sub' }, 'Karanlık çöküyor. Adını yaz ve maskeni seç.')));
      root.append(h('p', { class: 'notice', id: 'joinNotice', hidden: true }));
      const form = h('form', { class: 'card join-form', id: 'joinForm', autocomplete: 'off', novalidate: true });
      const input = h('input', {
        id: 'nameInput', class: 'input', type: 'text', maxlength: String(MAX_NAME), placeholder: 'Örn. Musa',
        autocomplete: 'off', autocapitalize: 'words', spellcheck: 'false', enterkeyhint: 'done', 'aria-describedby': 'nameCount',
      });
      input.value = ui.name;
      input.addEventListener('input', () => { ui.name = input.value.slice(0, MAX_NAME); updateJoin(root); });
      form.append(
        h('label', { for: 'nameInput', class: 'label' }, 'Adın'),
        h('div', { class: 'input-wrap' }, input, h('span', { id: 'nameCount', class: 'count' })),
        h('div', { class: 'label', id: 'avatarLabel' }, 'Maskeni seç'),
        h('div', { class: 'gallery', id: 'gallery', role: 'radiogroup', 'aria-labelledby': 'avatarLabel' },
          S.avatars.map((a) => {
            const b = h('button', { type: 'button', class: 'av-btn', role: 'radio', 'data-id': a.id, 'aria-label': a.id }, a.emoji);
            b.addEventListener('click', () => { ui.avatar = a.id; updateJoin(root); });
            return b;
          })),
        h('button', { type: 'submit', class: 'btn primary block', id: 'joinBtn' }, 'Köye katıl'),
        h('p', { class: 'hint', id: 'joinHint' }));
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const name = ui.name.trim();
        if (!name || !ui.avatar || S.joining) return;
        S.joining = send({ type: 'join', name, avatar: ui.avatar });
        updateJoin(root);
      });
      root.append(form);
      root.append(h('div', { class: 'card lobby-mini', id: 'joinPlayers' }));
      updateJoin(root);
      return root;
    },

    lobby(v) {
      const n = v.players.length;
      return h('div', null,
        card('center',
          h('div', { class: 'candle', 'aria-hidden': 'true' }, '🕯️'),
          ...title(`Hoş geldin, ${v.me.name}`, 'Moderatör oyunu başlatınca rolün burada belirecek. Telefonunu kimseye gösterme.'),
          h('p', { class: 'waiting' }, h('span', { class: 'dots', 'aria-hidden': 'true' }), 'Oyunun başlaması bekleniyor')),
        card('', h('h3', { class: 'section-title' }, `Köydekiler (${n})`),
          h('ul', { class: 'pgrid' }, v.players.map((p) => h('li', { class: `pchip ${p.id === v.me.id ? 'me' : ''} ${p.connected ? '' : 'off'}` },
            avatar(p.avatar), h('span', { class: 'pname' }, p.name))))));
    },

    rolereveal(v) {
      return h('div', null,
        ...title('Kaderin belirlendi', 'Kartına dokun, rolünü kimseye göstermeden oku.'),
        roleCard(v.me, { flippable: true }),
        h('p', { class: 'hint center' }, 'Moderatör geceyi başlatınca ekran değişecek. Rolünü daha sonra üstteki 🎴 Rolüm düğmesinden görebilirsin.'));
    },

    night(v) { return nightScreen(v); },

    dawn(v) {
      const r = v.report || { deaths: [], text: '' };
      return h('div', null,
        ...title('Şafak söktü', `${v.day}. gecenin ardından köy uyanıyor…`),
        reportCard(r.text, r.deaths),
        sideCard(v),
        whispers(v, (e) => e.day === v.day && e.phase === 'night'),
        playersList(v.players));
    },

    day(v) {
      const dawn = S.lastDawn && S.lastDawn.day === v.day ? S.lastDawn : null;
      return h('div', null,
        ...title('Gündüz', 'Konuşun, sorgulayın, şüphelenin. Süre bitince ya da herkes "geçelim" deyince oylama açılır.'),
        dawn ? card('recap', h('h3', { class: 'section-title' }, 'Bu sabah'), h('p', null, dawn.text)) : null,
        sideCard(v),
        skipCard(v),
        dayAbilitySection(v),
        playersList(v.players),
        logButtonCard(v));
    },

    vote(v) { return voteScreen(v); },

    voteresult(v) {
      const r = v.report || { tally: [], abstain: 0, text: '' };
      return h('div', null,
        ...title('Köyün kararı'),
        reportCard(r.text, r.eliminated ? [r.eliminated] : []),
        sideCard(v),
        tallyCard(r),
        dayAbilitySection(v),
        playersList(v.players));
    },

    ended(v) {
      const w = v.winner;
      if (!w) return card('center', ...title('Oyun bitti'));
      const won = v.me && w.winners.includes(v.me.id);
      const team = TEAM[w.team] || { name: 'Kazanan', emoji: '🏆' };
      return h('div', null,
        card(`center finale team-${w.team}`,
          h('div', { class: 'finale-emoji', 'aria-hidden': 'true' }, team.emoji),
          h('h1', { class: 'title' }, w.team === 'tarafsiz' ? 'Tarafsız zafer' : `${team.name} kazandı`),
          h('p', { class: 'sub' }, w.reason),
          v.me ? h('p', { class: `verdict ${won ? 'won' : 'lost'}` }, won ? '🏆 Kazandın!' : '🥀 Kaybettin') : null),
        card('', h('h3', { class: 'section-title' }, 'Maskeler düştü'),
          h('ul', { class: 'plist reveal' }, w.reveal.map((p) => h('li', { class: `prow ${p.alive ? '' : 'dead'} ${w.winners.includes(p.id) ? 'winner' : ''}` },
            avatar(p.avatar),
            h('span', { class: 'pname' }, p.name, v.me && p.id === v.me.id ? h('small', { class: 'you' }, ' (sen)') : null),
            p.alive ? null : h('span', { class: 'tomb', 'aria-label': 'ölü' }, '✝'),
            roleMini(p.role),
            w.winners.includes(p.id) ? h('span', { class: 'crown', 'aria-label': 'kazanan' }, '👑') : null)))),
        h('p', { class: 'hint center' }, 'Moderatör yeni oyun başlatırsa aynı adla lobiye dönersin.'));
    },

    dead(v) {
      const r = (v.phase === 'dawn' || v.phase === 'voteresult') ? v.report : null;
      const dead = r ? (r.deaths && r.deaths.length ? r.deaths : r.eliminated ? [r.eliminated] : []) : [];
      return h('div', null,
        card('center grave',
          h('div', { class: 'grave-stone', 'aria-hidden': 'true' }, '🪦'),
          h('h1', { class: 'title' }, 'Öldün'),
          h('p', { class: 'sub' }, 'Artık sadece izleyebilirsin. Ölüler konuşmaz — bildiklerini kendine sakla.')),
        h('h2', { class: 'spectate-title' }, `👁️ İzleyici · ${PHASE_NAMES[v.phase] || ''}${v.day ? ` · ${v.day}. gün` : ''}`),
        r ? reportCard(r.text, dead) : null,
        r && r.kind === 'vote' ? tallyCard(r) : null,
        v.phase === 'vote' ? card('', h('p', null, `Köy oy veriyor… ${v.votesCast || 0} / ${v.players.filter((p) => p.alive).length} oy kullanıldı.`)) : null,
        v.phase === 'night' ? card('', h('p', null, 'Köy uyuyor. Gölgeler dolaşıyor…')) : null,
        playersList(v.players));
    },
  };

  function tallyCard(r) {
    const tally = r.tally || [];
    const max = Math.max(1, ...tally.map((t) => t.count), r.abstain || 0);
    return card('', h('h3', { class: 'section-title' }, 'Oylar'),
      h('ul', { class: 'tally' },
        tally.map((t) => {
          const p = playerById(t.playerId) || { name: '?', avatar: null };
          return tallyRow(avatar(p.avatar), p.name, t.count, max);
        }),
        r.abstain ? tallyRow(h('span', { class: 'avatar', 'aria-hidden': 'true' }, '🤐'), 'Pas / oy vermedi', r.abstain, max) : null),
      !tally.length && !r.abstain ? h('p', { class: 'hint' }, 'Hiç oy kullanılmadı.') : null);
  }

  function tallyRow(av, name, count, max) {
    const bar = h('span', { class: 'bar' });
    bar.style.width = `${Math.round((count / max) * 100)}%`;
    return h('li', { class: 'trow' }, av, h('span', { class: 'pname' }, name), h('span', { class: 'bar-wrap' }, bar), h('b', { class: 'tcount' }, String(count)));
  }

  function logButtonCard(v) {
    const n = (v.me.log || []).length;
    return h('button', { type: 'button', class: 'btn ghost block', onclick: () => openSheet('log') }, `📜 Günlüğüm (${n} not)`);
  }

  // ---- katılım ekranını yerinde güncelle (yazarken odak kaybolmasın)
  function updateJoin(root) {
    const v = S.view;
    const taken = new Map((v ? v.players : []).map((p) => [p.avatar, p.name]));
    if (ui.avatar && taken.has(ui.avatar)) ui.avatar = null;
    const inLobby = !v || v.phase === 'lobby';
    root.querySelectorAll('.av-btn').forEach((b) => {
      const id = b.dataset.id;
      const isTaken = taken.has(id);
      b.disabled = isTaken || !inLobby;
      b.classList.toggle('taken', isTaken);
      b.classList.toggle('selected', ui.avatar === id);
      b.setAttribute('aria-checked', ui.avatar === id ? 'true' : 'false');
      b.title = isTaken ? `${taken.get(id)} seçti` : '';
    });
    const count = root.querySelector('#nameCount');
    if (count) count.textContent = `${ui.name.length}/${MAX_NAME}`;
    const nameTaken = v && v.players.some((p) => p.name.toLocaleLowerCase('tr') === ui.name.trim().replace(/\s+/g, ' ').toLocaleLowerCase('tr'));
    const ok = inLobby && ui.name.trim() && ui.avatar && !nameTaken && !S.joining;
    const btnEl = root.querySelector('#joinBtn');
    if (btnEl) { btnEl.disabled = !ok; btnEl.textContent = S.joining ? 'Katılıyor…' : 'Köye katıl'; }
    const hint = root.querySelector('#joinHint');
    if (hint) {
      hint.textContent = !inLobby ? 'Oyun şu an devam ediyor. Bir sonraki oyunda katılabilirsin.'
        : nameTaken ? 'Bu ad zaten alınmış.'
          : !ui.name.trim() ? 'Önce adını yaz.' : !ui.avatar ? 'Bir maske seç.' : '';
    }
    const notice = root.querySelector('#joinNotice');
    if (notice) { notice.hidden = !S.notice; notice.textContent = S.notice || ''; }
    const list = root.querySelector('#joinPlayers');
    if (list) {
      list.replaceChildren(
        h('h3', { class: 'section-title' }, v ? `Köydekiler (${v.players.length})` : 'Köydekiler'),
        v && v.players.length
          ? h('ul', { class: 'pgrid' }, v.players.map((p) => h('li', { class: 'pchip' }, avatar(p.avatar), h('span', { class: 'pname' }, p.name))))
          : h('p', { class: 'hint' }, 'Henüz kimse yok. İlk sen ol!'));
    }
  }

  // ---- rol kartı
  function roleCard(me, { flippable = false } = {}) {
    const r = me.role;
    const face = h('div', { class: `role-face team-${r.team}` },
      h('div', { class: 'role-emoji', 'aria-hidden': 'true' }, r.emoji),
      h('h2', { class: 'role-name' }, r.name),
      h('div', { class: 'role-tags' }, teamBadge(r.team), h('span', { class: 'cat-badge' }, `Kategori: ${r.categoryLabel}`)),
      h('p', { class: 'role-desc' }, r.description),
      me.side ? h('p', { class: `side-note team-${me.side.team}` }, `${me.side.emoji} Artık gizlice ${me.side.name} tarafındasın: onlar kazanırsa sen de kazanırsın.`) : null,
      me.abilities.length ? h('ul', { class: 'abilities' }, me.abilities.map((a) => h('li', null,
        h('strong', null, `${a.phase === 'night' ? '🌙' : '☀️'} ${a.name}`),
        a.usesLeft != null ? h('span', { class: 'uses' }, ` · ${a.usesLeft} hak`) : null,
        h('br'), h('span', null, a.description)))) : null,
      me.teammates.length ? h('div', { class: 'mates' },
        h('h3', { class: 'section-title' }, '🩸 Kan kardeşlerin'),
        h('ul', { class: 'plist' }, me.teammates.map((t) => h('li', { class: `prow ${t.alive ? '' : 'dead'}` },
          avatar(t.avatar), h('span', { class: 'pname' }, t.name), roleMini(t.role))))) : null);
    if (!flippable) return h('div', { class: 'role-card open' }, face);
    const back = h('div', { class: 'role-back' },
      h('div', { class: 'role-back-sigil', 'aria-hidden': 'true' }, '🦇'),
      h('p', null, 'Rolünü görmek için dokun'));
    const wrap = h('button', { type: 'button', class: `role-card flip ${ui.roleOpen ? 'open' : ''}`, 'aria-pressed': ui.roleOpen ? 'true' : 'false', 'aria-label': ui.roleOpen ? 'Rolü gizle' : 'Rolünü göster' },
      h('div', { class: 'role-inner' }, back, face));
    wrap.addEventListener('click', () => {
      ui.roleOpen = !ui.roleOpen;
      wrap.classList.toggle('open', ui.roleOpen);
      wrap.setAttribute('aria-pressed', ui.roleOpen ? 'true' : 'false');
      wrap.setAttribute('aria-label', ui.roleOpen ? 'Rolü gizle' : 'Rolünü göster');
    });
    return wrap;
  }

  // ---- gece
  function nightScreen(v) {
    const me = v.me;
    if (!me.hasNightAbility) return nightWatchScreen(v);
    const abilities = me.abilities.filter((a) => a.phase === 'night');
    if (!ui.night.abilityId || !abilities.some((a) => a.id === ui.night.abilityId && a.usableNow)) {
      const first = abilities.find((a) => a.usableNow);
      ui.night.abilityId = first ? first.id : null;
    }
    const ab = abilities.find((a) => a.id === ui.night.abilityId) || null;
    const mateIds = new Set(me.teammates.map((t) => t.id));
    const candidates = v.players.filter((p) => p.alive);
    const disabledReason = (p) => {
      if (!ab) return 'x';
      if (p.id === me.id && !ab.allowSelf) return 'kendin';
      if (ab.excludeTeam && mateIds.has(p.id)) return 'kardeşin';
      return null;
    };
    if (ui.night.targetId && (!candidates.some((p) => p.id === ui.night.targetId) || disabledReason(playerById(ui.night.targetId)))) ui.night.targetId = null;

    const sent = me.nightSubmitted ? ui.nightSent : null;
    const dirty = !me.nightSubmitted || !sent || sent.kind !== 'choice' || sent.abilityId !== ui.night.abilityId || sent.targetId !== ui.night.targetId;

    let status;
    if (!me.nightSubmitted) status = h('p', { class: 'status pending' }, 'Henüz seçim yapmadın.');
    else if (sent && sent.kind === 'pass') status = h('p', { class: 'status ok' }, '🌙 Bu gece uyumayı seçtin. Gece bitene kadar fikrini değiştirebilirsin.');
    else if (sent && sent.kind === 'choice') {
      const t = playerById(sent.targetId);
      const a = abilities.find((x) => x.id === sent.abilityId);
      status = h('p', { class: 'status ok' }, `✔ Seçimin kaydedildi: ${a ? a.name : ''} → ${t ? t.name : ''}. Gece bitene kadar değiştirebilirsin.`);
    } else status = h('p', { class: 'status ok' }, '✔ Seçimin kaydedildi. Gece bitene kadar değiştirebilirsin.');

    const tabs = h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Yetenek seç' }, abilities.map((a) => {
      const b = h('button', {
        type: 'button', role: 'tab', class: `tab ${a.id === ui.night.abilityId ? 'active' : ''}`,
        'aria-selected': a.id === ui.night.abilityId ? 'true' : 'false', disabled: !a.usableNow,
      }, a.name, a.usesLeft != null ? h('small', null, ` (${a.usesLeft})`) : null);
      b.addEventListener('click', () => { ui.night.abilityId = a.id; ui.night.targetId = null; render(); });
      return b;
    }));

    const list = h('ul', { class: 'targets', role: 'radiogroup', 'aria-label': 'Hedef seç' }, candidates.map((p) => {
      const why = disabledReason(p);
      const sel = ui.night.targetId === p.id;
      const b = h('button', {
        type: 'button', role: 'radio', class: `target ${sel ? 'selected' : ''}`, 'aria-checked': sel ? 'true' : 'false', disabled: !!why,
      }, avatar(p.avatar), h('span', { class: 'pname' }, p.name, p.id === me.id ? h('small', { class: 'you' }, ' (sen)') : null),
      why === 'kardeşin' ? h('small', { class: 'tag' }, '🩸 kardeşin') : null,
      h('span', { class: 'check', 'aria-hidden': 'true' }, sel ? '✔' : ''));
      b.addEventListener('click', () => { ui.night.targetId = p.id; render(); });
      return h('li', null, b);
    }));

    const confirm = btn(me.nightSubmitted && !dirty ? 'Kaydedildi ✔' : 'Seçimi onayla', {
      class: 'primary block', disabled: !ui.night.targetId || !ab || !dirty,
      onclick: () => {
        const payload = { type: 'night', abilityId: ab.id, targetId: ui.night.targetId };
        if (send(payload)) ui.nightSent = { kind: 'choice', abilityId: ab.id, targetId: ui.night.targetId };
      },
    });
    const pass = btn('😴 Uyu / Pas geç', {
      class: 'ghost block', disabled: me.nightSubmitted && sent && sent.kind === 'pass',
      onclick: () => { if (send({ type: 'night', abilityId: '__pass' })) { ui.nightSent = { kind: 'pass' }; ui.night.targetId = null; } },
    });

    return h('div', null,
      ...title(`${v.day}. gece`, 'Köy uyurken herkes telefonuna bakıyor. Kimse kimin ne yaptığını bilmiyor.'),
      me.teammates.length ? card('mates-mini', h('span', { class: 'label' }, '🩸 Kardeşlerin: '),
        me.teammates.map((t) => h('span', { class: `mate ${t.alive ? '' : 'dead'}` }, avatar(t.avatar, 'sm'), t.name,
          t.alive ? h('small', null, ` → ${!t.choice ? 'seçmedi' : t.choice.pass ? 'uyuyor' : `${t.choice.abilityName}: ${t.choice.targetName}`}`) : null))) : null,
      card('night-card',
        tabs,
        h('p', { class: 'ability-desc' }, ab ? ab.description : 'Bu gece kullanabileceğin yetenek kalmadı.'),
        list,
        h('div', { class: 'actions' }, confirm, pass),
        status),
      me.nightSubmitted ? miniCard('Beklerken: gece nöbeti', 'Gece bitene kadar eşleri bul. Herkes telefonuyla meşgulken kimse kimin rolü olduğunu anlayamaz.') : null);
  }

  // ---- gece nöbeti: yeteneği olmayanların (ve seçimini yapmış herkesin) hafıza oyunu.
  // Oyuna hiçbir etkisi yoktur; amaç gece herkesin telefonla meşgul görünmesi. İlk turu bitiren köylü "hazır" sayılır.
  const MINI_EMOJI = ['🦇', '🌙', '🕯️', '🧄', '🔮', '🦉', '🐺', '💀', '🥀', '🗝️', '⚰️', '🕸️', '🍷', '🪦'];
  const MINI_PAIRS = 6;
  function newMiniBoard(prev) {
    const pool = [...MINI_EMOJI];
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    const picked = pool.slice(0, MINI_PAIRS);
    const cards = [...picked, ...picked].map((e) => ({ e, open: false, done: false }));
    for (let i = cards.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [cards[i], cards[j]] = [cards[j], cards[i]]; }
    return { cards, first: null, lock: false, moves: 0, rounds: prev ? prev.rounds : 0, won: false };
  }
  function flipMini(i) {
    const m = ui.mini;
    const c = m.cards[i];
    if (m.lock || m.won || c.open || c.done) return;
    c.open = true;
    if (m.first === null) { m.first = i; render(); return; }
    m.moves += 1;
    const a = m.cards[m.first];
    m.first = null;
    if (a.e === c.e) {
      a.done = true; c.done = true;
      if (m.cards.every((x) => x.done)) {
        m.won = true; m.rounds += 1;
        // yeteneği olmayan oyuncu ilk turu bitirince moderatöre "hazır" görünür
        const me = S.view && S.view.me;
        if (me && !me.hasNightAbility && !me.nightSubmitted) send({ type: 'night', abilityId: '__decoy' });
      }
      render();
      return;
    }
    m.lock = true;
    render();
    setTimeout(() => {
      if (ui.mini !== m) return; // gece bitti / yeni tur
      a.open = false; c.open = false; m.lock = false;
      render();
    }, 750);
  }
  function miniCard(titleText, desc) {
    if (!ui.mini) ui.mini = newMiniBoard();
    const m = ui.mini;
    const found = m.cards.filter((c) => c.done).length / 2;
    return card('mini-card',
      h('h3', { class: 'section-title' }, `🕯️ ${titleText}`),
      h('p', { class: 'ability-desc' }, desc),
      h('ul', { class: 'mini-grid', 'aria-label': 'Hafıza oyunu' }, m.cards.map((c, i) => {
        const shown = c.open || c.done;
        const b = h('button', {
          type: 'button', class: `mini-tile ${shown ? 'open' : ''} ${c.done ? 'done' : ''}`,
          'aria-label': shown ? c.e : 'kapalı kart', disabled: c.done,
        }, shown ? c.e : '');
        b.addEventListener('click', () => flipMini(i));
        return h('li', null, b);
      })),
      m.won
        ? h('div', { class: 'actions' },
          h('p', { class: 'status ok' }, `✔ Tüm eşleri ${m.moves} hamlede buldun!${m.rounds > 1 ? ` (bu gece ${m.rounds}. tur)` : ''}`),
          btn('🔁 Yeni tur', { class: 'ghost block', onclick: () => { ui.mini = newMiniBoard(m); render(); } }))
        : h('p', { class: 'hint' }, `${found} / ${MINI_PAIRS} eş bulundu · ${m.moves} hamle`));
  }
  function nightWatchScreen(v) {
    const me = v.me;
    return h('div', null,
      ...title(`${v.day}. gece`, 'Köy uyurken herkes telefonuna bakıyor. Kimse kimin ne yaptığını bilmiyor.'),
      sideCard(v),
      miniCard('Gece nöbeti', 'Mumların ışığında eşleri bul. Senin gece yeteneğin yok; bu nöbetle meşgulken kimse rolünü tahmin edemez.'),
      me.nightSubmitted
        ? h('p', { class: 'status ok' }, '✔ Hazırsın. Gece bitene kadar istediğin kadar tur oynayabilirsin.')
        : h('p', { class: 'status pending' }, 'Bir turu bitirince hazır sayılırsın.'));
  }

  // ---- Soytarı'ya sonradan verilen gizli taraf
  function sideCard(v) {
    const s = v.me && v.me.alive && v.me.side;
    if (!s) return null;
    return card(`side-card team-${s.team}`, h('h3', { class: 'section-title' }, `${s.emoji} Gizli tarafın: ${s.name}`),
      h('p', null, `${s.name} kazanırsa sen de kazanırsın, ölmüş olsan bile. Asılarak kazanamazsın artık. Kimseye belli etme.`));
  }

  // ---- gündüz: "oylamaya geç" (yaşayan herkes isterse oylama hemen başlar)
  function skipCard(v) {
    const me = v.me;
    if (!me || !me.alive || !v.skip) return null;
    const on = !!me.skipped;
    return card('skip-card',
      btn(on ? '✋ Vazgeç, konuşmaya devam' : '⏭️ Oylamaya geçelim', {
        class: `${on ? 'ghost' : 'primary'} block`,
        onclick: () => send({ type: 'skipDay', want: !on }),
      }),
      h('p', { class: 'hint center' }, `${v.skip.count} / ${v.skip.needed} kişi oylamaya geçmek istiyor`));
  }

  // ---- gündüz yeteneği
  function dayAbilitySection(v) {
    const me = v.me;
    if (!me || !me.alive) return null;
    const abs = me.abilities.filter((a) => a.phase === 'day');
    if (!abs.length) return null;
    return abs.map((ab) => {
      if (!ab.usableNow) {
        return card('ability-card spent', h('h3', { class: 'section-title' }, `🏹 ${ab.name}`),
          h('p', { class: 'hint' }, ab.usesLeft === 0 ? 'Hakkını kullandın.' : 'Şu an kullanılamaz.'));
      }
      const targets = v.players.filter((p) => p.alive && (ab.allowSelf || p.id !== me.id));
      const details = h('details', { class: 'card ability-card' },
        h('summary', null, h('span', null, `🏹 ${ab.name}`), ab.usesLeft != null ? h('small', null, ` · ${ab.usesLeft} hak`) : null),
        h('p', { class: 'ability-desc' }, ab.description),
        h('ul', { class: 'targets' }, targets.map((p) => {
          const sel = ui.shootTarget === p.id;
          const b = h('button', { type: 'button', class: `target ${sel ? 'selected' : ''}`, 'aria-pressed': sel ? 'true' : 'false' },
            avatar(p.avatar), h('span', { class: 'pname' }, p.name), h('span', { class: 'check', 'aria-hidden': 'true' }, sel ? '🎯' : ''));
          b.addEventListener('click', () => { ui.shootTarget = p.id; ui.dayOpen = true; render(); });
          return h('li', null, b);
        })),
        btn(`🎯 ${ab.name}`, {
          class: 'danger block', disabled: !ui.shootTarget,
          onclick: () => {
            const t = playerById(ui.shootTarget);
            if (!t) return;
            openConfirm({
              title: `${ab.name}?`,
              text: `${t.name} kişisine ateş etmek üzeresin. Bu geri alınamaz! Hedef masumsa o da sen de ölürsün. Sonuç şafakta duyurulur.`,
              ok: 'Evet, ateş et', danger: true,
              onOk: () => { send({ type: 'dayAbility', abilityId: ab.id, targetId: t.id }); ui.shootTarget = null; },
            });
          },
        }));
      if (ui.dayOpen) details.open = true;
      details.addEventListener('toggle', () => { ui.dayOpen = details.open; });
      return details;
    });
  }

  // ---- oylama
  function voteScreen(v) {
    const me = v.me;
    const current = ui.pendingVote !== undefined ? ui.pendingVote : me.myVote;
    const aliveCount = v.players.filter((p) => p.alive).length;
    const cast = (target) => {
      ui.pendingVote = target;
      if (!send({ type: 'vote', targetId: target })) ui.pendingVote = undefined;
      render();
    };
    const option = (key, content, selected, onclick, cls = '') => {
      const b = h('button', { type: 'button', role: 'radio', class: `target ${cls} ${selected ? 'selected' : ''}`, 'aria-checked': selected ? 'true' : 'false' }, content, h('span', { class: 'check', 'aria-hidden': 'true' }, selected ? '✔' : ''));
      b.addEventListener('click', onclick);
      return h('li', { 'data-key': key }, b);
    };
    const others = v.players.filter((p) => p.alive && p.id !== me.id);
    let status;
    if (current === undefined) status = 'Henüz oy vermedin (oy vermezsen pas sayılır).';
    else if (current === null) status = 'Pas dedin. Değiştirebilirsin.';
    else { const t = playerById(current); status = `Oyun: ${t ? t.name : '?'}. Herkes oy verene kadar değiştirebilirsin.`; }
    return h('div', null,
      ...title('Oylama', 'Kim köyden atılsın? Oyun gizlidir; sonuçta sadece toplamlar görünür.'),
      h('p', { class: 'progress' }, `${v.votesCast || 0} / ${aliveCount} kişi oy verdi`),
      card('vote-card',
        h('ul', { class: 'targets', role: 'radiogroup', 'aria-label': 'Oy ver' },
          others.map((p) => option(p.id, [avatar(p.avatar), h('span', { class: 'pname' }, p.name)], current === p.id, () => cast(p.id))),
          option('abstain', [h('span', { class: 'avatar', 'aria-hidden': 'true' }, '🤐'), h('span', { class: 'pname' }, 'Pas')], current === null, () => cast(null), 'abstain')),
        h('p', { class: `status ${current === undefined ? 'pending' : 'ok'}` }, ui.pendingVote !== undefined ? 'Gönderiliyor…' : status)),
      dayAbilitySection(v));
  }

  // ------------------------------------------------------------------ alt sayfa (rol / günlük / onay)
  function openSheet(kind) {
    ui.sheet = kind;
    $('sheet').hidden = false;
    renderSheet();
    renderTop(S.view, S.screenKey);
    const close = $('sheet').querySelector('.close');
    if (close) close.focus();
  }
  function closeSheet() {
    ui.sheet = null; ui.confirm = null;
    $('sheet').hidden = true;
    if (S.view) renderTop(S.view, S.screenKey);
  }
  function openConfirm(opts) { ui.confirm = opts; openSheet('confirm'); }

  function renderSheet() {
    const v = S.view;
    const body = $('sheetBody');
    const titleEl = $('sheetTitle');
    if (!v || !v.me) return closeSheet();
    if (ui.sheet === 'role') {
      if (!v.me.role) return closeSheet();
      titleEl.textContent = 'Rolüm';
      body.replaceChildren(roleCard(v.me));
    } else if (ui.sheet === 'log') {
      titleEl.textContent = 'Günlüğüm';
      const log = v.me.log || [];
      save(`vk_seen_${v.me.id}`, String(log.length));
      body.replaceChildren(log.length
        ? h('ul', { class: 'log full' }, [...log].reverse().map((e) => h('li', null,
          h('small', { class: 'log-when' }, `${e.day}. ${e.phase === 'night' ? 'gece' : e.phase === 'day' || e.phase === 'vote' ? 'gün' : (PHASE_NAMES[e.phase] || '').toLocaleLowerCase('tr')}`),
          h('span', null, e.text))))
        : h('p', { class: 'hint' }, 'Henüz sana özel bir bildirim yok. Gece öğrendiklerin burada birikir.'));
    } else if (ui.sheet === 'confirm' && ui.confirm) {
      const c = ui.confirm;
      titleEl.textContent = c.title;
      body.replaceChildren(
        h('p', { class: 'confirm-text' }, c.text),
        h('div', { class: 'actions row' },
          btn('Vazgeç', { class: 'ghost', onclick: closeSheet }),
          btn(c.ok, { class: c.danger ? 'danger' : 'primary', onclick: () => { const f = c.onOk; closeSheet(); f(); } })));
    } else closeSheet();
  }

  $('sheet').addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeSheet(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && ui.sheet) closeSheet(); });
  $('btnRole').addEventListener('click', () => openSheet('role'));
  $('btnLog').addEventListener('click', () => openSheet('log'));

  // ------------------------------------------------------------------ başlat
  fetch('/api/avatars').then((r) => r.json()).then((list) => {
    if (Array.isArray(list) && list.length) { S.avatars = list; if (S.screenKey === 'join') S.screenKey = null; if (S.view) render(); }
  }).catch(() => { /* yedek liste kullanılır */ });
  setConnBand();
  render();
  connect();
})();
