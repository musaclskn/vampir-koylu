'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { loadRoles } = require('../server/game/roles');
const { suggestRoleCounts } = require('../server/game/setup');
const { Game, GameError } = require('../server/game/engine');
const { makeGame, byRole, ROLES_DIR } = require('./helpers');

// 10 kişilik dağılım (kahin, suçlayıcı, temizlikçi, avcı, doktor içerir)
const COUNTS10_FIX = { koylu: 4, vampir: 1, temizlikci: 1, suclayici: 1, doktor: 1, kahin: 1, avci: 1 };

// ------------------------------------------------------------------ roller
test('roller yüklenir ve doğrulanır', () => {
  const roles = loadRoles(ROLES_DIR);
  for (const id of ['koylu', 'vampir', 'doktor', 'kahin', 'avci', 'temizlikci', 'suclayici']) assert.ok(roles.has(id), id);
});

test('hatalı rol dosyası anlaşılır hata verir', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'roles-'));
  fs.writeFileSync(path.join(dir, 'bozuk.json'), JSON.stringify({
    id: 'bozuk', name: 'Bozuk', emoji: '?', description: 'x', team: 'koylu', category: 'siradan',
    abilities: [{ id: 'a', name: 'A', phase: 'night', target: 'player', effect: { type: 'ucmak' } }],
  }));
  assert.throws(() => loadRoles(dir), /bilinmeyen effect\.type "ucmak"/);
});

test('tarafsız rol win.type team olamaz', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'roles-'));
  fs.writeFileSync(path.join(dir, 'soytari.json'), JSON.stringify({
    id: 'soytari', name: 'Soytarı', emoji: '🤡', description: 'x', team: 'tarafsiz', category: 'gizemli',
  }));
  assert.throws(() => loadRoles(dir), /tarafsız bir rol/);
});

// ------------------------------------------------------------------ kurulum önerisi
test('öneri toplamı her zaman oyuncu sayısına eşit', () => {
  const roles = loadRoles(ROLES_DIR);
  for (let n = 4; n <= 30; n++) {
    const c = suggestRoleCounts(n, roles);
    const total = Object.values(c).reduce((a, b) => a + b, 0);
    assert.equal(total, n, `n=${n} ${JSON.stringify(c)}`);
    const vamps = ['vampir', 'temizlikci', 'suclayici'].reduce((a, id) => a + c[id], 0);
    assert.ok(vamps >= 1 && vamps < n - vamps, `n=${n} vampir=${vamps}`);
  }
});

test('öneri: 12 kişide özel roller devreye girer', () => {
  const roles = loadRoles(ROLES_DIR);
  const c = suggestRoleCounts(12, roles);
  assert.equal(c.doktor, 1); assert.equal(c.kahin, 1); assert.equal(c.avci, 1);
  assert.equal(c.temizlikci + c.suclayici + c.vampir, 3);
  assert.ok(c.vampir >= 1);
});

test('kurulum doğrulaması: sayı uyuşmazlığı ve vampirsiz oyun reddedilir', () => {
  const roles = loadRoles(ROLES_DIR);
  const g = new Game({ roles });
  ['a', 'b', 'c', 'd', 'e'].forEach((n, i) => g.addPlayer({ name: n, avatar: ['vampir', 'cadi', 'peri', 'elf', 'zombi'][i] }));
  assert.ok(g.validateSetup({ koylu: 4 }).length > 0);
  assert.ok(g.validateSetup({ koylu: 5 }).some((m) => /vampir/i.test(m)));
  assert.deepEqual(g.validateSetup({ koylu: 4, vampir: 1 }), []);
});

// ------------------------------------------------------------------ lobi
test('aynı ad ve aynı avatar engellenir, oyun başlayınca katılım kapanır', () => {
  const roles = loadRoles(ROLES_DIR);
  const g = new Game({ roles });
  g.addPlayer({ name: 'Ali', avatar: 'vampir' });
  assert.throws(() => g.addPlayer({ name: 'ali', avatar: 'cadi' }), GameError);
  assert.throws(() => g.addPlayer({ name: 'Veli', avatar: 'vampir' }), GameError);
  assert.throws(() => g.addPlayer({ name: 'Veli', avatar: 'yok' }), GameError);
  g.addPlayer({ name: 'Veli', avatar: 'cadi' });
  g.addPlayer({ name: 'Ayşe', avatar: 'peri' });
  g.addPlayer({ name: 'Can', avatar: 'elf' });
  g.start();
  assert.throws(() => g.addPlayer({ name: 'Geç', avatar: 'zombi' }), /başladı/);
});

