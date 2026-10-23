'use strict';
// Sunucu testleri: gerçek HTTP + WebSocket sunucusu açılır, 8 sahte telefon ve moderatör bağlanır.
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const http = require('http');
const WebSocket = require('ws');
const { loadRoles } = require('../server/game/roles');
const { createServer } = require('../server/app');
const { isLoopback, lanAddresses } = require('../server/net');
const { AVATARS } = require('../server/game/avatars');
const { ROLES_DIR } = require('./helpers');

// ------------------------------------------------------------------ yardımcılar
async function startServer(host = '127.0.0.1', opts = {}) {
  const roles = loadRoles(ROLES_DIR);
  const logs = [];
  const srv = createServer({ roles, joinUrl: 'http://127.0.0.1:0/', log: (...a) => logs.push(a.join(' ')), ...opts });
  await new Promise((r) => srv.server.listen(0, host, r));
  srv.port = srv.server.address().port;
  srv.logs = logs;
  return srv;
}

/** Mesajları biriktiren basit WS istemcisi. */
class Client {
  constructor(port, as, { host = '127.0.0.1', headers } = {}) {
    this.msgs = [];
    this.waiters = [];
    this.ws = new WebSocket(`ws://${host}:${port}/ws?as=${as}`, { headers });
    this.ws.on('message', (d) => {
      const m = JSON.parse(d.toString());
      this.msgs.push(m);
      if (m.type === 'state') this.view = m.view;
      this.waiters = this.waiters.filter((w) => (w.pred(m) ? (w.resolve(m), false) : true));
    });
    this.opened = new Promise((res, rej) => {
      this.ws.once('open', res);
      this.ws.once('unexpected-response', (req, resp) => rej(Object.assign(new Error(`HTTP ${resp.statusCode}`), { status: resp.statusCode })));
      this.ws.once('error', rej);
    });
    this.closed = new Promise((res) => this.ws.once('close', (code) => res(code)));
  }
  send(o) { this.ws.send(JSON.stringify(o)); }
  /** Koşulu sağlayan bir sonraki mesajı bekler (zaten gelmişse ve since verilmişse onu da sayar). */
  next(pred, timeout = 2000) {
    return new Promise((resolve, reject) => {
      const w = { pred, resolve };
      this.waiters.push(w);
      setTimeout(() => { this.waiters = this.waiters.filter((x) => x !== w); reject(new Error('zaman aşımı')); }, timeout).unref();
    });
  }
  /** Görünüm koşulu sağlayana kadar bekle (şu anki görünüm dahil). */
  async until(pred, timeout = 2000) {
    if (this.view && pred(this.view)) return this.view;
    const m = await this.next((x) => x.type === 'state' && pred(x.view), timeout);
    return m.view;
  }
  close() { this.ws.close(); return this.closed; }
}

const tick = () => new Promise((r) => setTimeout(r, 30));

// ------------------------------------------------------------------ birim: loopback
test('isLoopback: sadece bu bilgisayar kabul edilir', () => {
  for (const a of ['127.0.0.1', '::1', '::ffff:127.0.0.1', '127.5.6.7', '[::1]', '0:0:0:0:0:0:0:1', '::FFFF:127.0.0.1']) {
    assert.equal(isLoopback(a), true, a);
  }
  for (const a of ['192.168.1.20', '10.0.0.5', '::ffff:192.168.1.20', 'fe80::1', '0.0.0.0', '', null, undefined,
    '127.0.0.1.evil', '1127.0.0.1', '::ffff:10.0.0.1', '128.0.0.1', '172.16.0.1', 'localhost', '127.999.0.1']) {
    assert.equal(isLoopback(a), false, String(a));
  }
});

test('lanAddresses: ev ağı öne çıkar, sanal/VPN arayüzleri geriye düşer', () => {
  const ifaces = {
    'vEthernet (WSL)': [{ family: 'IPv4', address: '172.22.48.1', internal: false }],
    'VirtualBox Host-Only Network': [{ family: 'IPv4', address: '192.168.56.1', internal: false }],
    'Loopback Pseudo-Interface 1': [{ family: 'IPv4', address: '127.0.0.1', internal: true }],
    Tailscale: [{ family: 'IPv4', address: '100.101.1.2', internal: false }],
    'Wi-Fi': [{ family: 'IPv4', address: '192.168.1.34', internal: false }, { family: 'IPv6', address: 'fe80::1', internal: false }],
    Ethernet: [{ family: 4, address: '169.254.10.10', internal: false }],
  };
  const list = lanAddresses(ifaces);
  assert.equal(list[0].address, '192.168.1.34');
  assert.ok(!list.some((a) => a.address.startsWith('169.254.')));
  assert.ok(!list.some((a) => a.address === '127.0.0.1'));
  const vbox = list.find((a) => a.address === '192.168.56.1');
  assert.equal(vbox.virtual, true);
  assert.ok(list.indexOf(vbox) > 0);
  // Sadece 10.x olan bir ağ da bulunur
  assert.equal(lanAddresses({ wlan0: [{ family: 'IPv4', address: '10.0.0.7', internal: false }] })[0].address, '10.0.0.7');
});

