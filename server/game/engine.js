'use strict';
const { EventEmitter } = require('events');
const crypto = require('crypto');
const { TEAMS } = require('./teams');
const { EFFECTS, CATEGORY_LABELS, DEATH_TEXT } = require('./effects');
const { AVATARS, AVATAR_IDS } = require('./avatars');
const { suggestRoleCounts } = require('./setup');

class GameError extends Error {}
const fail = (msg) => { throw new GameError(msg); };

const MIN_PLAYERS = 4;
const MAX_NAME = 16;
const TEAM_ORDER = { koylu: 0, tarafsiz: 1, vampir: 2 };
const ABILITY_GAME_PHASES = { night: ['night'], day: ['day', 'vote'] };

const defaultConfig = () => ({
  roleCounts: {}, // boş = otomatik: oyuncu sayısına göre önerilen dağılım kullanılır
  // saniye; 0 = süresiz. Yarı otomatik modda süre sadece sayaç gösterir, fazı moderatör ilerletir.
  durations: { night: 90, day: 300, vote: 60 },
  options: {
    revealRoleOnDeath: true, // ölenin rolü herkese açıklansın
    announceSaves: false, // "birisi saldırıya uğradı ama kurtuldu" duyurulsun
    showRoleCounts: true, // oyun başlayınca hangi rolden kaç tane olduğu (kimde olduğu değil) ortak ekranda görünsün
  },
});

class Game extends EventEmitter {
  /**
   * @param {{roles: Map<string, object>, rng?: () => number, now?: () => number}} opts
   */
  constructor({ roles, rng = Math.random, now = Date.now }) {
    super();
    this.roles = roles;
    this.rng = rng;
    this.now = now;
    this.reset();
  }

  /** Her şeyi sıfırlar (oyuncular dahil). */
  reset() {
    this._init();
    this._changed();
  }

  /**
   * Yeni oyun: oyuncular (ad, avatar, token, bağlantı) ve ayarlar korunur, roller ve oyun durumu sıfırlanır,
   * herkes lobiye döner. Telefonlar aynı token ile bağlı kalır.
   */
  restartKeepPlayers() {
    const keep = [...this.players.values()];
    const config = JSON.parse(JSON.stringify(this.config));
    this._init();
    this.config = config;
    for (const p of keep) {
      this.players.set(p.id, this._newPlayer({ id: p.id, token: p.token, name: p.name, avatar: p.avatar, connected: p.connected }));
    }
    this._log('Yeni oyun: oyuncular lobiye döndü.');
    this._changed();
  }

  _newPlayer({ id, token, name, avatar, connected = true }) {
    return {
      id, token, name, avatar, connected,
      alive: true, roleId: null, death: null, used: {}, lastTargets: {}, privateLog: [],
    };
  }

  _init() {
    this.players = new Map();
    this.config = defaultConfig();
    this.phase = 'lobby';
    this.day = 0;
    this.phaseEndsAt = null;
    this.nightActions = {}; // playerId -> { abilityId, targetId }
    this.votes = {}; // playerId -> targetId | null
    this.report = null; // son duyuru (şafak / oylama sonucu)
    this.pendingDeaths = []; // avcı kurşunuyla ölenler, sabaha duyurulacak
    this.winner = null;
    this.dealtCounts = null; // oyun başında dağıtılan rol adetleri
    this.log = [];
  }

  // ---------------------------------------------------------------- yardımcılar
  _id() { return crypto.randomBytes(4).toString('hex'); }
  _token() { return crypto.randomBytes(16).toString('hex'); }
  _changed() { this.emit('change'); }
  _log(text) { this.log.push({ t: this.now(), day: this.day, phase: this.phase, text }); }
  _tell(player, text) { player.privateLog.push({ day: this.day, phase: this.phase, text }); }
  _shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  _setPhase(phase) {
    this.phase = phase;
    const secs = { night: this.config.durations.night, day: this.config.durations.day, vote: this.config.durations.vote }[phase];
    this.phaseEndsAt = secs > 0 ? this.now() + secs * 1000 : null;
    this._changed();
  }
  _role(player) { return this.roles.get(player.roleId); }
  _pubAlive(p) { return p.alive || (p.death && !p.death.announced); }
  _alive() { return [...this.players.values()].filter((p) => p.alive); }
  _abilitiesOf(player) { return this._roleAbilities(this._role(player)); }
  _roleAbilities(role) { return [...(TEAMS[role.team].abilities || []), ...(role.abilities || [])]; }
  _usesLeft(player, ab) {
    return ab.uses == null ? null : ab.uses - (player.used[ab.id] || 0);
  }

