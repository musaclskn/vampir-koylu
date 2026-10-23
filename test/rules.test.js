'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeGame } = require('./helpers');

/** Oyunu kurar ve saati elle ilerletilebilir hale getirir. */
function timed(...args) {
  const r = makeGame(...args);
  const clock = { t: 1_000_000 };
  r.g.now = () => clock.t;
  r.skip = (sec) => { clock.t += sec * 1000; return r.g.tick(); };
  return r;
}

test('süre dolunca gece, şafak, gündüz, oylama ve sonuç moderatörsüz ilerler', () => {
  const { g, ps, skip } = timed(7, { koylu: 5, vampir: 1, doktor: 1 }, { 0: 'vampir', 1: 'koylu' });
  g.advance(); // rolereveal -> gece (tek moderatör işi)
  assert.equal(g.phase, 'night');
  g.submitNight(ps[0].id, { abilityId: 'oldur', targetId: ps[1].id }); // diğerleri hazır değil
  assert.equal(skip(10), false); // süre dolmadı
  assert.equal(g.phase, 'night');
  skip(g.config.durations.night);
  assert.equal(g.phase, 'dawn');
  assert.equal(ps[1].alive, false);
  skip(g.config.durations.dawn);
  assert.equal(g.phase, 'day');
  skip(g.config.durations.day);
  assert.equal(g.phase, 'vote');
  skip(g.config.durations.vote);
  assert.equal(g.phase, 'voteresult');
  skip(g.config.durations.voteresult);
  assert.equal(g.phase, 'night');
  assert.equal(g.day, 2);
});

test('süresiz (0) faz kendiliğinden ilerlemez', () => {
  const { g, skip } = timed(7, { koylu: 5, vampir: 1, doktor: 1 });
  g.config.durations.night = 0;
  g.advance();
  assert.equal(g.phaseEndsAt, null);
  skip(100000);
  assert.equal(g.phase, 'night');
});

test('rol dağıtma ekranı kendiliğinden geçmez', () => {
  const { g, skip } = timed(7, { koylu: 5, vampir: 1, doktor: 1 });
  skip(100000);
  assert.equal(g.phase, 'rolereveal');
});

test('asılmak için yaşayanların yarısından fazlası "as" demeli; pas oyları sayılır', () => {
  // 7 yaşayan: 1 as + 6 pas -> kimse asılmaz
  let r = timed(7, { koylu: 5, vampir: 1, doktor: 1 }, { 0: 'vampir' });
  r.g.advance(); r.g.phase = 'vote'; r.g.votes = {};
  r.g.submitVote(r.ps[1].id, r.ps[2].id);
  for (let i = 2; i < 7; i++) r.g.submitVote(r.ps[i].id, null);
  r.g.advance();
  assert.equal(r.ps[2].alive, true);
  assert.equal(r.g.report.eliminated, null);
  assert.equal(r.g.report.abstain, 6);

  // 7 yaşayan: 3 as + 4 pas -> kimse asılmaz (3 yarıdan fazla değil)
  r = timed(7, { koylu: 5, vampir: 1, doktor: 1 }, { 0: 'vampir' });
  r.g.advance(); r.g.phase = 'vote'; r.g.votes = {};
  for (let i = 1; i <= 3; i++) r.g.submitVote(r.ps[i].id, r.ps[0].id);
  r.g.advance();
  assert.equal(r.ps[0].alive, true);

  // 7 yaşayan: 4 as -> asılır
  r = timed(7, { koylu: 5, vampir: 1, doktor: 1 }, { 0: 'vampir' });
  r.g.advance(); r.g.phase = 'vote'; r.g.votes = {};
  for (let i = 1; i <= 4; i++) r.g.submitVote(r.ps[i].id, r.ps[0].id);
  r.g.advance();
  assert.equal(r.ps[0].alive, false);
});

