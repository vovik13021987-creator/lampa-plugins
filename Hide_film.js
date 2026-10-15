(function () {
    'use strict';

    // ===== НАЛАШТУВАННЯ =====
    // Заблоковані країни виробництва (коди ISO). Можна додавати й прибирати.
    var BLOCKED = ['RU', 'UZ', 'KZ', 'KG', 'PL', 'IN'];

    var KEY = 'hide_movie_list';
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
    }
    function unhide(d) {
        Lampa.Storage.set(KEY, getList().fil
