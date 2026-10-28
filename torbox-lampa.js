
(function () {
    'use strict';

    var ID = 'torbox_lampa';
    var KEY = 'torbox_lampa_api_key';
    var API = 'https://api.torbox.app/v1/api';
    var started = false;

    function notify(message) {
        if (window.Lampa && Lampa.Noty && Lampa.Noty.show) {
            Lampa.Noty.show(message);
        } else {
            console.log('[TorBox]', message);
        }
    }

    function getKey() {
        return Lampa.Storage.get(KEY, '') || '';
    }

    function request(url, callback, error) {
        var key = getKey();

        if (!key) {
            notify('TorBox: спочатку введіть API-ключ у налаштуваннях');
            if (error) error('Не введено API-ключ');
            return;
        }

        var xhr = new XMLHttpRequest();
        xhr.open('GET', url, true);
        xhr.setRequestHeader('Authorization', 'Bearer ' + key);
        xhr.setRequestHeader('Accept', 'application/json');
        xhr.timeout = 30000;

        xhr.onload = function () {
            var json;

            try {
                json = JSON.parse(xhr.responseText);
            } catch (e) {
                if (error) error('TorBox повернув неправильну відповідь');
                return;
            }

            if (xhr.status < 200 || xhr.status >= 300 ||
                json.success === false) {
                var message = json.detail || json.error ||
                    ('HTTP ' + xhr.status);
                if (error) error(message);
                return;
            }

            callback(json);
        };

        xhr.onerror = function () {
            if (error) error('Помилка мережі або доступу до TorBox API');
        };

        xhr.ontimeout = function () {
            if (error) error('Час очікування TorBox вичерпано');
        };

        xhr.send();
    }

    function getData(json) {
        if (json && Array.isArray(json.data)) return json.data;
        if (json && json.data && Array.isArray(json.data.torrents)) {
            return json.data.torrents;
        }
        if (Array.isArray(json)) return json;
        return [];
    }

    function torrentName(item) {
        return item.name || item.title || item.hash || 'Торент';
    }

    function openPanel() {
        if (!getKey()) {
            notify('Спочатку введіть API-ключ TorBox у налаштуваннях Lampa');
            return;
        }

        Lampa.Activity.push({
            url: '',
            title: 'TorBox',
            component: ID,
            page: 1
        });
    }

    function TorBoxComponent(object) {
        var self = this;
        var scroll;
        var root;
        var destroyed = false;

        function message(text) {
            if (root) {
                root.find('.torbox-message').text(text).show();
            }
        }

        function addRow(title, subtitle, callback) {
            var row = $(
                '<div class="selector" style="' +
                'padding:1em;margin:.5em 0;' +
                'border-radius:.4em;background:rgba(128,128,128,.12)">' +
                '<div style="font-size:1.1em;font-weight:bold"></div>' +
                '<div style="opacity:.7;font-size:.9em;margin-top:.3em"></div>' +
                '</div>'
            );

            row.find('div').eq(0).text(title);
            row.find('div').eq(1).text(subtitle || '');
            row.on('hover:enter', callback);
            row.on('click', callback);
            scroll.append(row);
        }

        function playTorrent(item) {
            var files = Array.isArray(item.files) ? item.files : [];
            var video = files.filter(function (file) {
                return /\.(mkv|mp4|avi|mov|m4v|webm|ts)$/i.test(
                    file.name || ''
                );
            });

            if (video.length) {
                chooseFile(item, video);
                return;
            }

            var id = item.id || item.torrent_id;

            if (!id) {
                notify('Не знайдено ID торента');
                return;
            }

            request(
                API + '/torrents/mylist?id=' +
                encodeURIComponent(id) + '&bypass_cache=true',
                function (json) {
                    var result = json.data;
                    if (Array.isArray(result)) result = result[0];

                    if (!result) {
                        notify('Не вдалося отримати дані торента');
                        return;
                    }

                    var found = Array.isArray(result.files) ?
                        result.files.filter(function (file) {
                            return /\.(mkv|mp4|avi|mov|m4v|webm|ts)$/i
                                .test(file.name || '');
                        }) : [];

                    if (found.length) chooseFile(result, found);
                    else notify('У відповіді TorBox не знайдено відеофайлів');
                },
                notify
            );
        }

        function chooseFile(item, files) {
            if (files.length === 1) {
                requestPlay(item, files[0]);
                return;
            }

            Lampa.Select.show({
                title: 'Вибери відеофайл',
                items: files.map(function (file) {
                    return {
                        title: file.name || ('Файл ' + file.id),
                        file: file
                    };
                }),
                onSelect: function (selected) {
                    if (selected && selected.file) {
                        requestPlay(item, selected.file);
                    }
                },
                onBack: function () {
                    Lampa.Controller.toggle('content');
                }
            });
        }

        function requestPlay(item, file) {
            var id = item.id || item.torrent_id;
            var fileId = file.id;

            if (!id || fileId === undefined || fileId === null) {
                notify('Не знайдено ID торента або файлу');
                return;
            }

            var url = API + '/torrents/requestdl?torrent_id=' +
                encodeURIComponent(id) + '&file_id=' +
                encodeURIComponent(fileId);

            request(url, function (json) {
                var link = json.data;

                if (typeof link === 'string') {
                    startPlayer(link, file.name);
                } else if (link && typeof link === 'object') {
                    startPlayer(
                        link.url || link.download_url || link.hls_url,
                        file.name
                    );
                } else {
                    notify('TorBox не повернув посилання на відео');
                }
            }, notify);
        }

        function startPlayer(url, title) {
            if (!url) {
                notify('Посилання на відео відсутнє');
                return;
            }

            if (Lampa.Player && Lampa.Player.play) {
                Lampa.Player.play({
                    url: url,
                    title: title || 'TorBox',
                    quality: 'auto'
                });
            } else {
                notify('Плеєр Lampa недоступний');
            }
        }

        function loadTorrents() {
            if (!getKey()) {
                message('Введіть API-ключ TorBox у налаштуваннях Lampa.');
                return;
            }

            message('Завантажую список торентів...');

            request(API + '/torrents/mylist?bypass_cache=true',
                function (json) {
                    if (destroyed) return;

                    var list = getData(json);
                    root.find('.torbox-message').hide();

                    if (!list.length) {
                        message('Список порожній або формат відповіді невідомий.');
                        return;
                    }

                    list.forEach(function (item) {
                        addRow(
                            torrentName(item),
                            item.download_state ||
                                item.status ||
                                'Відкрити торент',
                            function () {
                                playTorrent(item);
                            }
                        );
                    });
                },
                function (err) {
                    if (!destroyed) message('Помилка TorBox: ' + err);
                }
            );
        }

        this.create = function () {
            root = $('<div class="torbox-page"></div>');
            root.append(
                '<div class="torbox-message" ' +
                'style="padding:1em;opacity:.8"></div>'
            );

            scroll = new Lampa.Scroll({
                mask: true,
                over: true
            });

            scroll.append(root);
            loadTorrents();
        };

        this.render = function () {
            return scroll.render();
        };

        this.start = function () {
            Lampa.Controller.add('content', {
                toggle: function () {},
                up: function () {
                    if (scroll) scroll.up();
                },
                down: function () {
                    if (scroll) scroll.down();
                },
                back: function () {
                    Lampa.Activity.backward();
                }
            });

            Lampa.Controller.toggle('content');
        };

        this.pause = function () {};

        this.stop = function () {};

        this.back = function () {
            Lampa.Activity.backward();
        };

        this.destroy = function () {
            destroyed = true;
            if (scroll) scroll.destroy();
            if (root) root.remove();
        };
    }

    function init() {
        if (started || !window.Lampa) return;
        if (!Lampa.SettingsApi || !Lampa.Component) return;

        started = true;

        try {
            Lampa.SettingsApi.addComponent({
                component: ID,
                name: 'TorBox'
            });

            Lampa.SettingsApi.addParam({
                component: ID,
                param: {
                    name: KEY,
                    type: 'input',
                    values: '',
                    default: '',
                    placeholder: 'Введіть API-ключ TorBox'
                },
                field: {
                    name: 'API-ключ TorBox',
                    description: 'Ключ зі сторінки TorBox Account'
                }
            });

            Lampa.Component.add(ID, TorBoxComponent);

            if (Lampa.Menu && Lampa.Menu.addButton) {
                Lampa.Menu.addButton('', 'TorBox', openPanel);
            }

            console.log('[TorBox] Plugin initialized');
        } catch (e) {
            console.log('[TorBox] Initialization error:', e);
            notify('Помилка запуску TorBox: ' + e.message);
        }
    }

    function waitForLampa() {
        if (window.Lampa && window.appready) {
            init();
            return;
        }

        if (window.Lampa && Lampa.Listener) {
            Lampa.Listener.follow('app', function (event) {
                if (event.type === 'ready') init();
            });
        } else {
            setTimeout(waitForLampa, 500);
        }
    }

    waitForLampa();
})();
