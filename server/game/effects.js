'use strict';
// Etki blokları: rol JSON'ları yeteneklerini bu hazır bloklarla tarif eder.
// Yeni bir blok eklemek = bu dosyaya yeni bir kayıt eklemek.
//
// Her blok:
//   phases    : yeteneğin kullanılabileceği faz ("night" | "day")
//   priority  : gece çözümünde sıra (küçük olan önce)
//   params    : JSON'daki effect objesinde kabul edilen ek alanlar (doğrulama için)
//   night(ctx, actor, target, params) : gece bloğu (tüm gece aksiyonları toplanır, sonra çözülür)
//   instant(game, actor, target, params) : gündüz bloğu (anında çalışır)

const CATEGORY_LABELS = {
  siradan: 'Sıradan',
  koruyucu: 'Koruyucu',
  bilgi: 'Bilgi toplayan',
  saldirgan: 'Saldırgan',
  gizemli: 'Gizemli',
};

const EFFECTS = {
  // Hedefi bu gece öldürülmekten korur.
  protect: {
    phases: ['night'],
    priority: 20,
    params: [],
    night(ctx, actor, target) {
      ctx.protectedIds.add(target.id);
      ctx.tell(actor, `Bu gece ${target.name} kişisini koruyorsun.`);
    },
  },

  // Hedefe saldırır (korunmuyorsa ölür).
  kill: {
    phases: ['night'],
    priority: 30,
    params: [],
    night(ctx, actor, target) {
      ctx.attacks.push({ by: actor.id, target: target.id });
    },
  },

  // Hedefi Kahin'e "saldırgan" gösterir (o gece için).
  frame: {
    phases: ['night'],
    priority: 10,
    params: [],
    night(ctx, actor, target) {
      ctx.framedIds.add(target.id);
      ctx.tell(actor, `${target.name} bu gece Kahin'e şüpheli görünecek.`);
    },
  },

  // Hedef bu gece ölürse rolü açıklanmaz.
  hide_role: {
    phases: ['night'],
    priority: 40,
    params: [],
    night(ctx, actor, target) {
      ctx.hiddenIds.add(target.id);
      ctx.tell(actor, `${target.name} bu gece ölürse rolü gizlenecek.`);
    },
  },

  // Hedefin rol KATEGORİSİNİ öğretir (rolün kendisini değil).
  inspect_category: {
    phases: ['night'],
    priority: 50,
    params: [],
    night(ctx, actor, target) {
      const cat = ctx.framedIds.has(target.id) ? 'saldirgan' : ctx.game.roles.get(target.roleId).category;
      ctx.tell(actor, `${target.name} için ipucu: "${CATEGORY_LABELS[cat]}" türde biri.`);
    },
  },

  // Gündüz tek atımlık ateş: hedef hitTeams'teyse hedef ölür; değilse hem hedef hem atan ölür.
  shoot: {
    phases: ['day'],
    priority: 0,
    params: ['hitTeams'],
    instant(game, actor, target, params) {
      const hitTeams = params.hitTeams || ['vampir'];
      const targetRole = game.roles.get(target.roleId);
      if (hitTeams.includes(targetRole.team)) {
        game._kill(target, { cause: 'avci', announce: 'dawn' });
        game._tell(actor, `Ateş ettin: ${target.name} bir vampirdi! Öldü. Mermin bitti ama oyuna devam ediyorsun.`);
      } else {
        game._kill(target, { cause: 'avci', announce: 'dawn' });
        game._kill(actor, { cause: 'avci_pismanlik', announce: 'dawn' });
        game._tell(actor, `Ateş ettin: ${target.name} masumdu. O öldü ve vicdanın seni de yedi bitirdi.`);
        game._tell(target, `Avcı seni yanlışlıkla vurdu.`);
      }
    },
  },
};

const DEATH_TEXT = {
  vampir: 'vampirler tarafından öldürüldü',
  oy: 'köylülerin oyuyla elendi',
  avci: 'avcının kurşunuyla öldü',
  avci_pismanlik: 'masum birini vurmanın bedelini canıyla ödedi',
  atildi: 'oyundan çıkarıldı',
};

module.exports = { EFFECTS, CATEGORY_LABELS, DEATH_TEXT };