// ------------------------------------------------------------------ HTTP
function get(port, path, host = '127.0.0.1', headers = {}) {
  return new Promise((resolve, reject) => {
    http.get({ host, port, path, headers }, (res) => {
      let body = '';
      res.on('data', (d) => { body += d; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    }).on('error', reject);
  });
}

function post(port, path, json, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(json || {});
    const req = http.request({ host: '127.0.0.1', port, path, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), ...headers } }, (res) => {
      let body = '';
      res.on('data', (d) => { body += d; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: body ? JSON.parse(body) : null }));
    });
    req.on('error', reject);
    req.end(data);
  });
}
const cookieOf = (res) => String((res.headers['set-cookie'] || [])[0] || '').split(';')[0];

test('HTTP rotaları çalışır', async () => {
  const srv = await startServer();
  try {
    const home = await get(srv.port, '/');
    assert.equal(home.status, 200);
    assert.match(home.body, /\/oyuncu\/app\.js/);
    assert.match(home.headers['content-security-policy'], /default-src 'self'/);
    assert.equal((await get(srv.port, '/ekran')).status, 200);
    assert.equal((await get(srv.port, '/mod')).status, 200);
    const qr = await get(srv.port, '/api/qr.svg');
    assert.equal(qr.status, 200);
    assert.match(qr.headers['content-type'], /svg/);
    assert.match(qr.body, /<svg/);
    const av = JSON.parse((await get(srv.port, '/api/avatars')).body);
    assert.equal(av.length, AVATARS.length);
    assert.equal((await get(srv.port, '/yok')).status, 404);
  } finally { await srv.close(); }
});

// Bu makinenin loopback olmayan bir IPv4 adresi varsa, gerçekten "LAN'dan" bağlanmayı dener
const lanIp = Object.values(os.networkInterfaces()).flat().find((i) => i && (i.family === 'IPv4' || i.family === 4) && !i.internal);
test('LAN adresinden /mod ve mod WebSocket reddedilir, oyuncu/ekran açık', { skip: !lanIp && 'loopback dışı ağ arayüzü yok' }, async () => {
  const srv = await startServer('0.0.0.0');
  try {
    const ip = lanIp.address;
    assert.equal((await get(srv.port, '/mod', ip)).status, 403);
    assert.equal((await get(srv.port, '/mod/index.html', ip)).status, 403);
    assert.equal((await get(srv.port, '/', ip)).status, 200);
    assert.equal((await get(srv.port, '/ekran', ip)).status, 200);
    const mod = new Client(srv.port, 'mod', { host: ip });
    await assert.rejects(mod.opened, (e) => e.status === 403);
    const p = new Client(srv.port, 'oyuncu', { host: ip });
    await p.opened;
    const e = new Client(srv.port, 'ekran', { host: ip });
    await e.opened;
    p.close(); e.close();
    // loopback'ten mod açılır
    const ok = new Client(srv.port, 'mod');
    await ok.opened;
    ok.close();
  } finally { await srv.close(); }
});

test('mod WS: yabancı Origin reddedilir, bilinmeyen istemci türü reddedilir', async () => {
  const srv = await startServer();
  try {
    const evil = new Client(srv.port, 'mod', { headers: { Origin: 'http://kotu-site.example' } });
    await assert.rejects(evil.opened, (e) => e.status === 403);
    const local = new Client(srv.port, 'mod', { headers: { Origin: `http://localhost:${srv.port}` } });
    await local.opened;
    local.close();
    const weird = new Client(srv.port, 'admin');
    await assert.rejects(weird.opened, (e) => e.status === 400);
  } finally { await srv.close(); }
});