test('Soytarı asılırsa tek başına kazanır; vampir/köylü kazanmaz', () => {
  const { g, ps } = timed(8, { koylu: 5, vampir: 1, soytari: 1, doktor: 1 }, { 0: 'vampir', 1: 'soytari' });
  g.advance(); g.phase = 'vote'; g.votes = {};
  for (let i = 2; i < 7; i++) g.submitVote(ps[i].id, ps[1].id); // 5/8 as
  g.advance();
  assert.equal(ps[1].alive, false);
  assert.equal(g.winner.team, 'tarafsiz');
  assert.deepEqual(g.winner.playerIds, [ps[1].id]);
  g.advance();
  assert.equal(g.phase, 'ended');
  assert.deepEqual(g.winner.playerIds, [ps[1].id]);
});

test('Soytarı gece vampirce öldürülürse kazanmaz, oyun normal sürer', () => {
  const { g, ps } = timed(8, { koylu: 5, vampir: 1, soytari: 1, doktor: 1 }, { 0: 'vampir', 1: 'soytari' });
  g.advance();
  g.submitNight(ps[0].id, { abilityId: 'oldur', targetId: ps[1].id });
  g.advance();
  assert.equal(ps[1].alive, false);
  assert.equal(g.winner, null);
});

test('vampirler gece takım arkadaşlarının seçimini görür, köylüler görmez', () => {
  const { g, ps } = timed(8, { koylu: 5, vampir: 2, doktor: 1 }, { 0: 'vampir', 1: 'vampir', 2: 'koylu' });
  g.advance();
  g.submitNight(ps[1].id, { abilityId: 'oldur', targetId: ps[2].id });
  const mate = g.viewFor(ps[0].id).me.teammates[0];
  assert.equal(mate.choice.targetId, ps[2].id);
  assert.equal(mate.choice.targetName, ps[2].name);
  assert.equal(g.viewFor(ps[3].id).me.teammates.length, 0);
  assert.doesNotMatch(JSON.stringify(g.publicView()), /targetName/);
});

test('vampiresKillSeparately kapalıyken vampirler ortak tek kişiyi keser', () => {
  const { g, ps } = timed(9, { koylu: 5, vampir: 3, doktor: 1 }, { 0: 'vampir', 1: 'vampir', 2: 'vampir', 3: 'koylu', 4: 'koylu' });
  g.config.options.vampiresKillSeparately = false;
  g.advance();
  g.submitNight(ps[0].id, { abilityId: 'oldur', targetId: ps[3].id });
  g.submitNight(ps[1].id, { abilityId: 'oldur', targetId: ps[3].id });
  g.submitNight(ps[2].id, { abilityId: 'oldur', targetId: ps[4].id });
  g.advance();
  assert.equal(ps[3].alive, false); // çoğunluk
  assert.equal(ps[4].alive, true);
  assert.equal(g.report.deaths.length, 1);
});

test('vampiresKillSeparately açıkken (varsayılan) 3 vampir 3 kişiyi öldürebilir', () => {
  const { g, ps } = timed(9, { koylu: 5, vampir: 3, doktor: 1 }, { 0: 'vampir', 1: 'vampir', 2: 'vampir', 3: 'koylu', 4: 'koylu', 5: 'koylu' });
  g.advance();
  [3, 4, 5].forEach((t, i) => g.submitNight(ps[i].id, { abilityId: 'oldur', targetId: ps[t].id }));
  g.advance();
  assert.equal(g.report.deaths.length, 3);
});

test('yaşayan herkes oy verince oylama süreyi beklemeden biter', () => {
  const { g, ps } = makeGame(5, { koylu: 4, vampir: 1 }, { 0: 'vampir' });
  g.advance(); g.advance(); g.advance(); g.advance(); // gece -> şafak -> gündüz -> oylama
  assert.equal(g.phase, 'vote');
  const alive = ps.filter((p) => p.alive);
  for (const p of alive.slice(0, -1)) g.submitVote(p.id, ps[0].id === p.id ? null : ps[0].id);
  assert.equal(g.phase, 'vote', 'son kişi oy vermeden bitmez');
  g.submitVote(alive.at(-1).id, null); // pas da oy sayılır
  assert.equal(g.phase, 'voteresult');
});

