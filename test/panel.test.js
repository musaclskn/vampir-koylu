'use strict';
// 4. adım testleri: rol adet özeti (publicView.roleCounts), moderatör görünümü ekleri, /api/info,
// tarayıcı açma komutu ve ortak ekranın HİÇBİR mesajında gizli bilgi olmaması.
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const http = require('http');
const WebSocket = require('ws');
const { loadRoles } = require('../server/game/roles');
const { createServer } = require('../server/app');
const { openCommand, shouldOpen } = require('../server/open');
const { AVATARS } = require('../server/game/avatars');
const { makeGame, ROLES_DIR } = require('./helpers');

// ------------------------------------------------------------------ motor
test('roleCounts: lobide yok, oyun başlayınca adet özeti var (kimde olduğu yok)', () => {
  const roles = loadRoles(ROLES_DIR);
  const { Game } = require('../server/game/engine');
  const g = new Game({ roles });
  for (let i = 0; i < 6; i++) g.addPlayer({ name: `P${i}`, avatar: AVATARS[i].id });
  g.setConfig({ roleCounts: { koylu: 3, vampir: 1, doktor: 1, kahin: 1 } });
  assert.equal(g.config.options.showRoleCounts, true, 'varsayılan açık');
  assert.ok(!('roleCounts' in g.publicView()), 'lobide rol özeti olmamalı');
  g.start();
  const rc = g.publicView().roleCounts;
  assert.ok(Array.isArray(rc));
  assert.equal(rc.reduce((a, r) => a + r.count, 0), 6);
  assert.deepEqual(rc.map((r) => r.id).sort(), ['doktor', 'kahin', 'koylu', 'vampir']);
  for (const r of rc) {
    assert.deepEqual(Object.keys(r).sort(), ['count', 'emoji', 'id', 'name', 'team']);
    assert.ok(r.count > 0);
  }
  // vampirler en sonda (köylü tarafı önce)
  assert.equal(rc[rc.length - 1].team, 'vampir');
  // telefon görünümüne eklenmez (telefon kendi rolünü bilir; özet ortak ekranda)
  assert.ok(!('roleCounts' in g.viewFor([...g.players.keys()][0])));
});

test('roleCounts: showRoleCounts kapalıysa gönderilmez; setConfig seçeneği kabul eder', () => {
  const roles = loadRoles(ROLES_DIR);
  const { Game } = require('../server/game/engine');
  const g = new Game({ roles });
  for (let i = 0; i < 5; i++) g.addPlayer({ name: `P${i}`, avatar: AVATARS[i].id });
  g.setConfig({ options: { showRoleCounts: false } });
  assert.equal(g.config.options.showRoleCounts, false);
  g.start();
  assert.ok(!('roleCounts' in g.publicView()));
  assert.throws(() => g.setConfig({ options: { showRoleCounts: true } }), /sadece oyun başlamadan/);
  // yeni oyunda (aynı oyuncular) ayar korunur
  g.restartKeepPlayers();
  assert.equal(g.config.options.showRoleCounts, false);
  assert.throws(() => g.setConfig({ options: { boyleBirSeyYok: true } }), /Bilinmeyen seçenek/);
});

test('otomatik rol modu: roleCounts boşken öneri kullanılır, ayar boş kalır; elle ayar oyuncu sayısı değişince korunur', () => {
  const roles = loadRoles(ROLES_DIR);
  const { Game } = require('../server/game/engine');
  const g = new Game({ roles });
  for (let i = 0; i < 8; i++) g.addPlayer({ name: `P${i}`, avatar: AVATARS[i].id });
  assert.deepEqual(g.config.roleCounts, {});
  assert.deepEqual(g.modView().setupProblems, []);
  // elle ayar: 9. oyuncu gelince ezilmez, sorun olarak görünür
  g.setConfig({ roleCounts: { koylu: 5, vampir: 2, doktor: 1 } });
  g.addPlayer({ name: 'P8', avatar: AVATARS[8].id });
  assert.deepEqual(g.config.roleCounts, { koylu: 5, vampir: 2, doktor: 1 });
  assert.match(g.modView().setupProblems.join(' '), /eşit olmalı/);
  // otomatiğe dön ({}), başlat: dağıtılan = öneri, ayar yine boş
  g.setConfig({ roleCounts: {} });
  g.start();
  assert.deepEqual(g.config.roleCounts, {});
  const dealt = g.publicView().roleCounts.reduce((a, r) => ({ ...a, [r.id]: r.count }), {});
  const sug = Object.fromEntries(Object.entries(g.suggest(9)).filter(([, c]) => c > 0));
  assert.deepEqual(dealt, sug);
  g.restartKeepPlayers();
  assert.deepEqual(g.config.roleCounts, {}, 'yeni oyunda da otomatik kalır');
  assert.equal(g.dealtCounts, null);
});

