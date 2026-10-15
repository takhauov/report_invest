/* Вход по логину и паролю.
 * Подключение к данным (владелец/репозиторий/токен) шифруется паролем инвестора (PBKDF2 + AES-GCM)
 * и кладётся в публичный файл access.json. Без пароля из файла ничего не прочитать;
 * с паролем сайт расшифровывает подключение прямо в браузере. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Access = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var ITER = 600000;
  var te = new TextEncoder(), td = new TextDecoder();

  function cryptoObj() {
    var c = (typeof globalThis !== 'undefined' && globalThis.crypto) || (typeof self !== 'undefined' && self.crypto);
    if (!c || !c.subtle) throw new Error('Браузер не поддерживает шифрование (нужен https и современный браузер).');
    return c;
  }
  function b64(buf) {
    var a = new Uint8Array(buf), s = '';
    for (var i = 0; i < a.length; i++) s += String.fromCharCode(a[i]);
    return btoa(s);
  }
  function unb64(str) {
    var s = atob(str), a = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) a[i] = s.charCodeAt(i);
    return a;
  }
  function normLogin(l) { return String(l || '').trim().toLowerCase(); }

  async function deriveKey(login, password, salt, iter) {
    var c = cryptoObj();
    var base = await c.subtle.importKey('raw', te.encode(normLogin(login) + '\n' + String(password || '')), 'PBKDF2', false, ['deriveKey']);
    return c.subtle.deriveKey({ name: 'PBKDF2', salt: salt, iterations: iter, hash: 'SHA-256' }, base,
      { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }

  // payload: { owner, repo, branch, token } -> объект для access.json
  async function seal(login, password, payload) {
    if (!normLogin(login)) throw new Error('Укажите логин.');
    if (String(password || '').length < 8) throw new Error('Пароль должен быть не короче 8 символов.');
    var c = cryptoObj(), salt = c.getRandomValues(new Uint8Array(16)), iv = c.getRandomValues(new Uint8Array(12));
    var key = await deriveKey(login, password, salt, ITER);
    var ct = await c.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, te.encode(JSON.stringify(payload)));
    return { v: 1, kdf: 'PBKDF2-SHA256', iter: ITER, salt: b64(salt), iv: b64(iv), ct: b64(ct) };
  }

  // Возвращает payload или бросает ошибку «неверный логин или пароль»
  async function open(login, password, blob) {
    if (!blob || blob.v !== 1 || !blob.ct) throw new Error('Файл доступа повреждён.');
    try {
      var key = await deriveKey(login, password, unb64(blob.salt), blob.iter || ITER);
      var pt = await cryptoObj().subtle.decrypt({ name: 'AES-GCM', iv: unb64(blob.iv) }, key, unb64(blob.ct));
      return JSON.parse(td.decode(pt));
    } catch (e) {
      throw new Error('Неверный логин или пароль.');
    }
  }

  return { seal: seal, open: open, ITER: ITER };
});
