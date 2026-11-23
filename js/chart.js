/* Chart-Darstellung mit Lightweight Charts (v5).
   Kerzen + Volumen, Legende mit OHLC am Fadenkreuz, Log-Skala,
   Live-Updates per WebSocket und automatisches Nachladen älterer Historie beim Scrollen nach links. */
window.CT = window.CT || {};

CT.chart = (function () {
  const LC = window.LightweightCharts;
  const COLORS = {
    bg: '#0e1016',
    text: '#a3a9b8',
    grid: '#1a1e29',
    border: '#242a38',
    up: '#26a69a',
    down: '#ef5350',
    upVol: 'rgba(38, 166, 154, 0.45)',
    downVol: 'rgba(239, 83, 80, 0.45)',
  };
  const DAILY_OR_MORE = { '1d': 1, '3d': 1, '1w': 1, '1M': 1 };
  const LOAD_MORE_THRESHOLD = 40; // so viele Kerzen vor dem linken Rand → ältere Daten nachladen

  let chart, candles, volume, legendEl;
  let bars = [];
  let current = { symbol: null, interval: null, info: null };
  let gen = 0; // erhöht sich bei jedem Symbol-/Zeitrahmenwechsel, verwirft veraltete Antworten
  let stream = null;
  let loadingOlder = false;
  let viewReady = false;
  let historyComplete = false;
  let hovering = false;
  let priceDecimals = 2;
  const listeners = { status: [], loading: [], error: [], price: [] };

  function emit(type, value) { listeners[type].forEach(function (fn) { fn(value); }); }
  function on(type, fn) { listeners[type].push(fn); }

  /* ---------- Zeit ----------
     Die Chart-Zeit ist immer echte UTC-Zeit in Sekunden (openTime / 1000).
     Die Ortszeit entsteht nur bei der Anzeige (timeFormatter / tickMarkFormatter).
     Wichtig: Zeiten NICHT pro Kerze in Ortszeit verschieben – bei der Zeitumstellung
     entstünden doppelte Zeitstempel, und Lightweight Charts zeichnet dann nichts mehr.
     Tages-, Wochen- und Monatskerzen werden in UTC formatiert, damit das Datum stimmt. */
  function isDailyOrMore(interval) { return !!DAILY_OR_MORE[interval]; }

  function toChartTime(ms) {
    return Math.floor(ms / 1000);
  }

  function fromChartTime(t) {
    return t * 1000;
  }

  function dtf(opts, utc) {
    return new Intl.DateTimeFormat('de-DE', utc ? Object.assign({ timeZone: 'UTC' }, opts) : opts);
  }
  const FMT = {
    local: {
      full: dtf({ weekday: 'short', day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }),
      year: dtf({ year: 'numeric' }),
      month: dtf({ month: 'short' }),
      day: dtf({ day: 'numeric' }),
      time: dtf({ hour: '2-digit', minute: '2-digit' }),
      seconds: dtf({ hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    },
    utc: {
      full: dtf({ weekday: 'short', day: '2-digit', month: '2-digit', year: '2-digit' }, true),
      monthFull: dtf({ month: 'short', year: 'numeric' }, true),
      year: dtf({ year: 'numeric' }, true),
      month: dtf({ month: 'short' }, true),
      day: dtf({ day: 'numeric' }, true),
    },
  };

  /** Zeit im Fadenkreuz */
  function formatCrosshairTime(t) {
    const d = new Date(t * 1000);
    if (current.interval === '1M') return FMT.utc.monthFull.format(d);
    return isDailyOrMore(current.interval) ? FMT.utc.full.format(d) : FMT.local.full.format(d);
  }

  /** Beschriftung der Zeitachse (TickMarkType: 0 Jahr, 1 Monat, 2 Tag, 3 Zeit, 4 Zeit mit Sekunden) */
  function formatTickMark(t, type) {
    const d = new Date(t * 1000);
    const f = isDailyOrMore(current.interval) ? FMT.utc : FMT.local;
    switch (type) {
      case 0: return f.year.format(d);
      case 1: return f.month.format(d);
      case 2: return f.day.format(d);
      case 4: return FMT.local.seconds.format(d);
      default: return FMT.local.time.format(d);
    }
  }

  function toCandle(b) {
    return { time: toChartTime(b.openTime), open: b.open, high: b.high, low: b.low, close: b.close };
  }

  function toVolume(b) {
    return { time: toChartTime(b.openTime), value: b.volume, color: b.close >= b.open ? COLORS.upVol : COLORS.downVol };
  }

  /* ---------- Formatierung ---------- */
  function decimalsFromTick(tickSize) {
    const s = String(tickSize);
    if (s.indexOf('e-') !== -1) return parseInt(s.split('e-')[1], 10);
    const parts = s.replace(/0+$/, '').split('.');
    return parts[1] ? parts[1].length : 0;
  }

  function guessDecimals(price) {
    if (price >= 1000) return 2;
    if (price >= 10) return 3;
    if (price >= 1) return 4;
    if (price >= 0.01) return 6;
    return 8;
  }

  const volFmt = new Intl.NumberFormat('de-DE', { notation: 'compact', maximumFractionDigits: 2 });

  // Gleiches Format wie die Preisachse (Punkt als Dezimaltrenner)
  function fmtPrice(v) {
    return v.toFixed(priceDecimals);
  }

  function applyPriceFormat() {
    if (!candles) return;
    const info = current.info;
    if (info && info.tickSize) {
      priceDecimals = decimalsFromTick(info.tickSize);
      candles.applyOptions({ priceFormat: { type: 'price', precision: priceDecimals, minMove: parseFloat(info.tickSize) } });
    } else if (bars.length) {
      priceDecimals = guessDecimals(bars[bars.length - 1].close);
      candles.applyOptions({ priceFormat: { type: 'price', precision: priceDecimals, minMove: Math.pow(10, -priceDecimals) } });
    }
  }

  /* ---------- Legende ---------- */
  function renderLegend(index) {
    if (!legendEl) return;
    const b = bars[index];
    const head = '<span class="lg-title">' + (current.symbol || '') + '</span>' +
      '<span class="lg-sub">' + labelFor(current.interval) + ' · Binance</span>';
    if (!b) { legendEl.innerHTML = head; return; }
    const prev = bars[index - 1];
    const ref = prev ? prev.close : b.open;
    const diff = b.close - ref;
    const pct = ref ? (diff / ref) * 100 : 0;
    const cls = b.close >= b.open ? 'up' : 'down';
    const chgCls = diff >= 0 ? 'up' : 'down';
    function kv(k, v, c) { return '<span><span class="lg-k">' + k + '</span><span class="' + (c || cls) + '">' + v + '</span></span>'; }
    legendEl.innerHTML = head +
      kv('O', fmtPrice(b.open)) +
      kv('H', fmtPrice(b.high)) +
      kv('L', fmtPrice(b.low)) +
      kv('C', fmtPrice(b.close)) +
      '<span class="' + chgCls + '">' + (diff >= 0 ? '+' : '') + fmtPrice(diff) + ' (' + (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%)</span>' +
      kv('Vol', volFmt.format(b.volume), 'lg-sub');
  }

  function labelFor(interval) {
    if (!interval) return '';
    return /[dw]$/.test(interval) ? interval.toUpperCase() : interval;
  }

  /* ---------- Aufbau ---------- */
  function init(container, legend) {
    legendEl = legend;
    chart = LC.createChart(container, {
      autoSize: true,
      layout: {
        background: { type: 'solid', color: COLORS.bg },
        textColor: COLORS.text,
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        attributionLogo: true,
      },
      grid: {
        vertLines: { color: COLORS.grid },
        horzLines: { color: COLORS.grid },
      },
      crosshair: {
        mode: LC.CrosshairMode.Normal,
        vertLine: { color: '#5d6478', labelBackgroundColor: '#2a3040' },
        horzLine: { color: '#5d6478', labelBackgroundColor: '#2a3040' },
      },
      rightPriceScale: { borderColor: COLORS.border, scaleMargins: { top: 0.08, bottom: 0.22 } },
      timeScale: {
        borderColor: COLORS.border,
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 8,
        tickMarkFormatter: formatTickMark,
      },
      localization: { locale: 'de-DE', timeFormatter: formatCrosshairTime },
    });

    candles = chart.addSeries(LC.CandlestickSeries, {
      upColor: COLORS.up,
      downColor: COLORS.down,
      wickUpColor: COLORS.up,
      wickDownColor: COLORS.down,
      borderVisible: false,
    });

    volume = chart.addSeries(LC.HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: 'vol',
      lastValueVisible: false,
      priceLineVisible: false,
    });
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });

    chart.subscribeCrosshairMove(function (param) {
      if (param && param.time !== undefined && param.logical !== undefined) {
        const i = Math.round(param.logical);
        if (bars[i]) {
          hovering = true;
          renderLegend(i);
          return;
        }
      }
      hovering = false;
      renderLegend(bars.length - 1);
    });

    chart.timeScale().subscribeVisibleLogicalRangeChange(function (range) {
      if (range && range.from < LOAD_MORE_THRESHOLD) loadOlder();
    });
  }

  function render() {
    candles.setData(bars.map(toCandle));
    volume.setData(bars.map(toVolume));
  }

  /* ---------- Laden ---------- */
  async function load(symbol, interval, info) {
    const myGen = ++gen;
    if (stream) { stream.close(); stream = null; }
    current = { symbol, interval, info: info || null };
    historyComplete = false;
    loadingOlder = false;
    viewReady = false;
    bars = [];
    chart.timeScale().applyOptions({ timeVisible: !isDailyOrMore(interval) });
    renderLegend(-1);
    emit('loading', true);
    try {
      const data = await CT.binance.klines(symbol, interval);
      if (myGen !== gen) return false;
      bars = data;
      historyComplete = data.length < CT.binance.MAX_LIMIT;
      applyPriceFormat();
      render();
      resetView();
      // Nachladen erst erlauben, wenn die Startansicht steht (sonst lädt es schon beim Aufbau)
      requestAnimationFrame(function () {
        if (myGen !== gen) return;
        resetView();
        viewReady = true;
      });
      renderLegend(bars.length - 1);
      emitPrice();
      startStream(myGen);
      return true;
    } catch (err) {
      if (myGen !== gen) return false;
      emit('error', 'Daten für ' + symbol + ' konnten nicht geladen werden: ' + err.message);
      emit('status', 'offline');
      return false;
    } finally {
      if (myGen === gen) emit('loading', false);
    }
  }

  function startStream(myGen) {
    stream = CT.binance.streamKlines(current.symbol, current.interval, {
      onStatus: function (s) { if (myGen === gen) emit('status', s); },
      onBar: function (bar) { if (myGen === gen) applyLiveBar(bar); },
      onReconnect: function () { if (myGen === gen) resync(myGen); },
    });
  }

  function applyLiveBar(bar) {
    if (!bars.length) return;
    const last = bars[bars.length - 1];
    if (bar.openTime === last.openTime) {
      bars[bars.length - 1] = bar;
    } else if (bar.openTime > last.openTime) {
      bars.push(bar);
    } else {
      return; // ältere Kerze – ignorieren
    }
    candles.update(toCandle(bar));
    volume.update(toVolume(bar));
    if (!hovering) renderLegend(bars.length - 1);
    emitPrice();
  }

  /** Nach einem Verbindungsabbruch die neuesten Kerzen nachladen und Lücken schließen. */
  async function resync(myGen) {
    try {
      const fresh = await CT.binance.klines(current.symbol, current.interval);
      if (myGen !== gen || !fresh.length) return;
      const firstFresh = fresh[0].openTime;
      bars = bars.filter(function (b) { return b.openTime < firstFresh; }).concat(fresh);
      render();
      if (!hovering) renderLegend(bars.length - 1);
      emitPrice();
    } catch (e) { /* nächster Live-Tick korrigiert es */ }
  }

  /** Ältere Historie nachladen – unbegrenzt, bis Binance keine Daten mehr liefert. */
  async function loadOlder() {
    if (!viewReady || loadingOlder || historyComplete || !bars.length) return;
    loadingOlder = true;
    const myGen = gen;
    try {
      const older = await CT.binance.klines(current.symbol, current.interval, { endTime: bars[0].openTime - 1 });
      if (myGen !== gen) return;
      const first = bars[0].openTime;
      const add = older.filter(function (b) { return b.openTime < first; });
      if (older.length < CT.binance.MAX_LIMIT) historyComplete = true;
      if (add.length) {
        // Sichtbaren Ausschnitt festhalten, damit die Ansicht beim Voranstellen nicht springt
        const range = chart.timeScale().getVisibleLogicalRange();
        bars = add.concat(bars);
        render();
        if (range) {
          chart.timeScale().setVisibleLogicalRange({ from: range.from + add.length, to: range.to + add.length });
        }
        if (!hovering) renderLegend(bars.length - 1);
      }
    } catch (e) {
      emit('error', 'Ältere Daten konnten nicht geladen werden: ' + e.message);
    } finally {
      if (myGen === gen) loadingOlder = false;
    }
  }

  function emitPrice() {
    const last = bars[bars.length - 1];
    if (last) emit('price', { symbol: current.symbol, price: last.close, text: fmtPrice(last.close) });
  }

  /* ---------- Steuerung ---------- */
  function setInfo(info) {
    if (!info || info.symbol !== current.symbol) return;
    current.info = info;
    applyPriceFormat();
    if (!hovering) renderLegend(bars.length - 1);
  }

  function setLog(enabled) {
    chart.priceScale('right').applyOptions({
      mode: enabled ? LC.PriceScaleMode.Logarithmic : LC.PriceScaleMode.Normal,
    });
  }

  function resetView() {
    chart.priceScale('right').applyOptions({ autoScale: true });
    const n = bars.length;
    if (n) chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, n - 160), to: n + 8 });
  }

  return {
    init,
    load,
    setInfo,
    setLog,
    resetView,
    on,
    toChartTime,
    fromChartTime,
    labelFor,
    get api() { return chart; },
    get series() { return { candles, volume }; },
    get bars() { return bars; },
    get current() { return current; },
  };
})();
