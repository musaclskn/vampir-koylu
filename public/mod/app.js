/* Vampir Köylü — moderatör paneli. Build adımı yok, vanilla JS.
 * GÜVENLİK: kullanıcı verisi (oyuncu adları vb.) SADECE textContent / text node ile yazılır. innerHTML kullanılmaz. */
(() => {
  'use strict';

  // ------------------------------------------------------------------ sabitler
  const PHASE_NAMES = {
    lobby: 'Lobi', rolereveal: 'Roller dağıtıldı', night: 'Gece', dawn: 'Şafak', day: 'Gündüz',
    vote: 'Oylama', voteresult: 'Oylama sonucu', ended: 'Oyun bitti',
  };
  const TEAM = {
    koylu: { name: 'Köylüler', emoji: '🏘️', win: 'Köylüler kazandı' },
    vampir: { name: 'Vampirler', emoji: '🧛', win: 'Vampirler kazandı' },
    tarafsiz: { name: 'Tarafsızlar', emoji: '🎭', win: 'Tarafsız kazandı' },
  };
  const CAUSE = {
    vampir: 'Vampir saldırısı', oy: 'Oylamayla elendi', avci: 'Avcı vurdu',
    avci_pismanlik: 'Avcı (yanlış atış)', atildi: 'Oyundan çıkarıldı',
  };
  const DURATIONS = [
    { key: 'night', label: 'Gece', sub: 'Gece yetenekleri' },
    { key: 'day', label: 'Gündüz', sub: 'Tartışma' },
    { key: 'vote', label: 'Oylama', sub: 'Oy verme' },
  ];
  const PRESETS = {
    hizli: { night: 45, day: 120, vote: 30 },
    normal: { night: 90, day: 300, vote: 60 },
    uzun: { night: 120, day: 480, vote: 90 },
  };
  const OPTIONS = [
    { key: 'revealRoleOnDeath', title: 'Ölünce rol açıklansın', desc: 'Ölen ya da elenen oyuncunun rolü herkese gösterilir (Temizlikçi gizlediyse hariç).' },
    { key: 'announceSaves', title: 'Kurtarmalar duyurulsun', desc: 'Doktor birini kurtardığında sabah "biri saldırıya uğradı ama kurtuldu" denir (kim olduğu söylenmez).' },
    { key: 'showRoleCounts', title: 'Rol adetleri gösterilsin', desc: 'Oyun başlayınca ortak ekranda hangi rolden kaç tane olduğu görünür (kimde olduğu değil).' },
  ];
  const ADV_LOCK_MS = 1200;
  const ARM_MS = 5000;

  // ------------------------------------------------------------------ durum
  const S = {
    ws: null, connected: false, everConnected: false, retry: 0, retryTimer: null,
    view: null, offset: 0, info: null,
    draft: null, draftTimer: null, // rol adetleri: sunucu onaylayana kadar yerel taslak
    durDraft: null, durTimer: null,
    autoPending: false, // "Otomatik öner"e basıldı, sunucu onayı bekleniyor
    advArmed: false, advArmTimer: null, advLockUntil: 0,
    phaseKey: null, logCount: 0, roleRowsBuilt: false, prevN: null,
  };


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
    for (const c of kids.flat(Infinity)) {
      if (c == null || c === false) continue;
      el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return el;
  }
  const avatarEmoji = (id) => ((S.view && S.view.avatars || []).find((a) => a.id === id) || { emoji: '❔' }).emoji;
  const avatar = (id) => h('span', { class: 'avatar', 'aria-hidden': 'true' }, avatarEmoji(id));
  const playerById = (id) => (S.view && S.view.players.find((p) => p.id === id)) || null;
  const roleById = (id) => (S.view && S.view.roles.find((r) => r.id === id)) || null;
  const pname = (id) => { const p = playerById(id); return p ? p.name : '?'; };

  function toast(text, kind = 'error') {
    const t = $('toast');
    t.textContent = text;
    t.className = `toast ${kind}`;
    t.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { t.hidden = true; }, kind === 'error' ? 4500 : 2500);
  }

  // ------------------------------------------------------------------ pencere (onay / düzenleme)
  let modalResolve = null;
  function openModal({ title, body, buttons }) {
    closeModal(null);
    $('modalTitle').textContent = title;
    $('modalBody').replaceChildren(...[].concat(body || []));
    $('modalBtns').replaceChildren(...buttons.map((b) => h('button', {
      class: `btn ${b.cls || ''}`, type: 'button', 'data-val': b.value,
      onclick: () => {
        if (b.onClick && b.onClick() === false) return;
        closeModal(b.value);
      },
    }, b.label)));
    $('modal').hidden = false;
    const primary = $('modalBtns').querySelector('.primary, .danger') || $('modalBtns').lastChild;
    const firstInput = $('modalBody').querySelector('input');
    setTimeout(() => (firstInput || primary).focus(), 30);
    return new Promise((r) => { modalResolve = r; });
  }
  function closeModal(val) {
    if ($('modal').hidden) return;
    $('modal').hidden = true;
    const r = modalResolve;
    modalResolve = null;
    if (r) r(val);
  }
  $('modal').addEventListener('click', (e) => { if (e.target.dataset.close) closeModal(null); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(null); });

  function confirmBox(title, body, okLabel, cls = 'primary') {
    return openModal({
      title, body: typeof body === 'string' ? h('p', null, body) : body,
      buttons: [{ label: 'Vazgeç', value: false, cls: 'ghost' }, { label: okLabel, value: true, cls }],
    }).then((v) => v === true);
  }

  // ------------------------------------------------------------------ bağlantı
  function connect() {
    clearTimeout(S.retryTimer);
    if (S.ws && (S.ws.readyState === 0 || S.ws.readyState === 1)) return;
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    let ws;
    try { ws = new WebSocket(`${proto}//${location.host}/ws?as=mod`); } catch { return scheduleReconnect(); }
    S.ws = ws;
    ws.onopen = () => {
      const wasEver = S.everConnected;
      S.connected = true; S.everConnected = true; S.retry = 0;
      setConnBand();
      if (wasEver) { $('qr').src = `/api/qr.svg?t=${Date.now()}`; }
      loadInfo();
    };
    ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      onMessage(msg);
    };
    ws.onclose = () => {
      if (S.ws !== ws) return;
      S.connected = false;
      setConnBand();
      scheduleReconnect();
      checkSession();
    };
    ws.onerror = () => { /* onclose gelecek */ };
  }
  function scheduleReconnect() {
    clearTimeout(S.retryTimer);
    const base = Math.min(5000, 400 * 2 ** S.retry);
    S.retry = Math.min(S.retry + 1, 8);
    S.retryTimer = setTimeout(connect, base * (0.75 + Math.random() * 0.5));
  }
  function setConnBand() {
    const band = $('conn');
    band.hidden = S.connected;
    document.body.classList.toggle('has-conn', !S.connected);
    band.textContent = S.everConnected
      ? 'Sunucu bağlantısı koptu — yeniden bağlanılıyor… (PowerShell penceresinde sunucu açık mı?)'
      : 'Sunucuya bağlanılıyor…';
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !S.connected) { S.retry = 0; connect(); }
  });

  function send(obj) {
    if (!S.ws || S.ws.readyState !== 1) { toast('Bağlantı yok, yeniden bağlanılıyor…'); return false; }
    S.ws.send(JSON.stringify(obj));
    return true;
  }

  async function loadInfo() {
    try {
      const r = await fetch('/api/info', { cache: 'no-store' });
      if (!r.ok) return;
      S.info = await r.json();
      $('joinUrl').textContent = S.info.joinUrl;
      $('screenUrl').textContent = S.info.screenUrl;
      $('logoutBtn').hidden = !S.info.passwordMode;
      if (S.info.passwordMode) $('joinHint').textContent = 'QR\'ı okutan ya da bu adresi açan herkes katılır.';
    } catch { /* bir sonraki bağlantıda tekrar */ }
  }

  // Şifre modunda oturum süresi dolduysa (sunucu 403 verir) giriş ekranına dön
  async function checkSession() {
    if (!S.info || !S.info.passwordMode) return;
    try {
      const r = await fetch('/api/info', { cache: 'no-store' });
      if (r.status === 403) location.reload();
    } catch { /* sunucuya ulaşılamıyor: yeniden bağlanma sürüyor */ }
  }

  $('logoutBtn').addEventListener('click', async () => {
    if (!(await confirmBox('Çıkış yap', 'Moderatör oturumu kapanacak. Oyun sunucuda devam eder; tekrar şifreyle girebilirsin.', 'Çıkış yap', 'danger'))) return;
    try { await fetch('/api/mod/logout', { method: 'POST', cache: 'no-store' }); } catch { /* yine de yenile */ }
    location.reload();
  });

  function onMessage(msg) {
    switch (msg.type) {
      case 'state':
        S.offset = (msg.serverNow || Date.now()) - Date.now();
        onState(msg.view);
        break;
      case 'error':
        toast(msg.message || 'Bir hata oluştu.');
        // sunucu taslağı reddettiyse sunucudaki duruma dön
        S.draft = null; S.durDraft = null;
        if (S.view) render();
        break;
      default: break;
    }
  }

  // ------------------------------------------------------------------ rol adetleri yardımcıları
  const roleIds = () => S.view.roles.map((r) => r.id);
  function fill(counts) {
    const o = {};
    for (const id of roleIds()) o[id] = (counts && counts[id]) || 0;
    return o;
  }
  const sameCounts = (a, b) => roleIds().every((id) => ((a && a[id]) || 0) === ((b && b[id]) || 0));
  // Sunucuda roleCounts boşsa otomatik mod: oyuncu sayısı değiştikçe öneri kendiliğinden geçerli olur
  // (bu bilgi sunucuda durduğu için birden fazla panel sekmesi açıkken de tutarlıdır).
  const isAuto = () => !S.draft && (S.autoPending || !Object.keys(S.view.config.roleCounts || {}).length);
  function serverCounts() {
    const v = S.view;
    return S.autoPending || !Object.keys(v.config.roleCounts || {}).length ? fill(v.suggestion) : fill(v.config.roleCounts);
  }
  const shownCounts = () => S.draft || serverCounts();
  function countsText(counts) {
    return S.view.roles.filter((r) => counts[r.id] > 0).map((r) => `${counts[r.id]} ${r.name}`).join(', ') || 'hiç rol yok';
  }
  /** Sunucudaki validateSetup ile aynı kurallar (taslak için anında geri bildirim). */
  function localProblems(counts, n) {
    const out = [];
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    if (n < 4) out.push(`En az 4 oyuncu gerekli (şu an ${n}).`);
    if (total !== n) out.push(`Rol sayısı (${total}) oyuncu sayısına (${n}) eşit olmalı.`);
    const vamps = S.view.roles.filter((r) => r.team === 'vampir').reduce((a, r) => a + (counts[r.id] || 0), 0);
    if (vamps < 1) out.push('En az 1 vampir olmalı.');
    if (vamps >= n - vamps && n > 0) out.push('Vampir sayısı köylülerden az olmalı, yoksa oyun başlar başlamaz biter.');
    return out;
  }

  function setCounts(counts) {
    S.autoPending = false;
    S.draft = fill(counts);
    clearTimeout(S.draftTimer);
    S.draftTimer = setTimeout(() => send({ type: 'setConfig', config: { roleCounts: S.draft } }), 180);
    renderLobby();
  }

  // ------------------------------------------------------------------ durum değişimi
  function onState(view) {
    S.view = view;
    if (S.draft && Object.keys(view.config.roleCounts).length && sameCounts(S.draft, fill(view.config.roleCounts))) S.draft = null;
    if (S.autoPending && !Object.keys(view.config.roleCounts).length) S.autoPending = false;
    if (S.durDraft && DURATIONS.every((d) => S.durDraft[d.key] === view.config.durations[d.key])) S.durDraft = null;
    if (view.phase !== 'lobby') S.draft = null;

    const key = `${view.phase}:${view.day}`;
    if (key !== S.phaseKey) {
      disarm();
      S.advLockUntil = Math.min(S.advLockUntil, Date.now() + 500); // yeni faza geçildi: kilidi kısa tut
      S.phaseKey = key;
    }

    if (view.phase !== 'lobby') S.autoPending = false;
    render();
  }

  // ------------------------------------------------------------------ zamanlayıcı
  function tick() {
    const el = $('timer');
    const v = S.view;
    if (!v || !v.phaseEndsAt || !['night', 'day', 'vote'].includes(v.phase)) { el.hidden = true; return; }
    el.hidden = false;
    const left = Math.round((v.phaseEndsAt - (Date.now() + S.offset)) / 1000);
    if (left <= 0) { el.textContent = '⏰ Süre doldu'; el.className = 'timer over'; return; }
    const m = Math.floor(left / 60), s = left % 60;
    el.textContent = `${m}:${String(s).padStart(2, '0')}`;
    el.className = left <= 10 ? 'timer low' : 'timer';
  }
  setInterval(tick, 500);

  // ------------------------------------------------------------------ çizim
  function render() {
    const v = S.view;
    if (!v) return;
    $('loading').hidden = true;
    document.body.dataset.phase = v.phase;
    const lobby = v.phase === 'lobby';
    $('lobby').hidden = !lobby;
    $('game').hidden = lobby;
    renderBar();
    if (lobby) renderLobby(); else renderGame();
    tick();
  }

  function phaseLabel(v) {
    if (v.phase === 'night') return `${v.day}. Gece`;
    if (v.phase === 'day') return `${v.day}. Gün`;
    return PHASE_NAMES[v.phase] || v.phase;
  }
  function phaseSub(v) {
    const alive = v.players.filter((p) => p.alive).length;
    switch (v.phase) {
      case 'lobby': return `${v.players.length} oyuncu katıldı`;
      case 'rolereveal': return 'Herkes rolüne baksın';
      case 'night': return `${alive} hayatta · gece eylemleri`;
      case 'dawn': return `${v.day}. gecenin sonu`;
      case 'day': return `${alive} hayatta · tartışma`;
      case 'vote': return `${v.day}. gün · ${v.votesCast || 0}/${alive} oy`;
      case 'voteresult': return `${v.day}. gün`;
      case 'ended': return v.winner ? TEAM[v.winner.team] ? TEAM[v.winner.team].win : '' : '';
      default: return '';
    }
  }

  function advLabel(v) {
    const finish = !!v.winner;
    switch (v.phase) {
      case 'rolereveal': return 'Rolleri dağıttım → Geceyi başlat';
      case 'night': return 'Geceyi bitir (şafağa geç)';
      case 'dawn': return finish ? 'Oyunu bitir / Sonuçları göster' : 'Gündüze geç';
      case 'day': return finish ? 'Oyunu bitir / Sonuçları göster' : 'Oylamayı başlat';
      case 'vote': return finish ? 'Oyunu bitir / Sonuçları göster' : 'Oylamayı bitir';
      case 'voteresult': return finish ? 'Oyunu bitir / Sonuçları göster' : 'Geceye geç';
      default: return 'İleri';
    }
  }

  function renderBar() {
    const v = S.view;
    $('phaseName').textContent = phaseLabel(v);
    $('phaseSub').textContent = phaseSub(v);
    const btn = $('advBtn');
    const show = !['lobby', 'ended'].includes(v.phase);
    btn.hidden = !show;
    const warn = $('advWarn');
    if (!show) { warn.hidden = true; return; }
    const waiting = (v.waiting || []).length;
    const finishing = !!v.winner && ['dawn', 'day', 'vote', 'voteresult'].includes(v.phase);
    btn.classList.toggle('finish', finishing && !S.advArmed);
    btn.classList.toggle('armed', S.advArmed);
    btn.textContent = S.advArmed ? `⚠ Yine de ilerle` : `${advLabel(v)} ▸`;
    btn.disabled = Date.now() < S.advLockUntil;
    if (waiting > 0 && ['night', 'vote'].includes(v.phase)) {
      warn.hidden = false;
      warn.textContent = S.advArmed
        ? `${waiting} kişi hâlâ ${v.phase === 'night' ? 'seçim yapmadı' : 'oy vermedi'}. Emin misin?`
        : `${waiting} kişi daha hazır değil`;
    } else warn.hidden = true;
  }

  function disarm() {
    S.advArmed = false;
    clearTimeout(S.advArmTimer);
  }

  $('advBtn').addEventListener('click', () => {
    const v = S.view;
    if (!v || Date.now() < S.advLockUntil) return;
    const waiting = (v.waiting || []).length;
    if (waiting > 0 && ['night', 'vote'].includes(v.phase) && !S.advArmed) {
      S.advArmed = true;
      clearTimeout(S.advArmTimer);
      S.advArmTimer = setTimeout(() => { S.advArmed = false; renderBar(); }, ARM_MS);
      // kazara çift tıklamada hemen onaylanmasın
      S.advLockUntil = Date.now() + 600;
      renderBar();
      setTimeout(renderBar, 650);
      return;
    }
    disarm();
    if (send({ type: 'advance' })) {
      S.advLockUntil = Date.now() + ADV_LOCK_MS;
      renderBar();
      setTimeout(renderBar, ADV_LOCK_MS + 50);
    }
  });

  // ================================================================== LOBİ
  function renderLobby() {
    const v = S.view;
    if (!v || v.phase !== 'lobby') return;
    const n = v.players.length;

    // ---- oyuncular
    $('pCount').textContent = String(n);
    $('noPlayers').hidden = n > 0;
    $('lobbyPlayers').replaceChildren(...v.players.map((p) => h('li', { class: 'lp' },
      avatar(p.avatar),
      h('span', { class: 'lp-name', title: p.name }, p.name),
      h('span', { class: `dot ${p.connected ? '' : 'off'}`, title: p.connected ? 'Bağlı' : 'Bağlantı yok' }),
      p.connected ? null : h('span', { class: 'conn-label' }, 'bağlantı yok'),
      h('span', { class: 'lp-btns' },
        h('button', { class: 'btn tiny icon', type: 'button', title: 'Ad / avatar düzenle', 'aria-label': `${p.name}: düzenle`, onclick: () => editPlayer(p.id) }, '✏️'),
        h('button', { class: 'btn tiny kick', type: 'button', 'aria-label': `${p.name}: çıkar`, onclick: () => kick(p.id) }, 'Çıkar')))));

    // ---- roller
    buildRoleRows();
    const counts = shownCounts();
    for (const r of v.roles) {
      const row = $(`rrow-${r.id}`);
      const c = counts[r.id] || 0;
      row.classList.toggle('nonzero', c > 0);
      const inp = row.querySelector('input');
      if (document.activeElement !== inp) inp.value = String(c);
      row.querySelector('[data-d="-1"]').disabled = c <= 0;
    }
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    $('totalNum').textContent = String(total);
    $('playerNum').textContent = String(n);
    const ts = $('totalState');
    if (total === n && n > 0) { ts.textContent = '✓ eşit'; ts.className = 'total-state ok'; }
    else if (total > n) { ts.textContent = `${total - n} fazla rol`; ts.className = 'total-state bad'; }
    else { ts.textContent = `${n - total} rol eksik`; ts.className = 'total-state bad'; }

    const byTeam = { koylu: 0, vampir: 0, tarafsiz: 0 };
    for (const r of v.roles) byTeam[r.team] = (byTeam[r.team] || 0) + (counts[r.id] || 0);
    const denom = Math.max(total, 1);
    $('ratioKoylu').style.width = `${(byTeam.koylu / denom) * 100}%`;
    $('ratioTarafsiz').style.width = `${(byTeam.tarafsiz / denom) * 100}%`;
    $('ratioVampir').style.width = `${(byTeam.vampir / denom) * 100}%`;
    const others = total - byTeam.vampir;
    $('ratioText').textContent = `🧛 Vampir ${byTeam.vampir} · 🏘️ Köylü tarafı ${byTeam.koylu}${byTeam.tarafsiz ? ` · 🎭 Tarafsız ${byTeam.tarafsiz}` : ''}`
      + (byTeam.vampir ? ` — oran 1 : ${(others / byTeam.vampir).toFixed(1).replace('.0', '')}` : '');

    const auto = isAuto();
    const pill = $('autoPill');
    pill.textContent = auto ? 'otomatik' : 'elle ayarlandı';
    pill.className = `pill ${auto ? 'auto' : 'manual'}`;
    pill.title = auto ? 'Oyuncu sayısı değiştikçe öneri kendiliğinden güncellenir.' : 'Seçimin korunuyor; oyuncu sayısı değişse de ezilmez.';

    // öneri uyarısı: elle ayarlanmış dağılım artık oyuncu sayısına uymuyor (seçim ezilmez, sadece önerilir)
    const sug = fill(v.suggestion);
    const showBanner = !auto && !S.draft && total !== n && n > 0 && !sameCounts(counts, sug);
    $('suggestBanner').hidden = !showBanner;
    if (showBanner) $('suggestText').textContent = `Oyuncu sayısı değişti (${n}); senin dağılımın korundu. Öneri: ${countsText(sug)}.`;

    const problems = S.draft ? localProblems(counts, n) : v.setupProblems;
    $('problems').replaceChildren(...problems.map((t) => h('li', null, t)));

    // ---- süreler
    buildDurRows();
    const durs = S.durDraft || v.config.durations;
    for (const d of DURATIONS) {
      const inp = $(`dur-${d.key}`);
      const chk = $(`inf-${d.key}`);
      const val = durs[d.key];
      if (val > 0) inp.dataset.last = String(val);
      if (document.activeElement !== inp) inp.value = val > 0 ? String(val) : '';
      inp.disabled = val === 0;
      inp.placeholder = val === 0 ? '∞' : '';
      chk.checked = val === 0;
      $(`unit-${d.key}`).textContent = val > 0 ? fmtDur(val) : 'süresiz';
    }
    for (const b of document.querySelectorAll('[data-preset]')) {
      const p = PRESETS[b.dataset.preset];
      b.classList.toggle('active', DURATIONS.every((d) => p[d.key] === durs[d.key]));
    }

    // ---- seçenekler
    buildOptRows();
    for (const o of OPTIONS) {
      const inp = $(`opt-${o.key}`);
      inp.checked = !!v.config.options[o.key];
    }

    // ---- başlat
    const btn = $('startBtn');
    btn.disabled = problems.length > 0;
    const reason = $('startReason');
    if (problems.length) { reason.textContent = `Başlatılamaz: ${problems[0]}`; reason.className = 'start-reason'; }
    else { reason.textContent = `${n} oyuncu · ${countsText(counts)}`; reason.className = 'start-reason ok'; }
  }

  function fmtDur(sec) {
    const m = Math.floor(sec / 60), s = sec % 60;
    return m ? `${m} dk${s ? ` ${s} sn` : ''}` : `${s} sn`;
  }

  function buildRoleRows() {
    if (S.roleRowsBuilt) return;
    const v = S.view;
    const order = { koylu: 0, tarafsiz: 1, vampir: 2 };
    const roles = [...v.roles].sort((a, b) => (order[a.team] - order[b.team]) || a.name.localeCompare(b.name, 'tr'));
    $('roleRows').replaceChildren(...roles.map((r) => {
      const t = TEAM[r.team] || { name: r.teamName, emoji: '' };
      const abil = (r.abilities || []).map((a) => `${a.name} (${a.phase === 'night' ? 'gece' : 'gündüz'}${a.uses != null ? `, ${a.uses} hak` : ''})`).join(', ');
      const tip = `${r.name} — ${t.name}\n${r.description}${abil ? `\nYetenek: ${abil}` : ''}`;
      const inp = h('input', {
        class: 'num', type: 'number', min: '0', max: '30', step: '1', inputmode: 'numeric', 'aria-label': `${r.name} adedi`,
      });
      const commit = () => {
        const val = Math.max(0, Math.min(30, Math.round(Number(inp.value) || 0)));
        inp.value = String(val);
        const c = { ...shownCounts(), [r.id]: val };
        if (!sameCounts(c, shownCounts())) setCounts(c);
      };
      inp.addEventListener('change', commit);
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { commit(); inp.blur(); } });
      const step = (d) => () => {
        const c = shownCounts();
        setCounts({ ...c, [r.id]: Math.max(0, Math.min(30, (c[r.id] || 0) + d)) });
      };
      return h('li', { class: `rrow team-${r.team}`, id: `rrow-${r.id}` },
        h('span', { class: 'rrow-emoji', 'aria-hidden': 'true' }, r.emoji),
        h('div', { class: 'rrow-main' },
          h('div', { class: 'rrow-name' }, r.name, h('span', { class: 'team-tag' }, `${t.emoji} ${t.name}`)),
          h('div', { class: 'rrow-desc', title: tip }, r.description)),
        h('div', { class: 'stepper' },
          h('button', { class: 'btn', type: 'button', 'data-d': '-1', 'aria-label': `${r.name} azalt`, onclick: step(-1) }, '−'),
          inp,
          h('button', { class: 'btn', type: 'button', 'data-d': '1', 'aria-label': `${r.name} artır`, onclick: step(1) }, '+')));
    }));
    S.roleRowsBuilt = true;
  }

  $('suggestBtn').addEventListener('click', applySuggestion);
  $('applySuggest').addEventListener('click', applySuggestion);
  function applySuggestion() {
    clearTimeout(S.draftTimer);
    S.draft = null;
    S.autoPending = true;
    send({ type: 'setConfig', config: { roleCounts: {} } });
    renderLobby();
    toast('Önerilen dağılım uygulandı. Oyuncu sayısı değiştikçe kendiliğinden güncellenecek.', 'info');
  }

  // ---- süreler
  let durBuilt = false;
  function buildDurRows() {
    if (durBuilt) return;
    durBuilt = true;
    $('durRows').replaceChildren(...DURATIONS.map((d) => {
      const inp = h('input', { class: 'num', id: `dur-${d.key}`, type: 'number', min: '10', max: '3600', step: '5', inputmode: 'numeric', 'aria-label': `${d.label} süresi (saniye)` });
      const chk = h('input', { type: 'checkbox', id: `inf-${d.key}` });
      const commit = () => {
        let val = Math.round(Number(inp.value));
        if (!Number.isFinite(val) || val <= 0) val = Number(inp.dataset.last) || PRESETS.normal[d.key];
        val = Math.max(10, Math.min(3600, val));
        inp.value = String(val);
        setDur({ [d.key]: val });
      };
      inp.addEventListener('change', commit);
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { commit(); inp.blur(); } });
      chk.addEventListener('change', () => {
        setDur({ [d.key]: chk.checked ? 0 : (Number(inp.dataset.last) || PRESETS.normal[d.key]) });
      });
      return h('div', { class: 'drow' },
        h('label', { class: 'drow-label', for: `dur-${d.key}` }, d.label, h('small', null, d.sub)),
        h('span', { class: 'drow-input' }, inp, h('span', { class: 'unit', id: `unit-${d.key}` }, '')),
        h('label', { class: 'check' }, chk, 'süresiz'));
    }));
  }
  function setDur(part) {
    S.durDraft = { ...(S.durDraft || S.view.config.durations), ...part };
    clearTimeout(S.durTimer);
    S.durTimer = setTimeout(() => send({ type: 'setConfig', config: { durations: S.durDraft } }), 200);
    renderLobby();
  }
  for (const b of document.querySelectorAll('[data-preset]')) {
    b.addEventListener('click', () => setDur(PRESETS[b.dataset.preset]));
  }

  // ---- seçenekler
  let optBuilt = false;
  function buildOptRows() {
    if (optBuilt) return;
    optBuilt = true;
    const known = OPTIONS.filter((o) => o.key in S.view.config.options);
    $('optRows').replaceChildren(...known.map((o) => {
      const inp = h('input', { type: 'checkbox', id: `opt-${o.key}` });
      inp.addEventListener('change', () => send({ type: 'setConfig', config: { options: { [o.key]: inp.checked } } }));
      return h('label', { class: 'opt', for: `opt-${o.key}` },
        inp, h('span', { class: 'switch', 'aria-hidden': 'true' }),
        h('span', null, h('span', { class: 'opt-title' }, o.title), h('span', { class: 'opt-desc' }, h('br'), o.desc)));
    }));
  }

  // ---- başlat
  $('startBtn').addEventListener('click', async () => {
    const v = S.view;
    const counts = shownCounts();
    const n = v.players.length;
    const body = [
      h('p', null, `${n} oyuncu ile oyun başlatılsın mı?`),
      h('ul', { class: 'confirm-list' }, v.roles.filter((r) => counts[r.id] > 0).map((r) => h('li', null, `${r.emoji} ${counts[r.id]} × ${r.name}`))),
      h('p', { class: 'hint' }, 'Başlayınca yeni oyuncu katılamaz ve ayarlar kilitlenir.'),
    ];
    if (!(await confirmBox('Oyunu başlat', body, '🩸 Başlat'))) return;
    // bekleyen taslak varsa önce onu gönder
    if (S.draft) { clearTimeout(S.draftTimer); send({ type: 'setConfig', config: { roleCounts: S.draft } }); }
    if (S.autoPending) send({ type: 'setConfig', config: { roleCounts: {} } });
    if (S.durDraft) { clearTimeout(S.durTimer); send({ type: 'setConfig', config: { durations: S.durDraft } }); }
    send({ type: 'start' });
  });

  // ---- oyuncu işlemleri
  async function kick(id) {
    const p = playerById(id);
    if (!p) return;
    const inGame = S.view.phase !== 'lobby';
    const ok = await confirmBox(
      inGame ? 'Oyundan çıkar' : 'Lobiden çıkar',
      inGame ? `${p.name} oyundan çıkarılsın mı? Ölmüş sayılır ve bu herkese duyurulur.` : `${p.name} lobiden çıkarılsın mı? İsterse yeniden katılabilir.`,
      'Çıkar', 'danger');
    if (ok) send({ type: 'kick', playerId: id });
  }

  function editPlayer(id) {
    const p = playerById(id);
    if (!p) return;
    let chosen = p.avatar;
    const nameInp = h('input', { class: 'text-input', id: 'editName', type: 'text', maxlength: '16', autocomplete: 'off', spellcheck: 'false' });
    nameInp.value = p.name;
    const taken = new Set(S.view.players.filter((o) => o.id !== id).map((o) => o.avatar));
    const grid = h('div', { class: 'av-grid', role: 'radiogroup', 'aria-label': 'Avatar' });
    const btns = S.view.avatars.map((a) => {
      const b = h('button', {
        class: `av-btn ${a.id === chosen ? 'selected' : ''}`, type: 'button', role: 'radio',
        'aria-checked': a.id === chosen ? 'true' : 'false', disabled: taken.has(a.id), title: taken.has(a.id) ? 'Başka oyuncuda' : a.id,
        onclick: () => {
          chosen = a.id;
          for (const x of btns) { x.classList.toggle('selected', x === b); x.setAttribute('aria-checked', x === b ? 'true' : 'false'); }
        },
      }, a.emoji);
      return b;
    });
    grid.append(...btns);
    openModal({
      title: 'Oyuncuyu düzenle',
      body: [h('label', { class: 'field-label', for: 'editName' }, 'Ad'), nameInp, h('div', { class: 'field-label' }, 'Avatar'), grid],
      buttons: [
        { label: 'Vazgeç', value: false, cls: 'ghost' },
        {
          label: 'Kaydet', value: true, cls: 'primary',
          onClick: () => {
            const name = nameInp.value.trim().replace(/\s+/g, ' ');
            if (!name) { toast('Ad boş olamaz.'); return false; }
            const msg = { type: 'updatePlayer', playerId: id };
            if (name !== p.name) msg.name = name;
            if (chosen !== p.avatar) msg.avatar = chosen;
            if (msg.name || msg.avatar) send(msg);
            return true;
          },
        },
      ],
    });
    nameInp.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('modalBtns').lastChild.click(); });
  }

  $('copyJoin').addEventListener('click', () => copy(S.info ? S.info.joinUrl : $('joinUrl').textContent, 'Katılım adresi kopyalandı.'));

  async function copy(text, okMsg) {
    try {
      await navigator.clipboard.writeText(text);
      toast(okMsg, 'info');
    } catch {
      const ta = h('textarea', { readonly: true });
      ta.value = text;
      document.body.append(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch { ok = false; }
      ta.remove();
      toast(ok ? okMsg : 'Kopyalanamadı. Elle seçip kopyala.', ok ? 'info' : 'error');
    }
  }

  // ================================================================== OYUN
  function abilityName(roleId, abilityId) {
    const r = roleById(roleId);
    const a = r && (r.abilities || []).find((x) => x.id === abilityId);
    return a ? a.name : abilityId;
  }

  function renderGame() {
    const v = S.view;
    const players = v.players;
    const alive = players.filter((p) => p.alive);
    $('aliveCount').textContent = `${alive.length} hayatta · ${players.length - alive.length} ölü`;
    const winners = new Set(v.winner && v.phase === 'ended' ? v.winner.winners : []);

    // ---- kazanan kutusu
    const ended = v.phase === 'ended';
    $('winnerBox').hidden = !ended;
    if (ended && v.winner) {
      const t = TEAM[v.winner.team] || { name: v.winner.team, emoji: '🏆', win: 'Kazanan' };
      $('winnerBox').className = `card winner-box team-${v.winner.team}`;
      $('winnerEmoji').textContent = t.emoji;
      $('winnerTitle').textContent = v.winner.team === 'tarafsiz'
        ? `${v.winner.winners.map(pname).join(', ')} kazandı`
        : t.win;
      $('winnerReason').textContent = v.winner.reason;
    }
    const pw = $('pendingWin');
    pw.hidden = !(v.winner && !ended);
    if (v.winner && !ended) pw.textContent = `🏁 Kazanan belli oldu (${(TEAM[v.winner.team] || {}).name || v.winner.team}). Duyuruyu ekranda gösterdikten sonra üstteki "Oyunu bitir / Sonuçları göster" düğmesine bas.`;
    $('abortBtn').hidden = ended;

    // ---- oyuncu tablosu
    const phaseCol = { night: 'Gece', vote: 'Oy', ended: 'Sonuç' }[v.phase] || 'Bu faz';
    $('phaseCol').textContent = phaseCol;
    const sorted = [...players].sort((a, b) => (b.alive - a.alive));
    $('ptbody').replaceChildren(...sorted.map((p) => {
      const role = p.role;
      let phaseCell;
      if (v.phase === 'night' && p.alive) phaseCell = p.acted ? h('span', { class: 'ph-ok' }, '✓ hazır') : h('span', { class: 'ph-wait' }, '… bekleniyor');
      else if (v.phase === 'vote' && p.alive) phaseCell = p.voted ? h('span', { class: 'ph-ok' }, '✓ oy verdi') : h('span', { class: 'ph-wait' }, '… bekleniyor');
      else if (ended) phaseCell = winners.has(p.id) ? h('span', { class: 'ph-ok' }, '👑 kazandı') : h('span', { class: 'ph-none' }, 'kaybetti');
      else phaseCell = h('span', { class: 'ph-none' }, '—');

      let status;
      if (p.alive) status = h('span', { class: 'st-alive' }, 'Canlı');
      else {
        const d = p.death || {};
        status = h('span', null,
          h('span', { class: 'st-dead' }, `✝ ${CAUSE[d.cause] || 'Öldü'}`),
          h('span', { class: 'st-sub' }, `${deathWhen(d)}${d.hidden ? ' · rol gizlendi' : ''}`),
          d.announced === false && !ended ? h('span', { class: 'st-pending' }, 'sabah duyurulacak') : null);
      }

      const uses = Object.entries(p.usesLeft || {}).map(([abId, left]) => {
        const r = role && roleById(role.id);
        const ab = r && r.abilities.find((a) => a.id === abId);
        const max = ab && ab.uses != null ? ab.uses : null;
        return h('span', { class: `uses ${left <= 0 ? 'spent' : ''}`, title: left <= 0 ? 'Hakkı bitti' : 'Kalan hak' },
          `${ab ? ab.name : abId}: ${left}${max != null ? `/${max}` : ''}`);
      });

      return h('tr', { class: `${p.alive ? '' : 'dead'} ${winners.has(p.id) ? 'winner' : ''}` },
        h('td', null, h('div', { class: 'pcell' }, avatar(p.avatar), h('span', { class: 'pn', title: p.name }, p.name), winners.has(p.id) ? h('span', { class: 'crown', 'aria-label': 'kazanan' }, '👑') : null)),
        h('td', null, role
          ? [h('span', { class: `rbadge team-${role.team}`, title: role.description }, `${role.emoji} ${role.name}`), h('span', { class: 'tname' }, role.teamName)]
          : h('span', { class: 'ph-none' }, '—')),
        h('td', null, status),
        h('td', null, phaseCell),
        h('td', null, uses.length ? uses : h('span', { class: 'ph-none' }, '—')),
        h('td', null, h('span', { class: `dot ${p.connected ? '' : 'off'}`, title: p.connected ? 'Bağlı' : 'Bağlantı yok', role: 'img', 'aria-label': p.connected ? 'Bağlı' : 'Bağlantı yok' })),
        h('td', null, p.alive && !ended ? h('button', { class: 'btn tiny kick', type: 'button', 'aria-label': `${p.name}: oyundan çıkar`, onclick: () => kick(p.id) }, 'Çıkar') : null));
    }));

    renderNow();
    renderReport();
    renderLog();
  }

  function deathWhen(d) {
    if (!d.day) return 'oyun başında';
    return d.cause === 'vampir' ? `${d.day}. gece` : `${d.day}. gün`;
  }

  function renderNow() {
    const v = S.view;
    const body = $('nowBody');
    const alive = v.players.filter((p) => p.alive);
    const hint = $('nowHint');
    const title = $('nowTitle');
    switch (v.phase) {
      case 'rolereveal':
        title.textContent = 'Roller dağıtıldı';
        hint.textContent = 'Herkes telefonundaki rol kartına baksın. Hazır olunca üstteki düğmeyle geceyi başlat.';
        body.replaceChildren(roleSummary());
        return;
      case 'night': {
        title.textContent = 'Gece eylemleri';
        hint.textContent = 'Yeteneği olmayanlar da sahte bir seçim yapar (kim rolü olduğu belli olmasın diye).';
        const acts = v.nightActions || {};
        const rows = alive.map((p) => {
          const a = acts[p.id];
          const team = p.role ? p.role.team : '';
          const who = h('span', { class: 'who' }, avatar(p.avatar), h('span', { class: 'nm', title: p.name }, p.name), p.role ? h('span', { 'aria-hidden': 'true', title: p.role.name }, p.role.emoji) : null);
          if (!a) return { order: 3, el: h('li', { class: `act waiting team-${team}` }, who, h('span', { class: 'arrow' }, '·'), h('span', { class: 'what' }, 'bekleniyor…')) };
          if (a.abilityId === '__pass') return { order: 1, el: h('li', { class: `act fake team-${team}` }, who, h('span', { class: 'arrow' }, '·'), h('span', { class: 'what' }, 'pas geçti')) };
          if (a.abilityId === '__decoy') return { order: 2, el: h('li', { class: `act fake team-${team}` }, who, h('span', { class: 'arrow' }, '·'), h('span', { class: 'what' }, `sahte seçim (yeteneği yok)${a.targetId ? ` → ${pname(a.targetId)}` : ''}`)) };
          return {
            order: 0,
            el: h('li', { class: `act team-${team}` }, who, h('span', { class: 'arrow' }, '→'),
              h('span', { class: 'what' }, a.targetId ? pname(a.targetId) : '—', ' ', h('span', { class: 'ab' }, `(${abilityName(p.role && p.role.id, a.abilityId)})`))),
          };
        }).sort((x, y) => x.order - y.order);
        const done = alive.length - (v.waiting || []).length;
        body.replaceChildren(h('div', { class: 'subhead' }, `${done}/${alive.length} oyuncu seçim yaptı`), h('ul', { class: 'acts' }, rows.map((r) => r.el)));
        return;
      }
      case 'vote': {
        title.textContent = 'Oylar (canlı)';
        hint.textContent = 'Oylar oyunculara ve ortak ekrana gizlidir; sadece sen görüyorsun.';
        const votes = v.votes || {};
        const tally = new Map();
        let abstain = 0;
        for (const p of alive) {
          if (!(p.id in votes)) continue;
          if (votes[p.id] == null) abstain += 1;
          else tally.set(votes[p.id], (tally.get(votes[p.id]) || 0) + 1);
        }
        body.replaceChildren(
          h('div', { class: 'subhead' }, `${Object.keys(votes).length}/${alive.length} oy kullanıldı`),
          tallyList([...tally.entries()].map(([playerId, count]) => ({ playerId, count })), abstain, alive.length),
          h('div', { class: 'subhead' }, 'Kim kime'),
          h('ul', { class: 'acts' }, alive.map((p) => {
            const has = p.id in votes;
            const t = votes[p.id];
            return h('li', { class: `act ${has ? (t == null ? 'fake' : '') : 'waiting'}` },
              h('span', { class: 'who' }, avatar(p.avatar), h('span', { class: 'nm', title: p.name }, p.name)),
              h('span', { class: 'arrow' }, has && t != null ? '→' : '·'),
              h('span', { class: 'what' }, has ? (t == null ? 'çekimser' : pname(t)) : 'bekleniyor…'));
          })));
        return;
      }
      case 'dawn':
        title.textContent = 'Şafak';
        hint.textContent = 'Gecenin sonucu ekranda ve telefonlarda gösteriliyor. Herkes okuyunca gündüze geç.';
        body.replaceChildren();
        return;
      case 'day':
        title.textContent = 'Gündüz — tartışma';
        hint.textContent = 'Köy tartışıyor. Avcı gibi gündüz yetenekleri bu sırada kullanılabilir. Hazır olunca oylamayı başlat.';
        body.replaceChildren(roleSummary());
        return;
      case 'voteresult':
        title.textContent = 'Oylama sonucu';
        hint.textContent = v.winner ? 'Kazanan belli oldu.' : 'Sonuç ekranda. Hazır olunca geceye geç.';
        body.replaceChildren();
        return;
      case 'ended':
        title.textContent = 'Oyun bitti';
        hint.textContent = 'Herkesin rolü artık ekranda ve telefonlarda açık. Aynı oyuncularla yeni oyun başlatabilirsin.';
        body.replaceChildren();
        return;
      default:
        body.replaceChildren();
    }
  }

  function roleSummary() {
    const v = S.view;
    const counts = {};
    for (const p of v.players) if (p.role) counts[p.role.id] = (counts[p.role.id] || 0) + 1;
    const alive = {};
    for (const p of v.players) if (p.role && p.alive) alive[p.role.id] = (alive[p.role.id] || 0) + 1;
    return h('ul', { class: 'acts' }, v.roles.filter((r) => counts[r.id]).map((r) => h('li', { class: `act team-${r.team}` },
      h('span', { class: 'who' }, h('span', { 'aria-hidden': 'true' }, r.emoji), h('span', { class: 'nm' }, r.name)),
      h('span', { class: 'arrow' }, '·'),
      h('span', { class: 'what' }, `${alive[r.id] || 0}/${counts[r.id]} hayatta`))));
  }

  function tallyList(rows, abstain, max, final = false) {
    rows = [...rows].sort((a, b) => b.count - a.count);
    const top = rows.length ? rows[0].count : 0;
    const tie = rows.length > 1 && rows[1].count === top;
    const list = h('ul', { class: 'tally' }, rows.map((r) => {
      const p = playerById(r.playerId);
      const bar = h('span', { class: 'tbar' });
      bar.style.width = `${(r.count / Math.max(max, 1)) * 100}%`;
      return h('li', { class: `trow ${r.count === top && !tie ? 'lead' : ''}` },
        p ? avatar(p.avatar) : h('span'), h('span', { class: 'nm', title: p ? p.name : '' }, p ? p.name : '?'),
        h('span', { class: 'bar-wrap' }, bar), h('span', { class: 'n' }, String(r.count)));
    }));
    if (!rows.length) list.append(h('li', { class: 'empty' }, 'Henüz kimseye oy verilmedi.'));
    if (abstain) list.append(h('li', { class: 'trow' }, h('span'), h('span', { class: 'nm' }, 'Çekimser'), h('span'), h('span', { class: 'n' }, String(abstain))));
    if (tie) list.append(h('li', { class: 'hint' }, final ? '⚖ Eşitlik: kimse elenmedi.' : '⚖ Şu an eşitlik var: böyle biterse kimse elenmez.'));
    return list;
  }

  function renderReport() {
    const v = S.view;
    const r = v.lastReport;
    const body = $('reportBody');
    const when = $('reportWhen');
    if (!r) { when.textContent = ''; body.replaceChildren(h('p', { class: 'empty' }, 'Henüz duyuru yok.')); return; }
    when.textContent = r.kind === 'dawn' ? `${r.day}. gece` : `${r.day}. gün oylaması`;
    const kids = [h('p', null, r.text)];
    if (r.kind === 'dawn' && r.deaths && r.deaths.length) {
      kids.push(h('ul', { class: 'rdeaths' }, r.deaths.map((d) => {
        const p = playerById(d.playerId);
        const role = p && p.role;
        return h('li', null, avatar(d.avatar), h('b', null, d.name),
          role ? h('span', { class: `rbadge team-${role.team}` }, `${role.emoji} ${role.name}`) : null,
          h('span', { class: 'muted' }, d.roleId ? '(rol herkese açıklandı)' : '(rol gizli kaldı)'));
      })));
    }
    if (r.kind === 'vote') {
      const alive = v.players.filter((p) => p.alive).length + (r.eliminated ? 1 : 0);
      kids.push(tallyList(r.tally || [], r.abstain || 0, alive, true));
    }
    body.replaceChildren(...kids);
  }

  function logWhen(e) {
    const d = new Date(e.t);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
  }
  function logPhase(e) {
    if (e.phase === 'lobby') return 'Lobi';
    if (!e.day) return 'Başlangıç';
    return `${e.day}. tur`;
  }
  function renderLog() {
    const list = $('log');
    const log = S.view.log || [];
    if (log.length < S.logCount) { list.replaceChildren(); S.logCount = 0; }
    if (log.length === S.logCount) return;
    const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
    const fresh = S.logCount > 0;
    for (const e of log.slice(S.logCount)) {
      list.append(h('li', { class: fresh ? 'fresh' : '' }, h('span', { class: 'lt' }, logWhen(e)), h('span', { class: 'lph' }, logPhase(e)), h('span', { class: 'lx' }, e.text)));
    }
    S.logCount = log.length;
    if (nearBottom || !fresh) list.scrollTop = list.scrollHeight;
  }
  $('copyLog').addEventListener('click', () => {
    const log = (S.view && S.view.log) || [];
    copy(log.map((e) => `[${logWhen(e)}] ${logPhase(e)} — ${e.text}`).join('\n') || '(boş)', 'Günlük kopyalandı.');
  });

  $('newGameBtn').addEventListener('click', async () => {
    if (await confirmBox('Yeni oyun', 'Aynı oyuncularla lobiye dönülsün mü? Telefonlar bağlı kalır, roller yeniden dağıtılır.', '🔁 Yeni oyun')) {
      send({ type: 'reset', keepPlayers: true });
    }
  });
  $('fullResetBtn').addEventListener('click', async () => {
    if (await confirmBox('Tamamen sıfırla', 'Tüm oyuncular silinsin mi? Herkesin yeniden QR okutup katılması gerekir.', '🧹 Her şeyi sil', 'danger')) {
      send({ type: 'reset', keepPlayers: false });
    }
  });
  $('abortBtn').addEventListener('click', async () => {
    if (await confirmBox('Oyunu yarıda bitir', 'Oyun sonlandırılıp aynı oyuncularla lobiye dönülsün mü? Mevcut oyun kaybolur.', 'Lobiye dön', 'danger')) {
      send({ type: 'reset', keepPlayers: true });
    }
  });

  // ------------------------------------------------------------------ başlat
  setConnBand();
  connect();
})();