test('gündüz "oylamaya geç": yaşayan herkes isterse oylama başlar', () => {
  const { g, ps } = makeGame(5, { koylu: 4, vampir: 1 }, { 0: 'vampir' });
  g.advance(); g.advance(); g.advance(); // gece -> şafak -> gündüz
  assert.equal(g.phase, 'day');
  assert.deepEqual(g.publicView().skip, { count: 0, needed: 5 });
  g.voteSkipDay(ps[1].id);
  g.voteSkipDay(ps[2].id);
  g.voteSkipDay(ps[2].id); // aynı kişi iki kez sayılmaz
  assert.equal(g.viewFor(ps[1].id).me.skipped, true);
  assert.deepEqual(g.publicView().skip, { count: 2, needed: 5 });
  g.voteSkipDay(ps[2].id, false); // vazgeçti
  assert.equal(g.publicView().skip.count, 1);
  g.voteSkipDay(ps[2].id); g.voteSkipDay(ps[3].id); g.voteSkipDay(ps[4].id);
  assert.equal(g.phase, 'day', 'biri daha istemedi');
  g.voteSkipDay(ps[0].id);
  assert.equal(g.phase, 'vote');
  assert.throws(() => g.voteSkipDay(ps[4].id), /gündüz değil/);
});

test('rastgele rol yuvası: takımından bir rol verilir, ortak ekranda sadece "Rastgele" görünür', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const { g, ps } = makeGame(8, { koylu: 3, rastgele_koylu: 3, vampir: 1, rastgele_vampir: 1 }, {}, seed);
    const roles = ps.map((p) => g.roles.get(p.roleId));
    assert.equal(roles.filter((r) => r.team === 'vampir').length, 2, `seed ${seed}`);
    assert.equal(roles.filter((r) => r.team === 'koylu').length, 6, `seed ${seed}`);
    assert.ok(ps.every((p) => !p.roleId.startsWith('rastgele_')));
    const counts = g.publicView().roleCounts;
    assert.deepEqual(counts.find((c) => c.id === 'rastgele_koylu'), { id: 'rastgele_koylu', name: 'Rastgele Köylü', emoji: '❓', team: 'koylu', count: 3 });
  }
});

test('rastgele yuva panelde rol olarak listelenir ve vampir sayısı kuralına dahildir', () => {
  const { g } = makeGame(4, { koylu: 3, vampir: 1 });
  g.restartKeepPlayers();
  const mv = g.modView();
  for (const id of ['rastgele_koylu', 'rastgele_vampir', 'rastgele_tarafsiz']) assert.ok(mv.roles.some((r) => r.id === id && r.random), id);
  g.setConfig({ roleCounts: { koylu: 2, rastgele_vampir: 2 } });
  assert.ok(g.validateSetup().some((t) => /Vampir sayısı/.test(t)));
  g.setConfig({ roleCounts: { koylu: 3, rastgele_vampir: 1 } });
  assert.deepEqual(g.validateSetup(), []);
  assert.throws(() => g.setConfig({ roleCounts: { rastgele_ejderha: 1 } }), /Bilinmeyen rol/);
});

// ------------------------------------------------------------------ Soytarı: son 5 kişide gizli rastgele taraf
function jesterGame(seed = 7) {
  // 6 kişi: 0 vampir, 1 soytarı, 2-5 köylü tarafı
  return makeGame(6, { koylu: 3, doktor: 1, vampir: 1, soytari: 1 }, { 0: 'vampir', 1: 'soytari', 2: 'koylu' }, seed);
}

