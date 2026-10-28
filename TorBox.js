/*
 * TorBox для Lampa
 * Підставляє TorBox замість TorrServer: обираєте торрент у списку "Торренти",
 * плагін перевіряє кеш TorBox, додає роздачу й запускає відео прямо з TorBox.
 * API-ключ вводиться в Налаштування -> TorBox (в файлі ключа немає).
 * Написано на ES5, щоб працювало на старих Tizen (2017 і раніше).
 */
(function () {
  'use strict';

  if (window.torbox_plugin_ready) return;
  window.torbox_plugin_ready = true;

  var API = 'https://api.torbox.app/v1/api';
  var VIDEO_RE = /\.(mkv|mp4|avi|mov|m4v|ts|m2ts|webm|wmv|mpg|mpeg)$/i;

  /* ---------- допоміжне ---------- */

  function apiKey() {
    return String(Lampa.Storage.get('torbox_key', '') || '').replace(/\s+/g, '');
  }

  function isEnabled() {
    return String(Lampa.Storage.get('torbox_enabled', 'true')) !== 'false' && !!apiKey();
  }

  function noty(text) {
    try { Lampa.Noty.show(text); } catch (e) {}
  }

  function loading(on) {
    try {
      if (on) {
        if (Lampa.Loading && Lampa.Loading.start) Lampa.Loading.start(function () {});
      } else {
        if (Lampa.Loading && Lampa.Loading.stop) Lampa.Loading.stop();
      }
    } catch (e) {}
  }

  function back() {
    try { Lampa.Controller.toggle('content'); } catch (e) {}
  }

  function formatSize(bytes) {
    if (!bytes) return '';
    var gb = bytes / 1073741824;
    if (gb >= 1) return gb.toFixed(2) + ' ГБ';
    return (bytes / 1048576).toFixed(0) + ' МБ';
  }

  /* base32 -> hex (деякі magnet-посилання мають хеш у base32) */
  function base32ToHex(s) {
    var alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    var bits = '';
    s = s.toUpperCase();
    for (var i = 0; i < s.length; i++) {
      var v = alphabet.indexOf(s.charAt(i));
      if (v < 0) return '';
      var b = v.toString(2);
      while (b.length < 5) b = '0' + b;
      bits += b;
    }
    var hex = '';
    for (var j = 0; j + 4 <= bits.length; j += 4) {
      hex += parseInt(bits.substr(j, 4), 2).toString(16);
    }
    return hex.substr(0, 40);
  }

  function getMagnet(el) {
    var cand = [el.MagnetUri, el.magnet, el.Magnet, el.Link, el.link, el.url];
    for (var i = 0; i < cand.length; i++) {
      if (cand[i] && String(cand[i]).indexOf('magnet:') === 0) return String(cand[i]);
    }
    return '';
  }

  function getHash(el, magnet) {
    var h = el.hash || el.Hash || el.infohash || '';
    if (h && /^[a-fA-F0-9]{40}$/.test(h)) return String(h).toLowerCase();
    var m = magnet.match(/btih:([a-zA-Z0-9]+)/i);
    if (!m) return '';
    var raw = m[1];
    if (raw.length === 40) return raw.toLowerCase();
    if (raw.length === 32) return base32ToHex(raw);
    return '';
  }

  /* ---------- запити до TorBox ---------- */

  function request(method, path, params, form, ok, fail) {
    var url = API + path;
    if (params) {
      var q = [];
      for (var k in params) {
        if (params.hasOwnProperty(k) && params[k] !== undefined) {
          q.push(encodeURIComponent(k) + '=' + encodeURIComponent(params[k]));
        }
      }
      if (q.length) url += '?' + q.join('&');
    }

    var x = new XMLHttpRequest();
    x.open(method, url, true);
    x.setRequestHeader('Authorization', 'Bearer ' + apiKey());
    x.timeout = 30000;

    x.onload = function () {
      var j = null;
      try { j = JSON.parse(x.responseText); } catch (e) {}
      if (x.status >= 200 && x.status < 300 && j && j.success !== false) {
        ok(j.data !== undefined ? j.data : j, j);
      } else {
        var msg = (j && (j.detail || j.error)) || ('HTTP ' + x.status);
        if (x.status === 401 || x.status === 403) msg = 'Невірний API-ключ TorBox';
        fail(msg);
      }
    };
    x.onerror = function () { fail('Помилка мережі (інтернет чи CORS)'); };
    x.ontimeout = function () { fail('TorBox не відповідає (таймаут)'); };
    x.send(form || null);
  }

  function isCached(data, hash) {
    if (!data) return false;
    hash = String(hash).toLowerCase();
    var i, it, v;
    if (Object.prototype.toString.call(data) === '[object Array]') {
      for (i = 0; i < data.length; i++) {
        it = data[i];
        v = typeof it === 'string' ? it : (it && it.hash);
        if (v && String(v).toLowerCase() === hash) return true;
      }
      return false;
    }
    if (typeof data === 'object') {
      for (var k in data) {
        if (!data.hasOwnProperty(k)) continue;
        if (k.toLowerCase() === hash && data[k]) return true;
        if (data[k] && data[k].hash && String(data[k].hash).toLowerCase() === hash) return true;
      }
    }
    return false;
  }

  function addTorrent(magnet, onlyIfCached, ok, fail) {
    var fd = new FormData();
    fd.append('magnet', magnet);
    fd.append('seed', '1');
    fd.append('allow_zip', 'false');
    if (onlyIfCached) fd.append('add_only_if_cached', 'true');
    request('POST', '/torrents/createtorrent', null, fd, ok, fail);
  }

  function getFiles(torrentId, ok, fail) {
    request('GET', '/torrents/mylist', { id: torrentId, bypass_cache: 'true' }, null, function (d) {
      var t = d;
      if (Object.prototype.toString.call(d) === '[object Array]') t = d[0];
      var files = (t && t.files) || [];
      var out = [];
      for (var i = 0; i < files.length; i++) {
        var f = files[i];
        var name = f.short_name || f.name || '';
        var isVideo = (f.mimetype && String(f.mimetype).indexOf('video') === 0) || VIDEO_RE.test(f.name || name);
        if (isVideo) out.push({ id: f.id, name: name, full: f.name || name, size: f.size });
      }
      out.sort(function (a, b) {
        var x = (a.full || '').toLowerCase(), y = (b.full || '').toLowerCase();
        return x < y ? -1 : (x > y ? 1 : 0);
      });
      ok(out);
    }, fail);
  }

  function streamUrl(torrentId, fileId) {
    return API + '/torrents/requestdl?token=' + encodeURIComponent(apiKey()) +
      '&torrent_id=' + encodeURIComponent(torrentId) +
      '&file_id=' + encodeURIComponent(fileId) +
      '&redirect=true';
  }

  /* ---------- відтворення ---------- */

  function play(torrentId, files, index, movie) {
    var title = (movie && (movie.title || movie.name)) || 'TorBox';
    var list = [];
    for (var i = 0; i < files.length; i++) {
      list.push({ title: files[i].name, url: streamUrl(torrentId, files[i].id) });
    }
    var cur = list[index];
    var obj = { title: cur.title || title, url: cur.url };
    if (movie) obj.movie = movie;
    try {
      if (list.length > 1 && Lampa.Player.playlist) Lampa.Player.playlist(list);
      Lampa.Player.play(obj);
    } catch (e) {
      noty('Не вдалося запустити плеєр: ' + e.message);
    }
  }

  function chooseFile(torrentId, files, movie) {
    if (!files.length) {
      noty('У торренті немає відеофайлів');
      back();
      return;
    }
    if (files.length === 1) {
      play(torrentId, files, 0, movie);
      return;
    }
    var items = [];
    for (var i = 0; i < files.length; i++) {
      items.push({ title: files[i].name, subtitle: formatSize(files[i].size), index: i });
    }
    Lampa.Select.show({
      title: 'TorBox: файли',
      items: items,
      onSelect: function (a) { play(torrentId, files, a.index, movie); },
      onBack: back
    });
  }

  function failMsg(msg) {
    loading(false);
    noty('TorBox: ' + msg);
    back();
  }

  function startTorBox(el, movie, fallback) {
    var magnet = getMagnet(el);
    var hash = getHash(el, magnet);

    if (!magnet || !hash) {
      noty('TorBox: для цього торрента немає magnet-посилання, відкриваю як зазвичай');
      fallback();
      return;
    }

    loading(true);

    request('GET', '/torrents/checkcached', { hash: hash, format: 'list', list_files: 'false' }, null, function (d) {
      if (isCached(d, hash)) {
        addTorrent(magnet, true, function (r) {
          var id = r && (r.torrent_id || r.id);
          if (!id) return failMsg('не отримано ID торрента');
          getFiles(id, function (files) {
            loading(false);
            chooseFile(id, files, movie);
          }, failMsg);
        }, failMsg);
      } else {
        loading(false);
        Lampa.Select.show({
          title: 'Немає в кеші TorBox',
          items: [
            { title: 'Додати в TorBox і чекати', action: 'add' },
            { title: 'Відкрити через TorrServer', action: 'orig' }
          ],
          onSelect: function (a) {
            if (a.action === 'orig') return fallback();
            loading(true);
            addTorrent(magnet, false, function () {
              loading(false);
              noty('Додано в TorBox. Коли завантажиться, відкрийте цей торрент ще раз');
              back();
            }, failMsg);
          },
          onBack: back
        });
      }
    }, failMsg);
  }

  /* ---------- підключення до Lampa ---------- */

  function hookTorrent() {
    var T = Lampa.Torrent;
    if (!T || typeof T.start !== 'function') return false;
    if (T.__torbox_hooked) return true;

    var original = T.start;
    T.start = function (el, movie) {
      var self = this, args = arguments;
      var fallback = function () { original.apply(self, args); };

      if (!isEnabled()) return fallback();
      try {
        startTorBox(el || {}, movie, fallback);
      } catch (e) {
        loading(false);
        fallback();
      }
    };
    T.__torbox_hooked = true;
    return true;
  }

  function addSettings() {
    var icon = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
      '<rect x="3" y="5" width="18" height="14" rx="3" stroke="currentColor" stroke-width="2"/>' +
      '<path d="M10 9.5l5 2.5-5 2.5v-5z" fill="currentColor"/></svg>';

    Lampa.SettingsApi.addComponent({
      component: 'torbox',
      name: 'TorBox',
      icon: icon
    });

    Lampa.SettingsApi.addParam({
      component: 'torbox',
      param: { name: 'torbox_enabled', type: 'trigger', default: true },
      field: {
        name: 'Використовувати TorBox',
        description: 'Замість TorrServer, коли обираєте торрент у списку'
      }
    });

    Lampa.SettingsApi.addParam({
      component: 'torbox',
      param: { name: 'torbox_key', type: 'input', values: '', default: '' },
      field: {
        name: 'API-ключ',
        description: 'torbox.app -> Settings -> Account -> API Key. Нікому його не показуйте'
      },
      onChange: function () {}
    });

    Lampa.SettingsApi.addParam({
      component: 'torbox',
      param: { name: 'torbox_check', type: 'button' },
      field: {
        name: 'Перевірити ключ',
        description: 'Надсилає тестовий запит до TorBox'
      },
      onChange: function () {
        if (!apiKey()) return noty('Спочатку введіть API-ключ');
        request('GET', '/user/me', null, null, function () {
          noty('TorBox: ключ працює');
        }, function (msg) {
          noty('TorBox: ' + msg);
        });
      }
    });
  }

  function init() {
    try { addSettings(); } catch (e) {}
    if (!hookTorrent()) {
      noty('TorBox: не знайдено Lampa.Torrent.start, оновіть Lampa');
    }
  }

  if (window.appready) {
    init();
  } else {
    Lampa.Listener.follow('app', function (e) {
      if (e.type === 'ready') init();
    });
  }
})();
