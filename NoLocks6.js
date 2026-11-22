/*
 * NoLocks: ховає в меню "Дія" заблоковані (із замком) статуси CUB Premium:
 * Дивлюся, Переглянуто, Заплановано, Далі буде, Відкинуто.
 * Якщо у вас є Premium, плагін нічого не прибирає.
 */
(function () {
    'use strict';

    if (window.nolocks_ready) return;
    window.nolocks_ready = true;

    var TITLES = ['дивлюся', 'переглянуто', 'заплановано', 'далі буде', 'відкинуто'];

    function norm(t) {
        return String(t || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
    }

    function premium() {
        try {
            return !!(Lampa.Account && Lampa.Account.hasPremium && Lampa.Account.hasPremium());
        } catch (e) {
            return false;
        }
    }

    function isLockedStatus(i) {
        if (!i) return false;
        if (i.lock) return true;
        var t = norm(i.title);
        for (var k = 0; k < TITLES.length; k++) {
            if (t === TITLES[k] || t.indexOf(TITLES[k]) === 0) return true;
        }
        return false;
    }

    // Показує, з чого складається меню, якщо нічого не вдалося прибрати
    function debugMenu(params) {
        try {
            var names = [];
            for (var n = 0; n < params.items.length; n++) {
                var it = params.items[n] || {};
                names.push(norm(it.title) + (it.lock ? ' [lock]' : '') + (it.items ? ' [items]' : ''));
            }
            Lampa.Noty.show('NoLocks меню "' + norm(params.title) + '": ' + names.join(' | '));
        } catch (e) {}
    }


    // ---- Запасний спосіб: ховаємо рядки з замком прямо в готовому меню (DOM) ----
    function lockedRowFor(textNode) {
        var row = textNode.parentNode;
        // піднімаємось до найбільшого предка, текст якого дорівнює назві (це весь рядок меню)
        while (row && row.parentNode && row.parentNode !== document.body &&
               norm(row.parentNode.textContent) === norm(textNode.nodeValue)) {
            row = row.parentNode;
        }
        if (!row || row === document.body) return null;
        return row;
    }

    var overlay = null;
    function showOverlay(text) {
        try {
            if (!overlay) {
                overlay = document.createElement('div');
                overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#7a0000;color:#fff;font:14px/1.4 monospace;padding:8px 10px;white-space:pre-wrap';
                overlay.onclick = function () { overlay.style.display = 'none'; };
                document.body.appendChild(overlay);
            }
            overlay.style.display = 'block';
            overlay.textContent = text;
        } catch (e) {}
    }

    function domSweep() {
        if (!document.body || !document.createTreeWalker) return;
        var prem = premium();
        var walker = document.createTreeWalker(document.body, 4, null, false);
        var rows = [], headers = [], n, found = 0, sample = '', already = 0;
        while ((n = walker.nextNode())) {
            var t = norm(n.nodeValue);
            if (!t) continue;
            if (TITLES.indexOf(t) !== -1) {
                found++;
                var row = lockedRowFor(n);
                if (row) {
                    if (!sample) {
                        var par = row.parentNode;
                        sample = (row.tagName || '?') + '.' + String(row.className || '') +
                            ' > ' + (par ? (par.tagName || '?') + '.' + String(par.className || '') : '-') +
                            ' icon=' + !!(row.querySelector && row.querySelector('svg, img, [class*="lock"]'));
                    }
                    if (row.style.display !== 'none') rows.push(row); else already++;
                }
            } else if (t === 'статус') {
                headers.push(n.parentNode);
            }
        }
        if (!found) return;
        if (!rows.length && already) return;

        // діагностика: показуємо один раз на кожне відкриття меню
        showOverlay('NoLocks v6 | premium=' + prem + ' | знайдено статусів: ' + found +
            ' | рядків до ховання: ' + rows.length + '\nрядок: ' + sample + '\n(торкніться, щоб закрити)');

        if (found < 3 || !rows.length) return;
        // не чіпаємо меню лише коли Premium справжній, тобто немає ознак замка
        if (prem) {
            var anyIcon = false;
            for (var k = 0; k < rows.length; k++) {
                if (rows[k].querySelector && rows[k].querySelector('svg, img, [class*="lock"]')) anyIcon = true;
            }
            if (!anyIcon) return;
        }
        for (var i = 0; i < rows.length; i++) rows[i].style.display = 'none';
        for (var j = 0; j < headers.length; j++) headers[j].style.display = 'none';
    }

    var domTimer = null;
    function startDomWatch() {
        if (!window.MutationObserver) return;
        new MutationObserver(function () {
            clearTimeout(domTimer);
            domTimer = setTimeout(function () {
                domSweep();
                setTimeout(domSweep, 500);
            }, 200);
        }).observe(document.body, { childList: true, subtree: true });
    }

    function patch() {
        if (!Lampa.Select || Lampa.Select._nolocks_patched) return;
        var orig = Lampa.Select.show;
        Lampa.Select._nolocks_patched = true;

        Lampa.Select.show = function (params) {
            try {
                if (params && Array.isArray(params.items) && !premium()) {
                    var kept = params.items.filter(function (i) { return !isLockedStatus(i); });
                    if (kept.length !== params.items.length) {
                        var removed = params.items.length - kept.length;
                        // якщо статусів не лишилось, прибираємо й заголовок "Статус"
                        kept = kept.filter(function (i) { return norm(i && i.title) !== 'статус'; });
                        params.items = kept;
                        try { Lampa.Noty.show('NoLocks: прибрано пунктів ' + removed); } catch (e2) {}
                    } else if (params.title && norm(params.title) === 'дія') {
                        debugMenu(params);
                    }
                }
            } catch (e) {}
            return orig.apply(this, arguments);
        };
    }

    function start() {
        patch();
        startDomWatch();
        try { Lampa.Noty.show('NoLocks v6 запущено'); } catch (e) {}
    }

    if (window.appready) start();
    else Lampa.Listener.follow('app', function (e) { if (e.type === 'ready') start(); });
})();