test('Soytarı 5 kişi kalınca hâlâ asılmadıysa gizlice rastgele bir taraf alır', () => {
  const sides = new Set();
  for (let seed = 1; seed <= 12; seed++) {
    const { g, ps } = jesterGame(seed);
    g.advance(); // gece
    assert.equal(ps[1].side, null, '6 kişide taraf yok');
    g.submitNight(ps[0].id, { abilityId: 'oldur', targetId: ps[2].id });
    g.advance(); // şafak: 5 kişi kaldı
    assert.equal(g.winner, null, 'oyun hemen bitmez');
    assert.ok(['koylu', 'vampir'].includes(ps[1].side), `seed ${seed}`);
    sides.add(ps[1].side);
    assert.match(ps[1].privateLog.at(-1).text, /Kader seni/);
    assert.equal(g.viewFor(ps[1].id).me.side.team, ps[1].side);
    // başkası göremez
    assert.equal(g.viewFor(ps[0].id).me.side, null);
    assert.ok(!JSON.stringify(g.publicView()).includes('"side"'));
  }
  assert.equal(sides.size, 2, 'iki taraf da çıkabilmeli');
});

test('taraf almış Soytarı asılırsa kazanmaz; tarafı kazanırsa ölmüş olsa bile kazanır', () => {
  const { g, ps } = jesterGame();
  g.advance();
  g.submitNight(ps[0].id, { abilityId: 'oldur', targetId: ps[2].id });
  g.advance(); // şafak, 5 kişi
  ps[1].side = 'koylu'; // testte tarafı sabitle
  g.advance(); g.advance(); // gündüz -> oylama
  for (const p of ps.filter((x) => x.alive)) g.submitVote(p.id, ps[1].id); // Soytarı asılır
  assert.equal(ps[1].alive, false);
  assert.equal(g.winner, null, 'asılarak kazanma bitti');
  // köy vampiri bulur
  g.advance(); // gece
  g.advance(); g.advance(); g.advance(); // şafak -> gündüz -> oylama
  for (const p of ps.filter((x) => x.alive)) g.submitVote(p.id, p.id === ps[0].id ? null : ps[0].id);
  assert.equal(g.winner.team, 'koylu');
  g.advance();
  assert.ok(g.winner.playerIds.includes(ps[1].id), 'ölü Soytarı köyle kazandı');
});

test('vampir tarafına yazılan Soytarı vampir sayılmaz ama vampirler kazanınca kazanır', () => {
  const { g, ps } = jesterGame();
  g.advance();
  g.submitNight(ps[0].id, { abilityId: 'oldur', targetId: ps[2].id });
  g.advance(); // 5 kişi: vampir, soytarı, 3 köylü tarafı
  ps[1].side = 'vampir';
  g._checkWinner();
  assert.equal(g.winner, null, '1 vampir 4 diğer: sürer');
  // gece 2 köylü daha ölür -> 1 vampir, soytarı, 1 köylü: vampir 1 < 2 diğer, sürer
  const town = ps.filter((p) => p.alive && p.roleId !== 'vampir' && p.roleId !== 'soytari');
  g.advance(); g.advance(); g.advance(); // gündüz -> oylama -> sonuç (kimse oy vermedi)
  g.advance(); // gece
  g.submitNight(ps[0].id, { abilityId: 'oldur', targetId: town[0].id });
  g.advance();
  assert.equal(g.winner, null);
  g.advance(); g.advance(); g.advance(); g.advance(); // gündüz, oylama, sonuç, gece
  g.submitNight(ps[0].id, { abilityId: 'oldur', targetId: town[1].id });
  g.advance(); // 1 vampir, soytarı, 1 köylü -> sürer
  assert.equal(g.winner, null);
  g.advance(); g.advance(); g.advance(); g.advance();
  g.submitNight(ps[0].id, { abilityId: 'oldur', targetId: town[2].id });
  g.advance(); // 1 vampir, soytarı -> eşitlik, vampirler kazanır
  assert.equal(g.winner.team, 'vampir');
  g.advance();
  assert.ok(g.winner.playerIds.includes(ps[1].id));
});