  // ---------------------------------------------------------------- lobi / oyuncular
  addPlayer({ name, avatar }) {
    if (this.phase !== 'lobby') fail('Oyun başladı, artık katılamazsın.');
    name = String(name || '').trim().replace(/\s+/g, ' ');
    if (!name) fail('Bir ad girmelisin.');
    if (name.length > MAX_NAME) fail(`Ad en fazla ${MAX_NAME} karakter olabilir.`);
    if (!AVATAR_IDS.has(avatar)) fail('Geçersiz avatar.');
    for (const p of this.players.values()) {
      if (p.name.toLocaleLowerCase('tr') === name.toLocaleLowerCase('tr')) fail('Bu ad zaten alınmış.');
      if (p.avatar === avatar) fail('Bu avatar zaten seçilmiş.');
    }
    const player = this._newPlayer({ id: this._id(), token: this._token(), name, avatar });
    this.players.set(player.id, player);
    this._log(`${name} lobiye katıldı.`);
    this._changed();
    return player;
  }

  playerByToken(token) {
    for (const p of this.players.values()) if (p.token === token) return p;
    return null;
  }

  setConnected(playerId, connected) {
    const p = this.players.get(playerId);
    if (p && p.connected !== connected) { p.connected = connected; this._changed(); }
  }

  updatePlayer(playerId, { name, avatar }) {
    const p = this.players.get(playerId) || fail('Oyuncu bulunamadı.');
    if (name != null) {
      name = String(name).trim().replace(/\s+/g, ' ');
      if (!name || name.length > MAX_NAME) fail('Geçersiz ad.');
      for (const o of this.players.values()) {
        if (o.id !== p.id && o.name.toLocaleLowerCase('tr') === name.toLocaleLowerCase('tr')) fail('Bu ad zaten alınmış.');
      }
      p.name = name;
    }
    if (avatar != null) {
      if (!AVATAR_IDS.has(avatar)) fail('Geçersiz avatar.');
      for (const o of this.players.values()) if (o.id !== p.id && o.avatar === avatar) fail('Bu avatar zaten seçilmiş.');
      p.avatar = avatar;
    }
    this._changed();
  }

  kickPlayer(playerId) {
    const p = this.players.get(playerId) || fail('Oyuncu bulunamadı.');
    if (this.phase === 'lobby') {
      this.players.delete(playerId);
      this._log(`${p.name} lobiden çıkarıldı.`);
    } else if (p.alive) {
      this._kill(p, { cause: 'atildi', announce: 'now' });
      this._log(`${p.name} oyundan çıkarıldı.`);
      this._checkWinner();
    }
    this._changed();
  }

  // ---------------------------------------------------------------- kurulum
  suggest(n = this.players.size) { return suggestRoleCounts(n, this.roles); }

  setConfig(partial = {}) {
    if (this.phase !== 'lobby') fail('Ayarlar sadece oyun başlamadan değiştirilebilir.');
    if (partial.roleCounts) {
      for (const [id, c] of Object.entries(partial.roleCounts)) {
        if (!this.roles.has(id)) fail(`Bilinmeyen rol: ${id}`);
        if (!Number.isInteger(c) || c < 0) fail(`"${id}" için geçersiz adet.`);
      }
      this.config.roleCounts = { ...partial.roleCounts };
    }
    if (partial.durations) {
      for (const [k, v] of Object.entries(partial.durations)) {
        if (!(k in this.config.durations)) fail(`Bilinmeyen süre: ${k}`);
        if (!Number.isInteger(v) || v < 0 || v > 3600) fail(`"${k}" süresi 0-3600 sn olmalı.`);
        this.config.durations[k] = v;
      }
    }
    if (partial.options) {
      for (const [k, v] of Object.entries(partial.options)) {
        if (!(k in this.config.options)) fail(`Bilinmeyen seçenek: ${k}`);
        this.config.options[k] = !!v;
      }
    }
    this._changed();
  }

