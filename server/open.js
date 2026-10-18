'use strict';
// Sunucu açılınca moderatör panelini varsayılan tarayıcıda açar. Hata olursa sessizce yutar.
const { spawn } = require('child_process');

/** Platforma göre tarayıcı açma komutu. (Testte doğrudan kontrol edilir.) */
function openCommand(url, platform = process.platform) {
  // Windows: `start` bir cmd iç komutudur; ilk tırnaklı argüman pencere başlığı sayıldığı için boş başlık ("") verilir.
  if (platform === 'win32') return { cmd: 'cmd', args: ['/c', 'start', '', url.replace(/&/g, '^&')] };
  if (platform === 'darwin') return { cmd: 'open', args: [url] };
  return { cmd: 'xdg-open', args: [url] };
}

/** NO_OPEN=1 (ya da true/yes) ise açma. */
function shouldOpen(env = process.env) {
  const v = String(env.NO_OPEN || '').trim().toLowerCase();
  return !(v && v !== '0' && v !== 'false' && v !== 'no' && v !== 'hayir' && v !== 'hayır');
}

function openBrowser(url) {
  try {
    const { cmd, args } = openCommand(url);
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true, windowsHide: true });
    child.on('error', () => { /* tarayıcı açılamadı: adres konsolda yazıyor */ });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

module.exports = { openCommand, shouldOpen, openBrowser };
