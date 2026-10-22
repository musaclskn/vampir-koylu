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
