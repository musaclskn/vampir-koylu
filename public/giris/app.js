/* Vampir Köylü — moderatör giriş ekranı. Başarılı girişte sunucu oturum çerezi verir, panel yeniden yüklenir. */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);

  function showError(text) {
    $('error').textContent = text;
    $('error').hidden = false;
  }

  $('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const password = $('password').value;
    if (!password) return showError('Şifreyi yaz.');
    $('submit').disabled = true;
    $('error').hidden = true;
    try {
      const r = await fetch('/api/mod/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
        cache: 'no-store',
      });
      const data = await r.json().catch(() => ({}));
      if (r.ok && data.ok) { location.replace('/mod'); return; }
      showError(data.message || 'Giriş yapılamadı.');
      $('password').select();
    } catch {
      showError('Sunucuya ulaşılamadı. İnternet bağlantını kontrol et.');
    } finally {
      $('submit').disabled = false;
    }
  });
})();