test('token ile yeniden bağlanma aynı oyuncuyu bulur', () => {
  const { g, ps } = makeGame(6, { koylu: 4, vampir: 1, doktor: 1 });
  assert.equal(g.playerByToken(ps[2].token).id, ps[2].id);
  assert.equal(g.playerByToken('yanlis'), null);
});

// ------------------------------------------------------------------ gece
function toNight(g) { g.advance(); assert.equal(g.phase, 'night'); }

test('vampir saldırısı öldürür, sabah rol açıklanır', () => {
  const { g, ps } = makeGame(6, { koylu: 4, vampir: 1, doktor: 1 }, { 0: 'vampir', 1: 'koylu' });
  toNight(g);
  g.submitNight(ps[0].id, { abilityId: 'oldur', targetId: ps[1].id });
  g.advance();
  assert.equal(g.phase, 'dawn');
  assert.equal(ps[1].alive, false);
  assert.equal(g.report.deaths.length, 1);
  assert.equal(g.report.deaths[0].roleId, 'koylu');
});

test('doktor korursa kimse ölmez', () => {
  const { g, ps } = makeGame(6, { koylu: 4, vampir: 1, doktor: 1 }, { 0: 'vampir', 1: 'koylu', 2: 'doktor' });
  toNight(g);
  g.submitNight(ps[0].id, { abilityId: 'oldur', targetId: ps[1].id });
  g.submitNight(ps[2].id, { abilityId: 'koru', targetId: ps[1].id });
  g.advance();
  assert.equal(ps[1].alive, true);
  assert.match(g.report.text, /kimse ölmedi/);
});

test('doktor kendini koruyabilir', () => {
  const { g, ps } = makeGame(6, { koylu: 4, vampir: 1, doktor: 1 }, { 0: 'vampir', 2: 'doktor' });
  toNight(g);
  g.submitNight(ps[0].id, { abilityId: 'oldur', targetId: ps[2].id });
  g.submitNight(ps[2].id, { abilityId: 'koru', targetId: ps[2].id });
  g.advance();
  assert.equal(ps[2].alive, true);
});

test('doktor üst üste iki gece aynı kişiyi koruyamaz; arada pas geçerse veya başkasını seçerse serbest', () => {
  const { g, ps } = makeGame(6, { koylu: 4, vampir: 1, doktor: 1 }, { 0: 'vampir', 1: 'doktor' });
  const nextNight = () => { g.advance(); g.advance(); g.advance(); g.advance(); }; // dawn, day, vote, voteresult
  const night = () => { assert.equal(g.phase, 'night'); };

  g.advance(); night(); // 1. gece
  g.submitNight(ps[1].id, { abilityId: 'koru', targetId: ps[2].id });
  g.advance(); nextNight(); night(); // 2. gece
  assert.throws(() => g.submitNight(ps[1].id, { abilityId: 'koru', targetId: ps[2].id }), /Üst üste/);
  g.submitNight(ps[1].id, { abilityId: 'koru', targetId: ps[3].id }); // başkası serbest
  g.submitNight(ps[1].id, { abilityId: '__pass' }); // pas geçti: 2. gece koruma yok
  g.advance(); nextNight(); night(); // 3. gece
  g.submitNight(ps[1].id, { abilityId: 'koru', targetId: ps[2].id }); // 1. geceden beri atlandı, serbest
});

test('doktor pas geçerse bir sonraki gece aynı kişiyi koruyabilir', () => {
  const { g, ps } = makeGame(6, { koylu: 4, vampir: 1, doktor: 1 }, { 0: 'vampir', 1: 'doktor' });
  const nextNight = () => { g.advance(); g.advance(); g.advance(); g.advance(); };
  g.advance();
  g.submitNight(ps[1].id, { abilityId: 'koru', targetId: ps[2].id }); // 1. gece koruma
  g.advance(); nextNight(); // 2. gece
  g.submitNight(ps[1].id, { abilityId: '__pass' });
  g.advance(); nextNight(); // 3. gece
  g.submitNight(ps[1].id, { abilityId: 'koru', targetId: ps[2].id }); // 2. gece kullanmadı -> serbest
  assert.ok(true);
});

