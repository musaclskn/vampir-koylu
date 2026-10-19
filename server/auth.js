'use strict';
// Moderatör şifresi ve oturumları. MOD_PASSWORD verilmişse panel her yerden şifreyle açılır;
// verilmemişse eski davranış (sadece bu bilgisayardan, şifresiz) geçerlidir.
const crypto = require('crypto');

const COOKIE = 'vk_mod';
const SESSION_MS = 12 * 60 * 60 * 1000; // 12 saat
const MAX_FAILS = 5; // bu kadar yanlış denemeden sonra
const LOCK_MS = 60 * 1000; // bu süre beklenir

const sha = (s) => crypto.createHash('sha256').update(String(s), 'utf8').digest();

function createAuth({ password, now = Date.now } = {}) {
  const enabled = typeof password === 'string' && password.length > 0;
  const want = enabled ? sha(password) : null;
  const sessions = new Map(); // token -> bitiş zamanı
  const fails = new Map(); // ip -> { count, until }

  function parseCookie(header) {
    for (const part of String(header || '').split(';')) {
      const i = part.indexOf('=');
      if (i > 0 && part.slice(0, i).trim() === COOKIE) return part.slice(i + 1).trim();
    }
    return null;
  }

  /** İstekteki çerez geçerli bir oturum mu? */
  function hasSession(req) {
    const token = parseCookie(req.headers.cookie);
    if (!token) return false;
    const exp = sessions.get(token);
    if (!exp) return false;
    if (exp < now()) { sessions.delete(token); return false; }
    return true;
  }

  /** Şifreyi dener. {ok, token} ya da {ok:false, message} döner. */
  function login(ip, given) {
    const f = fails.get(ip);
    if (f && f.until > now()) {
      return { ok: false, message: `Çok fazla yanlış deneme. ${Math.ceil((f.until - now()) / 1000)} saniye sonra tekrar dene.` };
    }
    if (typeof given !== 'string' || !crypto.timingSafeEqual(sha(given), want)) {
      if (fails.size > 1000) fails.clear(); // bellek sınırı
      const count = (f ? f.count : 0) + 1;
      fails.set(ip, count >= MAX_FAILS ? { count: 0, until: now() + LOCK_MS } : { count, until: 0 });
      return { ok: false, message: 'Şifre yanlış.' };
    }
    fails.delete(ip);
    for (const [t, exp] of sessions) if (exp < now()) sessions.delete(t);
    const token = crypto.randomBytes(24).toString('hex');
    sessions.set(token, now() + SESSION_MS);
    return { ok: true, token };
  }

  function logout(req) {
    const token = parseCookie(req.headers.cookie);
    if (token) sessions.delete(token);
  }

  function cookieFor(token, secure) {
    const base = `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict`;
    const tail = token ? `; Max-Age=${SESSION_MS / 1000}` : '; Max-Age=0';
    return base + tail + (secure ? '; Secure' : '');
  }

  return { enabled, hasSession, login, logout, cookieFor };
}

module.exports = { createAuth, COOKIE };
