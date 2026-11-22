(function() {
  'use strict';

  var TARGET_URL = 'https://tv.alcopa.cc';
  var SESSION_GUARD = 'alpac_tv_redirect_done_v1';

  function shouldRedirect() {
    var current = '';
    try {
      current = window.location.href || '';
    } catch (e) {}

    if (current && current.indexOf(TARGET_URL) === 0) {
      return false;
    }

    try {
      if (sessionStorage.getItem(SESSION_GUARD) === '1') {
        return false;
      }
    } catch (e) {}

    return true;
  }

  function go() {
    if (!shouldRedirect()) return;

    try {
      sessionStorage.setItem(SESSION_GUARD, '1');
    } catch (e) {}

    try {
      window.location.replace(TARGET_URL);
    } catch (e) {
      window.location.href = TARGET_URL;
    }
  }

  if (window.appready) {
    setTimeout(go, 300);
  } else if (window.Lampa && Lampa.Listener && typeof Lampa.Listener.follow === 'function') {
    Lampa.Listener.follow('app', function(e) {
      if (e && e.type === 'ready') {
        setTimeout(go, 300);
      }
    });
  } else {
    setTimeout(go, 800);
  }
})();
