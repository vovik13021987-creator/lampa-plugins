/* TorBox for Lampa — experimental. Enter your own API key in Lampa settings. */
(function () {
    'use strict';
    if (window.__torbox_lampa_fixed) return;
    window.__torbox_lampa_fixed = true;

    var COMPONENT = 'torbox_lampa';
    var KEY_NAME = 'torbox_lampa_api_key';
    var API = 'https://api.torbox.app/v1/api';

    function notice(message) {
        if (window.Lampa && Lampa.Noty && Lampa.Noty.show) Lampa.Noty.show(message);
        else if (window.console) console.log('[TorBox Lampa] ' + message);
    }
    function getKey() {
        try { return String(Lampa.Storage.get(KEY_NAME, '') || '').trim(); }
        catch (e) { return ''; }
    }
    function request(path, success, failure) {
        var token = getKey();
        if (!token) { failure('Введіть API key у Налаштування → TorBox.'); return; }
        try {
            var xhr = new XMLHttpRequest();
            xhr.open('GET', API + path, true);
            xhr.timeout = 20000;
            xhr.setRequestHeader('Authorization', 'Bearer ' + token);
            xhr.setRequestHeader('Accept', 'application/json');
            xhr.onreadystatechange = function () {
                if (xhr.readyState !== 4) return;
                if (xhr.status >= 200 && xhr.status < 300) {
                    try { success(JSON.parse(xhr.responseText)); }
                    catch (e) { failure('TorBox повернув некоректну відповідь.'); }
                } else {
                    var message = 'Помилка TorBox HTTP ' + xhr.status;
                    try { var data = JSON.parse(xhr.responseText); message = data.detail || data.error || message; } catch (e) {}
                    failure(message);
                }
            };
            xhr.onerror = function () { failure('Не вдалося з’єднатися з TorBox.'); };
            xhr.ontimeout = function () { failure('TorBox не відповів вчасно.'); };
            xhr.send();
        } catch (e) { failure('Не вдалося виконати запит у цій версії Lampa.'); }
    }
    function extractItems(response) {
        if (Array.isArray(response)) return response;
        if (response && Array.isArray(response.data)) return response.data;
        if (response && response.data && Array.isArray(response.data.torrents)) return response.data.torrents;
        return [];
    }
    function playItem(item) {
        var id = item.id || item.torrent_id;
        var title = item.name || item.filename || 'TorBox';
        if (!id) { notice('У цього запису немає ID торрента.'); return; }
        request('/torrents/requestdl?id=' + encodeURIComponent(id) + '&token=' + encodeURIComponent(getKey()), function (response) {
            var url = response && (response.data || response.url || response.download_url);
            if (url && typeof url === 'object') url = url.url || url.download_url;
            if (!url || typeof url !== 'string') { notice('TorBox не повернув посилання для відтворення.'); return; }
            try {
                if (Lampa.Player && typeof Lampa.Player.play === 'function') Lampa.Player.play({ title: title, url: url, source: 'TorBox', method: 'play' });
                else notice('У цій версії Lampa не знайдено сумісний метод запуску плеєра.');
            } catch (e) { notice('Не вдалося запустити відео в Lampa.'); }
        }, notice);
    }
    function makePage() {
        var html = $('<div style="padding:2em;color:#fff"><div style="font-size:2em;font-weight:bold">TorBox</div><div class="tb-status" style="margin:1em 0;opacity:.8"></div><div class="selector tb-refresh" style="padding:1em;background:rgba(255,255,255,.12);margin-bottom:1em">Оновити список</div><div class="tb-items"></div></div>');
        function load() {
            var status = html.find('.tb-status');
            var list = html.find('.tb-items').empty();
            if (!getKey()) { status.text('Спочатку введіть API key: Налаштування → TorBox.'); return; }
            status.text('Завантаження списку TorBox…');
            request('/torrents/mylist?bypass_cache=true', function (response) {
                var items = extractItems(response);
                if (!items.length) { status.text('Список порожній або формат відповіді TorBox змінився.'); return; }
                status.text('Знайдено: ' + items.length + '. Виберіть запис для запуску.');
                items.forEach(function (item) {
                    var name = item.name || item.filename || ('Торрент #' + (item.id || '?'));
                    var row = $('<div class="selector" style="padding:1em;margin:.5em 0;background:rgba(255,255,255,.08)"><div class="tb-name"></div><small class="tb-state" style="opacity:.65"></small></div>');
                    row.find('.tb-name').text(name);
                    row.find('.tb-state').text(item.download_state || item.status || '');
                    row.on('hover:enter hover:click click', function () { playItem(item); });
                    list.append(row);
                });
            }, function (message) { status.text(message); });
        }
        html.find('.tb-refresh').on('hover:enter hover:click click', load);
        load();
        return { html: html, create: function () {}, render: function () { return html; }, destroy: function () { html.remove(); } };
    }
    function registerSettings() {
        if (!Lampa.SettingsApi) { console.log('[TorBox Lampa] SettingsApi unavailable'); return; }
        // This is the documented Lampa pattern: register the section first, then its parameter.
        Lampa.SettingsApi.addComponent({ component: COMPONENT, name: 'TorBox' });
        Lampa.SettingsApi.addParam({
            component: COMPONENT,
            param: { name: KEY_NAME, type: 'input', default: '', placeholder: 'Вставте API key TorBox' },
            field: { name: 'API-ключ TorBox', description: 'Вставте ключ зі сторінки TorBox Account. Ключ зберігається в налаштуваннях Lampa на цьому пристрої.' },
            onChange: function (value) {
                try { Lampa.Storage.set(KEY_NAME, String(value || '').trim()); notice('API key TorBox збережено.'); }
                catch (e) { notice('Не вдалося зберегти API key.'); }
            }
        });
    }
    function init() {
        if (!window.Lampa) return;
        try { registerSettings(); } catch (e) { console.log('[TorBox Lampa] Settings error:', e); }
        try {
            if (Lampa.Component && Lampa.Component.add) {
                Lampa.Component.add(COMPONENT, function () { return makePage(); });
            }
        } catch (e) { console.log('[TorBox Lampa] Component error:', e); }
        function addMenu() {
            try {
                if (Lampa.Menu && Lampa.Menu.addButton) {
                    Lampa.Menu.addButton('', 'TorBox', function () {
                        Lampa.Activity.push({ title: 'TorBox', component: COMPONENT });
                    });
                } else if (Lampa.Menu && Lampa.Menu.add) {
                    Lampa.Menu.add({ title: 'TorBox', name: COMPONENT, onSelect: function () { Lampa.Activity.push({ title: 'TorBox', component: COMPONENT }); } });
                }
            } catch (e) { console.log('[TorBox Lampa] Menu error:', e); }
        }
        addMenu();
    }
    if (window.appready) init();
    else if (window.Lampa && Lampa.Listener && Lampa.Listener.follow) Lampa.Listener.follow('app', function (event) { if (event.type === 'ready') init(); });
    else document.addEventListener('DOMContentLoaded', init);
})();
