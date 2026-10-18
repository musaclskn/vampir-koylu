'use strict';
const fs = require('fs');
const path = require('path');
const { TEAMS } = require('./teams');
const { EFFECTS, CATEGORY_LABELS } = require('./effects');

const ABILITY_PHASES = ['night', 'day'];
const TARGET_TYPES = ['player', 'none'];
const WIN_TYPES = ['team', 'lynched', 'survive'];

function validateRole(role, fileName) {
  const errs = [];
  const e = (m) => errs.push(`[${fileName}] ${m}`);

  if (!role.id || typeof role.id !== 'string') e('"id" zorunlu');
  else if (!/^[a-z0-9_]+$/.test(role.id)) e('"id" sadece küçük harf/rakam/_ içerebilir (Türkçe karakter yok)');
  else if (`${role.id}.json` !== fileName) e(`dosya adı "${role.id}.json" olmalı`);
  if (!role.name) e('"name" zorunlu');
  if (!role.emoji) e('"emoji" zorunlu');
  if (!role.description) e('"description" zorunlu');
  if (!TEAMS[role.team]) e(`"team" şunlardan biri olmalı: ${Object.keys(TEAMS).join(', ')}`);
  if (!CATEGORY_LABELS[role.category]) e(`"category" şunlardan biri olmalı: ${Object.keys(CATEGORY_LABELS).join(', ')}`);

  const seen = new Set();
  for (const ab of role.abilities || []) {
    const p = `yetenek "${ab.id}"`;
    if (!ab.id) { e('yeteneğin "id"si yok'); continue; }
    if (seen.has(ab.id)) e(`${p}: id tekrarlı`);
    seen.add(ab.id);
    if (!ab.name) e(`${p}: "name" zorunlu`);
    if (!ABILITY_PHASES.includes(ab.phase)) e(`${p}: "phase" ${ABILITY_PHASES.join('|')} olmalı`);
    if (!TARGET_TYPES.includes(ab.target)) e(`${p}: "target" ${TARGET_TYPES.join('|')} olmalı`);
    if (ab.uses != null && !(Number.isInteger(ab.uses) && ab.uses > 0)) e(`${p}: "uses" pozitif tam sayı ya da null olmalı`);
    const eff = ab.effect && EFFECTS[ab.effect.type];
    if (!eff) e(`${p}: bilinmeyen effect.type "${ab.effect && ab.effect.type}" (geçerli: ${Object.keys(EFFECTS).join(', ')})`);
    else {
      if (!eff.phases.includes(ab.phase)) e(`${p}: "${ab.effect.type}" bloğu sadece ${eff.phases.join('/')} fazında kullanılabilir`);
      for (const k of Object.keys(ab.effect)) {
        if (k !== 'type' && !eff.params.includes(k)) e(`${p}: effect.${k} bu blokta tanınmıyor`);
      }
      if (ab.target === 'none' && ab.effect.type !== 'noop') e(`${p}: hedefsiz yetenekler henüz desteklenmiyor`);
    }
  }

  const win = role.win || { type: 'team' };
  if (!WIN_TYPES.includes(win.type)) e(`"win.type" ${WIN_TYPES.join('|')} olmalı`);
  if (role.team === 'tarafsiz' && win.type === 'team') e('tarafsız bir rol "win.type": "lynched" veya "survive" olmalı');

  return errs;
}

function loadRoles(dir) {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json') && !f.startsWith('_'));
  const roles = new Map();
  const errs = [];
  for (const f of files) {
    let role;
    try {
      role = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    } catch (err) {
      errs.push(`[${f}] JSON okunamadı: ${err.message}`);
      continue;
    }
    const problems = validateRole(role, f);
    if (problems.length) errs.push(...problems);
    else roles.set(role.id, role);
  }
  if (errs.length) {
    const err = new Error('Rol dosyalarında hata var:\n - ' + errs.join('\n - '));
    err.problems = errs;
    throw err;
  }
  return roles;
}

module.exports = { loadRoles, validateRole };