test('birden fazla vampir ayrı ayrı öldürür; aynı hedef bir kez sayılır', () => {
  const { g, ps } = makeGame(8, { koylu: 5, vampir: 2, doktor: 1 }, { 0: 'vampir', 1: 'vampir', 2: 'koylu', 3: 'koylu', 4: 'koylu' });
  toNight(g);
  g.submitNight(ps[0].id, { abilityId: 'oldur', targetId: ps[2].id });
  g.submitNight(ps[1].id, { abilityId: 'oldur', targetId: ps[3].id });
  g.advance();
  assert.equal(ps[2].alive, false);
  assert.equal(ps[3].alive, false);
  assert.equal(g.report.deaths.length, 2);

  const r = makeGame(8, { koylu: 5, vampir: 2, doktor: 1 }, { 0: 'vampir', 1: 'vampir', 2: 'koylu' });
  r.g.advance();
  r.g.submitNight(r.ps[0].id, { abilityId: 'oldur', targetId: r.ps[2].id });
  r.g.submitNight(r.ps[1].id, { abilityId: 'oldur', targetId: r.ps[2].id });
  r.g.advance();
  assert.equal(r.g.report.deaths.length, 1);
});

test('vampir takım arkadaşını ve kendini hedefleyemez', () => {
  const { g, ps } = makeGame(8, { koylu: 5, vampir: 2, doktor: 1 }, { 0: 'vampir', 1: 'vampir' });
  toNight(g);
  assert.throws(() => g.submitNight(ps[0].id, { abilityId: 'oldur', targetId: ps[1].id }), /Takım arkadaşını/);
  assert.throws(() => g.submitNight(ps[0].id, { abilityId: 'oldur', targetId: ps[0].id }), /Kendini/);
});

test('rolünde olmayan yetenek kullanılamaz, gündüz yeteneği gece kullanılamaz', () => {
  const { g, ps } = makeGame(8, { koylu: 5, vampir: 1, avci: 1, doktor: 1 }, { 0: 'koylu', 1: 'avci' });
  toNight(g);
  assert.throws(() => g.submitNight(ps[0].id, { abilityId: 'oldur', targetId: ps[2].id }), /yeteneğin yok/);
  assert.throws(() => g.submitNight(ps[1].id, { abilityId: 'ates', targetId: ps[2].id }), /kullanılamaz/);
});

test('Temizlikçi: diğer vampir öldürürse ölenin rolü gizlenir', () => {
  const { g, ps } = makeGame(8, { koylu: 5, vampir: 1, temizlikci: 1, doktor: 1 }, { 0: 'vampir', 1: 'temizlikci', 2: 'koylu' });
  toNight(g);
  g.submitNight(ps[0].id, { abilityId: 'oldur', targetId: ps[2].id });
  g.submitNight(ps[1].id, { abilityId: 'temizle', targetId: ps[2].id });
  g.advance();
  assert.equal(ps[2].alive, false);
  assert.equal(g.report.deaths[0].roleId, null, 'rol gizli kalmalı');
  assert.match(g.report.deaths[0].text, /vampirler/);
  // ortak ekranda da rol görünmemeli
  const pub = g.publicView().players.find((p) => p.id === ps[2].id);
  assert.equal(pub.alive, false);
  assert.equal(pub.role, null);
});

test('Temizlikçi ya da diğer yetenek: aynı oyuncu tek eylem gönderir (son seçim geçerli)', () => {
  const { g, ps } = makeGame(8, { koylu: 5, vampir: 1, temizlikci: 1, doktor: 1 }, { 1: 'temizlikci', 2: 'koylu' });
  toNight(g);
  g.submitNight(ps[1].id, { abilityId: 'oldur', targetId: ps[2].id });
  g.submitNight(ps[1].id, { abilityId: 'temizle', targetId: ps[2].id }); // değiştirdi
  g.advance();
  assert.equal(ps[2].alive, true, 'temizlikçi ısırmadı');
});

