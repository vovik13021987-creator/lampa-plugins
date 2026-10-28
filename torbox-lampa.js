(function () {
    'use strict';

    if (window.torbox_lampa_plugin_started) return;
    window.torbox_lampa_plugin_started = true;

    var PLUGIN_ID = 'torbox_lampa';
    var API = 'https://api.torbox.app/v1/api';
    var settings = {
        api_key: 'torbox_lampa_api_key'
    };

    function notify(message) {
        if (window.Lampa && Lampa.Noty) Lampa.Noty.show(message);
        else window.alert(message);
    }

    function key() {
        return (Lampa.Storage.get(settings.api_key, '') || '').trim();
    }

    function request(url, method, data, done, fail) {
        var headers = { 'Authorization': 'Bearer ' + key() };
        var options = {
            url: url,
            method: method || 'GET',
            data: data || {},
            headers: headers,
            dataType: 'json',
            timeout: 20000,
            success: function (response) { done(response); },
            error: function (error) {
                var msg = 'Помилка запиту TorBox';
                if (error && error.responseText) {
                    try {
                        var parsed = JSON.parse(error.responseText);
                        msg = parsed.detail || parsed.error || msg;
                    } catch (e) {}
                }
                if (fail) fail(msg);
                else notify(msg);
            }
        };

        try {
            new Lampa.Reguest().native(options);
        } catch (e) {
            // Compatibility fallback for Lampa builds with the older request API.
            try {
                new Lampa.Reguest().get(url, function (response) {
                    done(response);
                }, function () {
                    if (fail) fail('Не вдалося з’єднатися з TorBox');
                    else notify('Не вдалося з’єднатися з TorBox');
                }, options);
            } catch (e2) {
                if (fail) fail('Ця версія Lampa не підтримує потрібний HTTP-запит');
                else notify('Ця версія Lampa не підтримує потрібний HTTP-запит');
            }
        }
    }

    function normalizeList(response) {
        if (Array.isArray(response)) return response;
        if (response && Array.isArray(response.data)) return response.data;
        if (response && response.data && Array.isArray(response.data.torrents)) return response.data.torrents;
        return [];
    }

    function openPlayer(url, title) {
        if (!url || typeof url !== 'string') {
            notify('TorBox не повернув посилання для відтворення.');
            return;
        }
        // Use Lampa's normal player route so Tizen playback is handled by Lampa.
        try {
            var card = {
                title: title || 'TorBox',
                url: url,
                method: 'play',
                source: 'TorBox',
                quality: '未知'
            };
            if (Lampa.Player && Lampa.Player.play) Lampa.Player.play(card);
            else if (Lampa.Player && Lampa.Player.open) Lampa.Player.open(card);
            else notify('Посилання отримано, але ця версія Lampa не має сумісного методу запуску.');
        } catch (e) {
            notify('Не вдалося запустити відео в плеєрі Lampa.');
        }
    }

    function launchTorrent(torrent, title) {
        var id = torrent.id || torrent.torrent_id;
        if (!id) {
            notify('У записі TorBox немає ID торрента.');
            return;
        }
        // TorBox requestdl returns a temporary, account-authorized download/play URL.
        request(API + '/torrents/requestdl?id=' + encodeURIComponent(id) + '&token=' + encodeURIComponent(key()), 'GET', {}, function (response) {
            var url = response && (response.data || response.url || response.download_url);
            if (typeof url === 'object' && url) url = url.url || url.download_url;
            if (url) openPlayer(url, title || torrent.name || torrent.filename);
            else notify((response && response.detail) || 'TorBox не повернув посилання. Перевір статус торрента у своєму акаунті.');
        });
    }

    function addSettings() {
        if (!Lampa.SettingsApi || !Lampa.SettingsApi.addParam) return;
        Lampa.SettingsApi.addParam({
            component: 'torbox_lampa',
            param: {
                name: 'torbox_lampa_api_key',
                type: 'input',
                placeholder: 'Вставте API key TorBox',
                values: ''
            },
            field: {
                name: 'TorBox API key',
                description: 'Ключ з torbox.app/settings → Account. Зберігається локально в налаштуваннях Lampa на цьому пристрої.'
            },
            onChange: function (value) {
                Lampa.Storage.set(settings.api_key, (value || '').trim());
                notify('Ключ TorBox збережено на цьому пристрої.');
            }
        });
    }

    function buildPage() {
        var page = {
            component: 'torbox_lampa',
            name: 'TorBox',
            html: $('<div class="torbox-lampa-page"><div class="torbox-lampa-head"><div class="torbox-lampa-title">TorBox</div><div class="torbox-lampa-sub">Ваші торренти з акаунта TorBox</div></div><div class="torbox-lampa-actions"><div class="selector torbox-lampa-refresh">Оновити список</div><div class="selector torbox-lampa-settings">Налаштування API key</div></div><div class="torbox-lampa-status">Завантаження…</div><div class="torbox-lampa-list"></div></div>'),
            create: function () {
                var self = this;
                this.activity.loader(true);
                this.render = function () {
                    var list = self.html.find('.torbox-lampa-list').empty();
                    var status = self.html.find('.torbox-lampa-status');
                    if (!key()) {
                        status.text('Спочатку додайте API key у Налаштування → TorBox.');
                        self.activity.loader(false);
                        return;
                    }
                    status.text('Завантаження списку TorBox…');
                    request(API + '/torrents/mylist?bypass_cache=true', 'GET', {}, function (response) {
                        var items = normalizeList(response);
                        self.activity.loader(false);
                        list.empty();
                        if (!items.length) {
                            status.text((response && response.detail) || 'Список порожній або TorBox не повернув торренти.');
                            return;
                        }
                        status.text('Знайдено: ' + items.length);
                        items.forEach(function (item) {
                            var name = item.name || item.filename || ('Торрент #' + item.id);
                            var state = item.download_state || item.status || '';
                            var row = $('<div class="selector torbox-lampa-item"><div class="torbox-lampa-item-title"></div><div class="torbox-lampa-item-state"></div></div>');
                            row.find('.torbox-lampa-item-title').text(name);
                            row.find('.torbox-lampa-item-state').text(state);
                            row.on('hover:enter', function () { launchTorrent(item, name); });
                            row.on('hover:click', function () { launchTorrent(item, name); });
                            list.append(row);
                        });
                    }, function (message) {
                        self.activity.loader(false);
                        status.text(message + ' — перевірте API key і доступ до TorBox.');
                    });
                };
                self.html.find('.torbox-lampa-refresh').on('hover:enter', function () { self.render(); });
                self.html.find('.torbox-lampa-settings').on('hover:enter', function () {
                    notify('Відкрийте Налаштування Lampa → TorBox та вставте API key.');
                });
                this.render();
            },
            destroy: function () {
                this.html.remove();
            }
        };
        return page;
    }

    function init() {
        if (!window.Lampa || !Lampa.Component || !Lampa.Activity) return;
        addSettings();

        if (Lampa.Template && Lampa.Template.add) {
            Lampa.Template.add('torbox_lampa_style', '<style>' +
                '.torbox-lampa-page{padding:2em;color:#fff}.torbox-lampa-head{margin-bottom:1.4em}.torbox-lampa-title{font-size:2.2em;font-weight:700}.torbox-lampa-sub{opacity:.7;margin-top:.4em}.torbox-lampa-actions{display:flex;gap:1em;margin-bottom:1em}.torbox-lampa-actions .selector{padding:.8em 1.2em;background:rgba(255,255,255,.09);border-radius:.4em}.torbox-lampa-status{opacity:.8;margin:1em 0}.torbox-lampa-item{padding:1em;margin:.45em 0;background:rgba(255,255,255,.07);border-radius:.35em}.torbox-lampa-item-title{font-size:1.15em}.torbox-lampa-item-state{font-size:.85em;opacity:.65;margin-top:.35em}' +
                '</style>');
        }
        Lampa.Component.add('torbox_lampa', buildPage);

        // Add a sidebar/menu item where supported by the current Lampa build.
        if (Lampa.Manifest && Lampa.Manifest.plugins) {
            Lampa.Manifest.plugins(PLUGIN_ID, 'TorBox');
        }
        Lampa.Listener.follow('app', function (event) {
            if (event.type === 'ready') {
                try {
                    Lampa.Menu.add({
                        title: 'TorBox',
                        name: 'torbox_lampa',
                        icon: 'https://www.torbox.app/favicon.ico',
                        url: '',
                        onSelect: function () {
                            Lampa.Activity.push({
                                url: '',
                                title: 'TorBox',
                                component: 'torbox_lampa'
                            });
                        }
                    });
                } catch (e) {}
            }
        });
    }

    if (window.appready) init();
    else if (window.Lampa && Lampa.Listener) {
        Lampa.Listener.follow('app', function (event) {
            if (event.type === 'ready') init();
        });
    }
})();
