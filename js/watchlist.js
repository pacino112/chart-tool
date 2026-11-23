/* Watchlist rechts: Live-Kurs und 24h-Veränderung in % für beliebig viele Symbole.
   - Startwerte per REST (/api/v3/ticker/24hr), danach live über EINE WebSocket-Verbindung (miniTicker).
   - Hinzufügen über "+" (Symbolsuche) oder den Stern in der Suche, entfernen per ✕,
     Reihenfolge per Ziehen (Maus). Gespeichert unter "ct.watchlist" (Teil der JSON-Sicherung). */
window.CT = window.CT || {};

CT.watchlist = (function () {
  const DEFAULT = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT'];

  let list = sanitize(CT.store.get('watchlist', null));
  const data = {};      // Symbol → { price, change }
  let rowsEl, countEl;
  let stream = null;
  let active = null;
  let dragSym = null;
  let onOpen = null;

  function sanitize(arr) {
    if (!Array.isArray(arr)) return DEFAULT.slice();
    const out = [];
    arr.forEach(function (s) {
      const sym = CT.symbols.normalize(s);
      if (sym && out.indexOf(sym) === -1) out.push(sym);
    });
    return out;
  }

  function save() { CT.store.set('watchlist', list); }
  function has(sym) { return list.indexOf(sym) !== -1; }

  /* ---------- Formatierung ---------- */
  function decimals(sym, price) {
    const info = CT.symbols.get(sym);
    if (info && info.tickSize) {
      const s = String(info.tickSize).replace(/0+$/, '').split('.');
      return s[1] ? s[1].length : 0;
    }
    if (price >= 1000) return 2;
    if (price >= 10) return 3;
    if (price >= 1) return 4;
    if (price >= 0.01) return 6;
    return 8;
  }

  /** [Name, Zusatz]: Spot "BTC" + "/USDT", Aktien/Rohstoffe "NVDA" + "Aktie/ETF", Krypto-Perps "BTC" + "/USDT.P" */
  function splitSymbol(sym) {
    const info = CT.symbols.get(sym);
    if (info) {
      if (!info.futures) return [info.base, '/' + info.quote];
      if (info.kind === 'COIN' || info.kind === 'INDEX') return [info.base, '/' + info.quote + '.P'];
      return [info.base, info.label];
    }
    const raw = sym.replace(/\.P$/, '');
    const m = raw.match(/^(.+?)(USDT|USDC|FDUSD|BTC|ETH|EUR|TRY|BNB)$/);
    const fut = raw !== sym ? '.P' : '';
    return m ? [m[1], '/' + m[2] + fut] : [sym, ''];
  }

  /* ---------- Darstellung ---------- */
  function render() {
    rowsEl.innerHTML = '';
    countEl.textContent = list.length ? list.length : '';
    if (!list.length) {
      rowsEl.innerHTML = '<p class="wl-empty">Leer. Mit „+“ Symbole hinzufügen.</p>';
      return;
    }
    list.forEach(function (sym) {
      const row = document.createElement('div');
      row.className = 'wl-row' + (sym === active ? ' active' : '');
      row.dataset.sym = sym;
      row.draggable = true;
      row.setAttribute('role', 'button');
      row.tabIndex = 0;
      const parts = splitSymbol(sym);
      row.innerHTML =
        '<span class="wl-sym"><b></b><small></small></span>' +
        '<span class="wl-price">–</span>' +
        '<span class="wl-chg">–</span>' +
        '<button class="wl-del" title="Aus Watchlist entfernen" aria-label="Entfernen">' +
        '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button>';
      row.querySelector('b').textContent = parts[0];
      row.querySelector('small').textContent = parts[1];
      row.title = sym;
      rowsEl.appendChild(row);
      paint(sym, false);
    });
  }

  function rowOf(sym) { return rowsEl.querySelector('.wl-row[data-sym="' + sym + '"]'); }

  function paint(sym, flash) {
    const row = rowOf(sym);
    const d = data[sym];
    if (!row || !d) return;
    const priceEl = row.querySelector('.wl-price');
    const chgEl = row.querySelector('.wl-chg');
    const text = d.price.toFixed(decimals(sym, d.price));
    if (flash && priceEl.textContent !== '–' && priceEl.textContent !== text) {
      const up = d.price >= (d.prev || d.price);
      priceEl.classList.remove('flash-up', 'flash-down');
      void priceEl.offsetWidth; // Animation neu starten
      priceEl.classList.add(up ? 'flash-up' : 'flash-down');
    }
    priceEl.textContent = text;
    chgEl.textContent = (d.change >= 0 ? '+' : '') + d.change.toFixed(2) + '%';
    chgEl.className = 'wl-chg ' + (d.change >= 0 ? 'up' : 'down');
  }

  function onTick(t) {
    const prev = data[t.symbol] ? data[t.symbol].price : null;
    data[t.symbol] = { price: t.price, change: t.change, prev: prev };
    paint(t.symbol, true);
  }

  /** Startwerte per REST. Ein ungültiges Symbol lässt die Sammelabfrage scheitern → dann einzeln. */
  async function refresh(symbols) {
    const syms = (symbols || list).slice();
    if (!syms.length) return;
    try {
      (await CT.binance.ticker24h(syms)).forEach(onTick);
    } catch (e) {
      for (let i = 0; i < syms.length; i++) {
        try {
          (await CT.binance.ticker24h([syms[i]])).forEach(onTick);
        } catch (err) {
          const row = rowOf(syms[i]);
          if (row) { row.classList.add('invalid'); row.title = 'Symbol bei Binance nicht gefunden'; }
        }
      }
    }
  }

  /* ---------- Verwaltung ---------- */
  function add(sym) {
    if (!sym || has(sym)) return false;
    list.push(sym);
    save();
    render();
    refresh([sym]);
    stream.set(list);
    return true;
  }

  function remove(sym) {
    if (!has(sym)) return;
    list = list.filter(function (s) { return s !== sym; });
    save();
    render();
    stream.set(list);
  }

  function toggle(sym) {
    if (has(sym)) { remove(sym); return false; }
    add(sym);
    return true;
  }

  function setActive(sym) {
    active = sym;
    rowsEl.querySelectorAll('.wl-row').forEach(function (r) { r.classList.toggle('active', r.dataset.sym === sym); });
    const row = rowOf(sym);
    if (row) row.scrollIntoView({ block: 'nearest' });
  }

  /** Nächstes/vorheriges Symbol der Watchlist (für Pfeiltasten). */
  function step(dir) {
    if (!list.length) return null;
    const i = list.indexOf(active);
    const n = i === -1 ? 0 : (i + dir + list.length) % list.length;
    return list[n];
  }

  function move(sym, target, after) {
    if (sym === target) return;
    list = list.filter(function (s) { return s !== sym; });
    let idx = list.indexOf(target);
    if (after) idx++;
    list.splice(idx, 0, sym);
    save();
    render();
  }

  /* ---------- Start ---------- */
  function init(options) {
    onOpen = options.onOpen;
    rowsEl = document.getElementById('wlRows');
    countEl = document.getElementById('wlCount');

    rowsEl.addEventListener('click', function (e) {
      const row = e.target.closest('.wl-row');
      if (!row) return;
      if (e.target.closest('.wl-del')) { e.stopPropagation(); remove(row.dataset.sym); return; }
      onOpen(row.dataset.sym);
    });
    rowsEl.addEventListener('keydown', function (e) {
      const row = e.target.closest('.wl-row');
      if (!row) return;
      if (e.key === 'Enter') onOpen(row.dataset.sym);
      if (e.key === 'Delete') remove(row.dataset.sym);
    });

    // Reihenfolge per Ziehen
    rowsEl.addEventListener('dragstart', function (e) {
      const row = e.target.closest('.wl-row');
      if (!row) return;
      dragSym = row.dataset.sym;
      row.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', dragSym); } catch (err) { /* ignorieren */ }
    });
    rowsEl.addEventListener('dragover', function (e) {
      const row = e.target.closest('.wl-row');
      if (!row || !dragSym) return;
      e.preventDefault();
      const r = row.getBoundingClientRect();
      const after = e.clientY > r.top + r.height / 2;
      rowsEl.querySelectorAll('.drop-before, .drop-after').forEach(function (x) { x.classList.remove('drop-before', 'drop-after'); });
      row.classList.add(after ? 'drop-after' : 'drop-before');
    });
    rowsEl.addEventListener('drop', function (e) {
      const row = e.target.closest('.wl-row');
      if (!row || !dragSym) return;
      e.preventDefault();
      const r = row.getBoundingClientRect();
      move(dragSym, row.dataset.sym, e.clientY > r.top + r.height / 2);
    });
    rowsEl.addEventListener('dragend', function () {
      dragSym = null;
      rowsEl.querySelectorAll('.dragging, .drop-before, .drop-after').forEach(function (x) { x.classList.remove('dragging', 'drop-before', 'drop-after'); });
    });

    render();
    // Je Markt eine Live-Verbindung (Spot und Futures); die Futures-Verbindung öffnet erst, wenn sie gebraucht wird
    const spot = CT.binance.streamMiniTickers(onTick, null, 'spot');
    const fut = CT.binance.streamMiniTickers(onTick, null, 'futures');
    stream = {
      set: function (symbols) {
        spot.set(symbols.filter(function (s) { return !CT.binance.isFutures(s); }));
        fut.set(symbols.filter(CT.binance.isFutures));
      },
    };
    stream.set(list);
    refresh();
    // Sobald die Symbolliste da ist: Nachkommastellen und Basis/Quote genau darstellen
    CT.symbols.load().then(function () { render(); }).catch(function () { /* geht auch ohne */ });
  }

  return {
    init: init,
    add: add,
    remove: remove,
    toggle: toggle,
    has: has,
    setActive: setActive,
    step: step,
    get list() { return list.slice(); },
  };
})();
