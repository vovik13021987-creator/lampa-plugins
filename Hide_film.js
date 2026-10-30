(function () {
    'use strict';

    // ===== НАЛАШТУВАННЯ =====
    // Заблоковані країни виробництва (коди ISO). Можна додавати й прибирати.
    var BLOCKED = ['RU', 'UZ', 'KZ', 'KG', 'PL', 'IN'];

    var KEY = 'hide_movie_list';
    var TITLES_KEY = 'hide_movie_titles';
    var lastCard = null, lastTime = 0;

    // ===== РУЧНЕ ХОВАННЯ =====
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
        mark(key(d), 1);
    }
    function unhide(d) {
        unhideKey(key(d));
    }
    function unhideKey(k) {
        Lampa.Storage.set(KEY, getList().filter(function (x) { return x !== k; }));
        mark(k, 0);
    }

    // ===== СИНХРОНІЗАЦІЯ МІЖ РІЗНИМИ LAMPA =====
    // Список зберігається в jsonblob.com за вашим кодом. Для кожного фільму
    // запам'ятовується час останньої зміни, тому "показувати знову" теж синхронізується.
    var TS_KEY = 'hide_movie_ts';
    var SYNC_ID_KEY = 'hide_sync_id';
    var syncTimer = null, syncBusy = false;

    function getTs() {
        var t = Lampa.Storage.get(TS_KEY, '{}');
        return (t && typeof t === 'object' && !Array.isArray(t)) ? t : {};
    }
    function mark(k, h) {
        var ts = getTs();
        ts[k] = { t: Date.now(), h: h ? 1 : 0 };
        Lampa.Storage.set(TS_KEY, ts);
        scheduleSync();
    }
    function syncId() {
        var v = String(Lampa.Storage.get(SYNC_ID_KEY, '') || '').trim();
        if (!v) return '';
        v = v.split('?')[0].replace(/\/+$/, '');
        var parts = v.split('/');
        return parts[parts.length - 1];
    }
    function scheduleSync() {
        if (!syncId()) return;
        clearTimeout(syncTimer);
        syncTimer = setTimeout(function () { syncNow(); }, 3000);
    }
    function blobRequest(method, body, ok, fail) {
        var x = new XMLHttpRequest();
        x.open(method, 'https://jsonblob.com/api/jsonBlob/' + encodeURIComponent(syncId()), true);
        x.setRequestHeader('Accept', 'application/json');
        if (body) x.setRequestHeader('Content-Type', 'application/json');
        x.timeout = 20000;
        x.onload = function () {
            if (x.status >= 200 && x.status < 300) ok(x.responseText);
            else fail('HTTP ' + x.status);
        };
        x.onerror = function () { fail('мережа'); };
        x.ontimeout = function () { fail('таймаут'); };
        x.send(body || null);
    }
    // Створює новий запис на jsonblob.com і зберігає його код у налаштуваннях
    function createBlob(cb) {
        var x = new XMLHttpRequest();
        x.open('POST', 'https://jsonblob.com/api/jsonBlob', true);
        x.setRequestHeader('Accept', 'application/json');
        x.setRequestHeader('Content-Type', 'application/json');
        x.timeout = 20000;
        x.onload = function () {
            if (x.status < 200 || x.status >= 300) return cb('HTTP ' + x.status);
            var loc = '';
            try { loc = x.getResponseHeader('Location') || x.getResponseHeader('X-jsonblob') || ''; } catch (e) {}
            var id = String(loc).split('?')[0].replace(/\/+$/, '').split('/').pop();
            if (!id) return cb('сервер не повернув код (заголовок недоступний)');
            Lampa.Storage.set(SYNC_ID_KEY, id);
            cb(null, id);
        };
        x.onerror = function () { cb('мережа'); };
        x.ontimeout = function () { cb('таймаут'); };
        x.send(JSON.stringify({ v: 2, items: {} }));
    }

    function syncNow(cb) {
        cb = cb || function () {};
        if (!syncId()) return cb('немає коду синхронізації');
        if (syncBusy) return cb('синхронізація вже йде');
        syncBusy = true;

        blobRequest('GET', null, function (txt) {
            var remote = {};
            try {
                var j = JSON.parse(txt);
                if (j && j.items && typeof j.items === 'object') remote = j.items;
            } catch (e) {}

            var local = getTs();
            var list = getList();
            var i, k;
            // старі записи без часу вважаємо давніми
            for (i = 0; i < list.length; i++) if (!local[list[i]]) local[list[i]] = { t: 1, h: 1 };

            var merged = {}, changedRemote = false;
            for (k in local) if (local.hasOwnProperty(k)) merged[k] = local[k];
            for (k in remote) {
                if (!remote.hasOwnProperty(k)) continue;
                var r = remote[k];
                if (!r || typeof r.t !== 'number') continue;
                if (!merged[k] || r.t > merged[k].t) merged[k] = { t: r.t, h: r.h ? 1 : 0 };
            }
            for (k in merged) {
                if (!merged.hasOwnProperty(k)) continue;
                if (!remote[k] || remote[k].t !== merged[k].t || (remote[k].h ? 1 : 0) !== (merged[k].h ? 1 : 0)) {
                    changedRemote = true;
                    break;
                }
            }

            var newList = [];
            for (k in merged) if (merged.hasOwnProperty(k) && merged[k].h) newList.push(k);
            var oldList = getList();
            var changedLocal = newList.length !== oldList.length ||
                newList.some(function (x) { return oldList.indexOf(x) === -1; });

            Lampa.Storage.set(TS_KEY, merged);
            if (changedLocal) {
                Lampa.Storage.set(KEY, newList);
                sweep();
            }

            var done = function () { syncBusy = false; cb(null, changedLocal, changedRemote); };
            if (changedRemote) {
                blobRequest('PUT', JSON.stringify({ v: 2, items: merged }), done, function (e) {
                    syncBusy = false;
                    cb('запис: ' + e);
                });
            } else done();
        }, function (e) {
            syncBusy = false;
            cb('читання: ' + e);
        });
    }

    // ===== ФІЛЬТР ПО КРАЇНІ =====
    function countryFilterOn() {
        var v = Lampa.Storage.get('hide_ru', 'true');
        return v === true || v === 'true';
    }

    var cache = Lampa.Storage.get('hide_cn_cache', '{}');
    if (!cache || typeof cache !== 'object' || Array.isArray(cache)) cache = {};
    var pending = {};

    function inBlocked(code) { return BLOCKED.indexOf(code) !== -1; }

    // true / false / null (країна невідома)
    function countryBlocked(d) {
        var oc = d.origin_country;
        if (Array.isArray(oc) && oc.length) return oc.some(inBlocked);
        var pc = d.production_countries;
        if (Array.isArray(pc) && pc.length) {
            return pc.some(function (c) { return inBlocked(c.iso_3166_1); });
        }
        return null;
    }

    function fetchCountry(d, k) {
        if (pending[k]) return;
        pending[k] = 1;
        try {
            var url = Lampa.TMDB.api((isTv(d) ? 'tv/' : 'movie/') + d.id +
                      '?api_key=' + Lampa.TMDB.key() + '&language=en');
            $.getJSON(url, function (r) {
                var bad = countryBlocked(r) === true;
                cache[k] = bad ? 1 : 0;
                Lampa.Storage.set('hide_cn_cache', cache);
                if (bad) sweep();
            });
        } catch (e) { console.log('[hide_movie] tmdb', e); }
    }

    function isBlockedCountry(d) {
        if (!countryFilterOn() || !d || !d.id) return false;
        var r = countryBlocked(d);
        if (r !== null) return r;
        var k = key(d);
        if (k in cache) return cache[k] === 1;
        fetchCountry(d, k);
        return false;
    }

    // ===== ПОШУК ДАНИХ КАРТКИ =====
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

    // ===== ПРИБИРАННЯ КАРТОК =====
    function sweep() {
        $('.card').each(function () {
            var d = cardData(this);
            if (d && (isHidden(d) || isBlockedCountry(d))) $(this).remove();
        });
    }

    var timer;
    function startObserver() {
        new MutationObserver(function () {
            clearTimeout(timer);
            timer = setTimeout(sweep, 100);
        }).observe(document.body, { childList: true, subtree: true });
    }

    // ===== ПУНКТ "СХОВАТИ" У МЕНЮ КАРТКИ =====
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

    // ===== КНОПКА НА СТОРІНЦІ ФІЛЬМУ =====
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

    // ===== СПИСОК СХОВАНИХ ФІЛЬМІВ =====
    // Назви зберігаються в кеші, щоб не питати TMDB щоразу.
    function getTitles() {
        var t = Lampa.Storage.get(TITLES_KEY, '{}');
        return (t && typeof t === 'object' && !Array.isArray(t)) ? t : {};
    }

    function parseKey(k) {
        var p = String(k).split(':');
        return { type: p[0] === 'tv' ? 'tv' : 'movie', id: p[1] };
    }

    function loading(on) {
        try {
            if (on) { if (Lampa.Loading && Lampa.Loading.start) Lampa.Loading.start(function () {}); }
            else if (Lampa.Loading && Lampa.Loading.stop) Lampa.Loading.stop();
        } catch (e) {}
    }

    function backToSettings() {
        try { Lampa.Controller.toggle('settings_component'); } catch (e) {}
    }

    // Підтягує назви тих фільмів, яких ще немає в кеші (по 5 запитів одночасно)
    function loadTitles(keys, done) {
        var titles = getTitles();
        var queue = keys.filter(function (k) { return !titles[k]; });
        if (!queue.length) return done(titles);

        var active = 0, finished = 0, total = queue.length, idx = 0;
        var lang = Lampa.Storage.get('language', 'uk');

        function finishOne() {
            finished++;
            active--;
            if (finished >= total) {
                Lampa.Storage.set(TITLES_KEY, titles);
                done(titles);
            } else {
                next();
            }
        }

        function next() {
            while (active < 5 && idx < queue.length) {
                (function (k) {
                    active++;
                    idx++;
                    var p = parseKey(k);
                    try {
                        var url = Lampa.TMDB.api(p.type + '/' + p.id +
                            '?api_key=' + Lampa.TMDB.key() + '&language=' + lang);
                        $.getJSON(url, function (r) {
                            var name = r.title || r.name || r.original_title || r.original_name;
                            var date = r.release_date || r.first_air_date || '';
                            var year = date ? ' (' + date.slice(0, 4) + ')' : '';
                            if (name) titles[k] = name + year + (p.type === 'tv' ? ' · серіал' : '');
                            finishOne();
                        }).fail(function () { finishOne(); });
                    } catch (e) { finishOne(); }
                })(queue[idx]);
            }
        }

        next();
    }

    function labelOf(titles, k) {
        return titles[k] || ((parseKey(k).type === 'tv' ? 'Серіал' : 'Фільм') + ' #' + parseKey(k).id);
    }

    function openHiddenList() {
        var list = getList();
        if (!list.length) {
            Lampa.Noty.show('Схованих фільмів немає');
            return;
        }
        loading(true);
        loadTitles(list, function (titles) {
            loading(false);
            showHiddenList(titles);
        });
    }

    function showHiddenList(titles) {
        var list = getList();
        if (!list.length) {
            Lampa.Noty.show('Схованих фільмів більше немає');
            return backToSettings();
        }
        var items = list.map(function (k) {
            return { title: labelOf(titles, k), hkey: k };
        });
        items.sort(function (a, b) {
            var x = a.title.toLowerCase(), y = b.title.toLowerCase();
            return x < y ? -1 : (x > y ? 1 : 0);
        });

        Lampa.Select.show({
            title: 'Сховані (' + items.length + ')',
            items: items,
            onSelect: function (a) { showHiddenActions(a.hkey, titles); },
            onBack: backToSettings
        });
    }

    function showHiddenActions(k, titles) {
        var p = parseKey(k);
        Lampa.Select.show({
            title: labelOf(titles, k),
            items: [
                { title: 'Відкрити картку', act: 'open' },
                { title: 'Показувати знову', act: 'unhide' },
                { title: 'Назад до списку', act: 'back' }
            ],
            onSelect: function (a) {
                if (a.act === 'open') {
                    Lampa.Activity.push({
                        url: '',
                        component: 'full',
                        id: p.id,
                        method: p.type,
                        card: { id: p.id },
                        source: 'tmdb'
                    });
                } else if (a.act === 'unhide') {
                    unhideKey(k);
                    Lampa.Noty.show('Фільм знову буде показуватись');
                    showHiddenList(titles);
                } else {
                    showHiddenList(titles);
                }
            },
            onBack: function () { showHiddenList(titles); }
        });
    }

    // ===== НАЛАШТУВАННЯ В LAMPA =====
    try {
        Lampa.SettingsApi.addParam({
            component: 'more',
            param: { name: 'hide_ru', type: 'trigger', default: true },
            field: {
                name: 'Ховати контент за країнами',
                description: 'Країни виробництва: ' + BLOCKED.join(', ')
            },
            onChange: function () { sweep(); }
        });
    } catch (e) {}

    try {
        Lampa.SettingsApi.addParam({
            component: 'more',
            param: { name: 'hide_movie_open', type: 'static' },
            field: {
                name: 'Сховані фільми',
                description: 'Відкрити список схованих. Повернути можна кожен окремо'
            },
            onRender: function (item) {
                item.on('hover:enter', function () {
                    openHiddenList();
                });
            }
        });
    } catch (e) {}

    try {
        Lampa.SettingsApi.addParam({
            component: 'more',
            param: { name: 'hide_sync_id', type: 'input', values: '', default: '' },
            field: {
                name: 'Код синхронізації схованих',
                description: 'jsonblob.com: створіть запис з текстом [] і вставте сюди адресу чи ID. Той самий код вводьте в усіх Lampa'
            },
            onChange: function () { scheduleSync(); }
        });
    } catch (e) {}

    try {
        Lampa.SettingsApi.addParam({
            component: 'more',
            param: { name: 'hide_sync_create', type: 'static' },
            field: {
                name: 'Створити код синхронізації',
                description: 'Автоматично створює запис на jsonblob.com і показує код. Потім введіть той самий код в інших Lampa'
            },
            onRender: function (item) {
                item.on('hover:enter', function () {
                    Lampa.Noty.show('Створюю код…');
                    createBlob(function (err, id) {
                        if (err) return Lampa.Noty.show('Не вдалося створити код: ' + err);
                        Lampa.Select.show({
                            title: 'Ваш код синхронізації',
                            items: [{ title: id }, { title: 'Запишіть його й введіть в інших Lampa' }],
                            onSelect: function () { backToSettings(); },
                            onBack: backToSettings
                        });
                        syncNow();
                    });
                });
            }
        });
    } catch (e) {}

    try {
        Lampa.SettingsApi.addParam({
            component: 'more',
            param: { name: 'hide_sync_now', type: 'static' },
            field: { name: 'Синхронізувати сховані зараз', description: 'Звіряє список з іншими Lampa' },
            onRender: function (item) {
                item.on('hover:enter', function () {
                    Lampa.Noty.show('Синхронізація…');
                    syncNow(function (err, changedLocal) {
                        if (err) Lampa.Noty.show('Синхронізація: ' + err);
                        else Lampa.Noty.show(changedLocal ? 'Список оновлено з інших Lampa' : 'Усе актуально');
                    });
                });
            }
        });
    } catch (e) {}

    // ===== ЗАПУСК =====
    function init() {
        patchSelect();
        startObserver();
        sweep();
        setInterval(sweep, 1500);
        setTimeout(function () { syncNow(); }, 4000);
        setInterval(function () { syncNow(); }, 120000);
    }

    if (window.appready) init();
    else Lampa.Listener.follow('app', function (e) { if (e.type === 'ready') init(); });
})();
