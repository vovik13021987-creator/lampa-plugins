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

  // ---------- YouTube IFrame API ----------

  function loadYouTubeApi(done) {
    if (window.YT && window.YT.Player) return done();

    var prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = function () {
      if (typeof prev === 'function') {
        try { prev(); } catch (e) {}
      }
      done();
    };

    if (!document.getElementById('trailerbg-yt-api')) {
      var s = document.createElement('script');
      s.id = 'trailerbg-yt-api';
      s.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(s);
    }
  }

  // ---------- Вибір відео з даних TMDB ----------

  function pickVideos(data) {
    var list = data && data.videos && data.videos.results;
    if (!list || !list.length) return [];

    var lang = '';
    try { lang = Lampa.Storage.field('tmdb_lang') || ''; } catch (e) {}

    var scored = [];

    for (var i = 0; i < list.length; i++) {
      var v = list[i];
      if (!v || !v.key) continue;
      if (v.site && String(v.site).toLowerCase() !== 'youtube') continue;

      var score = 0;
      if (v.type === 'Trailer') score += 4;
      else if (v.type === 'Teaser') score += 2;
      if (v.iso_639_1 === lang) score += 2;
      else if (v.iso_639_1 === 'en') score += 1;
      if (v.official) score += 1;

      scored.push({ video: v, score: score, order: i });
    }

    scored.sort(function (a, b) {
      return b.score - a.score || a.order - b.order;
    });

    var out = [];
    for (var j = 0; j < scored.length; j++) out.push(scored[j].video);
    return out;
  }

  function isViewing(activity) {
    try {
      return Lampa.Activity.active().activity === activity &&
        Lampa.Controller.enabled().name === 'full_start';
    } catch (e) {
      return false;
    }
  }

  // ---------- Сеанс показу трейлера для однієї картки ----------

  function Session(activity, videos) {
    var self = this;

    this.activity = activity;
    this.videos = videos;
    this.index = 0;
    this.video = videos[0];
    this.state = 'waiting'; // waiting -> loading -> playing -> closed
    this.dwell = 0;
    this.player = null;
    this.overlay = null;
    this.hint = null;
    this.muted = true;
    this.timerStartup = null;

    this.timerTick = setInterval(function () {
      self.step();
    }, TICK_MS);

    this.onActivity = function (a) {
      if (a && a.type === 'destroy' && a.object && a.object.activity === activity) {
        self.close(false);
      }
    };
    Lampa.Listener.follow('activity', this.onActivity);
  }

  Session.prototype.step = function () {
    if (this.state === 'waiting') {
      if (isViewing(this.activity)) {
        this.dwell += TICK_MS;
        if (this.dwell >= DWELL_MS) this.start();
      } else {
        this.dwell = 0;
      }
    } else if (this.state === 'loading') {
      if (!isViewing(this.activity)) this.close(false);
    }
  };

  Session.prototype.start = function () {
    var self = this;
    this.state = 'loading';

    this.timerStartup = setTimeout(function () {
      if (self.state === 'loading') self.close(false);
    }, STARTUP_MS);

    loadYouTubeApi(function () {
      if (self.state === 'loading') self.build();
    });
  };

  Session.prototype.build = function () {
    var self = this;

    var overlay = document.createElement('div');
    overlay.className = 'trailerbg';

    var frame = document.createElement('div');
    frame.className = 'trailerbg__frame';

    var holder = document.createElement('div');
    holder.id = 'trailerbg-player';
    frame.appendChild(holder);

    var hint = document.createElement('div');
    hint.className = 'trailerbg__hint';
    hint.textContent = Lampa.Lang.translate('trailerbg_hint_sound');

    overlay.appendChild(frame);
    overlay.appendChild(hint);
    document.body.appendChild(overlay);

    this.overlay = overlay;
    this.hint = hint;

    try {
      this.player = new YT.Player('trailerbg-player', {
        width: '100%',
        height: '100%',
        videoId: this.video.key,
        playerVars: {
          controls: 0,
          showinfo: 0,
          modestbranding: 1,
          rel: 0,
          iv_load_policy: 3,
          disablekb: 1,
          fs: 0,
          playsinline: 1,
          autoplay: 1,
          mute: 1,
          enablejsapi: 1
        },
        events: {
          onReady: function (e) {
            try {
              e.target.mute();
              e.target.playVideo();
            } catch (err) {}
          },
          onStateChange: function (e) {
            if (e.data === YT.PlayerState.PLAYING && self.state === 'loading') {
              self.show();
            } else if (e.data === YT.PlayerState.ENDED) {
              self.close(true);
            }
          },
          onError: function () {
            // 101/150: власник заборонив вбудовування — пробуємо наступне відео зі списку
            if (self.state === 'loading' && self.index + 1 < self.videos.length) {
              self.index++;
              self.video = self.videos[self.index];
              clearTimeout(self.timerStartup);
              self.timerStartup = setTimeout(function () {
                if (self.state === 'loading') self.close(false);
              }, STARTUP_MS);
              try {
                self.player.loadVideoById(self.video.key);
              } catch (err) {
                self.close(false);
              }
            } else {
              self.close(self.state === 'playing');
            }
          }
        }
      });
    } catch (err) {
      this.close(false);
    }
  };

  Session.prototype.show = function () {
    var self = this;

    this.state = 'playing';
    clearTimeout(this.timerStartup);

    // небольшая пауза, чтобы видео успело отрисоваться, затем плавное появление
    setTimeout(function () {
      if (self.overlay) self.overlay.className = 'trailerbg show';
    }, 50);

    var exit = function () {
      self.close(true);
    };

    Lampa.Controller.add('trailerbg', {
      toggle: function () {
        Lampa.Controller.clear();
      },
      enter: function () {
        self.toggleSound();
      },
      left: exit,
      right: exit,
      up: exit,
      down: exit,
      back: exit
    });
    Lampa.Controller.toggle('trailerbg');
  };

  Session.prototype.toggleSound = function () {
    if (!this.player) return;
    try {
      if (this.muted) {
        this.player.unMute();
        this.player.setVolume(100);
        this.muted = false;
        if (this.hint) this.hint.textContent = Lampa.Lang.translate('trailerbg_hint_mute');
      } else {
        this.player.mute();
        this.muted = true;
        if (this.hint) this.hint.textContent = Lampa.Lang.translate('trailerbg_hint_sound');
      }
    } catch (e) {}
  };

  Session.prototype.close = function (restoreController) {
    if (this.state === 'closed') return;

    var wasPlaying = this.state === 'playing';
    this.state = 'closed';

    clearInterval(this.timerTick);
    clearTimeout(this.timerStartup);

    try { Lampa.Listener.remove('activity', this.onActivity); } catch (e) {}
    try { if (this.player && this.player.destroy) this.player.destroy(); } catch (e) {}

    if (this.overlay && this.overlay.parentNode) {
      this.overlay.parentNode.removeChild(this.overlay);
    }

    this.player = null;
    this.overlay = null;
    this.hint = null;

    if (current === this) current = null;

    if (wasPlaying && restoreController) {
      try {
        if (Lampa.Activity.active().activity === this.activity) {
          Lampa.Controller.toggle('full_start');
        }
      } catch (e) {}
    }
  };

  // ---------- Запуск плагіна ----------

  function addStyles() {
    if (document.getElementById('trailerbg-style')) return;

    var css = '' +
      '.trailerbg{position:fixed;left:0;top:0;right:0;bottom:0;z-index:1000;background:#000;opacity:0;transition:opacity .4s}' +
      '.trailerbg.show{opacity:1}' +
      '.trailerbg__frame{position:absolute;left:50%;top:50%;width:100vw;height:56.25vw;' +
      '-webkit-transform:translate3d(-50%,-50%,0) scale(1.2);transform:translate3d(-50%,-50%,0) scale(1.2)}' +
      '.trailerbg__frame iframe{width:100%;height:100%;border:0}' +
      '.trailerbg__hint{position:absolute;left:0;right:0;bottom:1.5em;text-align:center;font-size:1.3em;' +
      'color:#fff;text-shadow:0 0 .3em rgba(0,0,0,.8);opacity:.85}';

    var style = document.createElement('style');
    style.id = 'trailerbg-style';
    style.textContent = css;
    document.head.appendChild(style);
  }

  function startPlugin() {
    Lampa.Lang.add({
      trailerbg_name: {
        ru: 'Трейлер на фоне',
        en: 'Trailer background',
        uk: 'Трейлер на фоні'
      },
      trailerbg_enable: {
        ru: 'Показывать трейлер на карточке',
        en: 'Play trailer on movie card',
        uk: 'Показувати трейлер на картці'
      },
      trailerbg_desc: {
        ru: 'Через несколько секунд на карточке фильма запускается трейлер',
        en: 'A trailer starts a few seconds after opening a movie card',
        uk: 'Через кілька секунд на картці фільму запускається трейлер'
      },
      trailerbg_hint_sound: {
        ru: 'OK — включить звук, Назад — закрыть',
        en: 'OK — sound on, Back — close',
        uk: 'OK — увімкнути звук, Назад — закрити'
      },
      trailerbg_hint_mute: {
        ru: 'OK — выключить звук, Назад — закрыть',
        en: 'OK — sound off, Back — close',
        uk: 'OK — вимкнути звук, Назад — закрити'
      }
    });

    addStyles();

    Lampa.SettingsApi.addComponent({
      component: 'trailerbg',
      name: Lampa.Lang.translate('trailerbg_name'),
      icon: '<svg width="36" height="28" viewBox="0 0 36 28" fill="none" xmlns="http://www.w3.org/2000/svg">' +
        '<rect x="1.5" y="1.5" width="33" height="25" rx="3.5" stroke="white" stroke-width="3"/>' +
        '<path d="M14 8.5L24 14L14 19.5V8.5Z" fill="white"/></svg>'
    });

    Lampa.SettingsApi.addParam({
      component: 'trailerbg',
      param: {
        name: 'trailerbg_enabled',
        type: 'trigger',
        'default': false
      },
      field: {
        name: Lampa.Lang.translate('trailerbg_enable'),
        description: Lampa.Lang.translate('trailerbg_desc')
      }
    });

    Lampa.Listener.follow('full', function (e) {
      if (!e || e.type !== 'complite') return;
      if (!Lampa.Storage.field('trailerbg_enabled')) return;

      var videos = pickVideos(e.data);
      if (!videos.length) return;

      if (current) current.close(false);
      current = new Session(e.object.activity, videos);
    });
  }

  if (window.appready) {
    startPlugin();
  } else {
    Lampa.Listener.follow('app', function (e) {
      if (e.type === 'ready') startPlugin();
    });
  }
})();