test('modView: roller açıklama ve yeteneklerle gelir, son duyuru (lastReport) gündüz de durur', () => {
  const { g, ps } = makeGame(6, { koylu: 3, vampir: 1, doktor: 1, kahin: 1 }, { 0: 'vampir', 1: 'doktor' });
  const mv = g.modView();
  const vamp = mv.roles.find((r) => r.id === 'vampir');
  assert.ok(vamp.description && vamp.teamName === 'Vampirler');
  assert.ok(vamp.abilities.some((a) => a.id === 'oldur' && a.name === 'Isır'), 'takım yeteneği de listelenir');
  const avci = mv.roles.find((r) => r.id === 'avci');
  assert.deepEqual(avci.abilities.map((a) => [a.id, a.uses]), [['ates', 1]]);
  g.advance(); // gece
  g.submitNight(ps[0].id, { abilityId: 'oldur', targetId: ps[2].id });
  g.advance(); // şafak
  g.advance(); // gündüz
  assert.equal(g.publicView().report, null, 'herkese açık görünümde gündüz rapor yok');
  const lr = g.modView().lastReport;
  assert.equal(lr.kind, 'dawn');
  assert.equal(lr.deaths[0].playerId, ps[2].id);
});

// ------------------------------------------------------------------ tarayıcı açma
test('openCommand: Windows/mac/linux doğru komutu verir; NO_OPEN kapatır', () => {
  const u = 'http://localhost:3000/mod';
  assert.deepEqual(openCommand(u, 'win32'), { cmd: 'cmd', args: ['/c', 'start', '', u] });
  assert.deepEqual(openCommand(u, 'darwin'), { cmd: 'open', args: [u] });
  assert.deepEqual(openCommand(u, 'linux'), { cmd: 'xdg-open', args: [u] });
  assert.equal(openCommand('http://x/?a=1&b=2', 'win32').args[3], 'http://x/?a=1^&b=2');
  assert.equal(shouldOpen({}), true);
  assert.equal(shouldOpen({ NO_OPEN: '1' }), false);
  assert.equal(shouldOpen({ NO_OPEN: 'true' }), false);
  assert.equal(shouldOpen({ NO_OPEN: '0' }), true);
  assert.equal(shouldOpen({ NO_OPEN: '' }), true);
});

test('createServer tarayıcı açmaz (sadece index.js açar)', () => {
  const src = require('fs').readFileSync(require.resolve('../server/app'), 'utf8');
  assert.doesNotMatch(src, /openBrowser|child_process/);
});