  /** Mevcut rol adetlerini doğrular; sorun listesi döner. */
  validateSetup(counts = this.config.roleCounts, n = this.players.size) {
    const problems = [];
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    if (n < MIN_PLAYERS) problems.push(`En az ${MIN_PLAYERS} oyuncu gerekli (şu an ${n}).`);
    if (total !== n) problems.push(`Rol sayısı (${total}) oyuncu sayısına (${n}) eşit olmalı.`);
    const vamps = Object.entries(counts).filter(([id]) => this.roles.get(id) && this.roles.get(id).team === 'vampir')
      .reduce((a, [, c]) => a + c, 0);
    if (vamps < 1) problems.push('En az 1 vampir olmalı.');
    if (vamps >= n - vamps && n > 0) problems.push('Vampir sayısı köylülerden az olmalı, yoksa oyun başlar başlamaz biter.');
    return problems;
  }

  start() {
    if (this.phase !== 'lobby') fail('Oyun zaten başladı.');
    // roleCounts boşsa otomatik mod: öneri kullanılır (ayar boş kalır, yeni oyunda yine otomatik olur)
    const counts = Object.keys(this.config.roleCounts).length ? this.config.roleCounts : this.suggest();
    const problems = this.validateSetup(counts);
    if (problems.length) fail(problems.join(' '));
    this.dealtCounts = { ...counts };

    const deck = [];
    for (const [id, c] of Object.entries(counts)) for (let i = 0; i < c; i++) deck.push(id);
    const shuffled = this._shuffle(deck);
    [...this.players.values()].forEach((p, i) => { p.roleId = shuffled[i]; });

    this.day = 0;
    this._log('Roller dağıtıldı.');
    this._setPhase('rolereveal');
  }

  // ---------------------------------------------------------------- faz akışı (moderatör)
  advance() {
    if (this.phase === 'lobby') fail('Önce oyunu başlat.');
    if (this.phase === 'ended') fail('Oyun bitti.');
    if (this.winner && ['dawn', 'day', 'vote', 'voteresult'].includes(this.phase)) return this._end();

    switch (this.phase) {
      case 'rolereveal': return this._enterNight();
      case 'night': this._resolveNight(); return this._setPhase('dawn');
      case 'dawn': return this._setPhase('day');
      case 'day': this.votes = {}; return this._setPhase('vote');
      case 'vote': this._resolveVote(); return this._setPhase('voteresult');
      case 'voteresult': return this._enterNight();
      default: return fail('Geçersiz faz.');
    }
  }

  _enterNight() {
    this.day += 1;
    this.nightActions = {};
    this.report = null;
    this._log(`${this.day}. gece başladı.`);
    this._setPhase('night');
  }

  _end() {
    this.phase = 'ended';
    this.phaseEndsAt = null;
    // sağ kalarak kazanan tarafsızlar eş-galip sayılır
    const w = this.winner;
    const ids = new Set(w.playerIds || []);
    if (w.team && w.team !== 'tarafsiz') {
      for (const p of this.players.values()) if (this._role(p).team === w.team) ids.add(p.id);
    }
    for (const p of this.players.values()) {
      const win = this._role(p).win;
      if (win && win.type === 'survive' && p.alive) ids.add(p.id);
    }
    w.playerIds = [...ids];
    this._log(`Oyun bitti: ${w.reason}`);
    this._changed();
  }

  // ---------------------------------------------------------------- eylemler
  _validateAction(actor, abilityId, targetId, gamePhase) {
    if (!actor.alive) fail('Öldün, artık eylem yapamazsın.');
    const ab = this._abilitiesOf(actor).find((a) => a.id === abilityId) || fail('Böyle bir yeteneğin yok.');
    if (!ABILITY_GAME_PHASES[ab.phase].includes(gamePhase)) fail('Bu yetenek şu an kullanılamaz.');
    const left = this._usesLeft(actor, ab);
    if (left !== null && left <= 0) fail('Bu yeteneğin hakkı bitti.');
    let target = null;
    if (ab.target === 'player') {
      target = this.players.get(targetId) || fail('Bir hedef seçmelisin.');
      if (!ab.allowDead && !this._pubAlive(target)) fail('Bu oyuncu zaten ölü.');
      if (!ab.allowSelf && target.id === actor.id) fail('Kendini seçemezsin.');
      if (ab.excludeTeam && this._role(target).team === this._role(actor).team) fail('Takım arkadaşını seçemezsin.');
      // "üst üste": bir önceki gece/gündüz turunda aynı kişi seçildiyse yasak (arada pas geçilirse serbest)
      const last = actor.lastTargets[ab.id];
      if (ab.noRepeatTarget && last && last.id === target.id && last.day === this.day - 1) {
        fail('Üst üste iki gece aynı kişiyi seçemezsin.');
      }
    }
    return { ab, target };
  }

