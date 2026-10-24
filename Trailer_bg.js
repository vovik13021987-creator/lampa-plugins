/*
 * Trailer_bg — трейлер на фоні картки фільму для Lampa.
 * Власний плагін, без прив'язки до сторонніх сервісів і підписок.
 *
 * Як працює: ви відкрили картку фільму і кілька секунд нічого не натискаєте —
 * на весь екран запускається трейлер з YouTube (без звуку).
 *   OK      — увімкнути / вимкнути звук
 *   Назад   — закрити трейлер
 *   стрілки — закрити трейлер
 * Вмикається в Налаштування -> Трейлер на фоні.
 */
(function () {
  'use strict';

  if (window.trailerbg_ready) return;
  window.trailerbg_ready = true;

  var DWELL_MS = 3000;     // скільки чекати на картці перед запуском
  var TICK_MS = 500;       // як часто перевіряємо, що ви ще на картці
  var STARTUP_MS = 10000;  // скільки чекаємо, поки YouTube почне грати
  var current = null;      // поточний сеанс
  var DEBUG = true;        // показувати маленькі повідомлення на екрані (потім можна поставити false)

  function dbg(msg) {
    if (!DEBUG) return;
    try { Lampa.Noty.show('TBG: ' + msg); } catch (e) {}
  }

  // ---------- YouTube IFrame API ----------

  function loadYouTubeApi(done) {
    if (window.YT && window.YT.Player) return done();
    dbg('завантажую YouTube API');