// ------------------------------------------------------------------ şifreli moderatör girişi
test('şifre modu: giriş yapmadan panel, bilgi ve mod WS kapalı (bu bilgisayardan bile)', async () => {
  const srv = await startServer('127.0.0.1', { modPassword: 'gizli-sifre' });
  try {
    const page = await get(srv.port, '/mod');
    assert.equal(page.status, 200);
    assert.match(page.body, /\/giris\/app\.js/, 'giriş ekranı gelmeli');
    assert.doesNotMatch(page.body, /\/mod\/app\.js/);
    assert.equal((await get(srv.port, '/giris/app.js')).status, 200);
    assert.equal((await get(srv.port, '/mod/app.js')).status, 403);
    assert.equal((await get(srv.port, '/api/info')).status, 403);
    const mod = new Client(srv.port, 'mod');
    await assert.rejects(mod.opened, (e) => e.status === 403);
    // oyuncu ve ekran şifresiz açık
    assert.equal((await get(srv.port, '/')).status, 200);
    const p = new Client(srv.port, 'oyuncu');
    await p.opened;
    p.close();
  } finally { await srv.close(); }
});

test('şifre modu: yanlış şifre reddedilir, doğru şifre oturum açar, çıkış oturumu kapatır', async () => {
  const srv = await startServer('127.0.0.1', { modPassword: 'gizli-sifre' });
  try {
    const bad = await post(srv.port, '/api/mod/login', { password: 'yanlis' });
    assert.equal(bad.status, 401);
    assert.equal(bad.headers['set-cookie'], undefined);
    assert.equal((await post(srv.port, '/api/mod/login', {})).status, 401);

    const ok = await post(srv.port, '/api/mod/login', { password: 'gizli-sifre' });
    assert.equal(ok.status, 200);
    const setCookie = ok.headers['set-cookie'][0];
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /SameSite=Strict/);
    const Cookie = cookieOf(ok);

    const page = await get(srv.port, '/mod', '127.0.0.1', { Cookie });
    assert.match(page.body, /\/mod\/app\.js/, 'panel gelmeli');
    const info = JSON.parse((await get(srv.port, '/api/info', '127.0.0.1', { Cookie })).body);
    assert.equal(info.passwordMode, true);

    const mod = new Client(srv.port, 'mod', { headers: { Cookie, Origin: `http://127.0.0.1:${srv.port}` } });
    await mod.opened;
    await mod.until((v) => Array.isArray(v.roles));
    mod.close();
    const evil = new Client(srv.port, 'mod', { headers: { Cookie, Origin: 'http://kotu-site.example' } });
    await assert.rejects(evil.opened, (e) => e.status === 403);
    const forged = new Client(srv.port, 'mod', { headers: { Cookie: 'vk_mod=uydurma' } });
    await assert.rejects(forged.opened, (e) => e.status === 403);

    assert.equal((await post(srv.port, '/api/mod/logout', {}, { Cookie })).status, 200);
    assert.equal((await get(srv.port, '/api/info', '127.0.0.1', { Cookie })).status, 403);
  } finally { await srv.close(); }
});

test('şifre modu: 5 yanlış denemeden sonra doğru şifre de bir süre reddedilir', async () => {
  const srv = await startServer('127.0.0.1', { modPassword: 'gizli-sifre' });
  try {
    for (let i = 0; i < 5; i++) assert.equal((await post(srv.port, '/api/mod/login', { password: `x${i}` })).status, 401);
    const locked = await post(srv.port, '/api/mod/login', { password: 'gizli-sifre' });
    assert.equal(locked.status, 401);
    assert.match(locked.body.message, /Çok fazla/);
  } finally { await srv.close(); }
});

test('şifre yoksa giriş uç noktası kapalı, panel eskisi gibi bu bilgisayardan şifresiz açılır', async () => {
  const srv = await startServer();
  try {
    assert.equal((await post(srv.port, '/api/mod/login', { password: 'x' })).status, 404);
    const page = await get(srv.port, '/mod');
    assert.match(page.body, /\/mod\/app\.js/);
    assert.equal(JSON.parse((await get(srv.port, '/api/info')).body).passwordMode, false);
  } finally { await srv.close(); }
});

