'use strict';
// ESKİ / İSTEĞE BAĞLI: 4. adımdan beri moderatör paneli (http://localhost:3000/mod) her şeyi yapıyor. Bu araç yedek olarak duruyor.
// Geçici moderatör aracı (mod paneli yazılana kadar). Sunucu açıkken ayrı bir PowerShell'de çalıştır:
//   node tools/mod-cli.js            (ya da: npm run mod)
const readline = require('readline');
const WebSocket = require('ws');

const PORT = process.env.PORT || 3000;
const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws?as=mod`);
let view = null;
let lastKey = '';

const PHASE = {
  lobby: 'Lobi', rolereveal: 'Roller dağıtıldı', night: 'GECE', dawn: 'Şafak',
  day: 'GÜNDÜZ (tartışma)', vote: 'OYLAMA', voteresult: 'Oylama sonucu', ended: 'OYUN BİTTİ',
};

const HELP = `
Komutlar:
  d | durum          Oyunun tam durumu (roller dahil, sadece sende görünür)
  o | oneri          Mevcut oyuncu sayısına göre rol önerisini ayarlar
  rol koylu=4 vampir=1 doktor=1   Rol adetlerini elle ayarlar
  sure night=60 day=300 vote=60   Faz sürelerini ayarlar (0 = süresiz)
  b | basla          Oyunu başlatır (rol ayarı yapılmadıysa öneriyi kullanır)
  i | ileri          Bir sonraki faza geçer
  at <ad>            Oyuncuyu çıkarır
  yeni               Oyuncuları koruyarak lobiye döner
  y | yardim         Bu yardım
  q | cik            Çıkış
`;

function say(s) { console.log(s); }

function summary(v) {
  const lines = [];
  lines.push(`\n=== ${PHASE[v.phase] || v.phase}${v.day ? ` — ${v.day}. gün` : ''} ===`);
  if (v.phase === 'lobby') {
    lines.push(`Katılanlar (${v.players.length}): ${v.players.map((p) => p.name).join(', ') || '-'}`);
    const counts = Object.keys(v.config.roleCounts).length ? v.config.roleCounts : v.suggestion;
    lines.push('Roller: ' + Object.entries(counts || {}).filter(([, c]) => c > 0).map(([id, c]) => `${id}=${c}`).join(' '));
    if (v.setupProblems && v.setupProblems.length) lines.push('! ' + v.setupProblems.join(' '));
  } else {
    for (const p of v.players) {
      const st = p.alive ? '  ' : '✝ ';
      const role = p.role ? `${p.role.emoji} ${p.role.name} (${p.role.teamName})` : '?';
      let extra = '';
      if (v.phase === 'night' && p.alive) extra = p.acted ? '  [hazır]' : '  [bekleniyor]';
      if (v.phase === 'vote' && p.alive) extra = p.voted ? '  [oy verdi]' : '  [bekleniyor]';
      const uses = Object.entries(p.usesLeft || {}).map(([k, n]) => `${k}:${n}`).join(',');
      lines.push(`${st}${p.name.padEnd(16)} ${role}${uses ? ` {${uses}}` : ''}${extra}`);
    }
    if (v.report && v.report.text) lines.push(`\nDuyuru: ${v.report.text}`);
    if (v.report && v.report.tally && v.report.tally.length) {
      const name = (id) => (v.players.find((p) => p.id === id) || {}).name || id;
      lines.push('Oylar: ' + v.report.tally.map((t) => `${name(t.playerId)}=${t.count}`).join(', ') + (v.report.abstain ? `, çekimser=${v.report.abstain}` : ''));
    }
    if (v.winner) lines.push(`\nKAZANAN: ${v.winner.reason}`);
  }
  return lines.join('\n');
}

function nextHint(v) {
  switch (v.phase) {
    case 'lobby': return 'Herkes katıldıysa: b (başlat)';
    case 'rolereveal': return 'Oyuncular rollerini görsün, hazır olunca: i';
    case 'night': return `Bekleyen: ${v.waiting.length}. Herkes hazırsa: i`;
    case 'dawn': return 'Sabah duyurusu okundu mu? Sonra: i';
    case 'day': return 'Tartışma bitince oylamaya geçmek için: i';
    case 'vote': return `Bekleyen: ${v.waiting.length}. Herkes oy verdiyse: i`;
    case 'voteresult': return 'Geceye geçmek için: i';
    case 'ended': return 'Yeni oyun için: yeni';
    default: return '';
  }
}

ws.on('open', () => say('Moderatöre bağlandı. Komutlar için: y'));
ws.on('error', (e) => { say(`Bağlanamadı: ${e.message}\nSunucu açık mı? (npm start)`); process.exit(1); });
ws.on('close', () => { say('Bağlantı kapandı.'); process.exit(0); });
ws.on('message', (raw) => {
  const msg = JSON.parse(raw);
  if (msg.type === 'error') { say(`! ${msg.message}`); return; }
  if (msg.type === 'suggestion') { say('Öneri: ' + Object.entries(msg.counts).filter(([, c]) => c > 0).map(([id, c]) => `${id}=${c}`).join(' ')); return; }
  if (msg.type !== 'state') return;
  view = msg.view;
  // Sadece faz değişince otomatik yazdır; ara güncellemelerde sessiz kal.
  const key = `${view.phase}|${view.day}|${view.players.length}|${view.winner ? 1 : 0}`;
  if (key !== lastKey) {
    lastKey = key;
    say(summary(view));
    say(`→ ${nextHint(view)}`);
  }
});

const send = (o) => ws.send(JSON.stringify(o));
const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: 'mod> ' });
rl.pause(); // bağlantı kurulana kadar girişi beklet
ws.on('open', () => { rl.resume(); rl.prompt(); });

function parsePairs(args) {
  const out = {};
  for (const a of args) {
    const m = /^([a-z0-9_]+)=(\d+)$/.exec(a);
    if (!m) throw new Error(`Anlaşılmadı: "${a}" (örnek: koylu=4)`);
    out[m[1]] = Number(m[2]);
  }
  return out;
}

rl.on('line', (line) => {
  const [cmd, ...args] = line.trim().split(/\s+/);
  try {
    switch ((cmd || '').toLowerCase()) {
      case '': break;
      case 'd': case 'durum': if (view) { say(summary(view)); say(`→ ${nextHint(view)}`); } break;
      case 'o': case 'oneri':
        if (!view) break;
        send({ type: 'setConfig', config: { roleCounts: view.suggestion || {} } });
        setTimeout(() => { if (view) say(summary(view)); }, 150);
        break;
      case 'rol': send({ type: 'setConfig', config: { roleCounts: parsePairs(args) } }); setTimeout(() => view && say(summary(view)), 150); break;
      case 'sure': send({ type: 'setConfig', config: { durations: parsePairs(args) } }); say('Süreler gönderildi.'); break;
      case 'b': case 'basla': send({ type: 'start' }); break;
      case 'i': case 'ileri': send({ type: 'advance' }); break;
      case 'at': {
        const name = args.join(' ').toLocaleLowerCase('tr');
        const p = view && view.players.find((x) => x.name.toLocaleLowerCase('tr') === name);
        if (!p) say('Bu adda oyuncu yok.'); else send({ type: 'kick', playerId: p.id });
        break;
      }
      case 'yeni': send({ type: 'reset' }); break;
      case 'y': case 'yardim': say(HELP); break;
      case 'q': case 'cik': process.exit(0); break;
      default: say('Bilinmeyen komut. Yardım için: y');
    }
  } catch (e) { say(`! ${e.message}`); }
  rl.prompt();
});
