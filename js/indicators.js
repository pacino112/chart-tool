/* Indikatoren: Verwaltung, Darstellung, Legende und Einstellungsfenster.

   - Beliebig viele Instanzen (z. B. EMA 20 und EMA 200 gleichzeitig), gespeichert unter "ct.indicators"
     und damit automatisch Teil der JSON-Sicherung.
   - Platzierung: 'main' = im Kurs-Chart, 'vol' = auf der Volumen-Skala, 'pane' = eigener Bereich darunter.
   - Neuer Indikator-Typ: einen Eintrag in DEFS ergänzen (params, plots, calc). Schritt 4 hängt hier an. */
window.CT = window.CT || {};

CT.indicators = (function () {
  const LC = window.LightweightCharts;
  const ta = CT.ta;
  const SOURCES = ['close', 'open', 'high', 'low', 'hl2', 'hlc3', 'ohlc4'];
  const P_SOURCE = { key: 'source', label: 'Quelle', type: 'select', options: SOURCES, def: 'close' };
  const SUB_PANE_STRETCH = 0.28; // Höhe eines Unterbereichs relativ zum Kurs-Chart (=1)

  function len(def, label) { return { key: 'length', label: label || 'Länge', type: 'int', def: def, min: 1, max: 5000 }; }

  const DEFS = {
    sma: {
      name: 'SMA', full: 'Gleitender Durchschnitt (einfach)', place: 'main', format: 'price',
      params: [len(20), P_SOURCE],
      plots: [{ key: 'v', title: 'SMA', color: '#f0b90b', width: 2 }],
      calc: function (b, p) { return { v: ta.sma(ta.source(b, p.source), p.length) }; },
      label: function (p) { return 'SMA ' + p.length + src(p); },
    },
    ema: {
      name: 'EMA', full: 'Gleitender Durchschnitt (exponentiell)', place: 'main', format: 'price',
      params: [len(20), P_SOURCE],
      plots: [{ key: 'v', title: 'EMA', color: '#2962ff', width: 2 }],
      calc: function (b, p) { return { v: ta.ema(ta.source(b, p.source), p.length) }; },
      label: function (p) { return 'EMA ' + p.length + src(p); },
    },
    bb: {
      name: 'BB', full: 'Bollinger-Bänder', place: 'main', format: 'price',
      params: [len(20), { key: 'mult', label: 'Faktor (StdAbw)', type: 'float', def: 2, min: 0.1, max: 10, step: 0.1 }, P_SOURCE],
      plots: [
        { key: 'basis', title: 'Mitte', color: '#ff9800', width: 1 },
        { key: 'upper', title: 'Oben', color: '#2962ff', width: 1 },
        { key: 'lower', title: 'Unten', color: '#2962ff', width: 1 },
      ],
      calc: function (b, p) {
        const s = ta.source(b, p.source);
        const basis = ta.sma(s, p.length);
        const dev = ta.stdev(s, p.length);
        return {
          basis: basis,
          upper: basis.map(function (m, i) { return m === null || dev[i] === null ? null : m + p.mult * dev[i]; }),
          lower: basis.map(function (m, i) { return m === null || dev[i] === null ? null : m - p.mult * dev[i]; }),
        };
      },
      label: function (p) { return 'BB ' + p.length + ' ' + p.mult + src(p); },
    },
    vwap: {
      name: 'VWAP', full: 'Volumengewichteter Durchschnittspreis', place: 'main', format: 'price',
      params: [{ key: 'anchor', label: 'Neu starten je', type: 'select', options: ['Tag', 'Woche', 'Monat'], def: 'Tag' }],
      plots: [{ key: 'v', title: 'VWAP', color: '#e040fb', width: 2 }],
      calc: function (b, p) { return { v: ta.vwap(b, p.anchor) }; },
      label: function (p) { return 'VWAP ' + p.anchor; },
    },
    volma: {
      name: 'Volumen-MA', full: 'Durchschnitt des Volumens', place: 'vol', format: 'volume',
      params: [len(20)],
      plots: [{ key: 'v', title: 'Vol-MA', color: '#f0b90b', width: 1 }],
      calc: function (b, p) { return { v: ta.sma(b.map(function (x) { return x.volume; }), p.length) }; },
      label: function (p) { return 'Vol-MA ' + p.length; },
    },
    rsi: {
      name: 'RSI', full: 'Relative Strength Index', place: 'pane', format: 'fixed2', range: [0, 100],
      params: [len(14), P_SOURCE,
        { key: 'upper', label: 'Obere Linie', type: 'float', def: 70, min: 0, max: 100, step: 1 },
        { key: 'lower', label: 'Untere Linie', type: 'float', def: 30, min: 0, max: 100, step: 1 }],
      plots: [{ key: 'v', title: 'RSI', color: '#7e57c2', width: 2 }],
      levels: function (p) { return [p.upper, 50, p.lower]; },
      calc: function (b, p) { return { v: ta.rsi(ta.source(b, p.source), p.length) }; },
      label: function (p) { return 'RSI ' + p.length + src(p); },
    },
    macd: {
      name: 'MACD', full: 'Moving Average Convergence Divergence', place: 'pane', format: 'price',
      params: [
        { key: 'fast', label: 'Schnell', type: 'int', def: 12, min: 1, max: 5000 },
        { key: 'slow', label: 'Langsam', type: 'int', def: 26, min: 1, max: 5000 },
        { key: 'signal', label: 'Signal', type: 'int', def: 9, min: 1, max: 5000 },
        P_SOURCE],
      plots: [
        { key: 'hist', title: 'Histogramm', type: 'hist', fixedColors: true },
        { key: 'macd', title: 'MACD', color: '#2962ff', width: 2 },
        { key: 'signal', title: 'Signal', color: '#ff6d00', width: 2 },
      ],
      calc: function (b, p) {
        const r = ta.macd(ta.source(b, p.source), p.fast, p.slow, p.signal);
        // Farben wie bei TradingView: Stärke steigt = kräftig, fällt = blass
        r.colors = {
          hist: r.hist.map(function (h, i) {
            const prev = i > 0 ? r.hist[i - 1] : null;
            const rising = prev !== null && h !== null && h > prev;
            if (h === null) return null;
            return h >= 0 ? (rising ? '#26a69a' : '#b2dfdb') : (rising ? '#ffcdd2' : '#ff5252');
          }),
        };
        return r;
      },
      label: function (p) { return 'MACD ' + p.fast + ' ' + p.slow + ' ' + p.signal + src(p); },
    },
    stochrsi: {
      name: 'Stoch RSI', full: 'Stochastic RSI', place: 'pane', format: 'fixed2', range: [0, 100],
      params: [
        { key: 'k', label: 'K', type: 'int', def: 3, min: 1, max: 500 },
        { key: 'd', label: 'D', type: 'int', def: 3, min: 1, max: 500 },
        { key: 'rsiLength', label: 'RSI-Länge', type: 'int', def: 14, min: 1, max: 5000 },
        { key: 'stochLength', label: 'Stochastic-Länge', type: 'int', def: 14, min: 1, max: 5000 },
        P_SOURCE],
      plots: [
        { key: 'k', title: 'K', color: '#2962ff', width: 2 },
        { key: 'd', title: 'D', color: '#ff6d00', width: 2 },
      ],
      levels: function () { return [80, 50, 20]; },
      calc: function (b, p) {
        const r = ta.rsi(ta.source(b, p.source), p.rsiLength);
        const k = ta.sma(ta.stoch(r, p.stochLength), p.k);
        return { k: k, d: ta.sma(k, p.d) };
      },
      label: function (p) { return 'Stoch RSI ' + p.k + ' ' + p.d + ' ' + p.rsiLength + ' ' + p.stochLength + src(p); },
    },
    atr: {
      name: 'ATR', full: 'Average True Range', place: 'pane', format: 'price',
      params: [len(14)],
      plots: [{ key: 'v', title: 'ATR', color: '#ef5350', width: 2 }],
      calc: function (b, p) { return { v: ta.atr(b, p.length) }; },
      label: function (p) { return 'ATR ' + p.length; },
    },
    // Volumenprofil: wird nicht als Serie, sondern auf einer eigenen Canvas gezeichnet (place 'canvas')
    vp: {
      name: 'Volumenprofil', full: 'Volume Profile (sichtbarer Bereich) mit POC und Value Area', place: 'canvas', format: 'price',
      params: [
        { key: 'rows', label: 'Zeilen', type: 'int', def: 24, min: 4, max: 400 },
        { key: 'width', label: 'Breite (% des Charts)', type: 'int', def: 25, min: 5, max: 90 },
        { key: 'va', label: 'Value Area (%)', type: 'int', def: 70, min: 10, max: 100 },
        { key: 'range', label: 'Bereich', type: 'select', options: ['Sichtbar', 'Alle Kerzen'], def: 'Sichtbar' },
        { key: 'side', label: 'Seite', type: 'select', options: ['Rechts', 'Links'], def: 'Rechts' },
      ],
      plots: [
        { key: 'poc', title: 'POC', color: '#ffd600', value: true },
        { key: 'vah', title: 'VAH', color: '#9598a1', value: true },
        { key: 'val', title: 'VAL', color: '#9598a1', value: true },
        { key: 'up', title: 'Kaufvolumen', color: '#26a69a' },
        { key: 'down', title: 'Verkaufsvolumen', color: '#ef5350' },
      ],
      label: function (p) { return 'VP ' + p.rows + (p.range === 'Sichtbar' ? '' : ' alle'); },
    },
  };

  // Volumenprofil-Rechnung liegt in js/ta.js (wird auch vom Zeichenwerkzeug benutzt)
  const volumeProfile = ta.volumeProfile;

  function src(p) { return p.source && p.source !== 'close' ? ' ' + p.source : ''; }

  let api, wrap, legendEl, mainLegend, modal;
  let list = [];   // gespeicherte Instanzen
  let recs = [];   // aktuell dargestellte Instanzen mit Serien
  let hoverIndex = null;
  let expandedId = null;
  let layoutSig = '';

  /* =================== Speicher =================== */
  function defaults(type) {
    const p = {};
    DEFS[type].params.forEach(function (d) { p[d.key] = d.def; });
    return p;
  }

  function cleanParam(def, v) {
    if (def.type === 'select') return def.options.indexOf(v) !== -1 ? v : def.def;
    let n = def.type === 'int' ? parseInt(v, 10) : parseFloat(String(v).replace(',', '.'));
    if (!isFinite(n)) return def.def;
    if (def.min !== undefined) n = Math.max(def.min, n);
    if (def.max !== undefined) n = Math.min(def.max, n);
    return n;
  }

  function sanitize(arr) {
    if (!Array.isArray(arr)) return [];
    return arr.filter(function (x) { return x && DEFS[x.type]; }).map(function (x) {
      const def = DEFS[x.type];
      const params = {};
      def.params.forEach(function (d) { params[d.key] = cleanParam(d, x.params && x.params[d.key] !== undefined ? x.params[d.key] : d.def); });
      const colors = {};
      if (x.colors) def.plots.forEach(function (pl) { if (/^#[0-9a-f]{6}$/i.test(x.colors[pl.key])) colors[pl.key] = x.colors[pl.key]; });
      return { id: String(x.id || newId()), type: x.type, params: params, visible: x.visible !== false, colors: colors };
    });
  }

  function save() { CT.store.set('indicators', list); }
  function newId() { return 'i' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function find(id) { return list.find(function (x) { return x.id === id; }); }
  function colorOf(inst, pl) { return inst.colors[pl.key] || pl.color; }

  /* =================== Serien & Bereiche =================== */
  function priceFormat(def) {
    if (def.format === 'volume') return { type: 'volume' };
    if (def.format === 'fixed2') return { type: 'price', precision: 2, minMove: 0.01 };
    return CT.chart.series.candles.options().priceFormat;
  }

  function removeAll() {
    recs.forEach(function (r) {
      Object.keys(r.series).forEach(function (k) { api.removeSeries(r.series[k]); });
    });
    recs = [];
    while (api.panes().length > 1) api.removePane(api.panes().length - 1);
  }

  /** Alle Indikator-Serien neu aufbauen (nach Hinzufügen, Entfernen, Ein-/Ausschalten, Parameteränderung). */
  function rebuild() {
    removeAll();
    let paneIndex = 1;
    list.forEach(function (inst) {
      if (!inst.visible) return;
      const def = DEFS[inst.type];
      const rec = { inst: inst, def: def, series: {}, pane: def.place === 'pane' ? paneIndex++ : 0, res: null };
      if (def.place === 'canvas') { recs.push(rec); return; } // zeichnet drawCanvas()
      def.plots.forEach(function (pl) {
        const opts = {
          priceLineVisible: false,
          lastValueVisible: true,
          priceFormat: priceFormat(def),
        };
        if (def.place === 'vol') { opts.priceScaleId = 'vol'; opts.lastValueVisible = false; }
        if (def.range) {
          opts.autoscaleInfoProvider = function () { return { priceRange: { minValue: def.range[0], maxValue: def.range[1] } }; };
        }
        let s;
        if (pl.type === 'hist') {
          opts.color = '#26a69a';
          s = api.addSeries(LC.HistogramSeries, opts, rec.pane);
        } else {
          opts.color = colorOf(inst, pl);
          opts.lineWidth = pl.width || 1;
          opts.crosshairMarkerRadius = 3;
          s = api.addSeries(LC.LineSeries, opts, rec.pane);
        }
        rec.series[pl.key] = s;
      });
      if (def.levels) {
        const first = rec.series[def.plots.find(function (pl) { return pl.type !== 'hist'; }).key];
        def.levels(inst.params).forEach(function (v) {
          first.createPriceLine({ price: v, color: '#4a5060', lineWidth: 1, lineStyle: LC.LineStyle.Dashed, axisLabelVisible: false });
        });
      }
      recs.push(rec);
    });
    const panes = api.panes();
    panes.forEach(function (p, i) { p.setStretchFactor(i === 0 ? 1 : SUB_PANE_STRETCH); });
    setAll();
    buildLegends();
  }

  function toPoint(b, v, color) {
    const pt = { time: CT.chart.toChartTime(b.openTime), value: v };
    if (color) pt.color = color;
    return pt;
  }

  /** Alles neu berechnen und komplett setzen (nach neuen Daten). */
  function setAll() {
    const bars = CT.chart.bars;
    canvasDirty = true;
    recs.forEach(function (rec) {
      if (!rec.def.calc) return;
      rec.res = rec.def.calc(bars, rec.inst.params);
      rec.def.plots.forEach(function (pl) {
        const vals = rec.res[pl.key];
        const cols = rec.res.colors && rec.res.colors[pl.key];
        const data = [];
        for (let i = 0; i < bars.length; i++) {
          if (ta.valid(vals[i])) data.push(toPoint(bars[i], vals[i], cols && cols[i]));
        }
        const s = rec.series[pl.key];
        if (rec.def.format === 'price') s.applyOptions({ priceFormat: priceFormat(rec.def) });
        s.setData(data);
      });
    });
    renderValues();
  }

  /** Live-Kerze: neu berechnen, aber nur den letzten Punkt aktualisieren. */
  function tick() {
    const bars = CT.chart.bars;
    const i = bars.length - 1;
    if (i < 0) return;
    canvasDirty = true;
    recs.forEach(function (rec) {
      if (!rec.def.calc) return;
      rec.res = rec.def.calc(bars, rec.inst.params);
      rec.def.plots.forEach(function (pl) {
        const v = rec.res[pl.key][i];
        if (!ta.valid(v)) return;
        const cols = rec.res.colors && rec.res.colors[pl.key];
        rec.series[pl.key].update(toPoint(bars[i], v, cols && cols[i]));
      });
    });
    if (hoverIndex === null) renderValues();
  }

  /* =================== Legende =================== */
  const ICONS = {
    eye: '<svg viewBox="0 0 24 24"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
    eyeOff: '<svg viewBox="0 0 24 24"><path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3 3.8M6.6 6.6C3.8 8.4 2 12 2 12s3.5 7 10 7c1.9 0 3.6-.6 5-1.4"/></svg>',
    gear: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
    close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  };

  function legendRow(inst) {
    const def = DEFS[inst.type];
    const row = document.createElement('div');
    row.className = 'il-row' + (inst.visible ? '' : ' off');
    row.dataset.id = inst.id;
    let html = '<span class="il-name"></span><span class="il-vals">';
    def.plots.forEach(function (pl) {
      if (def.place === 'canvas' && !pl.value) return; // nur Farbe, kein Wert in der Legende
      const c = pl.fixedColors ? '#8a90a0' : colorOf(inst, pl);
      html += '<span class="il-v" data-plot="' + pl.key + '" style="color:' + c + '"></span>';
    });
    html += '</span><span class="il-btns">' +
      '<button data-act="toggle" title="' + (inst.visible ? 'Ausblenden' : 'Einblenden') + '">' + (inst.visible ? ICONS.eye : ICONS.eyeOff) + '</button>' +
      '<button data-act="edit" title="Einstellungen">' + ICONS.gear + '</button>' +
      '<button data-act="remove" title="Entfernen">' + ICONS.close + '</button></span>';
    row.innerHTML = html;
    row.querySelector('.il-name').textContent = def.label(inst.params);
    return row;
  }

  function buildLegends() {
    mainLegend.innerHTML = '';
    wrap.querySelectorAll('.pane-legend').forEach(function (el) { el.remove(); });
    list.forEach(function (inst) {
      const rec = recs.find(function (r) { return r.inst === inst; });
      const row = legendRow(inst);
      if (rec && rec.pane > 0) {
        const box = document.createElement('div');
        box.className = 'pane-legend ind-legend';
        box.dataset.pane = rec.pane;
        box.appendChild(row);
        wrap.appendChild(box);
        rec.legendBox = box;
      } else {
        mainLegend.appendChild(row);
      }
      if (rec) rec.row = row;
    });
    layoutSig = '';
    layoutLegends();
    renderValues();
  }

  function fmtValue(def, v) {
    if (!ta.valid(v)) return '–';
    if (def.format === 'volume') return new Intl.NumberFormat('de-DE', { notation: 'compact', maximumFractionDigits: 2 }).format(v);
    if (def.format === 'fixed2') return v.toFixed(2);
    return CT.chart.formatPrice(v);
  }

  function renderValues() {
    const n = CT.chart.bars.length;
    const i = hoverIndex !== null && hoverIndex >= 0 && hoverIndex < n ? hoverIndex : n - 1;
    recs.forEach(function (rec) {
      if (!rec.row || !rec.res) return;
      rec.def.plots.forEach(function (pl) {
        const el = rec.row.querySelector('[data-plot="' + pl.key + '"]');
        if (!el) return;
        const arr = rec.res[pl.key];
        const v = Array.isArray(arr) ? arr[i] : arr; // Canvas-Indikatoren liefern einzelne Werte
        el.textContent = (rec.def.place === 'canvas' ? pl.title + ' ' : '') + fmtValue(rec.def, v);
        if (pl.fixedColors && rec.res.colors) el.style.color = rec.res.colors[pl.key][i] || '#8a90a0';
      });
    });
  }

  /** Legenden an die Bereiche anpassen (Höhen ändern sich beim Ziehen der Trennlinien oder bei Größenänderung). */
  function layoutLegends() {
    const panes = api.panes();
    const heights = panes.map(function (p) { return p.getHeight(); });
    const sig = heights.join(',') + '|' + legendEl.offsetHeight + '|' + legendEl.offsetTop;
    if (sig !== layoutSig) {
      layoutSig = sig;
      mainLegend.style.top = (legendEl.offsetTop + legendEl.offsetHeight + 4) + 'px';
      const chartTop = document.getElementById('chart').offsetTop;
      recs.forEach(function (rec) {
        if (!rec.legendBox) return;
        let top = chartTop;
        for (let k = 0; k < rec.pane; k++) top += heights[k] + 1; // 1 px Trennlinie
        rec.legendBox.style.top = (top + 4) + 'px';
      });
    }
  }

  /* =================== Canvas-Indikatoren (Volumenprofil) =================== */
  let vpCanvas, vpCtx;
  let canvasDirty = true;
  let canvasSig = '';

  function rgba(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return 'rgba(' + (n >> 16 & 255) + ',' + (n >> 8 & 255) + ',' + (n & 255) + ',' + a + ')';
  }

  function drawCanvas() {
    const chartEl = document.getElementById('chart');
    const W = chartEl.clientWidth;
    const H = chartEl.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    if (vpCanvas.width !== Math.round(W * dpr) || vpCanvas.height !== Math.round(H * dpr)) {
      vpCanvas.width = Math.round(W * dpr);
      vpCanvas.height = Math.round(H * dpr);
      vpCanvas.style.width = W + 'px';
      vpCanvas.style.height = H + 'px';
    }
    vpCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    vpCtx.clearRect(0, 0, W, H);
    const bars = CT.chart.bars;
    const n = bars.length;
    if (!n) return;
    const paneW = W - api.priceScale('right').width();
    const paneH = api.panes()[0].getHeight();
    const candles = CT.chart.series.candles;
    const range = api.timeScale().getVisibleLogicalRange();
    vpCtx.save();
    vpCtx.beginPath();
    vpCtx.rect(0, 0, paneW, paneH);
    vpCtx.clip();
    recs.forEach(function (rec) {
      if (rec.def.place !== 'canvas') return;
      const p = rec.inst.params;
      let from = 0;
      let to = n - 1;
      if (p.range === 'Sichtbar' && range) {
        from = Math.max(0, Math.floor(range.from));
        to = Math.min(n - 1, Math.ceil(range.to));
      }
      if (to < from) { rec.res = null; return; }
      const vp = volumeProfile(bars, from, to, p.rows, p.va);
      if (!vp) { rec.res = null; return; }
      rec.res = { poc: vp.pocPrice, vah: vp.vah, val: vp.val };
      const inst = rec.inst;
      const col = {};
      rec.def.plots.forEach(function (pl) { col[pl.key] = colorOf(inst, pl); });
      const maxW = paneW * p.width / 100;
      const right = p.side !== 'Links';
      for (let r = 0; r < p.rows; r++) {
        if (!vp.total[r]) continue;
        const yTop = candles.priceToCoordinate(vp.lo + (r + 1) * vp.step);
        const yBot = candles.priceToCoordinate(vp.lo + r * vp.step);
        if (yTop === null || yBot === null) continue;
        const y = Math.min(yTop, yBot);
        const h = Math.max(1, Math.abs(yBot - yTop) - 1);
        const inVA = r >= vp.vaLow && r <= vp.vaHigh;
        const a = inVA ? 0.55 : 0.22;
        const wUp = maxW * vp.up[r] / vp.max;
        const wDn = maxW * vp.down[r] / vp.max;
        vpCtx.fillStyle = rgba(col.up, a);
        vpCtx.fillRect(right ? paneW - wUp : 0, y, wUp, h);
        vpCtx.fillStyle = rgba(col.down, a);
        vpCtx.fillRect(right ? paneW - wUp - wDn : wUp, y, wDn, h);
      }
      // POC über den ganzen Bereich, VAH/VAL über die Profilbreite
      const line = function (price, color, dash, x0, x1, width) {
        const y = candles.priceToCoordinate(price);
        if (y === null) return;
        vpCtx.strokeStyle = color;
        vpCtx.lineWidth = width;
        vpCtx.setLineDash(dash);
        vpCtx.beginPath();
        vpCtx.moveTo(x0, Math.round(y) + 0.5);
        vpCtx.lineTo(x1, Math.round(y) + 0.5);
        vpCtx.stroke();
      };
      const x0 = right ? paneW - maxW : 0;
      const x1 = right ? paneW : maxW;
      const fromX = api.timeScale().logicalToCoordinate(from);
      line(vp.pocPrice, col.poc, [], Math.max(0, fromX === null ? 0 : fromX), paneW, 1.5);
      line(vp.vah, col.vah, [3, 3], x0, x1, 1);
      line(vp.val, col.val, [3, 3], x0, x1, 1);
    });
    vpCtx.restore();
    vpCtx.setLineDash([]);
    renderValues();
  }

  /** Ein Loop für alles, was laufend nachgeführt werden muss: Legendenpositionen und Canvas-Indikatoren. */
  function frame() {
    layoutLegends();
    if (recs.some(function (r) { return r.def.place === 'canvas'; })) {
      const c = CT.chart.series.candles;
      const bars = CT.chart.bars;
      const last = bars[bars.length - 1];
      const range = api.timeScale().getVisibleLogicalRange();
      const sig = [
        range ? range.from.toFixed(2) + ':' + range.to.toFixed(2) : '', bars.length,
        last ? c.priceToCoordinate(last.close) : 0, last ? c.priceToCoordinate(last.close * 1.2) : 0,
        api.panes()[0].getHeight(), document.getElementById('chart').clientWidth, api.priceScale('right').width(),
      ].join('|');
      if (canvasDirty || sig !== canvasSig) {
        canvasSig = sig;
        canvasDirty = false;
        drawCanvas();
      }
    } else if (canvasSig !== 'empty') {
      canvasSig = 'empty';
      drawCanvas();
    }
    requestAnimationFrame(frame);
  }

  function onLegendClick(e) {
    const btn = e.target.closest('button[data-act]');
    const row = e.target.closest('.il-row');
    if (!btn || !row) return;
    e.stopPropagation();
    const inst = find(row.dataset.id);
    if (!inst) return;
    if (btn.dataset.act === 'toggle') { inst.visible = !inst.visible; save(); rebuild(); }
    else if (btn.dataset.act === 'remove') remove(inst.id);
    else if (btn.dataset.act === 'edit') openModal(inst.id);
  }

  /* =================== Verwaltung =================== */
  function add(type) {
    const inst = { id: newId(), type: type, params: defaults(type), visible: true, colors: {} };
    list.push(inst);
    save();
    rebuild();
    return inst;
  }

  function remove(id) {
    list = list.filter(function (x) { return x.id !== id; });
    if (expandedId === id) expandedId = null;
    save();
    rebuild();
    if (!modal.hidden) renderActive();
  }

  /* =================== Einstellungsfenster =================== */
  function openModal(focusId) {
    modal.hidden = false;
    expandedId = focusId || null;
    document.getElementById('indSearch').value = '';
    renderCatalog();
    renderActive();
    if (focusId) {
      const el = modal.querySelector('.ind-item[data-id="' + focusId + '"]');
      if (el) el.scrollIntoView({ block: 'nearest' });
    } else {
      document.getElementById('indSearch').focus();
    }
  }

  function closeModal() { modal.hidden = true; }

  function placeLabel(def) {
    return { main: 'Im Chart', vol: 'Volumen', pane: 'Eigener Bereich', canvas: 'Im Chart' }[def.place];
  }

  function renderCatalog() {
    const q = document.getElementById('indSearch').value.trim().toLowerCase();
    const ul = document.getElementById('indCatalog');
    ul.innerHTML = '';
    Object.keys(DEFS).forEach(function (type) {
      const def = DEFS[type];
      if (q && (def.name + ' ' + def.full).toLowerCase().indexOf(q) === -1) return;
      const li = document.createElement('li');
      li.innerHTML = '<span class="ic-name"></span><span class="ic-full"></span><span class="ic-tag"></span><span class="ic-add">+</span>';
      li.children[0].textContent = def.name;
      li.children[1].textContent = def.full;
      li.children[2].textContent = placeLabel(def);
      li.title = def.full + ' hinzufügen';
      li.addEventListener('click', function () {
        const inst = add(type);
        expandedId = inst.id;
        renderActive();
        CT.toast(def.name + ' hinzugefügt');
      });
      ul.appendChild(li);
    });
    if (!ul.childElementCount) ul.innerHTML = '<li class="ic-empty">Kein Indikator gefunden</li>';
  }

  function renderActive() {
    const box = document.getElementById('indActive');
    box.innerHTML = '';
    if (!list.length) {
      box.innerHTML = '<p class="ind-empty">Noch keine Indikatoren. Oben einen auswählen.</p>';
      return;
    }
    list.forEach(function (inst) {
      const def = DEFS[inst.type];
      const item = document.createElement('div');
      item.className = 'ind-item' + (inst.id === expandedId ? ' open' : '');
      item.dataset.id = inst.id;
      item.innerHTML =
        '<div class="ind-head">' +
        '<label class="ind-switch" title="Ein/Aus"><input type="checkbox"' + (inst.visible ? ' checked' : '') + '><span></span></label>' +
        '<button class="ind-title"></button>' +
        '<button class="icon-btn" data-act="edit" title="Einstellungen">' + ICONS.gear + '</button>' +
        '<button class="icon-btn" data-act="remove" title="Entfernen">' + ICONS.close + '</button>' +
        '</div>';
      item.querySelector('.ind-title').textContent = def.label(inst.params);
      item.querySelector('input[type=checkbox]').addEventListener('change', function (e) {
        inst.visible = e.target.checked;
        save();
        rebuild();
      });
      const toggleOpen = function () {
        expandedId = expandedId === inst.id ? null : inst.id;
        renderActive();
      };
      item.querySelector('.ind-title').addEventListener('click', toggleOpen);
      item.querySelector('[data-act=edit]').addEventListener('click', toggleOpen);
      item.querySelector('[data-act=remove]').addEventListener('click', function () { remove(inst.id); });
      if (inst.id === expandedId) item.appendChild(buildForm(inst, item));
      box.appendChild(item);
    });
  }

  function buildForm(inst, item) {
    const def = DEFS[inst.type];
    const form = document.createElement('div');
    form.className = 'ind-form';
    let timer = null;
    const apply = function () {
      clearTimeout(timer);
      timer = setTimeout(function () {
        save();
        rebuild();
        item.querySelector('.ind-title').textContent = def.label(inst.params);
      }, 250);
    };

    def.params.forEach(function (pd) {
      const row = document.createElement('label');
      row.className = 'ind-field';
      row.innerHTML = '<span></span>';
      row.firstChild.textContent = pd.label;
      let input;
      if (pd.type === 'select') {
        input = document.createElement('select');
        pd.options.forEach(function (o) {
          const opt = document.createElement('option');
          opt.value = o;
          opt.textContent = o;
          input.appendChild(opt);
        });
        input.value = inst.params[pd.key];
        input.addEventListener('change', function () { inst.params[pd.key] = cleanParam(pd, input.value); apply(); });
      } else {
        input = document.createElement('input');
        input.type = 'number';
        input.inputMode = pd.type === 'int' ? 'numeric' : 'decimal';
        if (pd.min !== undefined) input.min = pd.min;
        if (pd.max !== undefined) input.max = pd.max;
        input.step = pd.step || 1;
        input.value = inst.params[pd.key];
        input.addEventListener('input', function () {
          if (input.value === '') return;
          inst.params[pd.key] = cleanParam(pd, input.value);
          apply();
        });
        input.addEventListener('blur', function () { input.value = inst.params[pd.key]; });
      }
      row.appendChild(input);
      form.appendChild(row);
    });

    def.plots.forEach(function (pl) {
      if (pl.fixedColors) return;
      const row = document.createElement('label');
      row.className = 'ind-field';
      row.innerHTML = '<span></span><input type="color">';
      row.firstChild.textContent = 'Farbe ' + pl.title;
      const input = row.querySelector('input');
      input.value = colorOf(inst, pl);
      input.addEventListener('input', function () {
        inst.colors[pl.key] = input.value;
        const rec = recs.find(function (r) { return r.inst === inst; });
        if (rec) rec.series[pl.key].applyOptions({ color: input.value });
      });
      input.addEventListener('change', function () { save(); buildLegends(); });
      form.appendChild(row);
    });

    const reset = document.createElement('button');
    reset.className = 'ind-reset';
    reset.textContent = 'Standardwerte';
    reset.addEventListener('click', function () {
      inst.params = defaults(inst.type);
      inst.colors = {};
      save();
      rebuild();
      renderActive();
    });
    form.appendChild(reset);
    return form;
  }

  /* =================== Start =================== */
  function init(wrapEl) {
    api = CT.chart.api;
    wrap = wrapEl;
    legendEl = document.getElementById('legend');
    modal = document.getElementById('indModal');

    // Canvas für das Volumenprofil: über dem Chart, unter der Zeichen-Ebene
    vpCanvas = document.createElement('canvas');
    vpCanvas.className = 'vp-layer';
    wrap.insertBefore(vpCanvas, wrap.querySelector('.draw-layer'));
    vpCtx = vpCanvas.getContext('2d');

    mainLegend = document.createElement('div');
    mainLegend.className = 'ind-legend main-ind-legend';
    wrap.appendChild(mainLegend);
    wrap.addEventListener('click', onLegendClick);
    // Klicks auf die Legende nicht als Zeichen-/Chart-Eingabe behandeln
    wrap.addEventListener('pointerdown', function (e) { if (e.target.closest('.il-btns')) e.stopPropagation(); }, true);

    document.getElementById('indBtn').addEventListener('click', function () { openModal(); });
    document.getElementById('indClose').addEventListener('click', closeModal);
    modal.addEventListener('mousedown', function (e) { if (e.target === modal) closeModal(); });
    document.getElementById('indSearch').addEventListener('input', renderCatalog);
    document.getElementById('indSearch').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        const first = document.querySelector('#indCatalog li:not(.ic-empty)');
        if (first) first.click();
      }
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !modal.hidden) { closeModal(); return; }
      const t = e.target;
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable) return;
      if (e.key === '/' && !document.querySelector('.modal:not([hidden])')) { e.preventDefault(); openModal(); }
    });

    api.subscribeCrosshairMove(function (p) {
      hoverIndex = p && p.time !== undefined && p.logical !== undefined ? Math.round(p.logical) : null;
      renderValues();
    });
    CT.chart.on('data', setAll);
    CT.chart.on('tick', tick);

    list = sanitize(CT.store.get('indicators', []));
    rebuild();
    requestAnimationFrame(frame);
  }

  return {
    init: init,
    add: add,
    remove: remove,
    open: openModal,
    DEFS: DEFS,
    get list() { return list; },
    get recs() { return recs; },
  };
})();