test('Kahin sadece kategori görür; Suçlayıcı onu yanıltır', () => {
  const { g, ps } = makeGame(10, COUNTS10_FIX, { 0: 'kahin', 1: 'koylu', 2: 'suclayici' });
  toNight(g);
  g.submitNight(ps[0].id, { abilityId: 'bak', targetId: ps[1].id });
  g.submitNight(ps[2].id, { abilityId: 'suclama', targetId: ps[1].id });
  g.advance();
  const log = ps[0].privateLog.map((l) => l.text).join('\n');
  assert.match(log, /Saldırgan/);
  assert.doesNotMatch(log, /köylü|Köylü/i);

  // suçlama yokken masum köylü "Sıradan" görünür
  g.advance(); g.advance(); g.advance(); // dawn -> day -> vote -> voteresult
  g.advance();
  assert.equal(g.phase, 'night');
  g.submitNight(ps[0].id, { abilityId: 'bak', targetId: ps[1].id });
  g.advance();
  const log2 = ps[0].privateLog.map((l) => l.text).pop();
  assert.match(log2, /Sıradan/);
});

test('Kahin hiçbir zaman rol adını ya da tarafı söylemez', () => {
  const { g, ps } = makeGame(10, COUNTS10_FIX, { 0: 'kahin', 1: 'vampir' });
  toNight(g);
  g.submitNight(ps[0].id, { abilityId: 'bak', targetId: ps[1].id });
  g.advance();
  const msg = ps[0].privateLog.at(-1).text;
  assert.match(msg, /Saldırgan/);
  assert.doesNotMatch(msg, /vampir|Vampir/);
});

test('Doktor ve vampir birlikte: suçlayıcı gece öldürmez', () => {
  const { g, ps } = makeGame(10, COUNTS10_FIX, { 0: 'suclayici', 1: 'koylu' });
  toNight(g);
  g.submitNight(ps[0].id, { abilityId: 'suclama', targetId: ps[1].id });
  g.advance();
  assert.match(g.report.text, /kimse ölmedi/);
});

test('gece pas/sahte eylem geçerli ve etkisiz', () => {
  const { g, ps } = makeGame(6, { koylu: 4, vampir: 1, doktor: 1 }, { 0: 'koylu' });
  toNight(g);
  g.submitNight(ps[0].id, { abilityId: '__decoy', targetId: ps[1].id });
  g.advance();
  assert.match(g.report.text, /kimse ölmedi/);
});

// ------------------------------------------------------------------ avcı
function toDay(g) { g.advance(); g.advance(); assert.equal(g.phase, 'day'); } // night -> dawn -> day

test('Avcı vampire ateş eder: vampir ölür, avcı yaşar, mermi biter, ölüm sabaha duyurulur', () => {
  const { g, ps } = makeGame(8, { koylu: 5, vampir: 2, avci: 1 }, { 0: 'avci', 1: 'vampir' });
  g.advance(); // night
  toDay(g);
  g.useDayAbility(ps[0].id, { abilityId: 'ates', targetId: ps[1].id });
  assert.equal(ps[1].alive, false);
  assert.equal(ps[0].alive, true);
  assert.match(ps[0].privateLog.at(-1).text, /vampirdi/);
  // herkese açık görünümde henüz ölü görünmez
  assert.equal(g.publicView().players.find((p) => p.id === ps[1].id).alive, true);
  assert.throws(() => g.useDayAbility(ps[0].id, { abilityId: 'ates', targetId: ps[2].id }), /bitti/);
  // sonraki sabah duyurulur
  g.advance(); // vote
  g.advance(); // voteresult
  g.advance(); // night 2
  g.advance(); // dawn 2
  assert.equal(g.phase, 'dawn');
  assert.ok(g.report.deaths.some((d) => d.playerId === ps[1].id));
  assert.match(g.report.text, /avcının kurşunuyla/);
});

test('Avcı masuma ateş ederse ikisi de ölür', () => {
  const { g, ps } = makeGame(8, { koylu: 5, vampir: 2, avci: 1 }, { 0: 'avci', 1: 'koylu' });
  g.advance(); toDay(g);
  g.useDayAbility(ps[0].id, { abilityId: 'ates', targetId: ps[1].id });
  assert.equal(ps[1].alive, false);
  assert.equal(ps[0].alive, false);
  assert.match(ps[0].privateLog.map((l) => l.text).join(' '), /masumdu/);
});

