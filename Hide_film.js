(function () {
    'use strict';

    var KEY = 'hide_movie_list';

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

    function cardData(el) {
        var $el = $(el);
        var d = el.card_data || $el.data('card') || $el.data('item') || $el.data('data') ||
                $el.data('card_data') || el.item || el.data || null;
        if (d && typeof d === 'object' && d.id) return d;
        return null;
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

    function patchSelect() {
        if (!Lampa.Select || Lampa.Select._hide_patched) return;
        var orig = Lampa.Select.show;
        Lampa.Select._hide_patched = true;

        Lampa.Select.show = function (params) {
            try {
                var el = $('.card.focus').last()[0];
                var d = el && cardData(el);
                var isContext = params && Array.isArray(params.items) && params.items.length &&
                                !params.items.some(function (i) { return i.hide_movie; });

                if (d && isContext) {
                    var $el = $(el);
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