// ------------------------------------------------------------------ hatalar ve sınırlar
test('hatalı mesajlar sunucuyu düşürmez; motor hataları istemciye iletilir', async () => {
  const srv = await startServer();
  try {
    const c = new Client(srv.port, 'oyuncu');
    await c.opened;
    c.ws.send('bu json değil');
    assert.equal((await c.next((m) => m.type === 'error')).message, 'Geçersiz mesaj.');
    c.send({ type: 'join', name: '', avatar: 'kedi' });
    assert.equal((await c.next((m) => m.type === 'error')).message, 'Bir ad girmelisin.');
    c.send({ type: 'join', name: 'Ali', avatar: 'yok-boyle' });
    assert.equal((await c.next((m) => m.type === 'error')).message, 'Geçersiz avatar.');
    c.send({ type: 'vote', targetId: null });
    assert.match((await c.next((m) => m.type === 'error')).message, /katılmalısın/);
    c.send({ type: 'join', name: { toString: 1 }, avatar: ['kedi'] });
    await c.next((m) => m.type === 'error');
    // oyuncu mod komutu gönderemez
    c.send({ type: 'join', name: 'Ali', avatar: 'kedi' });
    await c.next((m) => m.type === 'token');
    c.send({ type: 'start' });
    assert.equal((await c.next((m) => m.type === 'error')).message, 'Bilinmeyen istek.');
    c.send({ type: 'reset' });
    await c.next((m) => m.type === 'error');
    assert.equal(srv.game.players.size, 1);
    // ekran mesaj gönderemez
    const e = new Client(srv.port, 'ekran');
    await e.opened;
    e.send({ type: 'advance' });
    await e.next((m) => m.type === 'error');
    // 4KB üstü mesaj bağlantıyı kapatır, sunucu ayakta kalır
    const big = new Client(srv.port, 'oyuncu');
    await big.opened;
    big.ws.send(JSON.stringify({ type: 'join', name: 'x'.repeat(5000), avatar: 'ay' }));
    assert.equal(await big.closed, 1009);
    assert.equal((await get(srv.port, '/api/avatars')).status, 200);
    c.close(); e.close();
  } finally { await srv.close(); }
});

test('hız sınırı: kısa sürede çok mesaj gönderen yavaşlatılır', async () => {
  const srv = await startServer();
  try {
    const c = new Client(srv.port, 'oyuncu');
    await c.opened;
    for (let i = 0; i < 60; i++) c.send({ type: 'ping' });
    await c.next((m) => m.type === 'error' && /yavaşla/.test(m.message));
    const pongs = c.msgs.filter((m) => m.type === 'pong').length;
    assert.ok(pongs >= 25 && pongs < 60, `pong=${pongs}`);
    c.close();
  } finally { await srv.close(); }
});

// ------------------------------------------------------------------ tam oyun
const NAMES = ['Ayşe', 'Burak', 'Cem', 'Deniz', 'Elif', 'Fatih', 'Gül', 'Hakan'];

/** Bir oyuncunun gördüğü HER durum mesajında başkasının rolü sızıyor mu? */
function assertNoLeak(client, allIds) {
  for (const m of client.msgs) {
    if (m.type !== 'state') continue;
    const v = m.view;
    for (const k of ['nightActions', 'votes', 'config', 'log', 'waiting', 'roles', 'suggestion']) {
      assert.ok(!(k in v), `${client.name}: oyuncu görünümünde "${k}" olmamalı`);
    }
    if (v.phase === 'ended') continue; // oyun sonunda herkesin rolü açıklanır
    const me = v.me;
    const mateIds = new Set(me && me.teammates ? me.teammates.map((t) => t.id) : []);
    if (me && me.role && me.role.team !== 'vampir') assert.equal(mateIds.size, 0, 'köylü takım arkadaşı görmemeli');
    for (const p of v.players) {
      if (me && p.id === me.id) continue;
      if (p.role) assert.equal(p.alive, false, `${client.name}: canlı ${p.id} oyuncusunun rolü görünmemeli`);
    }
    if (v.winner) assert.fail('oyun bitmeden winner görünmemeli');
    // Başka oyuncunun özel günlüğü / tokenı yok
    const s = JSON.stringify(v);
    assert.doesNotMatch(s, /"token"/);
    for (const id of allIds) if (!me || id !== me.id) assert.ok(!s.includes(`"privateLog"`));
  }
}