test('Avcı gece ateş edemez, kendine ateş edemez', () => {
  const { g, ps } = makeGame(8, { koylu: 5, vampir: 2, avci: 1 }, { 0: 'avci' });
  g.advance();
  assert.throws(() => g.useDayAbility(ps[0].id, { abilityId: 'ates', targetId: ps[1].id }), /gündüz değil/);
  toDay(g);
  assert.throws(() => g.useDayAbility(ps[0].id, { abilityId: 'ates', targetId: ps[0].id }), /Kendini/);
});

test('Avcı son vampire ateş ederse oyun biter', () => {
  const { g, ps } = makeGame(6, { koylu: 4, vampir: 1, avci: 1 }, { 0: 'avci', 1: 'vampir' });
  g.advance(); toDay(g);
  g.useDayAbility(ps[0].id, { abilityId: 'ates', targetId: ps[1].id });
  assert.equal(g.winner.team, 'koylu');
  g.advance();
  assert.equal(g.phase, 'ended');
});

// ------------------------------------------------------------------ oylama
function toVote(g) { toDay(g); g.advance(); assert.equal(g.phase, 'vote'); }

test('çoğunluk elenir, rolü açıklanır; eşitlikte kimse elenmez', () => {
  const { g, ps } = makeGame(7, { koylu: 5, vampir: 1, doktor: 1 }, { 0: 'vampir' });
  g.advance(); toVote(g);
  for (let i = 1; i < 5; i++) g.submitVote(ps[i].id, ps[0].id);
  g.submitVote(ps[5].id, ps[1].id);
  g.advance();
  assert.equal(g.phase, 'voteresult');
  assert.equal(ps[0].alive, false);
  assert.equal(g.report.eliminated.roleId, 'vampir');
  assert.equal(g.winner.team, 'koylu');

  const t = makeGame(7, { koylu: 5, vampir: 1, doktor: 1 }, { 0: 'vampir' });
  t.g.advance(); toVote(t.g);
  t.g.submitVote(t.ps[1].id, t.ps[2].id);
  t.g.submitVote(t.ps[2].id, t.ps[1].id);
  t.g.advance();
  assert.match(t.g.report.text, /kimse elenmedi/);
  assert.equal(t.g.report.eliminated, null);
});

test('oy gizli: ortak ekran ve diğer oyuncular kimin kime oy verdiğini görmez', () => {
  const { g, ps } = makeGame(7, { koylu: 5, vampir: 1, doktor: 1 });
  g.advance(); toVote(g);
  g.submitVote(ps[1].id, ps[2].id);
  const pub = JSON.stringify(g.publicView());
  assert.doesNotMatch(pub, /"votes"/);
  assert.equal(g.publicView().votesCast, 1);
  assert.doesNotMatch(JSON.stringify(g.viewFor(ps[3].id)), /"votes"/);
  assert.equal(g.viewFor(ps[3].id).me.myVote, undefined);
  assert.equal(g.viewFor(ps[1].id).me.myVote, ps[2].id);
});

test('ölüler oy kullanamaz, ölüye oy verilemez', () => {
  const { g, ps } = makeGame(7, { koylu: 5, vampir: 1, doktor: 1 }, { 0: 'vampir', 1: 'koylu' });
  g.advance();
  g.submitNight(ps[0].id, { abilityId: 'oldur', targetId: ps[1].id });
  toVote(g);
  assert.throws(() => g.submitVote(ps[1].id, ps[2].id), /Ölüler/);
  assert.throws(() => g.submitVote(ps[2].id, ps[1].id), /Ölü birine/);
});

// ------------------------------------------------------------------ kazanma
test('1 vampir, 2 köylü kalınca oyun sürer; 1v1 olunca vampir kazanır', () => {
  const { g, ps } = makeGame(4, { koylu: 2, vampir: 1, doktor: 1 }, { 0: 'vampir', 1: 'koylu' });
  g.advance();
  g.submitNight(ps[0].id, { abilityId: 'oldur', targetId: ps[1].id });
  g.advance();
  assert.equal(g.winner, null); // 3 kişi: 1 vampir, 2 diğer
  g.advance(); g.advance(); g.advance(); g.advance(); // day, vote, voteresult, night
  const victim = ps.find((p) => p.alive && p.roleId !== 'vampir');
  g.submitNight(ps[0].id, { abilityId: 'oldur', targetId: victim.id });
  g.advance();
  assert.equal(g.winner.team, 'vampir');
  g.advance();
  assert.equal(g.phase, 'ended');
  assert.ok(g.publicView().winner.reveal.length === 4);
});

