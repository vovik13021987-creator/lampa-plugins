(function () {
    'use strict';

    if (window.torbox_test_loaded) return;
    window.torbox_test_loaded = true;

    function init() {
        if (!window.Lampa || !Lampa.SettingsApi) return;

        try {
            Lampa.SettingsApi.addComponent({
                component: 'torbox_test',
                name: 'TorBox'
            });

            Lampa.SettingsApi.addParam({
                component: 'torbox_test',
                param: {
                    name: 'torbox_test_key',
                    type: 'input',
                    default: ''
                },
                field: {
                    name: 'API-ключ TorBox',
                    description: 'Введіть свій API-ключ TorBox'
                }
            });

            if (Lampa.Noty && Lampa.Noty.show) {
                Lampa.Noty.show('TorBox: плагін завантажено');
            }
        } catch (e) {
            console.log('TorBox error:', e);
        }
    }

    if (window.Lampa && window.appready) {
        init();
    } else if (window.Lampa && Lampa.Listener) {
        Lampa.Listener.follow('app', function (event) {
            if (event.type === 'ready') init();
        });
    } else {
        document.addEventListener('DOMContentLoaded', init);
    }
})();
