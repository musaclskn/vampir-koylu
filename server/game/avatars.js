'use strict';
// Hazır avatar galerisi. Arayüz bu listeyi oyuncuya gösterir; kimlik (id) sunucuda saklanır.
const AVATARS = [
  { id: 'vampir', emoji: '🧛' },
  { id: 'cadi', emoji: '🧙' },
  { id: 'peri', emoji: '🧚' },
  { id: 'elf', emoji: '🧝' },
  { id: 'zombi', emoji: '🧟' },
  { id: 'hayalet', emoji: '👻' },
  { id: 'yarasa', emoji: '🦇' },
  { id: 'kurt', emoji: '🐺' },
  { id: 'baykus', emoji: '🦉' },
  { id: 'kuzgun', emoji: '🐦‍⬛' },
  { id: 'kedi', emoji: '🐈‍⬛' },
  { id: 'yilan', emoji: '🐍' },
  { id: 'orumcek', emoji: '🕷️' },
  { id: 'kurukafa', emoji: '💀' },
  { id: 'mum', emoji: '🕯️' },
  { id: 'kabak', emoji: '🎃' },
  { id: 'gul', emoji: '🥀' },
  { id: 'ay', emoji: '🌙' },
  { id: 'yildiz', emoji: '⭐' },
  { id: 'ates', emoji: '🔥' },
  { id: 'kilic', emoji: '🗡️' },
  { id: 'kalkan', emoji: '🛡️' },
  { id: 'kristal', emoji: '🔮' },
  { id: 'mantar', emoji: '🍄' },
];

const AVATAR_IDS = new Set(AVATARS.map((a) => a.id));

module.exports = { AVATARS, AVATAR_IDS };
