/*
 * AgNative_Tizen.js — завантажувач-«перекладач» для плагіна AppleTV AgNative
 * (llowmikee/AppleTVAGNativeNG) на старих ТВ Samsung (Tizen 3.0, Chromium ~47).
 *
 * Що робить:
 *  1. Завантажує оригінальний appletv_agnative.js.
 *  2. Правит у пам'яті те, чого не розуміє старий рушій:
 *       - деструктуризацію  var { A, B } = OBJ;   (SyntaxError у Chrome < 49)
 *       - CSS `inset`, `min()` (не підтримуються)
 *       - режим продуктивності на Tizen -> «дуже слабкий пристрій»
 *  3. Додає поліфіли: String.padStart/padEnd, Element.replaceWith.
 *  4. Запускає виправлений код.
 *
 * Код цього файлу — чистий ES5, щоб він сам працював на старому ТВ.
 */
(function () {
  'use strict';

  var SRC = 'https://llowmikee.github.io/AppleTVAGNativeNG/appletv_agnative.js';
  var CACHE_KEY = 'agn_tizen_src_cache';
  var DEBUG = true;          // true — показувати на екрані повідомлення «завантажено» / помилки
  var WEAK_TV_AUTO = true;   // true — на Tizen автоматично ставити режим «дуже слабкий пристрій»

  if (window.__AGN_TIZEN_LOADER__) return;
  window.__AGN_TIZEN_LOADER__ = true;

  function say(text) {
    try {
      if (window.Lampa && Lampa.Noty && Lampa.Noty.show) { Lampa.Noty.show(text); return; }
    } catch (e) { }
    try { console.log(text); } catch (e2) { }
  }

  /* ───────────── поліфіли ───────────── */

  function define(proto, name, fn) {
    if (!proto || proto[name]) return;
    try {
      Object.defineProperty(proto, name, { value: fn, writable: true, configurable: true, enumerable: false });
    } catch (e) { proto[name] = fn; }
  }

  function padString(str, len, pad, atStart) {
    var s = String(str);
    len = len >> 0;
    pad = (pad === undefined) ? ' ' : String(pad);
    if (s.length >= len || !pad.length) return s;
    var need = len - s.length, fill = '';
    while (fill.length < need) fill += pad;
    fill = fill.slice(0, need);
    return atStart ? fill + s : s + fill;
  }

  define(String.prototype, 'padStart', function (len, pad) { return padString(this, len, pad, true); });
  define(String.prototype, 'padEnd', function (len, pad) { return padString(this, len, pad, false); });

  if (window.Element) {
    define(Element.prototype, 'replaceWith', function () {
      var parent = this.parentNode;
      if (!parent) return;
      var frag = document.createDocumentFragment();
      for (var i = 0; i < arguments.length; i++) {
        var n = arguments[i];
        if (typeof n === 'string' || typeof n === 'number') n = document.createTextNode(String(n));
        frag.appendChild(n);
      }
      parent.replaceChild(frag, this);
    });
  }

  /* ───────────── правки коду ───────────── */

  function patch(src) {
    // 1. Деструктуризація: var { A, B } = OBJ;  ->  var A = OBJ.A, B = OBJ.B;
    src = src.replace(/\b(?:var|let|const)\s*\{([^{}]*)\}\s*=\s*([A-Za-z_$][\w$.]*)\s*;/g, function (m, names, obj) {
      var parts = names.split(','), out = [], i, n;
      for (i = 0; i < parts.length; i++) {
        n = parts[i].replace(/^\s+|\s+$/g, '');
        if (!n) continue;
        if (!/^[A-Za-z_$][\w$]*$/.test(n)) return m; // складний шаблон — не чіпаємо
        out.push(n + ' = ' + obj + '.' + n);
      }
      if (!out.length) return m;
      return 'var ' + out.join(',\n      ') + ';';
    });

    // 2. Tizen -> «дуже слабкий пристрій» (ручний вибір у налаштуваннях плагіна має пріоритет)
    if (WEAK_TV_AUTO) {
      src = src.replace('var chromeVer = 999;',
        "var chromeVer = 999; if (ua.indexOf('tizen') > -1) chromeVer = 47;");
    }

    // 3. CSS, якого не знає Chrome 47
    src = src.replace(/inset:\s*-10%/g, 'top:-10%;right:-10%;bottom:-10%;left:-10%');
    src = src.replace(/inset:\s*0(?=[;\s'"}])/g, 'top:0;right:0;bottom:0;left:0');
    src = src.split('min(32em, 42vw)').join('42vw');

    return src;
  }

  /* ───────────── запуск ───────────── */

  function runViaScriptTag(code) {
    var s = document.createElement('script');
    s.text = code;
    (document.head || document.documentElement).appendChild(s);
  }

  function run(code) {
    try {
      (new Function(code))();
      return true;
    } catch (e) {
      var msg = (e && e.message) ? e.message : String(e);
      if ((e && e.name === 'EvalError') || /unsafe-eval|Content Security/i.test(msg)) {
        try { runViaScriptTag(code); return true; } catch (e2) { msg = (e2 && e2.message) || msg; }
      }
      say('AgNative (Tizen): помилка — ' + msg);
      return false;
    }
  }

  function start(text, fromCache) {
    var code = patch(text);
    var ok = run(code);
    if (ok && DEBUG) say('AgNative (Tizen): запущено' + (fromCache ? ' (з кешу)' : ''));
  }

  function readCache() {
    try { return localStorage.getItem(CACHE_KEY) || ''; } catch (e) { return ''; }
  }

  function writeCache(text) {
    try { localStorage.setItem(CACHE_KEY, text); } catch (e) { }
  }

  function load() {
    var done = false;
    var x = new XMLHttpRequest();

    function fail(reason) {
      if (done) return;
      done = true;
      var cached = readCache();
      if (cached) start(cached, true);
      else say('AgNative (Tizen): не вдалося завантажити плагін (' + reason + ')');
    }

    x.open('GET', SRC, true);
    x.timeout = 20000;
    x.onreadystatechange = function () {
      if (x.readyState !== 4 || done) return;
      if (x.status >= 200 && x.status < 300 && x.responseText) {
        done = true;
        writeCache(x.responseText);
        start(x.responseText, false);
      } else {
        fail(x.status || 'мережа');
      }
    };
    x.ontimeout = function () { fail('таймаут'); };
    x.send();
  }

  load();
})();
