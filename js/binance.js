/* Datenquelle: öffentliche Binance-API (ohne Schlüssel), zwei Märkte:
   - Spot:    Symbole wie "BTCUSDT"          → api.binance.com / stream.binance.com
   - Futures: Symbole mit Endung ".P" wie bei TradingView, z. B. "NVDAUSDT.P", "QQQUSDT.P", "XAUUSDT.P"
              → fapi.binance.com / fstream.binance.com. Darüber laufen Aktien, ETFs und Rohstoffe
              (Binance "TradFi"-Perpetuals) sowie Krypto-Perpetuals.
   Die Endung ".P" gibt es nur im Tool; an Binance geht immer das rohe Symbol ohne Endung.
   Fällt beim Spot der Hauptserver aus oder ist im Land gesperrt (HTTP 451/403),
   wird automatisch auf die offiziellen Marktdaten-Spiegel (binance.vision) gewechselt. */
window.CT = window.CT || {};

CT.binance = (function () {
  const MARKETS = {
    spot: {
      rest: ['https://api.binance.com', 'https://data-api.binance.vision'],
      ws: ['wss://stream.binance.com:9443/ws', 'wss://data-stream.binance.vision/ws'],
      api: '/api/v3',
    },
    futures: {
      rest: ['https://fapi.binance.com'],
      ws: ['wss://fstream.binance.com/ws'],
      api: '/fapi/v1',
    },
  };
  const MAX_LIMIT = 1000;
  const restIndex = { spot: 0, futures: 0 };

  /* ---------- Symbole & Märkte ---------- */
  function isFutures(symbol) { return /\.P$/.test(symbol); }
  function marketOf(symbol) { return isFutures(symbol) ? 'futures' : 'spot'; }
  function rawSymbol(symbol) { return symbol.replace(/\.P$/, ''); }
  function toolSymbol(raw, market) { return market === 'futures' ? raw + '.P' : raw; }

  async function request(market, path, params) {
    const m = MARKETS[market];
    const qs = new URLSearchParams(params || {}).toString();
    let lastError;
    for (let i = 0; i < m.rest.length; i++) {
      const idx = (restIndex[market] + i) % m.rest.length;
      const url = m.rest[idx] + m.api + path + (qs ? '?' + qs : '');
      try {
        const res = await fetch(url);
        if (res.ok) {
          restIndex[market] = idx;
          return await res.json();
        }
        let msg = 'HTTP ' + res.status;
        try { const body = await res.json(); if (body && body.msg) msg = body.msg; } catch (e) { /* kein JSON */ }
        const err = new Error(msg);
        // 400 = ungültige Anfrage (z. B. unbekanntes Symbol) – ein anderer Server hilft dann nicht.
        err.fatal = res.status === 400;
        throw err;
      } catch (err) {
        lastError = err;
        if (err.fatal) throw err;
      }
    }
    throw lastError || new Error('Binance nicht erreichbar');
  }

  function parseKline(k) {
    return {
      openTime: k[0],
      open: +k[1],
      high: +k[2],
      low: +k[3],
      close: +k[4],
      volume: +k[5],
      closeTime: k[6],
      quoteVolume: +k[7],
    };
  }

  /** Kerzen laden. endTime (ms) für ältere Historie, ohne endTime die neuesten. */
  async function klines(symbol, interval, opts) {
    const o = opts || {};
    const params = { symbol: rawSymbol(symbol), interval: interval, limit: Math.min(o.limit || MAX_LIMIT, MAX_LIMIT) };
    if (o.endTime != null) params.endTime = o.endTime;
    const data = await request(marketOf(symbol), '/klines', params);
    return data.map(parseKline);
  }

  function exchangeInfo(market) {
    return request(market || 'spot', '/exchangeInfo');
  }

  /**
   * Live-Kerzen abonnieren. Verbindet sich bei Abbruch automatisch neu.
   * handlers: { onBar(bar), onStatus('connecting'|'live'|'offline'), onReconnect() }
   */
  function streamKlines(symbol, interval, handlers) {
    const h = handlers || {};
    const hosts = MARKETS[marketOf(symbol)].ws;
    const stream = rawSymbol(symbol).toLowerCase() + '@kline_' + interval;
    let ws = null;
    let stopped = false;
    let attempt = 0;
    let hostIndex = 0;
    let everOpened = false;
    let timer = null;

    function status(s) { if (h.onStatus) h.onStatus(s); }

    function connect() {
      if (stopped) return;
      status('connecting');
      ws = new WebSocket(hosts[hostIndex % hosts.length] + '/' + stream);

      ws.onopen = function () {
        attempt = 0;
        status('live');
        if (everOpened && h.onReconnect) h.onReconnect();
        everOpened = true;
      };

      ws.onmessage = function (ev) {
        let msg;
        try { msg = JSON.parse(ev.data); } catch (e) { return; }
        const k = msg && msg.k;
        if (!k || !h.onBar) return;
        h.onBar({
          openTime: k.t,
          open: +k.o,
          high: +k.h,
          low: +k.l,
          close: +k.c,
          volume: +k.v,
          closeTime: k.T,
          quoteVolume: +k.q,
          closed: k.x,
        });
      };

      ws.onerror = function () {
        try { ws.close(); } catch (e) { /* ignorieren */ }
      };

      ws.onclose = function () {
        if (stopped) return;
        status('offline');
        attempt++;
        if (attempt % 2 === 0) hostIndex++; // nach zwei Fehlversuchen anderen Server probieren
        const delay = Math.min(30000, 1000 * Math.pow(2, Math.min(attempt, 5)));
        timer = setTimeout(connect, delay);
      };
    }

    connect();

    return {
      close() {
        stopped = true;
        clearTimeout(timer);
        if (ws) {
          ws.onclose = null;
          try { ws.close(); } catch (e) { /* ignorieren */ }
        }
      },
    };
  }

  function tickerFrom(t, market) {
    const last = +t.lastPrice;
    const open = +t.openPrice;
    return {
      symbol: toolSymbol(t.symbol, market),
      price: last,
      open: open,
      change: open ? (last - open) / open * 100 : 0,
      quoteVolume: +t.quoteVolume,
    };
  }

  /**
   * 24-Stunden-Statistik für mehrere Symbole (Spot und Futures gemischt).
   * Spot: eine Sammelabfrage. Futures: kennt keine Symbolliste → alle holen und filtern.
   */
  async function ticker24h(symbols) {
    const spot = symbols.filter(function (s) { return !isFutures(s); });
    const fut = symbols.filter(isFutures);
    const out = [];
    if (spot.length) {
      const data = await request('spot', '/ticker/24hr', { symbols: JSON.stringify(spot), type: 'MINI' });
      data.forEach(function (t) { out.push(tickerFrom(t, 'spot')); });
    }
    if (fut.length) {
      const wanted = fut.map(rawSymbol);
      const data = fut.length === 1
        ? [await request('futures', '/ticker/24hr', { symbol: wanted[0] })]
        : await request('futures', '/ticker/24hr');
      data.forEach(function (t) { if (wanted.indexOf(t.symbol) !== -1) out.push(tickerFrom(t, 'futures')); });
    }
    return out;
  }

  /**
   * Live-Kurse (rollierende 24 h) für eine veränderliche Liste von Symbolen eines Marktes über EINE Verbindung.
   * Nutzt SUBSCRIBE/UNSUBSCRIBE, damit beim Ändern der Watchlist nicht neu verbunden werden muss.
   * Rückgabe: { set(symbols), close() } – symbols in Tool-Schreibweise (mit ".P" bei Futures)
   */
  function streamMiniTickers(onTick, onStatus, market) {
    const mk = market || 'spot';
    const hosts = MARKETS[mk].ws;
    let ws = null;
    let wanted = [];
    let subscribed = [];
    let stopped = false;
    let attempt = 0;
    let hostIndex = 0;
    let timer = null;
    let reqId = 1;
    let started = false;

    function name(s) { return rawSymbol(s).toLowerCase() + '@miniTicker'; }
    function status(s) { if (onStatus) onStatus(s); }

    function send(method, symbols) {
      if (!ws || ws.readyState !== 1 || !symbols.length) return;
      ws.send(JSON.stringify({ method: method, params: symbols.map(name), id: reqId++ }));
    }

    function sync() {
      const add = wanted.filter(function (s) { return subscribed.indexOf(s) === -1; });
      const del = subscribed.filter(function (s) { return wanted.indexOf(s) === -1; });
      send('UNSUBSCRIBE', del);
      send('SUBSCRIBE', add);
      if (ws && ws.readyState === 1) subscribed = wanted.slice();
    }

    function connect() {
      if (stopped) return;
      status('connecting');
      ws = new WebSocket(hosts[hostIndex % hosts.length]);
      subscribed = [];
      ws.onopen = function () { attempt = 0; status('live'); sync(); };
      ws.onmessage = function (ev) {
        let m;
        try { m = JSON.parse(ev.data); } catch (e) { return; }
        if (!m || m.e !== '24hrMiniTicker') return;
        const last = +m.c;
        const open = +m.o;
        onTick({
          symbol: toolSymbol(m.s, mk),
          price: last,
          open: open,
          change: open ? (last - open) / open * 100 : 0,
          quoteVolume: +m.q,
        });
      };
      ws.onerror = function () { try { ws.close(); } catch (e) { /* ignorieren */ } };
      ws.onclose = function () {
        if (stopped) return;
        status('offline');
        attempt++;
        if (attempt % 2 === 0) hostIndex++;
        timer = setTimeout(connect, Math.min(30000, 1000 * Math.pow(2, Math.min(attempt, 5))));
      };
    }

    return {
      // Verbindung erst aufbauen, wenn es tatsächlich Symbole dieses Marktes gibt
      set: function (symbols) {
        wanted = symbols.slice();
        if (!started && wanted.length) { started = true; connect(); return; }
        sync();
      },
      close: function () {
        stopped = true;
        clearTimeout(timer);
        if (ws) { ws.onclose = null; try { ws.close(); } catch (e) { /* ignorieren */ } }
      },
    };
  }

  return {
    klines, exchangeInfo, ticker24h, streamKlines, streamMiniTickers,
    isFutures, marketOf, rawSymbol, toolSymbol, MAX_LIMIT,
  };
})();