test('tam oyun: 8 telefon + ekran + moderatör, katılım, yeniden bağlanma, gizlilik', async () => {
  const srv = await startServer();
  const clients = [];
  try {
    const mod = new Client(srv.port, 'mod');
    const screen = new Client(srv.port, 'ekran');
    await Promise.all([mod.opened, screen.opened]);

    // ---- katılım
    for (let i = 0; i < 8; i++) {
      const c = new Client(srv.port, 'oyuncu');
      c.name = NAMES[i];
      await c.opened;
      c.send({ type: 'join', name: NAMES[i], avatar: AVATARS[i].id });
      const t = await c.next((m) => m.type === 'token');
      c.token = t.token; c.id = t.playerId;
      clients.push(c);
    }
    // aynı avatar / ad reddedilir
    const dup = new Client(srv.port, 'oyuncu');
    await dup.opened;
    dup.send({ type: 'join', name: 'ayşe', avatar: AVATARS[20].id });
    assert.equal((await dup.next((m) => m.type === 'error')).message, 'Bu ad zaten alınmış.');
    dup.send({ type: 'join', name: 'Yeni', avatar: AVATARS[0].id });
    assert.equal((await dup.next((m) => m.type === 'error')).message, 'Bu avatar zaten seçilmiş.');
    dup.close();

    const mv = await mod.until((v) => v.players.length === 8);
    assert.ok(mv.config && mv.suggestion, 'mod tam görünüm almalı');
    await screen.until((v) => v.players.length === 8);
    assert.ok(!('me' in screen.view));

    // ---- yeniden bağlanma (sayfa yenileme): aynı oyuncuya döner
    const old = clients[2];
    await old.close();
    await mod.until((v) => v.players.find((p) => p.id === old.id).connected === false);
    const re = new Client(srv.port, 'oyuncu');
    re.name = old.name;
    await re.opened;
    re.send({ type: 'resume', token: old.token });
    const rt = await re.next((m) => m.type === 'token');
    assert.equal(rt.playerId, old.id);
    re.token = old.token; re.id = old.id;
    clients[2] = re;
    await mod.until((v) => v.players.find((p) => p.id === old.id).connected === true);
    await re.until((v) => v.me && v.me.id === old.id);
    assert.equal(srv.game.players.size, 8);

    // geçersiz token
    const bad = new Client(srv.port, 'oyuncu');
    await bad.opened;
    bad.send({ type: 'resume', token: 'f'.repeat(32) });
    await bad.next((m) => m.type === 'resumeFailed');
    bad.close();

    // ---- kurulum ve başlangıç
    mod.send({ type: 'suggest', n: 8 });
    const sug = await mod.next((m) => m.type === 'suggestion');
    assert.equal(Object.values(sug.counts).reduce((a, b) => a + b, 0), 8);
    mod.send({ type: 'setConfig', config: { roleCounts: { koylu: 4, vampir: 2, doktor: 1, kahin: 1 }, durations: { night: 60 } } });
    await mod.until((v) => v.config.roleCounts.vampir === 2);
    mod.send({ type: 'start' });
    await Promise.all(clients.map((c) => c.until((v) => v.phase === 'rolereveal' && v.me.role)));

    const roleOf = new Map(clients.map((c) => [c.id, c.view.me.role]));
    const vamps = clients.filter((c) => roleOf.get(c.id).team === 'vampir');
    const town = clients.filter((c) => roleOf.get(c.id).team !== 'vampir');
    assert.equal(vamps.length, 2);
    // vampirler birbirini görür, köylüler kimseyi görmez
    for (const v of vamps) assert.deepEqual(v.view.me.teammates.map((t) => t.id), vamps.filter((x) => x !== v).map((x) => x.id));
    for (const t of town) assert.equal(t.view.me.teammates.length, 0);
    // her telefon sadece kendi rolünü bilir
    for (const c of clients) for (const p of c.view.players) assert.equal(p.role, null);
    // ekran rol görmez
    for (const p of screen.view.players) assert.equal(p.role, null);
    // mod hepsini görür
    const mv2 = await mod.until((v) => v.phase === 'rolereveal');
    assert.ok(mv2.players.every((p) => p.role));

    // ---- oyun döngüsü: vampirler köylü ısırır, köy vampir asar
    const alive = (c) => srv.game.players.get(c.id).alive;
    const phase = (p) => Promise.all([...clients, screen, mod].map((c) => c.until((v) => v.phase === p)));
    let guard = 0;
    const seen = new Set();
    while (true) {
      if (++guard > 40) assert.fail('oyun bitmedi');
      const ph = srv.game.phase;
      seen.add(ph);
      if (ph === 'ended') break;
      await phase(ph);
      if (ph === 'night') {
        const victim = town.find(alive);
        for (const c of clients.filter(alive)) {
          if (roleOf.get(c.id).team === 'vampir') c.send({ type: 'night', abilityId: 'oldur', targetId: victim.id });
          else if (c.view.me.hasNightAbility) c.send({ type: 'night', abilityId: '__pass' });
          else c.send({ type: 'night', abilityId: '__decoy', targetId: clients.find((o) => o !== c && alive(o)).id });
        }
        await mod.until((v) => v.waiting.length === 0);
        // gece seçimi kendi görünümüne yansır
        const anyVamp = vamps.find(alive);
        const vv = await anyVamp.until((v) => v.me.nightChoice);
        assert.equal(vv.me.nightChoice.targetId, victim.id);
        // vampir kendi takım arkadaşını ısıramaz
        const mate = vamps.find((x) => x !== anyVamp && alive(x));
        if (mate) {
          anyVamp.send({ type: 'night', abilityId: 'oldur', targetId: mate.id });
          assert.equal((await anyVamp.next((m) => m.type === 'error')).message, 'Takım arkadaşını seçemezsin.');
        }
      } else if (ph === 'vote') {
        const target = vamps.find(alive);
        const voters = clients.filter(alive);
        for (const c of voters.slice(0, -1)) c.send({ type: 'vote', targetId: target.id });
        await mod.until((v) => v.waiting.length === 1);
        await screen.until((v) => v.votesCast === voters.length - 1);
        assert.ok(!('votes' in screen.view), 'ekran kim kime oy verdi görmemeli');
        // ölü biri oy veremez
        const deadOne = clients.find((c) => !alive(c));
        if (deadOne) {
          deadOne.send({ type: 'vote', targetId: null });
          assert.equal((await deadOne.next((m) => m.type === 'error')).message, 'Ölüler oy kullanamaz.');
        }
        // son oy gelince oylama moderatörsüz biter
        voters.at(-1).send({ type: 'vote', targetId: target.id });
        await mod.until((v) => v.phase !== 'vote');
        continue;
      } else if (ph === 'dawn') {
        const rv = clients[0].view.report;
        assert.equal(rv.kind, 'dawn');
      }
      mod.send({ type: 'advance' });
      await mod.next((m) => m.type === 'state' && m.view.phase !== ph);
    }
    for (const p of ['rolereveal', 'night', 'dawn', 'day', 'vote', 'voteresult', 'ended']) assert.ok(seen.has(p), `faz görülmedi: ${p}`);
    const end = await clients[0].until((v) => v.phase === 'ended');
    assert.equal(end.winner.team, 'koylu');
    assert.equal(end.winner.reveal.length, 8);
    assert.ok(end.winner.reveal.every((p) => p.role));
    for (const t of town) assert.ok(end.winner.winners.includes(t.id));

    // ---- gizlilik: oyun boyunca hiçbir telefona başkasının rolü sızmadı
    const ids = clients.map((c) => c.id);
    for (const c of clients) assertNoLeak(c, ids);
    for (const m of screen.msgs) if (m.type === 'state' && m.view.phase !== 'ended') {
      assert.ok(!('me' in m.view));
      for (const p of m.view.players) if (p.role) assert.equal(p.alive, false);
    }

    // ---- yeni oyun: oyuncular korunur, telefonlar lobiye döner
    mod.send({ type: 'reset' });
    await Promise.all(clients.map((c) => c.until((v) => v.phase === 'lobby' && v.me && v.me.role === null)));
    assert.equal(srv.game.players.size, 8);
    for (const c of clients) assert.equal(c.view.me.id, c.id);

    // ---- lobiden atma: telefona "kicked" gider
    const kicked = clients[7];
    mod.send({ type: 'kick', playerId: kicked.id });
    await kicked.next((m) => m.type === 'kicked');
    const kv = await kicked.until((v) => v.players.length === 7);
    assert.ok(!kv.me);
    kicked.send({ type: 'vote', targetId: null });
    assert.match((await kicked.next((m) => m.type === 'error')).message, /katılmalısın/);

    // ---- mod: isim güncelle ve tam sıfırla
    mod.send({ type: 'updatePlayer', playerId: clients[0].id, name: 'Ayşe Yeni' });
    await clients[0].until((v) => v.me && v.me.name === 'Ayşe Yeni');
    mod.send({ type: 'reset', keepPlayers: false });
    await clients[1].next((m) => m.type === 'kicked');
    assert.equal(srv.game.players.size, 0);

    // bağlantı kopunca oyuncu çevrimdışı görünür (motor tarafında)
    assert.equal(srv.logs.length, 0, `beklenmeyen sunucu logu: ${srv.logs.join('\n')}`);
    await tick();
  } finally {
    for (const c of clients) c.ws.terminate();
    await srv.close();
  }
});