  /** Gece eylemi. abilityId: yetenek id'si, '__pass' (pas) ya da '__decoy' (yeteneği olmayanın sahte seçimi). */
  submitNight(playerId, { abilityId, targetId } = {}) {
    if (this.phase !== 'night') fail('Şu an gece değil.');
    const actor = this.players.get(playerId) || fail('Oyuncu bulunamadı.');
    if (!actor.alive) fail('Öldün, artık eylem yapamazsın.');
    if (abilityId === '__pass' || abilityId === '__decoy') {
      this.nightActions[playerId] = { abilityId };
    } else {
      this._validateAction(actor, abilityId, targetId, 'night');
      this.nightActions[playerId] = { abilityId, targetId };
    }
    this._changed();
  }

  /** Gündüz yeteneği (ör. avcının ateşi). Anında işler. */
  useDayAbility(playerId, { abilityId, targetId } = {}) {
    if (!['day', 'vote'].includes(this.phase)) fail('Şu an gündüz değil.');
    const actor = this.players.get(playerId) || fail('Oyuncu bulunamadı.');
    const { ab, target } = this._validateAction(actor, abilityId, targetId, this.phase);
    actor.used[ab.id] = (actor.used[ab.id] || 0) + 1;
    actor.lastTargets[ab.id] = target ? { id: target.id, day: this.day } : null;
    EFFECTS[ab.effect.type].instant(this, actor, target, ab.effect);
    this._log(`${actor.name} gündüz yeteneğini kullandı (${ab.name} → ${target ? target.name : '-'}).`);
    this._checkWinner();
    this._changed();
  }

  submitVote(playerId, targetId) {
    if (this.phase !== 'vote') fail('Şu an oylama yok.');
    const voter = this.players.get(playerId) || fail('Oyuncu bulunamadı.');
    if (!voter.alive) fail('Ölüler oy kullanamaz.');
    if (targetId != null) {
      const t = this.players.get(targetId) || fail('Geçersiz hedef.');
      if (!this._pubAlive(t)) fail('Ölü birine oy veremezsin.');
    }
    this.votes[playerId] = targetId == null ? null : targetId;
    this._changed();
  }

  // ---------------------------------------------------------------- çözümleme
  _kill(player, { cause, announce, hidden = false }) {
    if (!player.alive) return;
    player.alive = false;
    player.death = { day: this.day, cause, hidden, announced: announce === 'now' };
    if (announce === 'dawn') this.pendingDeaths.push(player.id);
    this._tell(player, 'Öldün. Artık oyunu sadece izleyebilirsin.');
    this._log(`${player.name} öldü (${cause}).`);
  }

  _deathEntry(p) {
    const showRole = this.config.options.revealRoleOnDeath && !p.death.hidden;
    return {
      playerId: p.id, name: p.name, avatar: p.avatar, cause: p.death.cause,
      text: `${p.name} ${DEATH_TEXT[p.death.cause] || 'öldü'}.`,
      roleId: showRole ? p.roleId : null,
    };
  }

  _resolveNight() {
    const ctx = {
      game: this,
      protectedIds: new Set(), framedIds: new Set(), hiddenIds: new Set(), attacks: [],
      tell: (p, t) => this._tell(p, t),
    };

    const queue = [];
    for (const [pid, act] of Object.entries(this.nightActions)) {
      const actor = this.players.get(pid);
      if (!actor || !actor.alive || !act.abilityId || act.abilityId.startsWith('__')) continue;
      const ab = this._abilitiesOf(actor).find((a) => a.id === act.abilityId);
      if (!ab) continue;
      queue.push({ actor, ab, target: this.players.get(act.targetId) || null, eff: EFFECTS[ab.effect.type] });
    }
    queue.sort((a, b) => a.eff.priority - b.eff.priority);
    for (const q of queue) {
      q.actor.used[q.ab.id] = (q.actor.used[q.ab.id] || 0) + 1;
      q.actor.lastTargets[q.ab.id] = q.target ? { id: q.target.id, day: this.day } : null;
      q.eff.night(ctx, q.actor, q.target, q.ab.effect);
    }

    // saldırıları çöz
    const targets = [];
    for (const a of ctx.attacks) if (!targets.includes(a.target)) targets.push(a.target);
    let saved = 0;
    const nightDeaths = [];
    for (const tid of targets) {
      const t = this.players.get(tid);
      if (!t || !t.alive) continue;
      if (ctx.protectedIds.has(tid)) { saved += 1; continue; }
      this._kill(t, { cause: 'vampir', announce: 'now', hidden: ctx.hiddenIds.has(tid) });
      nightDeaths.push(t);
    }

    // sabaha duyurulacak avcı ölümleri
    const pending = this.pendingDeaths.map((id) => this.players.get(id));
    this.pendingDeaths = [];
    for (const p of pending) p.death.announced = true;

    const deaths = [...nightDeaths, ...pending].map((p) => this._deathEntry(p));
    const lines = deaths.map((d) => d.text);
    if (!deaths.length) lines.push('Bu gece kimse ölmedi.');
    if (this.config.options.announceSaves && saved > 0) lines.push('Biri bu gece saldırıya uğradı ama kurtuldu.');

    this.report = { kind: 'dawn', day: this.day, deaths, text: lines.join(' ') };
    this._log(`Şafak: ${this.report.text}`);
    this._checkWinner();
  }

