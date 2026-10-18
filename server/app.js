'use strict';
// HTTP + WebSocket sunucusu. index.js bunu başlatır; testler de doğrudan kullanır.
const http = require('http');
const path = require('path');
const express = require('express');
const { WebSocketServer } = require('ws');
const QRCode = require('qrcode');
const { Game, GameError } = require('./game/engine');
const { AVATARS } = require('./game/avatars');
const { isLoopback } = require('./net');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const MAX_MSG_BYTES = 4096;
const RATE = { perSec: 10, burst: 30 }; // bağlantı başına mesaj sınırı (token kovası)
const HEARTBEAT_MS = 15000;
const CLIENT_KINDS = new Set(['oyuncu', 'ekran', 'mod']);

/**
 * @param {{roles: Map, joinUrl?: string, game?: Game, log?: (…args) => void}} opts
 */
function createServer({ roles, joinUrl = 'http://127.0.0.1:3000/', game, log = console.log } = {}) {
  game = game || new Game({ roles });
  const state = { joinUrl, qrSvg: null };

  // ------------------------------------------------------------ HTTP
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' ws: wss:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    });
    next();
  });

  const onlyLoopback = (req, res, next) => {
    if (isLoopback(req.socket.remoteAddress)) return next();
    res.status(403).type('text/plain; charset=utf-8').send('403 - Moderatör paneli sadece sunucunun çalıştığı bilgisayardan açılabilir.');
  };

  const page = (dir) => (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.sendFile(path.join(PUBLIC_DIR, dir, 'index.html'));
  };
  const staticOpts = { index: false, maxAge: 0 };

  app.get('/favicon.ico', (req, res) => res.status(204).end());
  app.get('/', page('oyuncu'));
  app.use('/oyuncu', express.static(path.join(PUBLIC_DIR, 'oyuncu'), staticOpts));
  app.use('/ortak', express.static(path.join(PUBLIC_DIR, 'ortak'), staticOpts));
  app.get(['/ekran', '/ekran/'], page('ekran'));
  app.use('/ekran', express.static(path.join(PUBLIC_DIR, 'ekran'), staticOpts));
  app.use('/mod', onlyLoopback);
  app.get(['/mod', '/mod/'], page('mod'));
  app.use('/mod', express.static(path.join(PUBLIC_DIR, 'mod'), staticOpts));

  app.get('/api/avatars', (req, res) => res.json(AVATARS));
  // Moderatör paneli için temel adresler (sır yok, ama sadece bu bilgisayardan)
  app.get('/api/info', onlyLoopback, (req, res) => {
    res.set('Cache-Control', 'no-store');
    const port = server.address() && server.address().port;
    let screenUrl;
    try { screenUrl = new URL('/ekran', state.joinUrl).href; } catch { screenUrl = '/ekran'; }
    res.json({ joinUrl: state.joinUrl, screenUrl, modUrl: `http://localhost:${port}/mod` });
  });
  app.get('/api/qr.svg', async (req, res, next) => {
    try {
      if (!state.qrSvg) {
        state.qrSvg = await QRCode.toString(state.joinUrl, { type: 'svg', margin: 2, color: { dark: '#120a14', light: '#f4ead8' } });
      }
      res.type('image/svg+xml').set('Cache-Control', 'no-store').send(state.qrSvg);
    } catch (e) { next(e); }
  });
  app.use((req, res) => res.status(404).type('text/plain; charset=utf-8').send('Sayfa bulunamadı.'));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    log('[http] hata:', err && err.stack || err);
    res.status(500).type('text/plain; charset=utf-8').send('Sunucu hatası.');
  });

  const server = http.createServer(app);

  // ------------------------------------------------------------ WebSocket
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MSG_BYTES });
  const clients = new Set();
  const socketsPerPlayer = new Map(); // playerId -> sayı

  server.on('upgrade', (req, socket, head) => {
    let url;
    try { url = new URL(req.url, 'http://x'); } catch { url = null; }
    const kind = url && url.searchParams.get('as');
    const reject = (code, text) => {
      socket.write(`HTTP/1.1 ${code} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
      socket.destroy();
    };
    if (!url || url.pathname !== '/ws' || !CLIENT_KINDS.has(kind)) return reject(400, 'Bad Request');
    if (kind === 'mod') {
      if (!isLoopback(req.socket.remoteAddress)) return reject(403, 'Forbidden');
      // Bu bilgisayarda açık başka bir sitenin moderatör bağlantısı kurmasını engelle
      const origin = req.headers.origin;
      if (origin && !isLocalOrigin(origin)) return reject(403, 'Forbidden');
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req, kind));
  });

  wss.on('connection', (ws, req, kind) => {
    const c = { ws, kind, playerId: null, tokens: RATE.burst, last: Date.now(), alive: true, joinTries: 0 };
    clients.add(c);
    ws.on('pong', () => { c.alive = true; });
    ws.on('message', (data, isBinary) => {
      try {
        if (isBinary) return send(c, { type: 'error', message: 'Geçersiz mesaj.' });
        if (!takeToken(c)) return send(c, { type: 'error', message: 'Çok hızlı! Biraz yavaşla.' });
        let msg;
        try { msg = JSON.parse(data.toString('utf8')); } catch { return send(c, { type: 'error', message: 'Geçersiz mesaj.' }); }
        if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') return send(c, { type: 'error', message: 'Geçersiz mesaj.' });
        handle(c, msg);
      } catch (e) {
        if (e instanceof GameError) send(c, { type: 'error', message: e.message });
        else { log('[ws] beklenmeyen hata:', e && e.stack || e); send(c, { type: 'error', message: 'Sunucuda bir hata oluştu.' }); }
      }
    });
    ws.on('close', () => {
      clients.delete(c);
      unbindPlayer(c);
    });
    ws.on('error', (e) => log('[ws] bağlantı hatası:', e.message));
    send(c, { type: 'hello', as: kind });
    pushView(c);
  });

  function isLocalOrigin(origin) {
    try { return isLoopback(new URL(origin).hostname) || new URL(origin).hostname === 'localhost'; } catch { return false; }
  }

  function takeToken(c) {
    const now = Date.now();
    c.tokens = Math.min(RATE.burst, c.tokens + ((now - c.last) / 1000) * RATE.perSec);
    c.last = now;
    if (c.tokens < 1) return false;
    c.tokens -= 1;
    return true;
  }

  function bindPlayer(c, player) {
    if (c.playerId === player.id) return;
    unbindPlayer(c);
    c.playerId = player.id;
    socketsPerPlayer.set(player.id, (socketsPerPlayer.get(player.id) || 0) + 1);
    game.setConnected(player.id, true);
  }

  function unbindPlayer(c) {
    if (!c.playerId) return;
    const id = c.playerId;
    c.playerId = null;
    const n = (socketsPerPlayer.get(id) || 1) - 1;
    if (n <= 0) {
      socketsPerPlayer.delete(id);
      if (game.players.has(id)) game.setConnected(id, false);
    } else socketsPerPlayer.set(id, n);
  }

  const str = (v, max = 64) => (typeof v === 'string' ? v.slice(0, max) : v == null ? null : String(v).slice(0, max));

  function handle(c, msg) {
    if (msg.type === 'ping') return send(c, { type: 'pong' });
    if (c.kind === 'oyuncu') return handlePlayer(c, msg);
    if (c.kind === 'mod') return handleMod(c, msg);
    return send(c, { type: 'error', message: 'Ortak ekran mesaj gönderemez.' });
  }

  function handlePlayer(c, msg) {
    switch (msg.type) {
      case 'join': {
        if (c.playerId) throw new GameError('Zaten oyundasın.');
        if (++c.joinTries > 20) throw new GameError('Çok fazla deneme.');
        const p = game.addPlayer({ name: str(msg.name, 64), avatar: str(msg.avatar) });
        bindPlayer(c, p);
        send(c, { type: 'token', token: p.token, playerId: p.id });
        return pushView(c);
      }
      case 'resume': {
        const p = typeof msg.token === 'string' && msg.token.length <= 64 ? game.playerByToken(msg.token) : null;
        if (!p) { send(c, { type: 'resumeFailed' }); return pushView(c); }
        bindPlayer(c, p);
        send(c, { type: 'token', token: p.token, playerId: p.id });
        return pushView(c);
      }
    }
    if (!c.playerId || !game.players.has(c.playerId)) throw new GameError('Önce oyuna katılmalısın.');
    switch (msg.type) {
      case 'night': return game.submitNight(c.playerId, { abilityId: str(msg.abilityId), targetId: str(msg.targetId) });
      case 'dayAbility': return game.useDayAbility(c.playerId, { abilityId: str(msg.abilityId), targetId: str(msg.targetId) });
      case 'vote': return game.submitVote(c.playerId, msg.targetId == null ? null : str(msg.targetId));
      default: throw new GameError('Bilinmeyen istek.');
    }
  }

  function handleMod(c, msg) {
    switch (msg.type) {
      case 'setConfig': {
        const cfg = msg.config && typeof msg.config === 'object' ? msg.config : {};
        return game.setConfig({ roleCounts: cfg.roleCounts, durations: cfg.durations, options: cfg.options });
      }
      case 'start': return game.start();
      case 'advance': return game.advance();
      case 'kick': return game.kickPlayer(str(msg.playerId));
      case 'updatePlayer': return game.updatePlayer(str(msg.playerId), { name: msg.name == null ? null : str(msg.name, 64), avatar: msg.avatar == null ? null : str(msg.avatar) });
      case 'reset': return msg.keepPlayers === false ? game.reset() : game.restartKeepPlayers();
      case 'suggest': {
        const n = Number.isInteger(msg.n) && msg.n > 0 && msg.n <= 100 ? msg.n : game.players.size;
        return send(c, { type: 'suggestion', n, counts: game.suggest(n) });
      }
      default: throw new GameError('Bilinmeyen istek.');
    }
  }

  function viewOf(c) {
    if (c.kind === 'mod') return game.modView();
    if (c.kind === 'ekran') return { ...game.publicView(), joinUrl: state.joinUrl };
    if (c.playerId) {
      if (!game.players.has(c.playerId)) {
        // moderatör lobiden attı ya da oyunu tamamen sıfırladı
        c.playerId = null;
        send(c, { type: 'kicked' });
      } else return game.viewFor(c.playerId);
    }
    return game.publicView();
  }

  function pushView(c) {
    try {
      send(c, { type: 'state', joined: c.kind === 'oyuncu' ? !!c.playerId : undefined, serverNow: Date.now(), view: viewOf(c) });
    } catch (e) { log('[ws] görünüm hatası:', e && e.stack || e); }
  }

  function send(c, obj) {
    if (c.ws.readyState === 1) c.ws.send(JSON.stringify(obj));
  }

  // Motor değiştikçe herkese kendi görünümünü yolla (aynı tick'teki değişiklikler birleştirilir)
  let scheduled = false;
  const onChange = () => {
    if (scheduled) return;
    scheduled = true;
    setImmediate(() => {
      scheduled = false;
      for (const c of clients) pushView(c);
    });
  };
  game.on('change', onChange);

  // Uyuyan telefonların ölü bağlantılarını temizle
  const hb = setInterval(() => {
    for (const c of clients) {
      if (!c.alive) { c.ws.terminate(); continue; }
      c.alive = false;
      try { c.ws.ping(); } catch { /* yok say */ }
    }
  }, HEARTBEAT_MS);
  hb.unref();

  return {
    app, server, wss, game, clients,
    setJoinUrl(u) { state.joinUrl = u; state.qrSvg = null; },
    close() {
      clearInterval(hb);
      game.off('change', onChange);
      for (const c of clients) c.ws.terminate();
      return new Promise((r) => { wss.close(); server.close(() => r()); });
    },
  };
}

module.exports = { createServer, MAX_MSG_BYTES };
