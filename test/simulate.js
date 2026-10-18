'use strict';
// Rastgele oynayan botlarla çok sayıda oyun oynatır; motorun hata vermeden bittiğini doğrular.
const { makeGame, seeded } = require('./helpers');
const { suggestRoleCounts } = require('../server/game/setup');
const { loadRoles } = require('../server/game/roles');
const { ROLES_DIR } = require('./helpers');

const roles = loadRoles(ROLES_DIR);
const stats = { koylu: 0, vampir: 0, tarafsiz: 0 };
let games = 0;

for (let seed = 1; seed <= 400; seed++) {
  const rnd = seeded(seed * 31);
  const n = 4 + Math.floor(rnd() * 17); // 4..20
  const counts = suggestRoleCounts(n, roles);
  const { g, ps } = makeGame(n, counts, {}, seed);
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];

  let guard = 0;
  while (g.phase !== 'ended') {
    if (++guard > 400) throw new Error(`seed ${seed}: sonsuz döngü, faz=${g.phase}`);
    const alive = ps.filter((p) => p.alive);
    if (g.phase === 'night') {
      for (const p of alive) {
        const abs = g.viewFor(p.id).me.abilities.filter((a) => a.usableNow && a.phase === 'night');
        const others = ps.filter((o) => g._pubAlive(o) && o.id !== p.id);
        if (abs.length && rnd() < 0.9) {
          const ab = pick(abs);
          const tries = ps.filter((o) => g._pubAlive(o));
          for (let k = 0; k < 6; k++) {
            try { g.submitNight(p.id, { abilityId: ab.id, targetId: pick(tries).id }); break; } catch (e) { if (k === 5) g.submitNight(p.id, { abilityId: '__pass' }); }
          }
        } else {
          g.submitNight(p.id, { abilityId: '__decoy', targetId: pick(others).id });
        }
      }
    } else if (g.phase === 'day') {
      for (const p of alive) {
        const ab = g.viewFor(p.id).me.abilities.find((a) => a.usableNow && a.phase === 'day');
        if (ab && rnd() < 0.3) { try { g.useDayAbility(p.id, { abilityId: ab.id, targetId: pick(ps.filter((o) => g._pubAlive(o) && o.id !== p.id)).id }); } catch (e) { /* geçersiz seçim */ } }
      }
    } else if (g.phase === 'vote') {
      for (const p of alive) {
        const t = pick(ps.filter((o) => g._pubAlive(o)));
        g.submitVote(p.id, rnd() < 0.15 ? null : t.id);
      }
    }
    g.advance();
    // her fazda görünümler hata vermemeli
    g.publicView(); g.modView(); ps.forEach((p) => g.viewFor(p.id));
  }
  stats[g.winner.team] += 1;
  games += 1;
}
console.log(`${games} oyun hatasız bitti.`, stats);
