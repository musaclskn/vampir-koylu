'use strict';
const path = require('path');
const { loadRoles } = require('../server/game/roles');
const { Game } = require('../server/game/engine');
const { AVATARS } = require('../server/game/avatars');

const ROLES_DIR = path.join(__dirname, '..', 'roles');

// Deterministik rastgelelik (testlerin tekrarlanabilir olması için)
function seeded(seed = 1) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

/**
 * n oyunculu, istenen rollerle başlamış bir oyun kurar.
 * layout: { oyuncuIndex: 'rolId' } -> o oyuncuya o rol verilir, geri kalanı rastgele kalır.
 */
function makeGame(n, counts, layout = {}, seed = 7) {
  const roles = loadRoles(ROLES_DIR);
  const g = new Game({ roles, rng: seeded(seed), now: () => 1_000_000 });
  const ps = [];
  for (let i = 0; i < n; i++) ps.push(g.addPlayer({ name: `Oyuncu${i}`, avatar: AVATARS[i].id }));
  g.setConfig({ roleCounts: counts });
  g.start();
  // Belirli oyunculara belirli rol ver (takasla, adetler korunsun)
  const locked = new Set(); // zaten yerleştirilmiş oyuncular takas için kullanılmaz
  for (const [idx, roleId] of Object.entries(layout)) {
    const i = Number(idx);
    const p = ps[i];
    if (p.roleId !== roleId) {
      const j = ps.findIndex((o, k) => k !== i && !locked.has(k) && o.roleId === roleId);
      if (j < 0) throw new Error(`Takas için ${roleId} bulunamadı`);
      ps[j].roleId = p.roleId;
      p.roleId = roleId;
    }
    locked.add(i);
  }
  return { g, ps, roles };
}

const byRole = (ps, roleId) => ps.filter((p) => p.roleId === roleId);

module.exports = { makeGame, byRole, seeded, ROLES_DIR };
