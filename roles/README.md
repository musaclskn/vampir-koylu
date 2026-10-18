# Rol Şeması

Her rol `roles/<id>.json` dosyasıdır. Sunucu açılırken hepsini okur ve doğrular; hatalı dosya
varsa nerede ne yanlış olduğunu yazar. `_` ile başlayan dosyalar yok sayılır.

```json
{
  "id": "doktor",
  "name": "Doktor",
  "emoji": "🩺",
  "team": "koylu",
  "category": "koruyucu",
  "description": "Oyuncuya telefonunda gösterilen rol açıklaması.",
  "setup": { "minPlayers": 5, "max": 2, "every": 10, "order": 1 },
  "win": { "type": "team" },
  "abilities": [
    {
      "id": "koru",
      "name": "Koru",
      "description": "Buton altında görünen açıklama.",
      "phase": "night",
      "target": "player",
      "allowSelf": true,
      "excludeTeam": false,
      "noRepeatTarget": false,
      "uses": null,
      "effect": { "type": "protect" }
    }
  ]
}
```

## Alanlar

| Alan | Zorunlu | Açıklama |
|---|---|---|
| `id` | evet | Küçük harf/rakam/`_`, Türkçe karakter yok. Dosya adıyla aynı olmalı. |
| `name`, `emoji`, `description` | evet | Telefonda ve ekranda görünür. |
| `team` | evet | `koylu`, `vampir`, `tarafsiz` |
| `category` | evet | Kahin'in gördüğü ipucu: `siradan`, `koruyucu`, `bilgi`, `saldirgan`, `gizemli`. Aynı kategoriyi farklı roller paylaşabilir, Kahin'i belirsiz bırakan da budur. |
| `setup` | hayır | Otomatik rol önerisi. `fill:true` = takımın kalanını doldurur. `minPlayers`, `max`, `every` (min üstünde her N kişide +1), `order`, `auto:false` (öneriye girmez). |
| `win` | hayır | `{"type":"team"}` (varsayılan), `{"type":"lynched"}` (oylamayla elenirse kazanır), `{"type":"survive"}` (oyun bitince hayattaysa eş-galip). Tarafsız roller `team` olamaz. |
| `abilities` | hayır | Yetenek listesi. Takımın ortak yeteneği (vampirin "Isır"ı) otomatik eklenir. |

## Yetenek alanları

| Alan | Açıklama |
|---|---|
| `id`, `name`, `description` | Zorunlu. |
| `phase` | `night` (gece, çözümü sabaha) veya `day` (gündüz, anında). |
| `target` | `player` (şimdilik tek desteklenen hedef türü). |
| `allowSelf` | Kendini seçebilir mi. Varsayılan `false`. |
| `excludeTeam` | Kendi takımını seçemez. |
| `noRepeatTarget` | Üst üste aynı kişiyi seçemez. |
| `uses` | Toplam kullanım hakkı. `null` = sınırsız. |
| `effect` | Aşağıdaki hazır bloklardan biri. |

**Gece kuralı:** bir oyuncu gece sadece TEK yetenek seçer. Vampirlerin "Isır"ı takımdan geldiği için
özel yeteneğini seçen vampir o gece öldüremez.

## Etki blokları (`effect.type`)

| Blok | Faz | Ne yapar |
|---|---|---|
| `protect` | gece | Hedefi o gece öldürülmekten korur. |
| `kill` | gece | Hedefe saldırır (korunmuyorsa ölür). |
| `frame` | gece | Hedefi o gece Kahin'e "Saldırgan" gösterir. |
| `hide_role` | gece | Hedef o gece ölürse rolü açıklanmaz. |
| `inspect_category` | gece | Hedefin rol kategorisini öğretir (rolü/tarafı değil). |
| `shoot` | gündüz | `hitTeams` (varsayılan `["vampir"]`) içindeyse hedef ölür; değilse hedef ve atan ölür. Ölümler ertesi sabah duyurulur. |

Yeni bir etki gerekiyorsa `server/game/effects.js` içine bir blok eklenir (`night()` ya da `instant()` fonksiyonu).
Sonra roller onu JSON'dan çağırır.
