/* Datenquelle: öffentliche Binance-API (ohne Schlüssel).
   - Kerzen über REST  (/api/v3/klines)
   - Live-Kerze über WebSocket (<symbol>@kline_<interval>)
   Fällt der Hauptserver aus oder ist im Land gesperrt (HTTP 451/403),
   wird automatisch auf die offiziellen Marktdaten-Spiegel (binance.vision) gewechselt. */
window.CT = window.CT || {};

CT.binance = (function () {
  const REST_HOSTS = ['https://api.binance.com', 'https://data-api.binance.vision'];
  const WS_HOSTS = ['wss://stream.binance.com:9443/ws', 'wss://data-stream.binance.vision/ws'];
  const MAX_LIMIT = 1000;
  let restIndex = 0;

  async function request(path, params) {
    const qs = new URLSearchParams(params || {}).toString();
    let lastError;
    for (let i = 0; i < REST_HOSTS.length; i++) {
      const idx = (restIndex + i) % REST_HOSTS.length;
      const url = REST_HOSTS[idx] + path + (qs ? '?' + qs : '');
      try {
        const res = await fetch(url);
        if (res.ok) {
          restIndex = idx;
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
    const params = { symbol, interval, limit: Math.min(o.limit || MAX_LIMIT, MAX_LIMIT) };
    if (o.endTime != null) params.endTime = o.endTime;
    const data = await request('/api/v3/klines', params);
    return data.map(parseKline);
  }

  function exchangeInfo() {
    return request('/api/v3/exchangeInfo');
  }

  /**
   * Live-Kerzen abonnieren. Verbindet sich bei Abbruch automatisch neu.
   * handlers: { onBar(bar), onStatus('connecting'|'live'|'offline'), onReconnect() }
   */
  function streamKlines(symbol, interval, handlers) {
    const h = handlers || {};
    const stream = symbol.toLowerCase() + '@kline_' + interval;
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
      ws = new WebSocket(WS_HOSTS[hostIndex % WS_HOSTS.length] + '/' + stream);

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

  return { klines, exchangeInfo, streamKlines, MAX_LIMIT };
})();