  _resolveVote() {
    const tally = new Map();
    let abstain = 0;
    for (const p of this._alive()) {
      if (!(p.id in this.votes) || this.votes[p.id] == null) { abstain += 1; continue; }
      tally.set(this.votes[p.id], (tally.get(this.votes[p.id]) || 0) + 1);
    }
    const rows = [...tally.entries()].map(([playerId, count]) => ({ playerId, count })).sort((a, b) => b.count - a.count);
    let eliminated = null;
    let text = 'Oylamada çoğunluk sağlanamadı, kimse elenmedi.';
    if (rows.length && (rows.length === 1 || rows[0].count > rows[1].count)) {
      const t = this.players.get(rows[0].playerId);
      if (t && t.alive) {
        this._kill(t, { cause: 'oy', announce: 'now' });
        eliminated = this._deathEntry(t);
        text = eliminated.text;
        const win = this._role(t).win;
        if (win && win.type === 'lynched' && !this.winner) {
          this.winner = { team: 'tarafsiz', playerIds: [t.id], reason: `${t.name} (${this._role(t).name}) oylamayla elenerek kazandı.` };
        }
      }
    }
    this.report = { kind: 'vote', day: this.day, tally: rows, abstain, eliminated, text };
    this._log(`Oylama: ${text}`);
    this._checkWinner();
  }

  _checkWinner() {
    if (this.winner) return;
    const alive = this._alive();
    const vamps = alive.filter((p) => this._role(p).team === 'vampir').length;
    const others = alive.length - vamps;
    if (vamps === 0) this.winner = { team: 'koylu', reason: TEAMS.koylu.winText };
    else if (vamps >= others) this.winner = { team: 'vampir', reason: TEAMS.vampir.winText };
  }

  // ---------------------------------------------------------------- görünümler
  _roleCard(roleId) {
    const r = this.roles.get(roleId);
    return {
      id: r.id, name: r.name, emoji: r.emoji, team: r.team, teamName: TEAMS[r.team].name,
      category: r.category, categoryLabel: CATEGORY_LABELS[r.category], description: r.description,
    };
  }

  _publicPlayers() {
    return [...this.players.values()].map((p) => {
      const pubDead = !this._pubAlive(p);
      const showRole = pubDead && this.config.options.revealRoleOnDeath && p.death && !p.death.hidden;
      return {
        id: p.id, name: p.name, avatar: p.avatar, connected: p.connected, alive: !pubDead,
        role: showRole ? this._roleCard(p.roleId) : null,
      };
    });
  }

  _publicState() {
    const state = {
      phase: this.phase, day: this.day, phaseEndsAt: this.phaseEndsAt,
      players: this._publicPlayers(), report: null, winner: null,
    };
    if (this.phase === 'dawn' || (this.phase === 'voteresult')) state.report = this.report;
    if (this.phase === 'vote') state.votesCast = Object.keys(this.votes).length;
    if (this.phase === 'ended') {
      state.winner = this._winnerView();
      state.report = this.report;
    }
    return state;
  }

  _roleCountsView() {
    return Object.entries(this.dealtCounts || {}).filter(([id, c]) => c > 0 && this.roles.has(id))
      .map(([id, count]) => {
        const r = this.roles.get(id);
        return { id, name: r.name, emoji: r.emoji, team: r.team, count };
      })
      .sort((a, b) => (TEAM_ORDER[a.team] ?? 9) - (TEAM_ORDER[b.team] ?? 9) || b.count - a.count);
  }

