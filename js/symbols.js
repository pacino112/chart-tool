/* Symbolsuche über alle handelbaren Binance-Spot-Paare.
   Die Liste wird 24 Stunden im Browser zwischengespeichert. */
window.CT = window.CT || {};

CT.symbols = (function () {
  const CACHE_KEY = 'symbols.v1';
  const TTL = 24 * 60 * 60 * 1000;
  const QUOTE_RANK = ['USDT', 'USDC', 'FDUSD', 'BTC', 'ETH', 'EUR', 'TRY', 'BNB'];
  const POPULAR = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'DOGE', 'ADA', 'AVAX', 'LINK', 'TRX', 'DOT', 'SUI', 'LTC', 'PEPE'];

  let list = null; // [symbol, base, quote, tickSize]
  let bySymbol = new Map();
  let pending = null;

  function index() {
    bySymbol = new Map(list.map(function (s) { return [s[0], s]; }));
  }

  function load() {
    if (list) return Promise.resolve(list);
    if (pending) return pending;
    const cached = CT.store.get(CACHE_KEY, null);
    if (cached && Array.isArray(cached.d) && Date.now() - cached.t < TTL) {
      list = cached.d;
      index();
      return Promise.resolve(list);
    }
    pending = CT.binance.exchangeInfo().then(function (info) {
      list = info.symbols
        .filter(function (s) { return s.status === 'TRADING' && s.isSpotTradingAllowed; })
        .map(function (s) {
          const pf = (s.filters || []).find(function (f) { return f.filterType === 'PRICE_FILTER'; });
          return [s.symbol, s.baseAsset, s.quoteAsset, pf ? pf.tickSize : null];
        });
      index();
      CT.store.set(CACHE_KEY, { t: Date.now(), d: list });
      return list;
    }).catch(function (err) {
      // Ohne Liste funktioniert die Suche weiter: ein eingetipptes Symbol wird direkt geöffnet.
      if (cached && Array.isArray(cached.d)) { list = cached.d; index(); return list; }
      throw err;
    }).finally(function () { pending = null; });
    return pending;
  }

  function toInfo(s) {
    return s ? { symbol: s[0], base: s[1], quote: s[2], tickSize: s[3] } : null;
  }

  function get(symbol) {
    return toInfo(bySymbol.get(symbol));
  }

  function quoteRank(q) {
    const i = QUOTE_RANK.indexOf(q);
    return i === -1 ? QUOTE_RANK.length : i;
  }

  /** Suche: exakte Treffer zuerst, dann Basis-Asset, dann Anfang, dann enthalten. */
  function search(query, quote, max) {
    if (!list) return [];
    const q = String(query || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const limit = max || 80;
    const out = [];
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      if (quote && quote !== 'ALL' && s[2] !== quote) continue;
      let score;
      if (!q) {
        const p = POPULAR.indexOf(s[1]);
        if (p === -1) continue;
        score = p;
      } else if (s[0] === q) score = 0;
      else if (s[1] === q) score = 1;
      else if (s[0].startsWith(q)) score = 2;
      else if (s[1].startsWith(q)) score = 3;
      else if (s[0].indexOf(q) !== -1) score = 4;
      else continue;
      out.push({ s: s, score: score });
    }
    out.sort(function (a, b) {
      return a.score - b.score ||
        quoteRank(a.s[2]) - quoteRank(b.s[2]) ||
        a.s[1].length - b.s[1].length ||
        (a.s[0] < b.s[0] ? -1 : 1);
    });
    return out.slice(0, limit).map(function (r) { return toInfo(r.s); });
  }

  return { load, get, search, QUOTES: ['ALL'].concat(QUOTE_RANK) };
})();
