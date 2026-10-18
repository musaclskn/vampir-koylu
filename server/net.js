'use strict';
// Ağ yardımcıları: loopback kontrolü ve LAN IPv4 adresi seçimi.
const os = require('os');

/** Bağlantı bu bilgisayarın kendisinden mi geliyor? (moderatör yetkisi sadece buna verilir) */
function isLoopback(addr) {
  if (typeof addr !== 'string' || !addr) return false;
  let a = addr.trim().toLowerCase();
  if (a.startsWith('[') && a.endsWith(']')) a = a.slice(1, -1);
  const pct = a.indexOf('%'); // IPv6 bölge kimliği (fe80::1%lo0)
  if (pct >= 0) a = a.slice(0, pct);
  if (a === '::1' || a === '0:0:0:0:0:0:0:1') return true;
  if (a.startsWith('::ffff:')) a = a.slice(7); // IPv4-mapped IPv6
  // 127.0.0.0/8
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(a);
  if (!m) return false;
  const parts = m.slice(1).map(Number);
  if (parts.some((n) => n > 255)) return false;
  return parts[0] === 127;
}

// Sanal makine / VPN / konteyner arayüzleri (adına göre ele)
const VIRTUAL_RE = /(vmware|virtualbox|vbox|hyper-?v|vethernet|wsl|docker|podman|vpn|tap|tun\d|^tun|tailscale|zerotier|hamachi|wireguard|wg\d|loopback|bluetooth|utun|^br-|^veth|^virbr|^lo\d*$|npcap|radmin|nordlynx|proton|openvpn|fortinet|cisco|anyconnect|pangp)/i;

function privateRank(ip) {
  if (ip.startsWith('192.168.')) return 3;
  if (ip.startsWith('10.')) return 2;
  const m = /^172\.(\d+)\./.exec(ip);
  if (m && Number(m[1]) >= 16 && Number(m[1]) <= 31) return 1;
  return 0;
}

/**
 * Telefonların bağlanabileceği IPv4 adaylarını en olasıdan başlayarak döner.
 * @param {ReturnType<typeof os.networkInterfaces>} ifaces test için verilebilir
 */
function lanAddresses(ifaces = os.networkInterfaces()) {
  const out = [];
  for (const [name, list] of Object.entries(ifaces || {})) {
    for (const i of list || []) {
      const fam = i.family === 4 ? 'IPv4' : i.family;
      if (fam !== 'IPv4' || i.internal) continue;
      if (i.address.startsWith('169.254.') || i.address.startsWith('127.')) continue; // link-local / loopback
      const virtual = VIRTUAL_RE.test(name);
      let score = privateRank(i.address) * 10;
      if (/wi-?fi|wlan|wireless|kablosuz|^en\d|^eth\d|ethernet/i.test(name)) score += 5;
      if (virtual) score -= 100;
      out.push({ name, address: i.address, virtual, score });
    }
  }
  return out.sort((a, b) => b.score - a.score);
}

/** En iyi tahmin; HOST_IP ortam değişkeni varsa o kullanılır. */
function pickLanAddress(ifaces) {
  if (process.env.HOST_IP) return process.env.HOST_IP;
  const list = lanAddresses(ifaces);
  return list.length ? list[0].address : '127.0.0.1';
}

module.exports = { isLoopback, lanAddresses, pickLanAddress };
