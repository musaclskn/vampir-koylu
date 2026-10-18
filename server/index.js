'use strict';
// Giriş noktası: `npm start`
const path = require('path');
const QRCode = require('qrcode');
const { loadRoles } = require('./game/roles');
const { createServer } = require('./app');
const { lanAddresses, pickLanAddress } = require('./net');
const { openBrowser, shouldOpen } = require('./open');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

let roles;
try {
  roles = loadRoles(path.join(__dirname, '..', 'roles'));
} catch (e) {
  console.error(e.message);
  process.exit(1);
}

const ip = pickLanAddress();
const joinUrl = `http://${ip}:${PORT}/`;
const srv = createServer({ roles, joinUrl });

srv.server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') console.error(`\n${PORT} portu kullanımda. Başka bir port dene:  PORT=3001 npm start  (Windows: set PORT=3001 && npm start)`);
  else console.error('Sunucu başlatılamadı:', e.message);
  process.exit(1);
});

srv.server.listen(PORT, HOST, async () => {
  const line = '─'.repeat(52);
  console.log(`\n${line}\n  🧛  VAMPİR KÖYLÜ sunucusu çalışıyor\n${line}`);
  console.log(`  Oyuncular (telefon):   ${joinUrl}`);
  console.log(`  Ortak ekran (TV):      http://${ip}:${PORT}/ekran`);
  const modUrl = `http://localhost:${PORT}/mod`;
  const autoOpen = shouldOpen();
  console.log(`  Moderatör paneli: http://localhost:${PORT}/mod${autoOpen ? ' (tarayıcıda açılıyor)' : ''}  — sadece bu bilgisayardan açılır`);
  const others = lanAddresses().filter((a) => a.address !== ip && !a.virtual);
  if (others.length) console.log(`  Diğer olası adresler: ${others.map((a) => `http://${a.address}:${PORT}/ (${a.name})`).join(', ')}`);
  if (ip === '127.0.0.1') console.log('  ⚠ Yerel ağ adresi bulunamadı. Bilgisayar Wi-Fi\'ye bağlı mı?');
  try {
    const qr = await QRCode.toString(joinUrl, { type: 'terminal', small: true });
    console.log('\n  Telefonla okut:\n');
    console.log(qr);
  } catch (e) {
    console.log('(QR çizilemedi:', e.message, ')');
  }
  console.log('  Telefonlar bağlanamıyorsa README.md → "Ağ sorunları" bölümüne bak.');
  console.log(`  Kapatmak için Ctrl+C\n${line}\n`);
  if (autoOpen) openBrowser(modUrl);
});

process.on('uncaughtException', (e) => console.error('[beklenmeyen hata]', e && e.stack || e));
process.on('unhandledRejection', (e) => console.error('[beklenmeyen hata]', e && e.stack || e));
process.on('SIGINT', () => { console.log('\nKapatılıyor…'); srv.close().then(() => process.exit(0)); setTimeout(() => process.exit(0), 1500).unref(); });
