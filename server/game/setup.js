'use strict';
const { TEAMS } = require('./teams');

// Oyuncu sayısına göre önerilen rol dağılımı.
// Her rolün JSON'undaki "setup" alanı belirler:
//   fill: true        -> takımının kalan kontenjanını doldurur (köylü / sade vampir)
//   minPlayers, max   -> en az kaç kişiyle başlar, en fazla kaç tane
//   every             -> minPlayers'ın üstünde her `every` kişide bir tane daha
//   order             -> hangi sırayla dağıtılır (küçük önce)
//   auto: false       -> otomatik öneriye hiç girmez (elle eklenir)
function suggestRoleCounts(n, roles) {
  const counts = {};
  for (const id of roles.keys()) counts[id] = 0;
  if (!(n >= 1)) return counts;

  const list = [...roles.values()];
  const vampQuota = Math.min(n - 1 > 0 ? n - 1 : 1, TEAMS.vampir.quota(n));
  let remaining = n;

  // 1) vampir kontenjanı: özel vampirler en fazla (kontenjan - 1), geri kalanı sade vampir
  const specialVamps = list
    .filter((r) => r.team === 'vampir' && !(r.setup && r.setup.fill) && r.setup && r.setup.auto !== false)
    .sort((a, b) => (a.setup.order || 99) - (b.setup.order || 99));
  let vampLeft = vampQuota;
  const specialBudget = Math.max(0, vampQuota - 1);
  let specialUsed = 0;
  for (const r of specialVamps) {
    const c = countFor(r, n);
    const take = Math.min(c, specialBudget - specialUsed);
    if (take > 0) { counts[r.id] = take; specialUsed += take; vampLeft -= take; remaining -= take; }
  }
  const plainVamp = list.find((r) => r.team === 'vampir' && r.setup && r.setup.fill);
  if (plainVamp) { counts[plainVamp.id] = vampLeft; remaining -= vampLeft; }

  // 2) köylü tarafı özel roller (sırayla, yer kaldıysa)
  const specials = list
    .filter((r) => r.team !== 'vampir' && !(r.setup && r.setup.fill) && r.setup && r.setup.auto !== false)
    .sort((a, b) => (a.setup.order || 99) - (b.setup.order || 99));
  for (const r of specials) {
    const take = Math.min(countFor(r, n), Math.max(0, remaining - 1)); // en az 1 sade köylüye yer bırak
    if (take > 0) { counts[r.id] = take; remaining -= take; }
  }

  // 3) kalan sade köylü
  const plainVillager = list.find((r) => r.team === 'koylu' && r.setup && r.setup.fill);
  if (plainVillager) counts[plainVillager.id] += Math.max(0, remaining);
  return counts;
}

function countFor(role, n) {
  const s = role.setup || {};
  if (s.minPlayers == null || n < s.minPlayers) return 0;
  const max = s.max == null ? 1 : s.max;
  const extra = s.every ? Math.floor((n - s.minPlayers) / s.every) : 0;
  return Math.min(max, 1 + extra);
}

module.exports = { suggestRoleCounts };
