/* Vampir Köylü — ortak ekran (TV). Sadece herkese açık görünümü (publicView) gösterir; hiçbir şey göndermez.
 * GÜVENLİK: kullanıcı verisi SADECE textContent / text node ile yazılır. innerHTML kullanılmaz. */
(() => {
  'use strict';

  const TEAM = {
    koylu: { name: 'Köylüler', emoji: '🏘️', win: 'KÖYLÜLER KAZANDI' },
    vampir: { name: 'Vampirler', emoji: '🧛', win: 'VAMPİRLER KAZANDI' },
    tarafsiz: { name: 'Tarafsızlar', emoji: '🎭', win: 'TARAFSIZ KAZANDI' },
  };
  const SKY = { lobby: 'dusk', rolereveal: 'dusk', night: 'night', dawn: 'dawn', day: 'day', vote: 'day', voteresult: 'day' };
  const FALLBACK_AVATARS = [['vampir', '🧛'], ['cadi', '🧙'], ['peri', '🧚'], ['elf', '🧝'], ['zombi', '🧟'], ['hayalet', '👻'],
    ['yarasa', '🦇'], ['kurt', '🐺'], ['baykus', '🦉'], ['kuzgun', '🐦‍⬛'], ['kedi', '🐈‍⬛'], ['yilan', '🐍'], ['orumcek', '🕷️'],
    ['kurukafa', '💀'], ['mum', '🕯️'], ['kabak', '🎃'], ['gul', '🥀'], ['ay', '🌙'], ['yildiz', '⭐'], ['ates', '🔥'],
    ['kilic', '🗡️'], ['kalkan', '🛡️'], ['kristal', '🔮'], ['mantar', '🍄']].map(([id, emoji]) => ({ id, emoji }));

  const S = {
    ws: null, connected: false, everConnected: false, retry: 0, retryTimer: null,
    view: null, offset: 0, avatars: FALLBACK_AVATARS,
    sceneKey: null, sig: null, seen: new Set(),
  };

  // ------------------------------------------------------------------ DOM yardımcıları
  const $ = (id) => document.getElementById(id);
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k.startsWith('--')) el.style.setProperty(k, String(v));
        else if (v === true) el.setAttribute(k, '');
        else el.setAttribute(k, String(v));
      }
    }
    for (const c of kids.flat(Infinity)) {
      if (c == null || c === false) continue;
      el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return el;
  }
  const avatarEmoji = (id) => (S.avatars.find((a) => a.id === id) || { emoji: '❔' }).emoji;
  const avatar = (id) => h('span', { class: 'avatar', 'aria-hidden': 'true' }, avatarEmoji(id));
  const playerById = (id) => (S.view && S.view.players.find((p) => p.id === id)) || null;

  fetch('/api/avatars').then((r) => r.json()).then((a) => { if (Array.isArray(a) && a.length) { S.avatars = a; if (S.view) render(true); } }).catch(() => {});

  // ------------------------------------------------------------------ yıldızlar (bir kez, satır içi SVG)
  (function stars() {
    const svg = $('stars');
    const NS = 'http://www.w3.org/2000/svg';
    let seed = 42;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 0x100000000; };
    for (let i = 0; i < 170; i++) {
      const c = document.createElementNS(NS, 'circle');
      c.setAttribute('cx', (rnd() * 1600).toFixed(1));
      c.setAttribute('cy', (rnd() * 900).toFixed(1));
      c.setAttribute('r', (rnd() < 0.08 ? 1.9 : 0.5 + rnd() * 1.1).toFixed(2));
      c.setAttribute('opacity', (0.35 + rnd() * 0.65).toFixed(2));
      const k = rnd();
      if (k < 0.18) c.setAttribute('class', 'tw'); else if (k < 0.3) c.setAttribute('class', 'tw2');
      svg.append(c);
    }
  })();

  // ------------------------------------------------------------------ bağlantı
  function connect() {
    clearTimeout(S.retryTimer);
    if (S.ws && (S.ws.readyState === 0 || S.ws.readyState === 1)) return;
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    let ws;
    try { ws = new WebSocket(`${proto}//${location.host}/ws?as=ekran`); } catch { return scheduleReconnect(); }
    S.ws = ws;
    ws.onopen = () => { S.connected = true; S.everConnected = true; S.retry = 0; setConnBand(); };
    ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.type === 'state') {
        S.offset = (msg.serverNow || Date.now()) - Date.now();
        S.view = msg.view;
        render(false);
      }
    };
    ws.onclose = () => {
      if (S.ws !== ws) return;
      S.connected = false;
      setConnBand();
      scheduleReconnect();
    };
    ws.onerror = () => {};
  }
  function scheduleReconnect() {
    clearTimeout(S.retryTimer);
    const base = Math.min(6000, 500 * 2 ** S.retry);
    S.retry = Math.min(S.retry + 1, 8);
    S.retryTimer = setTimeout(connect, base * (0.75 + Math.random() * 0.5));
  }
  function setConnBand() {
    const band = $('conn');
    band.hidden = S.connected;
    band.textContent = S.everConnected ? 'Sunucu bağlantısı koptu — yeniden bağlanılıyor…' : 'Sunucuya bağlanılıyor…';
  }

  // ------------------------------------------------------------------ zamanlayıcı
  function tick() {
    const el = $('timer');
    const v = S.view;
    if (!v || !v.phaseEndsAt || !['night', 'dawn', 'day', 'vote', 'voteresult'].includes(v.phase)) { el.hidden = true; return; }
    el.hidden = false;
    const left = Math.round((v.phaseEndsAt - (Date.now() + S.offset)) / 1000);
    if (left <= 0) { el.textContent = 'Süre doldu'; el.className = 'timer over'; return; }
    const m = Math.floor(left / 60), s = left % 60;
    el.textContent = `${m}:${String(s).padStart(2, '0')}`;
    el.className = left <= 10 ? 'timer low' : 'timer';
  }
  setInterval(tick, 500);

  // ------------------------------------------------------------------ çizim
  function phaseTitle(v) {
    switch (v.phase) {
      case 'lobby': return 'Oyuncular toplanıyor';
      case 'rolereveal': return 'Roller dağıtıldı';
      case 'night': return `${v.day}. Gece`;
      case 'dawn': return `${v.day}. Gecenin sabahı`;
      case 'day': return `${v.day}. Gün · Tartışma`;
      case 'vote': return `${v.day}. Gün · Oylama`;
      case 'voteresult': return `${v.day}. Gün · Karar`;
      case 'ended': return 'Oyun bitti';
      default: return '';
    }
  }

  /** Sahnenin içeriğini belirleyen veri; değişmediyse yeniden çizilmez (animasyonlar tekrar oynamaz). */
  function signature(v) {
    const ps = v.players.map((p) => [p.id, p.name, p.avatar, p.alive, p.connected, p.role && p.role.id]);
    return JSON.stringify([v.phase, v.day, ps, v.report, v.votesCast, v.skip, v.winner && v.winner.team, v.roleCounts, v.joinUrl, S.avatars.length]);
  }

  function render(force) {
    const v = S.view;
    if (!v) return;
    let sky = SKY[v.phase] || 'dusk';
    if (v.phase === 'ended' && v.winner) sky = v.winner.team === 'vampir' ? 'blood' : 'dawn';
    document.body.dataset.sky = sky;
    document.body.dataset.phase = v.phase;
    $('phaseTitle').textContent = phaseTitle(v);
    tick();

    const key = `${v.phase}:${v.day}`;
    const sig = signature(v);
    const entering = key !== S.sceneKey;
    if (!entering && sig === S.sig && !force) return;
    S.sceneKey = key;
    S.sig = sig;
    const build = SCENES[v.phase] || SCENES.lobby;
    const view = h('section', { class: `view ph-${v.phase} ${entering ? 'enter' : ''}` }, build(v, entering));
    $('stage').replaceChildren(view);
    requestAnimationFrame(fitAll);
  }

  // ---- oyuncu ızgarası: kutuya taşmadan sığacak en büyük kart boyutu
  function fitAll() {
    for (const box of document.querySelectorAll('.fit')) {
      const grid = box.firstElementChild;
      if (!grid) continue;
      const n = grid.children.length;
      const W = box.clientWidth, H = box.clientHeight;
      if (!n || !W || !H) continue;
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      const gap = rem * (n > 16 ? 0.8 : 1.2);
      const maxW = rem * (Number(box.dataset.max) || 12);
      const ratio = 1.18;
      let best = { size: 0, cols: 1 };
      for (let cols = 1; cols <= n; cols++) {
        const rows = Math.ceil(n / cols);
        const cw = (W - gap * (cols - 1)) / cols;
        const ch = (H - gap * (rows - 1)) / rows / ratio;
        const size = Math.min(cw, ch, maxW);
        if (size > best.size + 0.5) best = { size, cols };
      }
      grid.style.setProperty('--cols', String(best.cols));
      grid.style.setProperty('--cw', `${Math.floor(best.size)}px`);
      grid.style.setProperty('--gap', `${gap}px`);
    }
  }
  window.addEventListener('resize', () => requestAnimationFrame(fitAll));

  function roleBadge(role) {
    if (!role) return null;
    return h('span', { class: `rb team-${role.team}` }, `${role.emoji} ${role.name}`);
  }

  function playerCard(p, opts = {}) {
    const isNew = opts.animateNew && !S.seen.has(p.id);
    S.seen.add(p.id);
    const cls = ['pcard', `team-${p.role ? p.role.team : ''}`];
    if (isNew) cls.push('new');
    if (!p.alive && !opts.ignoreDeath && opts.win !== true) cls.push('dead');
    if (p.connected === false && opts.showOffline) cls.push('off');
    if (opts.win === true) cls.push('win');
    if (opts.win === false) cls.push('lose');
    return h('div', { class: cls.join(' '), '--i': opts.i || 0 },
      opts.win === true ? h('span', { class: 'crown', 'aria-label': 'kazanan' }, '👑') : null,
      !p.alive && !opts.ignoreDeath ? h('span', { class: 'tomb', 'aria-label': 'ölü' }, '✝') : null,
      avatar(p.avatar),
      h('span', { class: 'nm' }, p.name),
      opts.role ? roleBadge(opts.role) : (!p.alive && !opts.ignoreDeath && p.role ? roleBadge(p.role) : null));
  }

  function grid(cards, max) {
    return h('div', { class: 'fit', 'data-max': max || 12 }, h('div', { class: 'pgrid' }, cards));
  }

  function roleChips(v) {
    if (!v.roleCounts || !v.roleCounts.length) return null;
    return h('div', { class: 'role-strip small' },
      h('span', null, 'Oyundaki roller:'),
      v.roleCounts.map((r) => h('span', { class: `chip team-${r.team}` }, `${r.emoji} `, h('b', null, `${r.count}`), ` ${r.name}`)));
  }

  function causeText(d) {
    const t = d.text || '';
    return t.startsWith(d.name) ? t.slice(d.name.length).trim() : t;
  }

  function deathCard(d, i) {
    const p = playerById(d.playerId);
    const role = d.roleId && p && p.role ? p.role : null;
    return h('div', { class: `dcard ${role ? `team-${role.team}` : ''}`, '--i': i },
      h('span', { class: 'cross', 'aria-hidden': 'true' }, '✝'),
      avatar(d.avatar),
      h('div', { class: 'nm' }, d.name),
      h('div', { class: 'cause' }, causeText(d)),
      role
        ? h('div', { class: `rolebox team-${role.team}` }, h('span', { class: 'em' }, role.emoji), h('span', { class: 'rn' }, role.name), h('span', { class: 'tn' }, role.teamName))
        : h('div', { class: 'rolebox hid' }, h('span', { class: 'em' }, '🕯️'), h('span', { class: 'rn' }, 'Rolü gizli kaldı')));
  }

  const SCENES = {
    lobby(v) {
      const n = v.players.length;
      const right = h('div', { class: 'lobby-right' },
        h('div', { class: 'lobby-head' }, h('span', { class: 'big-count' }, String(n)), h('span', { class: 'lbl' }, n === 1 ? 'oyuncu hazır' : 'oyuncu hazır')),
        n
          ? grid(v.players.map((p) => playerCard(p, { animateNew: true, showOffline: true, ignoreDeath: true })), 11)
          : h('div', { class: 'waiting' }, h('div', { class: 'candle', 'aria-hidden': 'true' }, '🕯️'), 'Oyuncular bekleniyor…'),
        h('div', { class: 'lobby-foot' }, n < 4 ? `Oyun için en az 4 oyuncu gerekli.` : 'Herkes katılınca moderatör oyunu başlatacak.'));
      return h('div', { class: 'lobby' },
        h('div', { class: 'qr-card glass' },
          h('div', { class: 'cap' }, 'Katılmak için telefonla okut'),
          h('img', { class: 'qr-img', src: `/api/qr.svg?u=${encodeURIComponent(v.joinUrl || '')}`, alt: 'Katılım QR kodu' }),
          h('div', { class: 'join-url' }, (v.joinUrl || '').replace(/^https?:\/\//, '').replace(/\/$/, '')),
          // Wi-Fi uyarısı sadece yerel ağda oynarken (adres bir IP ise); internette yayınlarken gereksiz
          /^http:\/\/\d{1,3}(\.\d{1,3}){3}[:/]/.test(v.joinUrl || '') && h('div', { class: 'tip' }, '📶 Telefonun bu bilgisayarla aynı Wi-Fi ağında olsun')),
        right);
    },

    rolereveal(v) {
      const rc = v.roleCounts || [];
      return h('div', { class: 'center-col' },
        h('div', { class: 'shh', 'aria-hidden': 'true' }, '🤫'),
        h('h1', { class: 'h1 lg' }, 'Herkes rolüne baksın'),
        h('p', { class: 'lead' }, 'Telefonundaki kartı çevir — rolünü kimseye gösterme!'),
        rc.length
          ? h('div', { class: 'role-strip' }, rc.map((r, i) => h('div', { class: `rcard team-${r.team}`, '--i': i },
            h('div', { class: 'em' }, r.emoji), h('div', { class: 'cnt' }, `× ${r.count}`), h('div', { class: 'nm' }, r.name),
            h('div', { class: 'tm' }, (TEAM[r.team] || {}).name || ''))))
          : h('div', { class: 'sigil', 'aria-hidden': 'true' }, '🎴'),
        h('p', { class: 'lead muted' }, `${v.players.length} oyuncu · Gece birazdan çökecek…`));
    },

    night(v) {
      const alive = v.players.filter((p) => p.alive).length;
      return h('div', { class: 'center-col' },
        h('h1', { class: 'h1 xl night-title' }, 'Köy uyuyor', h('span', { class: 'dots' }, h('span', null, '.'), h('span', null, '.'), h('span', null, '.'))),
        h('p', { class: 'lead' }, 'Gözler kapansın. Telefonundan sessizce seçimini yap.'),
        h('div', { class: 'stat-row' },
          h('div', { class: 'stat glass' }, h('b', null, `${v.day}.`), h('span', null, 'gece')),
          h('div', { class: 'stat glass' }, h('b', null, String(alive)), h('span', null, 'kişi hayatta'))));
    },

    dawn(v) {
      const r = v.report || { deaths: [], text: '' };
      const deaths = r.deaths || [];
      let rest = r.text || '';
      for (const d of deaths) rest = rest.replace(d.text, '');
      rest = rest.replace('Bu gece kimse ölmedi.', '').trim();
      return h('div', { class: 'center-col' },
        h('h1', { class: 'h1 lg' }, 'Şafak söktü'),
        h('p', { class: 'lead muted' }, deaths.length ? (deaths.length === 1 ? 'Köy bu sabah bir kayıp verdi…' : `Köy bu sabah ${deaths.length} kayıp verdi…`) : 'Köy uyanıyor…'),
        deaths.length
          ? h('div', { class: `deaths ${deaths.length > 3 ? 'many' : ''}` }, deaths.map((d, i) => deathCard(d, i)))
          : h('div', { class: 'nodeath glass' }, h('div', { class: 'em' }, '🌅'), h('div', { class: 't' }, 'Bu gece kimse ölmedi'), h('div', { class: 's' }, 'Köy derin bir nefes aldı.')),
        rest ? h('p', { class: 'extra' }, rest) : null);
    },

    day(v) {
      const alive = v.players.filter((p) => p.alive).length;
      return [
        h('div', { class: 'day-head' },
          h('h1', { class: 'h1 md' }, 'Köy meydanında tartışma'),
          h('p', { class: 'lead muted' }, `${alive} kişi hayatta · Vampirler aranızda. Kimden şüpheleniyorsunuz?`),
          v.skip && v.skip.count ? h('p', { class: 'lead' }, `⏭️ ${v.skip.count}/${v.skip.needed} kişi oylamaya geçmek istiyor`) : null),
        grid(sortAliveFirst(v.players).map((p) => playerCard(p)), 10),
        h('div', { class: 'day-foot' }, roleChips(v)),
      ];
    },

    vote(v) {
      const alive = v.players.filter((p) => p.alive);
      const cast = Math.min(v.votesCast || 0, alive.length);
      const bar = h('i');
      bar.style.width = `${alive.length ? (cast / alive.length) * 100 : 0}%`;
      return [
        h('div', { class: 'vote-box glass' },
          h('h1', { class: 'h1 md' }, 'Oylama sürüyor'),
          h('div', { class: 'vote-count' }, h('b', null, `${cast} / ${alive.length}`), h('span', null, 'oy kullanıldı')),
          h('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': alive.length, 'aria-valuenow': cast }, bar),
          h('p', { class: 'lead muted' }, 'Oyunu telefonundan ver. Oylar gizlidir.')),
        grid(alive.map((p) => playerCard(p)), 8),
      ];
    },

    voteresult(v) {
      const r = v.report || { tally: [], abstain: 0 };
      const tally = [...(r.tally || [])].sort((a, b) => b.count - a.count);
      const total = tally.reduce((a, t) => a + t.count, 0) + (r.abstain || 0);
      const top = tally.length ? tally[0].count : 0;
      const tie = tally.length > 1 && tally[1].count === top;
      const shown = tally.slice(0, 8);
      const rows = shown.map((t, i) => {
        const p = playerById(t.playerId);
        const bar = h('i');
        bar.style.width = `${total ? (t.count / total) * 100 : 0}%`;
        return h('li', { class: `trow ${t.count === top && !tie ? 'top1' : ''}`, '--i': i },
          p ? avatar(p.avatar) : h('span'), h('span', { class: 'nm' }, p ? p.name : '?'), h('span', { class: 'bw' }, bar), h('span', { class: 'n' }, String(t.count)));
      });
      if (r.abstain) {
        const bar = h('i');
        bar.style.width = `${total ? (r.abstain / total) * 100 : 0}%`;
        rows.push(h('li', { class: 'trow abst', '--i': rows.length }, h('span', { class: 'avatar', 'aria-hidden': 'true' }, '🤐'), h('span', { class: 'nm' }, 'Pas'), h('span', { class: 'bw' }, bar), h('span', { class: 'n' }, String(r.abstain))));
      }
      if (!rows.length) rows.push(h('li', { class: 'lead muted' }, 'Kimse oy kullanmadı.'));
      const e = r.eliminated;
      return h('div', { class: 'vr' },
        h('div', { class: 'tally-box glass' },
          h('h3', null, 'Oylama sonucu'),
          h('ul', { class: 'tally' }, rows),
          tally.length > shown.length ? h('p', { class: 'lead muted' }, `+${tally.length - shown.length} kişi daha oy aldı`) : null),
        h('div', { class: 'vr-right' },
          e
            ? [h('h1', { class: 'h1 md' }, 'Köy kararını verdi'), h('div', { class: 'deaths' }, deathCard(e, 0))]
            : h('div', { class: 'nodeath glass' }, h('div', { class: 'em' }, '⚖️'), h('div', { class: 't' }, 'Kimse elenmedi'),
              h('div', { class: 's' }, tie ? 'Oylar eşit çıktı.' : 'Çoğunluk sağlanamadı.'))));
    },

    ended(v) {
      const w = v.winner;
      if (!w) return h('div', { class: 'center-col' }, h('h1', { class: 'h1 lg' }, 'Oyun bitti'));
      const t = TEAM[w.team] || { emoji: '🏆', win: 'KAZANAN' };
      const winners = new Set(w.winners || []);
      const names = (w.reveal || []).filter((p) => winners.has(p.id)).map((p) => p.name);
      const title = w.team === 'tarafsiz' ? `${names.join(', ')} KAZANDI` : t.win;
      const reveal = [...(w.reveal || [])].sort((a, b) => (winners.has(b.id) - winners.has(a.id)));
      return h('div', { class: 'end' },
        h('div', { class: `end-banner glass team-${w.team}` },
          h('span', { class: 'em', 'aria-hidden': 'true' }, t.emoji),
          h('div', null, h('div', { class: 't' }, title), h('div', { class: 'r' }, w.reason))),
        grid(reveal.map((p, i) => playerCard(p, { win: winners.has(p.id), role: p.role, i, ignoreDeath: false })), 10));
    },
  };

  function sortAliveFirst(ps) { return [...ps].sort((a, b) => b.alive - a.alive); }

  // ------------------------------------------------------------------ tam ekran ipucu
  (function f11() {
    const el = $('f11');
    const full = () => document.fullscreenElement || (window.innerHeight >= screen.height - 2 && window.innerWidth >= screen.width - 2);
    if (!full()) {
      el.hidden = false;
      setTimeout(() => el.classList.add('fade'), 7000);
      setTimeout(() => { el.hidden = true; }, 8500);
    }
    document.addEventListener('dblclick', () => {
      try {
        if (document.fullscreenElement) document.exitFullscreen();
        else document.documentElement.requestFullscreen();
      } catch { /* desteklenmiyor */ }
    });
    // fare bir süre kıpırdamazsa imleci gizle
    let idle;
    document.addEventListener('mousemove', () => {
      document.body.classList.remove('idle');
      clearTimeout(idle);
      idle = setTimeout(() => document.body.classList.add('idle'), 3000);
    });
  })();

  setConnBand();
  connect();
})();
