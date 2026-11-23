/* Verdrahtung der Oberfläche: Zeitrahmen, Symbolsuche, Log-Skala, Status, Tastenkürzel.
   Zustand (Symbol, Zeitrahmen, Log) wird gespeichert und steht zusätzlich in der URL (#BTCUSDT/1h). */
window.CT = window.CT || {};

(function () {
  const INTERVALS = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '3d', '1w', '1M'];
  const RECENT_MAX = 8;
  const $ = function (id) { return document.getElementById(id); };

  const state = {
    symbol: CT.store.get('symbol', 'BTCUSDT'),
    interval: CT.store.get('interval', '1h'),
    log: CT.store.get('log', false),
    recent: CT.store.get('recent', []),
  };

  /* ---------- Hilfen ---------- */
  let toastTimer;
  function toast(msg, isError) {
    const el = $('toast');
    el.textContent = msg;
    el.className = 'toast' + (isError ? ' error' : '');
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, isError ? 6000 : 2500);
  }
  CT.toast = toast;

  function readHash() {
    const m = location.hash.replace(/^#/, '').split('/');
    const sym = (m[0] || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (sym) state.symbol = sym;
    if (m[1] && INTERVALS.indexOf(m[1]) !== -1) state.interval = m[1];
  }

  function writeHash() {
    const h = '#' + state.symbol + '/' + state.interval;
    if (location.hash !== h) history.replaceState(null, '', h);
  }

  function save() {
    CT.store.set('symbol', state.symbol);
    CT.store.set('interval', state.interval);
    CT.store.set('log', state.log);
    CT.store.set('recent', state.recent);
    writeHash();
  }

  /* ---------- Laden ---------- */
  let lastGood = null; // zuletzt erfolgreich geladenes Symbol

  async function open(symbol, interval) {
    state.symbol = symbol;
    state.interval = interval;
    $('symbolLabel').textContent = symbol;
    renderTfBar();
    CT.drawings.setSymbol(symbol);
    const ok = await CT.chart.load(symbol, interval, CT.symbols.get(symbol));
    if (ok) {
      lastGood = symbol;
      state.recent = [symbol].concat(state.recent.filter(function (s) { return s !== symbol; })).slice(0, RECENT_MAX);
      save();
    } else if (state.symbol === symbol && state.interval === interval) {
      // Symbol nicht ladbar: zurück zum letzten funktionierenden (oder BTCUSDT beim Start)
      const fallback = lastGood || 'BTCUSDT';
      if (fallback !== symbol) open(fallback, interval);
    }
  }

  /* ---------- Zeitrahmen ---------- */
  function renderTfBar() {
    const bar = $('tfBar');
    if (!bar.childElementCount) {
      INTERVALS.forEach(function (iv) {
        const b = document.createElement('button');
        b.className = 'tf-btn';
        b.dataset.iv = iv;
        b.textContent = CT.chart.labelFor(iv);
        b.title = 'Zeitrahmen ' + CT.chart.labelFor(iv);
        b.addEventListener('click', function () {
          if (iv !== state.interval) open(state.symbol, iv);
        });
        bar.appendChild(b);
      });
    }
    Array.prototype.forEach.call(bar.children, function (b) {
      const active = b.dataset.iv === state.interval;
      b.classList.toggle('active', active);
      b.setAttribute('aria-pressed', active);
      if (active) b.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
  }

  /* ---------- Log-Skala ---------- */
  function applyLog() {
    CT.chart.setLog(state.log);
    $('logBtn').classList.toggle('active', state.log);
    $('logBtn').setAttribute('aria-pressed', state.log);
  }

  function toggleLog() {
    state.log = !state.log;
    applyLog();
    save();
  }

  /* ---------- Symbolsuche ---------- */
  const search = { quote: CT.store.get('searchQuote', 'ALL'), items: [], active: 0 };

  function openSearch(initial) {
    $('searchModal').hidden = false;
    const input = $('searchInput');
    input.value = initial || '';
    renderQuoteFilter();
    input.focus();
    renderResults();
    CT.symbols.load().then(renderResults).catch(function () {
      renderResults('Symbolliste nicht erreichbar – Symbol eintippen und Enter drücken.');
    });
  }

  function closeSearch() {
    $('searchModal').hidden = true;
  }

  function renderQuoteFilter() {
    const box = $('quoteFilter');
    box.innerHTML = '';
    CT.symbols.QUOTES.forEach(function (q) {
      const b = document.createElement('button');
      b.textContent = q === 'ALL' ? 'Alle' : q;
      b.className = q === search.quote ? 'active' : '';
      b.addEventListener('click', function () {
        search.quote = q;
        CT.store.set('searchQuote', q);
        renderQuoteFilter();
        renderResults();
        $('searchInput').focus();
      });
      box.appendChild(b);
    });
  }

  function renderResults(note) {
    const ul = $('searchResults');
    const q = $('searchInput').value.trim();
    ul.innerHTML = '';
    search.items = [];
    search.active = 0;

    function section(title) {
      const li = document.createElement('li');
      li.className = 'sr-section';
      li.textContent = title;
      ul.appendChild(li);
    }

    function row(info, tag) {
      const li = document.createElement('li');
      li.setAttribute('role', 'option');
      const base = info.base || info.symbol;
      const quote = info.quote ? '/' + info.quote : '';
      li.innerHTML = '<span class="sr-base"></span><span class="sr-quote"></span><span class="sr-tag"></span>';
      li.children[0].textContent = base;
      li.children[1].textContent = quote;
      li.children[2].textContent = tag || 'Spot';
      const idx = search.items.length;
      li.addEventListener('mousemove', function () { setActive(idx); });
      li.addEventListener('click', function () { choose(idx); });
      ul.appendChild(li);
      search.items.push({ info: info, el: li });
    }

    if (!q) {
      const recent = state.recent
        .map(function (s) { return CT.symbols.get(s) || { symbol: s }; })
        .filter(function (i) { return search.quote === 'ALL' || i.quote === search.quote; });
      if (recent.length) {
        section('Zuletzt geöffnet');
        recent.forEach(function (i) { row(i, 'Zuletzt'); });
      }
      const popular = CT.symbols.search('', search.quote, 20)
        .filter(function (i) { return state.recent.indexOf(i.symbol) === -1; });
      if (popular.length) {
        section('Beliebt');
        popular.forEach(function (i) { row(i); });
      }
    } else {
      CT.symbols.search(q, search.quote).forEach(function (i) { row(i); });
    }

    if (!search.items.length) {
      const li = document.createElement('li');
      li.className = 'sr-empty';
      li.textContent = note || (q ? 'Kein Treffer. Enter öffnet „' + q.toUpperCase() + '“ direkt.' : 'Lade Symbolliste …');
      ul.appendChild(li);
    }
    setActive(0);
  }

  function setActive(i) {
    if (!search.items.length) return;
    search.active = Math.max(0, Math.min(i, search.items.length - 1));
    search.items.forEach(function (it, k) { it.el.classList.toggle('active', k === search.active); });
    search.items[search.active].el.scrollIntoView({ block: 'nearest' });
  }

  function choose(i) {
    const it = search.items[i];
    let symbol;
    if (it) symbol = it.info.symbol;
    else symbol = $('searchInput').value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!symbol) return;
    closeSearch();
    open(symbol, state.interval);
  }

  /* ---------- Ereignisse ---------- */
  function bind() {
    $('symbolBtn').addEventListener('click', function () { openSearch(''); });
    $('searchClose').addEventListener('click', closeSearch);
    $('searchModal').addEventListener('mousedown', function (e) { if (e.target === e.currentTarget) closeSearch(); });
    $('searchInput').addEventListener('input', function () { renderResults(); });
    $('searchInput').addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive(search.active + 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(search.active - 1); }
      else if (e.key === 'Enter') { e.preventDefault(); choose(search.items.length ? search.active : -1); }
      else if (e.key === 'Escape') { e.preventDefault(); closeSearch(); }
    });

    $('logBtn').addEventListener('click', toggleLog);
    $('resetBtn').addEventListener('click', function () { CT.chart.resetView(); });

    document.addEventListener('keydown', function (e) {
      const inField = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;
      if (inField || !$('searchModal').hidden) return;
      if (e.altKey && (e.key === 'l' || e.key === 'L')) { e.preventDefault(); toggleLog(); return; }
      if (e.altKey && (e.key === 'r' || e.key === 'R')) { e.preventDefault(); CT.chart.resetView(); return; }
      // Wie bei TradingView: einfach lostippen öffnet die Symbolsuche
      if (!e.ctrlKey && !e.metaKey && !e.altKey && /^[a-zA-Z0-9]$/.test(e.key)) {
        e.preventDefault();
        openSearch(e.key);
      }
    });

    window.addEventListener('hashchange', function () {
      const before = state.symbol + '/' + state.interval;
      readHash();
      if (state.symbol + '/' + state.interval !== before) open(state.symbol, state.interval);
    });

    CT.chart.on('status', function (s) {
      const el = $('status');
      el.dataset.state = s;
      el.title = { live: 'Live verbunden', connecting: 'Verbindung wird aufgebaut', offline: 'Keine Verbindung' }[s] || s;
    });
    CT.chart.on('loading', function (v) { $('loading').hidden = !v; });
    CT.chart.on('error', function (msg) { toast(msg, true); });
    CT.chart.on('price', function (p) { document.title = p.symbol + ' ' + p.text + ' · Chart-Tool'; });
  }

  /* ---------- Start ---------- */
  function start() {
    if (!window.LightweightCharts) {
      document.body.innerHTML = '<p style="padding:20px">Die Chart-Bibliothek konnte nicht geladen werden. Bitte Internetverbindung prüfen.</p>';
      return;
    }
    readHash();
    CT.chart.init($('chart'), $('legend'));
    CT.drawings.init(document.querySelector('.chart-wrap'), $('chart'));
    bind();
    applyLog();
    open(state.symbol, state.interval);
    // Symbolliste im Hintergrund laden, danach genaue Preis-Nachkommastellen setzen
    CT.symbols.load().then(function () {
      CT.chart.setInfo(CT.symbols.get(state.symbol));
    }).catch(function () { /* Suche funktioniert auch ohne Liste */ });
  }

  start();
})();