  _winnerView() {
    return {
      team: this.winner.team, reason: this.winner.reason,
      winners: [...(this.winner.playerIds || [])],
      reveal: [...this.players.values()].map((p) => ({ id: p.id, name: p.name, avatar: p.avatar, alive: p.alive, role: this._roleCard(p.roleId) })),
    };
  }

  /** Ortak ekran (herkese açık bilgi). Oyun başladıysa ve seçenek açıksa rol adet özeti (kimde olduğu olmadan) eklenir. */
  publicView() {
    const state = this._publicState();
    if (this.phase !== 'lobby' && this.config.options.showRoleCounts) state.roleCounts = this._roleCountsView();
    return state;
  }

  /** Bir oyuncunun telefonu için görünüm. */
  viewFor(playerId) {
    const p = this.players.get(playerId) || fail('Oyuncu bulunamadı.');
    const state = this._publicState();
    if (!p.roleId) return { ...state, me: { id: p.id, name: p.name, avatar: p.avatar, alive: true, role: null, abilities: [], teammates: [], log: [] } };

    const role = this._role(p);
    const team = TEAMS[role.team];
    const acted = this.nightActions[p.id] || null;
    const abilities = this._abilitiesOf(p).map((ab) => ({
      id: ab.id, name: ab.name, description: ab.description, phase: ab.phase, target: ab.target,
      allowSelf: !!ab.allowSelf, excludeTeam: !!ab.excludeTeam, usesLeft: this._usesLeft(p, ab),
      usableNow: p.alive && ABILITY_GAME_PHASES[ab.phase].includes(this.phase) && (this._usesLeft(p, ab) ?? 1) > 0,
    }));
    const teammates = team.knowsTeam
      ? [...this.players.values()].filter((o) => o.id !== p.id && this._role(o).team === role.team)
        .map((o) => ({ id: o.id, name: o.name, avatar: o.avatar, alive: this._pubAlive(o), role: this._roleCard(o.roleId) }))
      : [];
    state.me = {
      id: p.id, name: p.name, avatar: p.avatar, alive: p.alive,
      role: this._roleCard(p.roleId), abilities, teammates,
      // Yeteneği olmayanlar da gece bir seçim ekranı görür (sahte), böylece kimin rolü olduğu belli olmaz.
      hasNightAbility: abilities.some((a) => a.phase === 'night'),
      nightSubmitted: this.phase === 'night' ? !!acted : null,
      nightChoice: this.phase === 'night' && acted && !acted.abilityId.startsWith('__') ? acted : null,
      myVote: this.phase === 'vote' ? (p.id in this.votes ? this.votes[p.id] : undefined) : undefined,
      log: p.privateLog,
    };
    return state;
  }

  /** Moderatör paneli: her şey. */
  modView() {
    const players = [...this.players.values()].map((p) => ({
      id: p.id, name: p.name, avatar: p.avatar, connected: p.connected, alive: p.alive,
      role: p.roleId ? this._roleCard(p.roleId) : null,
      death: p.death,
      acted: this.phase === 'night' ? !!this.nightActions[p.id] : null,
      voted: this.phase === 'vote' ? p.id in this.votes : null,
      usesLeft: p.roleId ? Object.fromEntries(this._abilitiesOf(p).filter((a) => a.uses != null).map((a) => [a.id, this._usesLeft(p, a)])) : {},
    }));
    const waiting = this.phase === 'night' ? players.filter((p) => p.alive && !p.acted).map((p) => p.id)
      : this.phase === 'vote' ? players.filter((p) => p.alive && !p.voted).map((p) => p.id) : [];
    return {
      ...this._publicState(),
      players,
      config: this.config,
      suggestion: this.phase === 'lobby' ? this.suggest() : null,
      setupProblems: this.phase === 'lobby' ? this.validateSetup(Object.keys(this.config.roleCounts).length ? this.config.roleCounts : this.suggest()) : [],
      roles: [...this.roles.values()].map((r) => ({
        id: r.id, name: r.name, emoji: r.emoji, team: r.team, teamName: TEAMS[r.team].name, category: r.category,
        description: r.description,
        abilities: this._roleAbilities(r).map((a) => ({ id: a.id, name: a.name, phase: a.phase, uses: a.uses == null ? null : a.uses })),
      })),
      lastReport: this.report,
      avatars: AVATARS,
      waiting,
      nightActions: this.phase === 'night' ? this.nightActions : null,
      votes: this.phase === 'vote' ? this.votes : null,
      winner: this.winner ? this._winnerView() : null,
      log: this.log,
    };
  }
}

module.exports = { Game, GameError, MIN_PLAYERS };