// ------------------------------------------------------------------ HTTP
async function startServer(host = '127.0.0.1') {
  const roles = loadRoles(ROLES_DIR);
  const logs = [];
  const srv = createServer({ roles, joinUrl: 'http://192.168.1.34:3000/', log: (...a) => logs.push(a.join(' ')) });
  await new Promise((r) => srv.server.listen(0, host, r));
  srv.port = srv.server.address().port;
  srv.logs = logs;
  return srv;
}
function get(port, path, host = '127.0.0.1') {
  return new Promise((resolve, reject) => {
    http.get({ host, port, path }, (res) => {
      let body = '';
      res.on('data', (d) => { body += d; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    }).on('error', reject);
  });
}

test('/api/info: bu bilgisayardan katılım/ekran/mod adreslerini verir', async () => {
  const srv = await startServer();
  try {
    const r = await get(srv.port, '/api/info');
    assert.equal(r.status, 200);
    const info = JSON.parse(r.body);
    assert.deepEqual(info, {
      joinUrl: 'http://192.168.1.34:3000/',
      screenUrl: 'http://192.168.1.34:3000/ekran',
      modUrl: `http://localhost:${srv.port}/mod`,
    });
    // panel ve ekran dosyaları sunuluyor
    for (const p of ['/mod/app.js', '/mod/style.css', '/ekran/app.js', '/ekran/style.css', '/ortak/tema.css']) {
      assert.equal((await get(srv.port, p)).status, 200, p);
    }
    const mod = await get(srv.port, '/mod');
    assert.match(mod.body, /\/mod\/app\.js/);
    const ekran = await get(srv.port, '/ekran');
    assert.match(ekran.body, /\/ekran\/app\.js/);
    // CSP satır içi stile izin vermiyor: HTML'de style="" olmamalı
    assert.doesNotMatch(mod.body, /\sstyle=/);
    assert.doesNotMatch(ekran.body, /\sstyle=/);
  } finally { await srv.close(); }
});

const lanIp = Object.values(os.networkInterfaces()).flat().find((i) => i && (i.family === 'IPv4' || i.family === 4) && !i.internal);
test('LAN adresinden /mod, /mod/app.js ve /api/info 403', { skip: !lanIp && 'loopback dışı ağ arayüzü yok' }, async () => {
  const srv = await startServer('0.0.0.0');
  try {
    for (const p of ['/mod', '/mod/', '/mod/app.js', '/mod/style.css', '/api/info']) {
      assert.equal((await get(srv.port, p, lanIp.address)).status, 403, p);
    }
    assert.equal((await get(srv.port, '/ekran', lanIp.address)).status, 200);
    assert.equal((await get(srv.port, '/ekran/app.js', lanIp.address)).status, 200);
    assert.equal((await get(srv.port, '/api/qr.svg', lanIp.address)).status, 200);
  } finally { await srv.close(); }
});

// ------------------------------------------------------------------ ortak ekran gizliliği (tam oyun, gerçek WS)
class Client {
  constructor(port, as) {
    this.msgs = [];
    this.waiters = [];
    this.ws = new WebSocket(`ws://127.0.0.1:${port}/ws?as=${as}`);
    this.ws.on('message', (d) => {
      const m = JSON.parse(d.toString());
      this.msgs.push(m);
      if (m.type === 'state') this.view = m.view;
      this.waiters = this.waiters.filter((w) => (w.pred(m) ? (w.resolve(m), false) : true));
    });
    this.opened = new Promise((res, rej) => { this.ws.once('open', res); this.ws.once('error', rej); });
  }
  send(o) { this.ws.send(JSON.stringify(o)); }
  next(pred, timeout = 2000) {
    return new Promise((resolve, reject) => {
      const w = { pred, resolve };
      this.waiters.push(w);
      setTimeout(() => { this.waiters = this.waiters.filter((x) => x !== w); reject(new Error('zaman aşımı')); }, timeout).unref();
    });
  }
  async until(pred, timeout = 2000) {
    if (this.view && pred(this.view)) return this.view;
    return (await this.next((x) => x.type === 'state' && pred(x.view), timeout)).view;
  }
}

const SECRET_KEYS = ['nightActions', 'votes', 'waiting', 'config', 'log', 'roles', 'suggestion', 'setupProblems',
  'lastReport', 'me', 'acted', 'voted', 'usesLeft', 'death', 'token', 'privateLog', 'roleId', 'nightChoice', 'myVote', 'teammates'];

/** Nesnede (iç içe) yasak anahtar var mı? Ölüm raporundaki açıklanmış roleId hariç. */
function findSecretKeys(obj, path = '') {
  const out = [];
  if (Array.isArray(obj)) obj.forEach((x, i) => out.push(...findSecretKeys(x, `${path}[${i}]`)));
  else if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) {
      const allowedRoleId = k === 'roleId' && /report\.(deaths\[\d+\]|eliminated)$/.test(path);
      if (SECRET_KEYS.includes(k) && !allowedRoleId) out.push(`${path}.${k}`);
      out.push(...findSecretKeys(v, `${path}.${k}`));
    }
  }
  return out;
}

