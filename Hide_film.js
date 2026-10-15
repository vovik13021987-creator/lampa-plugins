(function () {
    'use strict';

    var KEY = 'hide_movie_list';
    var lastCard = null, lastTime = 0;

    function getList() {
        var l = Lampa.Storage.get(KEY, '[]');
        return Array.isArray(l) ? l : [];
    }
    function isTv(d) {
        return !!(d.name || d.original_name || d.first_air_date || d.number_of_seasons);
    }
    function key(d) { return (isTv(d) ? 'tv:' : 'movie:') + d.id; }
    function isHidden(d) { return !!(d && d.id && getList().indexOf(key(d)) !== -1); }
    function hide(d) {
        var l = getList();
        if (l.indexOf(key(d)) === -1) l.push(key(d));
        Lampa.Storage.set(KEY, l);
    }
    function unhide(d) {
        Lampa.Storage.set(KEY, getList().filter(function (x) { return x !== key(d); }));
    }

    function looksLikeMovie(v) {
        return v && typeof v === 'object' && v.id &&
            (v.title || v.name || v.original_title || v.original_name);
    }

    function fromValue(v) {
        if (looksLikeMovie(v)) return v;
        if (v && typeof v === 'object') {
            var sub = [v.data, v.card_data, v.item, v.card, v.movie];
            for (var i = 0; i < sub.length; i++) if (looksLikeMovie(sub[i])) return sub[i];
        }
        return null;
    }

    function cardData(el) {
        if (!el) return null;
        var found = null, k;
        try {
            var jd = $(el).data() || {};
            for (k in jd) { found = fromValue(jd[k]); if (found) return found; }
        } catch (e) {}
        for (k in el) {
            try { found = fromValue(el[k]); if (found) return found; } catch (e) {}
        }
        return null;
    }

    function debugInfo(el) {
        if (!el) return 'Картку не визначено';
        var own = [], jd = [];
        try { for (var k in el) if (/card|data|item|movie/i.test(k)) own.push(k); } catch (e) {}
        try { jd = Object.keys($(el).data() || {}); } catch (e) {}
        return 'Дані не знайдено. el: [' + own.join(',') + '] jq: [' + jd.join(',') + ']';
    }

    function sweep() {
        $('.card').each(function () {
            var d = cardData(this);
            if (d && isHidden(d)) $(this).remove();
        });
    }

    var timer;
    function startObserver() {
        new MutationObserver(function () {
            clearTimeout(timer);
            timer = setTimeout(sweep, 100);
        }).observe(document.body, { childList: true, subtree: true });
    }

    // запам'ятовуємо останню картку, з якою взаємодіяли
    function track(e) {
        var c = $(e.target).closest('.card')[0];
        if (c) { lastCard = c; lastTime = Date.now(); }
    }
    document.addEventListener('touchstart', track, true);
    document.addEventListener('mousedown', track, true);
    document.addEventListener('contextmenu', track, true);

    function currentCard() {
        var f = $('.card.focus').last()[0];
        if (f) return f;
        if (lastCard && Date.now() - lastTime < 8000) return lastCard;
        return null;
    }

    function patchSelect() {
        if (!Lampa.Select || Lampa.Select._hide_patched) return;
        var orig = Lampa.Select.show;
        Lampa.Select._hide_patched = true;

        Lampa.Select.show = function (params) {
            try {
                if (params && Array.isArray(params.items) && params.items.length &&
                    !params.items.some(function (i) { return i.hide_movie; })) {

                    var el = currentCard();
                    if (el) {
                        var d = cardData(el);
                        var $el = $(el);
                        if (d) {
                            params.items.push({
                                title: isHidden(d) ? 'Показувати фільм' : 'Сховати фільм',
                                hide_movie: true,
                                onSelect: function () {
                                    if (isHidden(d)) {
                                        unhide(d);
                                        Lampa.Noty.show('Фільм знову буде показуватись');
                                    } else {
                                        hide(d);
                                        $el.remove();
                                        Lampa.Noty.show('Фільм сховано');
                                    }
                                }
                            });
                        } else {
                            params.items.push({
                                title: 'Сховати: діагностика',
                                hide_movie: true,
                                onSelect: function () { Lampa.Noty.show(debugInfo(el)); }
                            });
                        }
                    }
                }
            } catch (e) { console.log('[hide_movie]', e); }
            return orig.apply(this, arguments);
        };
    }

    Lampa.Listener.follow('full', function (e) {
        if (e.type !== 'complite') return;

        var movie = e.data.movie;
        var render = e.object.activity.render();
        var container = render.find('.full-start-new__buttons, .full-start__buttons').eq(0);
        if (!container.length || render.find('.button--hide-movie').length) return;

        var btn = $('<div class="full-start__button selector button--hide-movie"><span></span></div>');
        function refresh() { btn.find('span').text(isHidden(movie) ? 'Показувати' : 'Сховати'); }

        btn.on('hover:enter', function () {
            if (isHidden(movie)) {
                unhide(movie);
                Lampa.Noty.show('Фільм знову буде показуватись');
            } else {
                hide(movie);
                Lampa.Noty.show('Фільм сховано');
                Lampa.Activity.backward();
            }
            refresh();
        });

        refresh();
        container.append(btn);
    });

    try {
        Lampa.SettingsApi.addParam({
            component: 'more',
            param: { name: 'hide_movie_clear', type: 'static' },
            field: { name: 'Сховані фільми: очистити', description: 'Показати знову всі сховані фільми' },
            onRender: function (item) {
                item.on('hover:enter', function () {
                    Lampa.Storage.set(KEY, []);
                    Lampa.Noty.show('Список схованих очищено');
                });
            }
        });
    } catch (err) {}

    function init() {
        patchSelect();
        startObserver();
        sweep();
    }

    if (window.appready) init();
    else Lampa.Listener.follow('app', function (e) { if (e.type === 'ready') init(); });
})();