// ------------------------------------------------------------------ gizlilik
test('oyuncu görünümü başkalarının rolünü sızdırmaz; vampirler birbirini görür', () => {
  const { g, ps } = makeGame(8, { koylu: 5, vampir: 2, doktor: 1 }, { 0: 'vampir', 1: 'vampir', 2: 'doktor', 3: 'koylu' });
  const v = g.viewFor(ps[3].id);
  assert.equal(v.me.role.id, 'koylu');
  assert.deepEqual(v.me.teammates, []);
  for (const p of v.players) assert.equal(p.role, null);
  // başkasının rol bilgisi hiçbir yerde geçmemeli (kendi rolü hariç)
  assert.doesNotMatch(JSON.stringify(v), /"id":"(vampir|doktor)"/);

  const vamp = g.viewFor(ps[0].id);
  assert.equal(vamp.me.teammates.length, 1);
  assert.equal(vamp.me.teammates[0].id, ps[1].id);
  assert.equal(vamp.me.teammates[0].role.id, 'vampir');
});

test('moderatör görünümü tüm rolleri ve bekleyenleri gösterir', () => {
  const { g, ps } = makeGame(6, { koylu: 4, vampir: 1, doktor: 1 });
  g.advance();
  const m = g.modView();
  assert.ok(m.players.every((p) => p.role));
  assert.equal(m.waiting.length, 6);
  g.submitNight(ps[0].id, { abilityId: '__pass' });
  assert.equal(g.modView().waiting.length, 5);
});

test('oyuncu atılınca ölür ve kazanma kontrolü yapılır', () => {
  const { g, ps } = makeGame(6, { koylu: 4, vampir: 1, doktor: 1 }, { 0: 'vampir' });
  g.advance();
  g.kickPlayer(ps[0].id);
  assert.equal(g.winner.team, 'koylu');
});

// ------------------------------------------------------------------ yeni oyun (oyuncuları koru)
test('restartKeepPlayers: oyuncular, tokenlar ve ayarlar korunur, oyun lobiye döner', () => {
  const { g, ps } = makeGame(8, { koylu: 4, vampir: 2, doktor: 1, kahin: 1 });
  g.setConnected(ps[3].id, false);
  g.advance(); // gece
  const v = ps.find((p) => p.roleId === 'vampir');
  const victim = ps.find((p) => g.roles.get(p.roleId).team === 'koylu');
  g.submitNight(v.id, { abilityId: 'oldur', targetId: victim.id });
  g.advance(); // şafak
  assert.equal(victim.alive, false);
  const before = ps.map((p) => ({ id: p.id, token: p.token, name: p.name, avatar: p.avatar }));
  let changes = 0;
  g.on('change', () => {
    changes += 1;
    assert.equal(g.players.size, 8, 'change sırasında oyuncular eksik görünmemeli');
  });
  g.restartKeepPlayers();
  assert.equal(changes, 1);
  assert.equal(g.phase, 'lobby');
  assert.equal(g.day, 0);
  assert.equal(g.winner, null);
  assert.deepEqual(g.config.roleCounts, { koylu: 4, vampir: 2, doktor: 1, kahin: 1 });
  for (const b of before) {
    const p = g.playerByToken(b.token);
    assert.ok(p, 'token geçerli kalmalı');
    assert.equal(p.id, b.id); assert.equal(p.name, b.name); assert.equal(p.avatar, b.avatar);
    assert.equal(p.alive, true); assert.equal(p.roleId, null); assert.equal(p.death, null);
    assert.deepEqual(p.privateLog, []);
  }
  assert.equal(g.players.get(ps[3].id).connected, false);
  // eski oyuncu nesneleri motordan kopmuş olmalı (yeni nesneler)
  assert.notEqual(g.players.get(victim.id), victim);
  g.start();
  assert.equal(g.phase, 'rolereveal');
  assert.ok([...g.players.values()].every((p) => p.roleId));
});

test('reset: oyuncular dahil her şey silinir', () => {
  const { g, ps } = makeGame(5, { koylu: 4, vampir: 1 });
  g.reset();
  assert.equal(g.players.size, 0);
  assert.equal(g.playerByToken(ps[0].token), null);
  assert.equal(g.phase, 'lobby');
});