test('ortak ekran: hiçbir mesajda rol/oy/gece eylemi/hazır bilgisi yok (sadece açıklanan ölü rolleri)', async () => {
  const srv = await startServer();
  const players = [];
  try {
    const mod = new Client(srv.port, 'mod');
    const screen = new Client(srv.port, 'ekran');
    await Promise.all([mod.opened, screen.opened]);
    for (let i = 0; i < 8; i++) {
      const c = new Client(srv.port, 'oyuncu');
      await c.opened;
      c.send({ type: 'join', name: `Oyuncu${i}`, avatar: AVATARS[i].id });
      c.id = (await c.next((m) => m.type === 'token')).playerId;
      players.push(c);
    }
    await screen.until((v) => v.players.length === 8);
    assert.ok(!('roleCounts' in screen.view));
    mod.send({ type: 'setConfig', config: { roleCounts: { koylu: 3, vampir: 1, temizlikci: 1, doktor: 1, kahin: 1, avci: 1 } } });
    await mod.until((v) => v.config.roleCounts.temizlikci === 1);
    mod.send({ type: 'start' });
    const rv = await screen.until((v) => v.phase === 'rolereveal');
    assert.equal(rv.roleCounts.reduce((a, r) => a + r.count, 0), 8);

    const g = srv.game;
    const byRole = (id) => players.find((c) => g.players.get(c.id).roleId === id);
    const vamp = byRole('vampir'), cleaner = byRole('temizlikci'), doc = byRole('doktor');
    const villagers = players.filter((c) => g.players.get(c.id).roleId === 'koylu');
    const alive = (c) => g.players.get(c.id).alive;
    const advance = async (phase) => {
      mod.send({ type: 'advance' });
      await screen.until((v) => v.phase === phase);
    };
    const nightAll = (choices) => {
      for (const c of players.filter(alive)) {
        const ch = choices.get(c);
        if (ch) c.send({ type: 'night', ...ch });
        else c.send({ type: 'night', abilityId: '__decoy', targetId: players.find((o) => o !== c && alive(o)).id });
      }
    };

    // 1. gece: temizlikçi izleri siler, vampir köylüyü ısırır -> ölür, rolü gizli
    await advance('night');
    const v1 = villagers[0];
    nightAll(new Map([[vamp, { abilityId: 'oldur', targetId: v1.id }], [cleaner, { abilityId: 'temizle', targetId: v1.id }],
      [doc, { abilityId: 'koru', targetId: doc.id }]]));
    await mod.until((v) => v.waiting.length === 0);
    await advance('dawn');
    const d1 = screen.view.report;
    assert.equal(d1.deaths.length, 1);
    assert.equal(d1.deaths[0].playerId, v1.id);
    assert.equal(d1.deaths[0].roleId, null, 'temizlenen ölünün rolü ekranda gizli');
    assert.equal(screen.view.players.find((p) => p.id === v1.id).role, null);

    // 1. gün oylama: eşitlik -> kimse elenmez
    await advance('day');
    await advance('vote');
    const voters = players.filter(alive);
    assert.equal(voters.length, 7);
    voters.forEach((c, i) => c.send({ type: 'vote', targetId: i === 6 ? null : i % 2 ? vamp.id : villagers[1].id })); // 3-3 + 1 çekimser
    await screen.until((v) => v.votesCast === voters.length);
    await advance('voteresult');
    assert.equal(screen.view.report.eliminated, null);

    // 2. gece: doktor korur -> kimse ölmez
    await advance('night');
    const v2 = villagers[1];
    nightAll(new Map([[vamp, { abilityId: 'oldur', targetId: v2.id }], [doc, { abilityId: 'koru', targetId: v2.id }]]));
    await mod.until((v) => v.waiting.length === 0);
    await advance('dawn');
    assert.equal(screen.view.report.deaths.length, 0);

    // 2. gün: vampir elenir, rolü açıklanır
    await advance('day');
    await advance('vote');
    for (const c of players.filter(alive)) c.send({ type: 'vote', targetId: c === vamp ? null : vamp.id });
    await screen.until((v) => v.votesCast === players.filter(alive).length);
    await advance('voteresult');
    assert.equal(screen.view.report.eliminated.playerId, vamp.id);
    assert.equal(screen.view.report.eliminated.roleId, 'vampir');
    assert.equal(screen.view.players.find((p) => p.id === vamp.id).role.id, 'vampir');

    // 3. gece -> gün: temizlikçi elenir, köy kazanır
    await advance('night');
    nightAll(new Map([[cleaner, { abilityId: 'oldur', targetId: villagers[2].id }], [doc, { abilityId: 'koru', targetId: villagers[2].id }]]));
    await mod.until((v) => v.waiting.length === 0);
    await advance('dawn');
    await advance('day');
    await advance('vote');
    for (const c of players.filter(alive)) c.send({ type: 'vote', targetId: c === cleaner ? null : cleaner.id });
    await screen.until((v) => v.votesCast === players.filter(alive).length);
    await advance('voteresult');
    await advance('ended');
    assert.equal(screen.view.winner.team, 'koylu');

    // ---- denetim: oyun bitene kadar ekrana giden her mesaj
    const states = screen.msgs.filter((m) => m.type === 'state');
    assert.ok(states.length > 20);
    for (const m of screen.msgs) assert.ok(['hello', 'state'].includes(m.type), `ekrana beklenmeyen mesaj: ${m.type}`);
    for (const m of states) {
      const v = m.view;
      if (v.phase === 'ended') continue; // oyun sonunda herkesin rolü açıklanır
      assert.deepEqual(findSecretKeys(v), [], `faz ${v.phase}`);
      assert.equal(v.winner, null);
      for (const p of v.players) {
        if (p.role) assert.equal(p.alive, false, 'canlı oyuncunun rolü ekranda olmamalı');
        assert.deepEqual(Object.keys(p).sort(), ['alive', 'avatar', 'connected', 'id', 'name', 'role']);
      }
      if (v.report && v.report.deaths) {
        for (const d of v.report.deaths) {
          if (d.roleId) assert.equal(d.roleId, g.players.get(d.playerId).roleId);
        }
      }
      // gece: kimin hazır olduğu sızmaz (votesCast sadece oylamada, sayı olarak)
      if (v.phase !== 'vote') assert.ok(!('votesCast' in v));
      const s = JSON.stringify(v);
      for (const ab of ['oldur', 'temizle', 'koru', 'bak', '__decoy', '__pass']) assert.ok(!s.includes(`"${ab}"`), `${ab} sızdı (${v.phase})`);
    }
    assert.equal(srv.logs.length, 0, srv.logs.join('\n'));
  } finally {
    for (const c of players) c.ws.terminate();
    await srv.close();
  }
});
