'use strict';
// Takımlar. Takıma bağlı ortak yetenekler (ör. vampirlerin "ısır"ı) burada tanımlanır;
// o takımdaki HER rola otomatik eklenir. Bir rol gece tek bir yetenek kullanabildiği için
// özel yeteneğini seçen vampir o gece öldüremez.

const TEAMS = {
  koylu: {
    id: 'koylu',
    name: 'Köylüler',
    emoji: '🏘️',
    knowsTeam: false,
    abilities: [],
    winText: 'Tüm vampirler yok edildi. Köy kurtuldu!',
  },
  vampir: {
    id: 'vampir',
    name: 'Vampirler',
    emoji: '🧛',
    knowsTeam: true, // vampirler birbirini ve rollerini telefonlarında görür
    abilities: [
      {
        id: 'oldur',
        name: 'Isır',
        description: 'Bu gece bir kişiyi öldür. (Özel yeteneğini kullanırsan bu gece öldüremezsin.)',
        phase: 'night',
        target: 'player',
        allowSelf: false,
        excludeTeam: true,
        effect: { type: 'kill' },
      },
    ],
    winText: 'Vampirler sayıca köylülere yetişti. Köy karanlığa gömüldü!',
    // Kaç vampir olmalı? (oyuncu sayısına göre öneri)
    quota: (n) => Math.max(1, Math.floor((n + 2) / 4)),
  },
  tarafsiz: {
    id: 'tarafsiz',
    name: 'Tarafsızlar',
    emoji: '🎭',
    knowsTeam: false,
    abilities: [],
    winText: '',
  },
};

module.exports = { TEAMS };
