/* Symbolsuche über alle handelbaren Binance-Paare:
   - Spot (Krypto), z. B. "BTCUSDT"
   - Futures (Perpetuals) mit Endung ".P": Aktien/ETFs (NVDA, MSTR, QQQ = Nasdaq-100, SPY = S&P 500 …),
     Rohstoffe (Gold XAU, Silber, Öl …) und Krypto-Perpetuals
   Die Liste wird 24 Stunden im Browser zwischengespeichert. */
window.CT = window.CT || {};

CT.symbols = (function () {
  const CACHE_KEY = 'symbols.v2';
  const TTL = 24 * 60 * 60 * 1000;
  const QUOTE_RANK = ['USDT', 'USDC', 'FDUSD', 'BTC', 'ETH', 'EUR', 'TRY', 'BNB'];
  const POPULAR = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'DOGE', 'ADA', 'AVAX', 'LINK', 'TRX', 'DOT', 'SUI', 'LTC', 'PEPE'];
  const POPULAR_TRADFI = ['QQQ', 'SPY', 'NVDA', 'MSTR', 'TSLA', 'AAPL', 'MSFT', 'META', 'AMZN', 'GOOGL', 'AMD', 'PLTR', 'COIN', 'XAU', 'XAG', 'CL'];
  const EQUITY_KINDS = ['EQUITY', 'KR_EQUITY', 'HK_EQUITY', 'CN_EQUITY', 'PREMARKET'];

  /** Filter in der Suche: Kategorien und Quote-Währungen */
  const FILTERS = [
    { id: 'ALL', label: 'Alle' },
    { id: 'STOCKS', label: 'Aktien & ETFs' },
    { id: 'COMMODITY', label: 'Rohstoffe' },
    { id: 'SPOT', label: 'Krypto Spot' },
    { id: 'PERP', label: 'Futures' },
  ].concat(QUOTE_RANK.map(function (q) { return { id: q, label: q }; }));

  const KIND_LABEL = {
    SPOT: 'Spot', COIN: 'Perp', EQUITY: 'Aktie/ETF', KR_EQUITY: 'Aktie KR', HK_EQUITY: 'Aktie HK',
    CN_EQUITY: 'Aktie CN', PREMARKET: 'Pre-IPO', COMMODITY: 'Rohstoff', FX: 'Devisen', INDEX: 'Index',
  };

  let list = null; // [symbol, base, quote, tickSize, kind]
  let bySymbol = new Map();
  let pending = null;

  function index() {
    bySymbol = new Map(list.map(function (s) { return [s[0], s]; }));
  }

  function priceTick(s) {
    const pf = (s.filters || []).find(function (f) { return f.filterType === 'PRICE_FILTER'; });
    return pf ? pf.tickSize : null;
  }

  function loadSpot() {
    return CT.binance.exchangeInfo('spot').then(function (info) {
      return info.symbols
        .filter(function (s) { return s.status === 'TRADING' && s.isSpotTradingAllowed; })
        .map(function (s) { return [s.symbol, s.baseAsset, s.quoteAsset, priceTick(s), 'SPOT']; });
    });
  }

  function loadFutures() {
    return CT.binance.exchangeInfo('futures').then(function (info) {
      return info.symbols
        .filter(function (s) {
          return s.status === 'TRADING' && /PERPETUAL/.test(s.contractType) &&
            (s.quoteAsset === 'USDT' || s.quoteAsset === 'USDC');
        })
        .map(function (s) {
          return [s.symbol + '.P', s.baseAsset, s.quoteAsset, priceTick(s), s.underlyingType || 'COIN'];
        });
    });
  }

  function load() {
    if (list) return Promise.resolve(list);
    if (pending) return pending;
    CT.store.remove('symbols.v1'); // alter Zwischenspeicher (nur Spot) aus früheren Versionen
    const cached = CT.store.get(CACHE_KEY, null);
    if (cached && Array.isArray(cached.d) && Date.now() - cached.t < TTL) {
      list = cached.d;
      index();
      return Promise.resolve(list);
    }
    // Spot und Futures parallel; fällt Futures aus, geht es mit Spot weiter (und umgekehrt)
    pending = Promise.allSettled([loadSpot(), loadFutures()]).then(function (r) {
      if (r[0].status === 'rejected' && r[1].status === 'rejected') throw r[0].reason;
      list = (r[0].value || []).concat(r[1].value || []);
      index();
      if (r[0].status === 'fulfilled' && r[1].status === 'fulfilled') CT.store.set(CACHE_KEY, { t: Date.now(), d: list });
      return list;
    }).catch(function (err) {
      // Ohne Liste funktioniert die Suche weiter: ein eingetipptes Symbol wird direkt geöffnet.
      if (cached && Array.isArray(cached.d)) { list = cached.d; index(); return list; }
      throw err;
    }).finally(function () { pending = null; });
    return pending;
  }

  function toInfo(s) {
    return s ? {
      symbol: s[0], base: s[1], quote: s[2], tickSize: s[3], kind: s[4] || 'SPOT',
      futures: s[4] !== 'SPOT' && s[4] !== undefined, label: KIND_LABEL[s[4]] || 'Perp',
    } : null;
  }

  function get(symbol) {
    return toInfo(bySymbol.get(symbol));
  }

  /** Eingabe in Tool-Schreibweise bringen: Großbuchstaben, nur A–Z/0–9, Futures-Endung ".P" bleibt erhalten. */
  function normalize(input) {
    const s = String(input || '').trim().toUpperCase();
    const fut = /\.P$/.test(s);
    const core = s.replace(/\.P$/, '').replace(/[^A-Z0-9]/g, '');
    return core ? core + (fut ? '.P' : '') : '';
  }

  function quoteRank(q) {
    const i = QUOTE_RANK.indexOf(q);
    return i === -1 ? QUOTE_RANK.length : i;
  }

  /** Reihenfolge bei gleicher Trefferqualität: Spot und Aktien/Rohstoffe vor Krypto-Perpetuals */
  function marketRank(kind) { return kind === 'COIN' || kind === 'INDEX' ? 1 : 0; }

  function matchesFilter(s, filter) {
    switch (filter) {
      case undefined: case null: case 'ALL': return true;
      case 'STOCKS': return EQUITY_KINDS.indexOf(s[4]) !== -1;
      case 'COMMODITY': return s[4] === 'COMMODITY';
      case 'SPOT': return s[4] === 'SPOT';
      case 'PERP': return s[4] !== 'SPOT';
      default: return s[2] === filter;
    }
  }

  /** Suche: exakte Treffer zuerst, dann Basis-Asset, dann Anfang, dann enthalten. */
  function search(query, filter, max) {
    if (!list) return [];
    const q = String(query || '').toUpperCase().replace(/\.P$/, '').replace(/[^A-Z0-9]/g, '');
    const limit = max || 80;
    const category = filter === 'STOCKS' || filter === 'COMMODITY' || filter === 'PERP';
    const out = [];
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      if (!matchesFilter(s, filter)) continue;
      let score;
      if (!q) {
        // Ohne Eingabe: beliebte Werte; in Kategorien alle, beliebte zuerst
        const pt = s[4] !== 'SPOT' && s[4] !== 'COIN' ? POPULAR_TRADFI.indexOf(s[1]) : -1;
        const pc = s[4] === 'SPOT' ? POPULAR.indexOf(s[1]) : -1;
        if (pt !== -1) score = pt;
        else if (pc !== -1) score = 20 + pc;
        else if (category) score = 100;
        else continue;
      } else if (s[0] === q || s[0] === q + '.P') score = 0;
      else if (s[1] === q) score = 1;
      else if (s[0].startsWith(q)) score = 2;
      else if (s[1].startsWith(q)) score = 3;
      else if (s[0].indexOf(q) !== -1) score = 4;
      else continue;
      out.push({ s: s, score: score });
    }
    out.sort(function (a, b) {
      return a.score - b.score ||
        marketRank(a.s[4]) - marketRank(b.s[4]) ||
        quoteRank(a.s[2]) - quoteRank(b.s[2]) ||
        a.s[1].length - b.s[1].length ||
        (a.s[0] < b.s[0] ? -1 : 1);
    });
    return out.slice(0, limit).map(function (r) { return toInfo(r.s); });
  }

  return { load, get, search, normalize, FILTERS, KIND_LABEL };
})();
