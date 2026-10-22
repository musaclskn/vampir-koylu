# Vampir Köylü

Yerel ağda, telefonlarla oynanan Vampir Köylü. Sunucu senin bilgisayarında çalışır, oyuncular QR kodu
okutup aynı Wi-Fi üzerinden katılır. İnternet gerekmez (kurulum hariç).

## Durum

- [x] 1. Adım: oyun motoru, rol şeması, 7 rol, testler
- [x] 2. Adım: sunucu (HTTP + WebSocket + QR), moderatör yetkisi (sadece bu bilgisayardan)
- [x] 3. Adım: telefon arayüzü (katılım, lobi, rol kartı, gece/şafak/gündüz, oylama, sonuç, ölü/izleyici)
- [x] 4. Adım: moderatör paneli (`/mod`) ve ortak ekran (`/ekran`, TV/projeksiyon)
- [ ] 5. Adım: "rol ekle/güncelle" skill'i

## Kurulum ve çalıştırma

Node.js 18 veya üstü gerekir (https://nodejs.org). Bu klasörde bir terminal (PowerShell) aç:

```
npm install     # ilk seferde bir kez (express, ws, qrcode)
npm start       # sunucuyu başlatır, moderatör paneli tarayıcıda kendiliğinden açılır
```

## Oyun nasıl oynanır (moderatör için)

1. **`npm start`** → Moderatör paneli (`http://localhost:3000/mod`) varsayılan tarayıcıda açılır.
   Açılmazsa konsoldaki adresi tarayıcıya yapıştır. Panel **sadece bu bilgisayardan** açılır.
2. **Telefonlar katılır:** paneldeki (ya da ortak ekrandaki) QR kodu okutan herkes ad + avatar seçip girer.
   Paneldeki listede bağlı/bağlantı yok durumu görünür; ✏️ ile ad/avatar düzeltilir, **Çıkar** ile lobiden atılır.
3. **Ortak ekranı TV'ye ver:** panelin sağ üstündeki **📺 Ortak ekranı aç** düğmesi `/ekran` sayfasını açar.
   Pencereyi TV'ye/projeksiyona sürükle ve **F11** (ya da ekrana çift tıkla) ile tam ekran yap. Başka bir cihazdan
   açmak istersen adres: `http://192.168.x.x:3000/ekran`. Ekran sadece herkese açık bilgiyi gösterir
   (roller, oylar ve gece seçimleri asla ekrana gitmez).
4. **Rolleri ayarla:** varsayılan **otomatik** mod oyuncu sayısına göre dağılımı kendisi önerir ve oyuncu
   geldikçe günceller. − / + ile değiştirdiğin an "elle ayarlandı" moduna geçer: seçimin korunur, oyuncu sayısı
   değişirse "Öneriyi uygula" uyarısı çıkar. Sorun varsa (ör. rol sayısı ≠ oyuncu sayısı) kırmızı uyarı çıkar ve
   Başlat pasif olur. Faz sürelerini (Hızlı / Normal / Uzun ya da elle, "süresiz" dahil) ve seçenekleri ayarla.
5. **Oyunu Başlat** → onayla. Herkes telefonunda rolünü görür, ekranda "Herkes rolüne baksın" ve rol adetleri çıkar.
6. **Fazlar kendiliğinden ilerler:** sadece "Rolleri dağıttım → Geceyi başlat" düğmesine sen basarsın. Sonrasında
   gece, şafak (ölenlerin açıklanması), gündüz, oylama ve oylama sonucu süre dolunca moderatör onayı olmadan, kim hazır
   olursa olsun bir sonrakine geçer. Üstteki büyük düğme istersen fazı erken bitirmek içindir; süresi 0 (süresiz)
   olan faz sadece düğmeyle ilerler. Şafak ve sonuç ekranı süreleri `config.durations.dawn/voteresult` (varsayılan 15 sn).
   **Oylama:** seçenekler "as" (bir oyuncu) ya da "pas"tır. Biri ancak yaşayanların yarısından fazlası ona oy verirse
   asılır; pas ve oy kullanmayanlar sayılır.
7. Oyun bitince panelde **Yeni oyun (aynı oyuncularla)** ya da **Tamamen sıfırla**.

### Moderatör ipuçları

- **Gece / oylama:** "N kişi daha hazır değil" yazıyorsa ilk tıklama düğmeyi "⚠ Yine de ilerle"ye çevirir;
  ilerlemek için birkaç saniye içinde tekrar tıkla. Yanlışlıkla çift tıklamaya karşı kısa bir kilit vardır.
- **Gece eylemleri** kutusunda kimin kime ne yaptığını, **Oylar (canlı)** kutusunda kimin kime oy verdiğini
  ve anlık sayımı görürsün. Bunlar sadece panelde görünür; oyunculara ve ekrana gizlidir.
- Yeteneği olmayanlar da gece sahte bir seçim yapar (rolü olan belli olmasın diye); panelde "sahte seçim" yazar.
- Oyun sırasında **Çıkar** = oyuncu ölmüş sayılır ve herkese duyurulur (telefonu kapanan, oyunu bırakan için).
- **Olay günlüğü**nü "Günlüğü kopyala" ile panoya alıp oyundan sonra paylaşabilirsin.
- Panel sekmesini kapatıp açmak ya da yenilemek güvenlidir; oyun sunucuda devam eder.
- Eski geçici araç `tools/mod-cli.js` (`npm run mod`) artık **isteğe bağlı/eski**; panel her şeyi yapıyor.

Konsolda şunlar yazar:

- **Oyuncular (telefon):** `http://192.168.x.x:3000/` ve bir QR kod. Telefonla okutan direkt katılır.
- **Ortak ekran (TV):** `http://192.168.x.x:3000/ekran`
- **Moderatör paneli:** `http://localhost:3000/mod` — sadece sunucunun çalıştığı bilgisayardan açılır.
  Başka bir cihazdan açılmaya çalışılırsa 403 verir.

### Sorun giderme

- **Tarayıcı kendiliğinden açılmasın:** PowerShell'de `$env:NO_OPEN=1; npm start` (cmd: `set NO_OPEN=1 && npm start`).
- **Port kullanımda** ("3000 portu kullanımda"): başka bir `npm start` açık kalmış olabilir, o pencereyi kapat;
  ya da başka port: PowerShell `$env:PORT=3001; npm start` (cmd: `set PORT=3001 && npm start`).
  Panel o zaman `http://localhost:3001/mod` olur.
- **Adres yanlış tahmin edilirse** (ör. VPN açıkken): `$env:HOST_IP="192.168.1.34"; npm start`.
- **Panelde/ekranda üstte kırmızı "bağlantı koptu" bandı:** sunucu penceresi kapanmış ya da durmuş olabilir.
  `npm start`'ı yeniden çalıştır; sayfalar kendiliğinden yeniden bağlanır (sunucu yeniden başlarsa oyun sıfırdan başlar).
- **Ekranda QR yanlış adres gösteriyor:** yukarıdaki `HOST_IP` ile doğru adresi ver.

Testler:

```
npm test          # motor + sunucu + panel/ekran gizlilik testleri (gerçek WebSocket ile tam oyunlar dahil)
npm run simulate  # rastgele botlarla 400 oyun
```

## İnternette yayınlama (GitHub + Render)

GitHub Pages bu oyunu çalıştıramaz: Pages sadece sabit dosya sunar, oyunun ise WebSocket'li bir Node.js
sunucusuna ihtiyacı var. Kod GitHub'da durur, sunucuyu ücretsiz bir servis (Render) GitHub'dan alıp çalıştırır.
Böylece oyuncuların aynı Wi-Fi'da olması gerekmez; adresi bilen herkes katılır.

1. Kodu GitHub repona yükle (`render.yaml` dosyası da gitsin).
2. https://render.com → GitHub hesabınla giriş yap → **New → Blueprint** → bu repoyu seç.
3. Render `MOD_PASSWORD` değerini sorar: moderatör şifreni yaz (en az 10-12 karakter, başka yerde kullanmadığın bir şey).
4. Kurulum bitince adres `https://vampir-koylu-xxxx.onrender.com` gibi olur:
   - Oyuncular: ana adres (QR kod bunu gösterir)
   - Moderatör: `/mod` → şifre ekranı → panel
   - Ortak ekran: `/ekran`
5. Kodu GitHub'da güncellediğinde Render kendiliğinden yeniden kurar.

Bilmen gerekenler:

- **Ücretsiz planda sunucu 15 dakika kimse girmeyince uyur.** İlk açılış ~1 dakika sürebilir; oyundan önce
  `/mod`'u bir kez aç.
- **Oyun bellekte tutulur.** Sunucu uyursa ya da yeniden kurulursa süren oyun ve lobi silinir. Oyun ortasında kod güncelleme.
- Şifreyi değiştirmek: Render → servis → **Environment** → `MOD_PASSWORD`.
- Render dışında bir yerde çalıştırırsan iki ortam değişkeni ver: `PUBLIC_URL` (ör. `https://oyunum.example.com`) ve `MOD_PASSWORD`.

### Moderatör şifresi

- `MOD_PASSWORD` ayarlıysa `/mod` her cihazdan açılır ama önce şifre ister (bu bilgisayardan da). Oturum 12 saat sürer,
  panelin sağ üstündeki **🚪 Çıkış** ile kapatılır. Aynı adresten 5 yanlış denemede giriş 1 dakika kilitlenir.
- Ayarlı değilse eski davranış: panel sadece sunucunun çalıştığı bilgisayardan, şifresiz açılır.
- Evde şifreyle denemek için: PowerShell `$env:MOD_PASSWORD="sifren"; npm start`.

## Ağ sorunları

1. **Aynı Wi-Fi:** bilgisayar ve tüm telefonlar aynı ağda olmalı. Telefonun mobil verisi değil Wi-Fi'si açık olsun.
2. **Windows Güvenlik Duvarı:** `npm start` ilk kez çalışınca Windows "Node.js'e erişim izni" sorar.
   **Özel ağlar** kutusunu işaretleyip izin ver. Yanlışlıkla reddettiysen:
   Denetim Masası → Windows Defender Güvenlik Duvarı → "Bir uygulamaya izin ver" → Node.js'i bul,
   **Özel** kutusunu işaretle. Wi-Fi bağlantının ağ profili de "Özel" olmalı
   (Ayarlar → Ağ ve İnternet → Wi-Fi → bağlı ağ → Ağ profili türü: Özel).
3. **İstemci izolasyonu:** okul, kafe, otel ve bazı misafir Wi-Fi'larında cihazlar birbirini göremez
   ("AP/client isolation"). Telefon sayfayı açamıyorsa en kolay çözüm: **bir telefonda hotspot (kişisel erişim
   noktası) aç**, bilgisayarı ve diğer telefonları ona bağla, `npm start`'ı yeniden çalıştır (adres değişir).
   Hotspot internet kotası harcamaz; oyun sadece yerel ağda konuşur.
4. **VPN / sanal ağ kartları** (VirtualBox, WSL, Hamachi, Tailscale…) yanlış adresin seçilmesine yol açabilir.
   Konsoldaki "Diğer olası adresler" satırına bak ya da `HOST_IP` ile adresi elle ver.
5. Telefon kilitlenip açılırsa sayfa kendiliğinden yeniden bağlanır ve aynı oyuncuya döner
   (tarayıcıda saklanan anahtar ile). Sayfayı yenilemek de güvenlidir.

## Klasörler

- `roles/` rol JSON'ları ve şema açıklaması (`roles/README.md`)
- `server/game/` oyun motoru (`engine.js`), etki blokları (`effects.js`), takımlar (`teams.js`), rol önerisi (`setup.js`), avatarlar
- `server/app.js` HTTP + WebSocket sunucusu, `server/net.js` loopback kontrolü ve LAN adresi seçimi, `server/index.js` giriş noktası,
  `server/open.js` tarayıcıyı açma, `server/auth.js` moderatör şifresi ve oturumları
- `public/giris/` moderatör giriş ekranı (sadece `MOD_PASSWORD` ayarlıyken)
- `render.yaml` Render.com kurulum ayarları
- `public/oyuncu/` telefon arayüzü, `public/mod/` moderatör paneli, `public/ekran/` ortak ekran (hepsi saf HTML/CSS/JS, build yok),
  `public/ortak/tema.css` panel ve ekranın ortak renkleri
- `tools/mod-cli.js` eski, isteğe bağlı komut satırı moderatör aracı
- `test/` testler ve simülasyon

## Oyun akışı

`lobby → rolereveal → night → dawn → day → vote → voteresult → night …` ve `ended`.
Rol dağıtımından sonra fazlar süre dolunca kendiliğinden ilerler (moderatör düğmesi erken bitirmek içindir).

## WebSocket protokolü

Bağlantı: `ws://<adres>/ws?as=oyuncu|ekran|mod` (mod sadece loopback'ten). Mesajlar JSON, en fazla 4 KB,
bağlantı başına saniyede ~10 mesaj.

- Sunucu → istemci: `{type:'state', view, serverNow, joined}` (oyuncuya `viewFor`, ekrana `publicView`, moda `modView`),
  `{type:'token', token, playerId}`, `{type:'resumeFailed'}`, `{type:'kicked'}`, `{type:'error', message}`,
  `{type:'suggestion', n, counts}`.
- Oyuncu → sunucu: `join {name, avatar}`, `resume {token}`, `night {abilityId, targetId}` (`__pass`, `__decoy` dahil),
  `dayAbility {abilityId, targetId}`, `vote {targetId|null}`.
- Ekran görünümü (`publicView`) oyun başladıktan sonra `roleCounts: [{id, name, emoji, team, count}]` içerir
  (sadece adetler, kimde olduğu değil; `options.showRoleCounts` ile kapatılabilir). Moderatör görünümü ek olarak
  `roles[].description/abilities`, `lastReport` içerir.
- HTTP: `/api/info` (sadece moderatöre) → `{joinUrl, screenUrl, modUrl, passwordMode}`; `/api/qr.svg`; `/api/avatars`;
  `POST /api/mod/login {password}` (başarılıysa `vk_mod` HttpOnly çerezi), `POST /api/mod/logout`.
  Şifre modunda mod WebSocket'i bu çerezi ve aynı-origin'i ister.
- Mod → sunucu: `setConfig {config:{roleCounts, durations, options}}` (`roleCounts: {}` = otomatik öneri modu;
  `options`: `revealRoleOnDeath`, `announceSaves`, `showRoleCounts`), `start`, `advance`, `kick {playerId}`,
  `updatePlayer {playerId, name?, avatar?}`, `reset {keepPlayers?: boolean}` (varsayılan: oyuncuları koruyup lobiye dön),
  `suggest {n?}`.
