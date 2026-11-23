/* Zeichenwerkzeuge – unbegrenzt viele Zeichnungen pro Symbol, sichtbar auf allen Zeitrahmen.

   Aufbau:
   - Eine eigene Canvas liegt über dem Chart (pointer-events: none). Maus/Touch werden auf
     .chart-wrap in der Capture-Phase abgefangen, bevor Lightweight Charts sie bekommt.
   - Jede Zeichnung speichert Punkte als { t: UTC-Millisekunden, p: Preis }. Für die Anzeige wird
     t über die Kerzen des aktuellen Zeitrahmens in einen (gebrochenen) Kerzenindex umgerechnet –
     so passt eine auf 1D gezeichnete Linie auch auf 1h. Außerhalb der Daten wird mit der
     Kerzenlänge weitergerechnet (Zeichnen in die Zukunft funktioniert).
   - Gespeichert wird pro Symbol unter "ct.drawings.<SYMBOL>".
   - Rückgängig/Wiederholen über Schnappschüsse (JSON) der Zeichnungen des aktuellen Symbols. */
window.CT = window.CT || {};

CT.drawings = (function () {
  const TOOLS = {
    cursor: { name: 'Fadenkreuz', pts: 0 },
    trend: { name: 'Trendlinie', pts: 2 },
    ray: { name: 'Strahl', pts: 2 },
    hline: { name: 'Horizontale Linie', pts: 1 },
    vline: { name: 'Vertikale Linie', pts: 1 },
    rect: { name: 'Rechteck', pts: 2 },
    text: { name: 'Text', pts: 1 },
    fib: { name: 'Fibonacci', pts: 2 },
    measure: { name: 'Messen', pts: 2 },
  };
  const SAVED_TYPES = ['trend', 'ray', 'hline', 'vline', 'rect', 'text', 'fib'];
  const DEFAULT_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 0.886, 1];
  const DEFAULT_COLORS = {
    trend: '#2962ff', ray: '#2962ff', hline: '#f0b90b', vline: '#9598a1',
    rect: '#9c27b0', text: '#d1d4dc', fib: '#26a69a',
  };
  const SWATCHES = ['#2962ff', '#26a69a', '#ef5350', '#f0b90b', '#ff9800', '#9c27b0', '#00bcd4', '#d1d4dc'];
  const INTERVAL_MS = {
    '1m': 6e4, '3m': 18e4, '5m': 3e5, '15m': 9e5, '30m': 18e5, '1h': 36e5, '2h': 72e5, '4h': 144e5,
    '6h': 216e5, '8h': 288e5, '12h': 432e5, '1d': 864e5, '3d': 2592e5, '1w': 6048e5, '1M': 2629746e3,
  };
  const TEXT_SIZES = [12, 14, 18, 24];
  const HISTORY_MAX = 500;

  let wrap, chartEl, canvas, ctx, propsEl;
  let symbol = null;
  let items = [];
  let selectedId = null;
  let tool = 'cursor';
  let hidden = CT.store.get('drawHidden', false);
  let settings = loadSettings();

  // Interaktion
  let draft = null;   // Zeichnung, die gerade gesetzt wird
  let phase = null;   // 'down1' | 'down' | 'second' | 'up2'
  let downPos = null;
  let measure = null; // Messung (wird nicht gespeichert)
  let drag = null;
  let pointerType = 'mouse';
  let locked = false;

  // Verlauf
  let undoStack = [];
  let redoStack = [];
  let snapshot = '[]';

  // Neuzeichnen
  let dirty = true;
  let lastSig = '';

  /* =================== Einstellungen & Speicher =================== */
  function loadSettings() {
    const s = CT.store.get('drawSettings', {}) || {};
    return {
      fibLevels: Array.isArray(s.fibLevels) && s.fibLevels.length ? s.fibLevels.filter(isFinite) : DEFAULT_LEVELS.slice(),
      colors: s.colors && typeof s.colors === 'object' ? s.colors : {},
    };
  }
  function saveSettings() { CT.store.set('drawSettings', settings); }

  function sanitize(list) {
    if (!Array.isArray(list)) return [];
    return list.filter(function (d) {
      return d && SAVED_TYPES.indexOf(d.type) !== -1 && Array.isArray(d.points) &&
        d.points.length === TOOLS[d.type].pts &&
        d.points.every(function (p) { return p && isFinite(p.t) && isFinite(p.p); });
    }).map(function (d) {
      return {
        id: String(d.id || newId()),
        type: d.type,
        points: d.points.map(function (p) { return { t: +p.t, p: +p.p }; }),
        color: /^#[0-9a-f]{6}$/i.test(d.color) ? d.color : DEFAULT_COLORS[d.type],
        width: [1, 2, 3, 4].indexOf(d.width) !== -1 ? d.width : 1,
        dash: !!d.dash,
        text: d.type === 'text' ? String(d.text || '') : undefined,
        levels: d.type === 'fib' && Array.isArray(d.levels) ? d.levels.filter(isFinite).map(Number) : undefined,
      };
    });
  }

  function save() {
    if (symbol) CT.store.set('drawings.' + symbol, items);
  }

  function newId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  /** Symbol wechseln: Zeichnungen laden, Verlauf zurücksetzen. */
  function setSymbol(sym) {
    if (sym === symbol) return;
    cancelDraft();
    measure = null;
    symbol = sym;
    items = sanitize(CT.store.get('drawings.' + sym, []));
    selectedId = null;
    undoStack = [];
    redoStack = [];
    snapshot = JSON.stringify(items);
    updateProps();
    updateHistoryButtons();
    dirty = true;
  }

  /* =================== Verlauf =================== */
  function commit() {
    const now = JSON.stringify(items);
    if (now === snapshot) return;
    undoStack.push(snapshot);
    if (undoStack.length > HISTORY_MAX) undoStack.shift();
    redoStack = [];
    snapshot = now;
    save();
    updateHistoryButtons();
  }

  function restore(json) {
    items = sanitize(JSON.parse(json));
    snapshot = json;
    if (!items.some(function (d) { return d.id === selectedId; })) selectedId = null;
    save();
    updateProps();
    updateHistoryButtons();
    dirty = true;
  }

  function undo() {
    cancelDraft();
    if (!undoStack.length) return;
    redoStack.push(snapshot);
    restore(undoStack.pop());
  }

  function redo() {
    cancelDraft();
    if (!redoStack.length) return;
    undoStack.push(snapshot);
    restore(redoStack.pop());
  }

  /* =================== Koordinaten =================== */
  function bars() { return CT.chart.bars; }
  function ivMs() { return INTERVAL_MS[CT.chart.current.interval] || 36e5; }

  function timeToLogical(t) {
    const b = bars();
    const n = b.length;
    if (!n) return null;
    if (t <= b[0].openTime) return (t - b[0].openTime) / ivMs();
    if (t >= b[n - 1].openTime) return n - 1 + (t - b[n - 1].openTime) / ivMs();
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (b[m].openTime <= t) lo = m; else hi = m;
    }
    return lo + (t - b[lo].openTime) / (b[hi].openTime - b[lo].openTime);
  }

  function logicalToTime(l) {
    const b = bars();
    const n = b.length;
    if (!n) return null;
    if (l <= 0) return b[0].openTime + l * ivMs();
    if (l >= n - 1) return b[n - 1].openTime + (l - (n - 1)) * ivMs();
    const i = Math.floor(l);
    return b[i].openTime + (l - i) * (b[i + 1].openTime - b[i].openTime);
  }

  // logicalToCoordinate kennt nur ganze Kerzenindizes (gebrochene ergeben 0) – daher selbst interpolieren.
  function xOf(t) {
    const l = timeToLogical(t);
    if (l === null || !isFinite(l)) return null;
    const ts = CT.chart.api.timeScale();
    const i = Math.floor(l);
    const x0 = ts.logicalToCoordinate(i);
    if (x0 === null) return null;
    const f = l - i;
    if (f < 1e-9) return x0;
    const x1 = ts.logicalToCoordinate(i + 1);
    return x1 === null ? x0 : x0 + (x1 - x0) * f;
  }
  function yOf(p) { return CT.chart.series.candles.priceToCoordinate(p); }
  function logicalAt(x) { return CT.chart.api.timeScale().coordinateToLogical(x); }
  function priceAt(y) { return CT.chart.series.candles.coordinateToPrice(y); }

  /** Bildschirmposition → Punkt, Zeit auf die nächste Kerze eingerastet. */
  function pointAt(pos) {
    const l = logicalAt(pos.x);
    const p = priceAt(pos.y);
    if (l === null || p === null || !isFinite(p)) return null;
    return { t: Math.round(logicalToTime(Math.round(l))), p: p };
  }

  function paneSize() {
    const api = CT.chart.api;
    return {
      w: chartEl.clientWidth - api.priceScale('right').width(),
      h: chartEl.clientHeight - api.timeScale().height(),
    };
  }

  function screenPoints(d) {
    const out = [];
    for (let i = 0; i < d.points.length; i++) {
      const x = xOf(d.points[i].t);
      const y = yOf(d.points[i].p);
      if (x === null || y === null) return null;
      out.push({ x: x, y: y });
    }
    return out;
  }

  function extend(a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (!len) return b;
    const k = 20000 / len;
    return { x: b.x + dx * k, y: b.y + dy * k };
  }

  function fibLevels(d) { return d.levels && d.levels.length ? d.levels : settings.fibLevels; }
  function fibPrice(d, lv) { return d.points[1].p + (d.points[0].p - d.points[1].p) * lv; }

  /* =================== Zeichnen =================== */
  function rgba(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return 'rgba(' + (n >> 16 & 255) + ',' + (n >> 8 & 255) + ',' + (n & 255) + ',' + a + ')';
  }

  function line(a, b) {
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }

  function label(text, x, y, bg, align) {
    ctx.font = '11px -apple-system, "Segoe UI", Roboto, sans-serif';
    const w = ctx.measureText(text).width + 8;
    const left = align === 'right' ? x - w : (align === 'center' ? x - w / 2 : x);
    ctx.fillStyle = bg;
    ctx.fillRect(left, y - 9, w, 18);
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, left + 4, y);
  }

  function textFont(d) {
    return (TEXT_SIZES[d.width - 1] || 14) + 'px -apple-system, "Segoe UI", Roboto, sans-serif';
  }

  function textBox(d, P) {
    ctx.font = textFont(d);
    const size = TEXT_SIZES[d.width - 1] || 14;
    const lines = d.text.split('\n');
    let w = 0;
    lines.forEach(function (l) { w = Math.max(w, ctx.measureText(l).width); });
    return { x: P[0].x, y: P[0].y - size, w: w, h: lines.length * size * 1.25, size: size, lines: lines };
  }

  function drawItem(d, selected, pane) {
    const P = screenPoints(d);
    if (!P) return;
    const fmt = CT.chart.formatPrice;
    ctx.strokeStyle = d.color;
    ctx.lineWidth = d.width;
    ctx.setLineDash(d.dash ? [6, 4] : []);

    switch (d.type) {
      case 'trend':
        line(P[0], P[1]);
        break;
      case 'ray':
        line(P[0], extend(P[0], P[1]));
        break;
      case 'hline':
        line({ x: 0, y: P[0].y }, { x: pane.w, y: P[0].y });
        ctx.setLineDash([]);
        label(fmt(d.points[0].p), pane.w - 2, P[0].y, d.color, 'right');
        break;
      case 'vline':
        line({ x: P[0].x, y: 0 }, { x: P[0].x, y: pane.h });
        break;
      case 'rect': {
        const x = Math.min(P[0].x, P[1].x);
        const y = Math.min(P[0].y, P[1].y);
        const w = Math.abs(P[1].x - P[0].x);
        const h = Math.abs(P[1].y - P[0].y);
        ctx.fillStyle = rgba(d.color, 0.15);
        ctx.fillRect(x, y, w, h);
        ctx.strokeRect(x, y, w, h);
        break;
      }
      case 'text': {
        const box = textBox(d, P);
        ctx.fillStyle = d.color;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        box.lines.forEach(function (l, i) { ctx.fillText(l, box.x, P[0].y + i * box.size * 1.25); });
        if (selected) {
          ctx.setLineDash([3, 3]);
          ctx.lineWidth = 1;
          ctx.strokeRect(box.x - 3, box.y - 2, box.w + 6, box.h + 4);
        }
        break;
      }
      case 'fib': {
        const x1 = Math.min(P[0].x, P[1].x);
        const x2 = Math.max(P[0].x, P[1].x);
        ctx.save();
        ctx.setLineDash([4, 4]);
        ctx.lineWidth = 1;
        ctx.strokeStyle = rgba(d.color, 0.6);
        line(P[0], P[1]);
        ctx.restore();
        ctx.font = '11px -apple-system, "Segoe UI", Roboto, sans-serif';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        fibLevels(d).forEach(function (lv) {
          const price = fibPrice(d, lv);
          const y = yOf(price);
          if (y === null) return;
          line({ x: x1, y: y }, { x: x2, y: y });
          ctx.fillStyle = d.color;
          ctx.fillText(String(lv) + ' (' + fmt(price) + ')', x1 - 6, y);
        });
        break;
      }
    }
    ctx.setLineDash([]);
    if (selected) handles(P);
  }

  function handles(P) {
    const r = pointerType === 'touch' ? 6 : 4.5;
    P.forEach(function (p) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fillStyle = '#0e1016';
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#2962ff';
      ctx.stroke();
    });
  }

  function duration(ms) {
    const neg = ms < 0;
    let m = Math.round(Math.abs(ms) / 60000);
    const d = Math.floor(m / 1440); m -= d * 1440;
    const h = Math.floor(m / 60); m -= h * 60;
    const parts = [];
    if (d) parts.push(d + 'T');
    if (h) parts.push(h + 'h');
    if (m && !d) parts.push(m + 'm');
    return (neg ? '−' : '') + (parts.join(' ') || '0m');
  }

  function drawMeasure(d) {
    const P = screenPoints(d);
    if (!P) return;
    const a = d.points[0];
    const b = d.points[1];
    const up = b.p >= a.p;
    const col = up ? '#26a69a' : '#ef5350';
    const x = Math.min(P[0].x, P[1].x);
    const y = Math.min(P[0].y, P[1].y);
    const w = Math.abs(P[1].x - P[0].x);
    const h = Math.abs(P[1].y - P[0].y);
    ctx.fillStyle = rgba(col, 0.18);
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = col;
    ctx.lineWidth = 1;
    const midX = (P[0].x + P[1].x) / 2;
    const midY = (P[0].y + P[1].y) / 2;
    line({ x: midX, y: P[0].y }, { x: midX, y: P[1].y });
    line({ x: P[0].x, y: midY }, { x: P[1].x, y: midY });
    const diff = b.p - a.p;
    const pct = a.p ? diff / a.p * 100 : 0;
    const nBars = Math.round(timeToLogical(b.t) - timeToLogical(a.t));
    const sign = diff >= 0 ? '+' : '';
    const fmt = CT.chart.formatPrice;
    const ly = (up ? y - 32 : y + h + 14);
    label(sign + fmt(diff) + ' (' + sign + pct.toFixed(2) + '%)', midX, ly, col, 'center');
    label(nBars + ' Kerzen · ' + duration(b.t - a.t), midX, ly + 19, col, 'center');
  }

  function draw() {
    const W = chartEl.clientWidth;
    const H = chartEl.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      canvas.style.width = W + 'px';
      canvas.style.height = H + 'px';
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (!bars().length) return;
    const pane = paneSize();
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, pane.w, pane.h);
    ctx.clip();
    if (!hidden) {
      items.forEach(function (d) { drawItem(d, d.id === selectedId, pane); });
    }
    if (draft) {
      if (draft.type === 'measure') drawMeasure(draft);
      else drawItem(draft, true, pane);
    }
    if (measure) drawMeasure(measure);
    ctx.restore();
  }

  /** Zeichnet nur neu, wenn sich Ansicht, Daten oder Zeichnungen geändert haben. */
  function loop() {
    if (chartEl && CT.chart.api) {
      const api = CT.chart.api;
      const ts = api.timeScale();
      const b = bars();
      const last = b[b.length - 1];
      const c = CT.chart.series.candles;
      const sig = [
        chartEl.clientWidth, chartEl.clientHeight, b.length, b.length ? b[0].openTime : 0,
        ts.logicalToCoordinate(0), ts.logicalToCoordinate(1),
        last ? c.priceToCoordinate(last.close) : 0, last ? c.priceToCoordinate(last.close * 1.5) : 0,
        api.priceScale('right').width(),
      ].join('|');
      if (dirty || sig !== lastSig) {
        lastSig = sig;
        dirty = false;
        draw();
      }
    }
    requestAnimationFrame(loop);
  }

  /* =================== Treffer =================== */
  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

  function distSeg(p, a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    let t = len2 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
  }

  function hitBody(d, P, pos, tol) {
    switch (d.type) {
      case 'trend': return distSeg(pos, P[0], P[1]) <= tol;
      case 'ray': return distSeg(pos, P[0], extend(P[0], P[1])) <= tol;
      case 'hline': return Math.abs(pos.y - P[0].y) <= tol;
      case 'vline': return Math.abs(pos.x - P[0].x) <= tol;
      case 'rect':
        return pos.x >= Math.min(P[0].x, P[1].x) - tol && pos.x <= Math.max(P[0].x, P[1].x) + tol &&
          pos.y >= Math.min(P[0].y, P[1].y) - tol && pos.y <= Math.max(P[0].y, P[1].y) + tol;
      case 'text': {
        const box = textBox(d, P);
        return pos.x >= box.x - tol && pos.x <= box.x + box.w + tol && pos.y >= box.y - tol && pos.y <= box.y + box.h + tol;
      }
      case 'fib': {
        const ys = fibLevels(d).map(function (lv) { return yOf(fibPrice(d, lv)); }).filter(function (y) { return y !== null; });
        if (!ys.length) return false;
        return pos.x >= Math.min(P[0].x, P[1].x) - tol && pos.x <= Math.max(P[0].x, P[1].x) + tol &&
          pos.y >= Math.min.apply(null, ys) - tol && pos.y <= Math.max.apply(null, ys) + tol;
      }
    }
    return false;
  }

  function hitTest(pos) {
    if (hidden) return null;
    const tol = pointerType === 'touch' ? 12 : 6;
    const handleR = pointerType === 'touch' ? 16 : 8;
    // Ausgewählte Zeichnung zuerst, dann von oben (zuletzt gezeichnet) nach unten
    const order = items.slice().reverse().sort(function (a, b) {
      return (b.id === selectedId) - (a.id === selectedId);
    });
    for (let i = 0; i < order.length; i++) {
      const d = order[i];
      const P = screenPoints(d);
      if (!P) continue;
      for (let k = 0; k < P.length; k++) {
        if (dist(pos, P[k]) <= handleR) return { d: d, handle: k };
      }
      if (hitBody(d, P, pos, tol)) return { d: d, handle: -1 };
    }
    return null;
  }

  /* =================== Maus & Touch =================== */
  function local(e) {
    const r = chartEl.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function inPane(pos) {
    const s = paneSize();
    return pos.x >= 0 && pos.y >= 0 && pos.x < s.w && pos.y < s.h;
  }

  /** Verhindert, dass der Chart verschoben/gezoomt wird, solange gezeichnet oder gezogen wird. */
  function lock(on) {
    if (locked === on) return;
    locked = on;
    CT.chart.api.applyOptions({ handleScroll: !on, handleScale: !on });
  }

  function newItem(type, points) {
    return {
      id: newId(),
      type: type,
      points: points,
      color: settings.colors[type] || DEFAULT_COLORS[type] || '#2962ff',
      width: type === 'text' ? 2 : 1,
      dash: false,
    };
  }

  function onDown(e) {
    if (e.button !== 0 || !bars().length) return;
    pointerType = e.pointerType || 'mouse';
    const pos = local(e);
    if (!inPane(pos)) return;

    if (tool === 'cursor') {
      if (measure) { measure = null; dirty = true; }
      const h = hitTest(pos);
      if (h) {
        e.preventDefault();
        e.stopPropagation();
        lock(true);
        select(h.d.id);
        drag = {
          d: h.d,
          handle: h.handle,
          start: pos,
          startL: logicalAt(pos.x),
          orig: h.d.points.map(function (p) { return { t: p.t, p: p.p, l: timeToLogical(p.t), y: yOf(p.p) }; }),
          moved: false,
        };
      } else if (selectedId) {
        select(null);
      }
      return;
    }

    e.preventDefault();
    e.stopPropagation();
    lock(true);
    const pt = pointAt(pos);
    if (!pt) return;
    if (draft && phase === 'second') {
      draft.points[1] = pt;
      phase = 'up2';
    } else if (TOOLS[tool].pts === 2) {
      draft = newItem(tool, [pt, { t: pt.t, p: pt.p }]);
      phase = 'down';
      downPos = pos;
    } else {
      draft = newItem(tool, [pt]);
      phase = 'down1';
    }
    dirty = true;
  }

  function onMove(e) {
    if (drag) {
      const pos = local(e);
      const d = drag.d;
      if (!drag.moved && dist(pos, drag.start) < 3) return;
      drag.moved = true;
      if (drag.handle >= 0) {
        const pt = pointAt(pos);
        if (pt) d.points[drag.handle] = pt;
      } else {
        const l = logicalAt(pos.x);
        const dL = l === null || drag.startL === null ? 0 : Math.round(l - drag.startL);
        const dy = pos.y - drag.start.y;
        d.points = drag.orig.map(function (o) {
          const p = o.y === null ? o.p : priceAt(o.y + dy);
          return { t: Math.round(logicalToTime(o.l + dL)), p: p === null || !isFinite(p) ? o.p : p };
        });
      }
      dirty = true;
      return;
    }
    if (draft && phase !== 'down1') {
      const pt = pointAt(local(e));
      if (pt) { draft.points[1] = pt; dirty = true; }
      return;
    }
    if (e.pointerType === 'mouse' && wrap.contains(e.target)) updateCursor(local(e));
  }

  function onUp(e) {
    if (drag) {
      const moved = drag.moved;
      drag = null;
      lock(false);
      if (moved) commit();
      return;
    }
    if (!draft) return;
    if (phase === 'down1' || phase === 'up2') {
      finishDraft();
    } else if (phase === 'down') {
      // Gezogen → fertig. Nur geklickt → zweiter Klick setzt den Endpunkt.
      if (dist(local(e), downPos) > 5) finishDraft();
      else phase = 'second';
    }
  }

  function finishDraft() {
    const d = draft;
    draft = null;
    phase = null;
    lock(false);
    dirty = true;
    if (d.type === 'measure') {
      measure = d;
      setTool('cursor');
      return;
    }
    if (d.type === 'text') {
      const txt = window.prompt('Text eingeben:', '');
      if (!txt) { setTool('cursor'); return; }
      d.text = txt;
    }
    items.push(d);
    selectedId = d.id;
    commit();
    setTool('cursor');
    updateProps();
  }

  function cancelDraft() {
    if (!draft && !drag) return;
    if (drag && drag.moved) {
      drag.d.points = drag.orig.map(function (o) { return { t: o.t, p: o.p }; });
    }
    draft = null;
    drag = null;
    phase = null;
    lock(false);
    dirty = true;
  }

  function updateCursor(pos) {
    let cls = '';
    if (tool !== 'cursor') cls = 'cur-draw';
    else if (inPane(pos)) {
      const h = hitTest(pos);
      if (h) cls = h.handle >= 0 ? 'cur-handle' : 'cur-move';
    }
    wrap.classList.toggle('cur-draw', cls === 'cur-draw');
    wrap.classList.toggle('cur-move', cls === 'cur-move');
    wrap.classList.toggle('cur-handle', cls === 'cur-handle');
  }

  /* =================== Auswahl & Eigenschaften =================== */
  function selected() {
    return items.find(function (d) { return d.id === selectedId; }) || null;
  }

  function select(id) {
    selectedId = id;
    updateProps();
    dirty = true;
  }

  function removeSelected() {
    if (!selectedId) return;
    items = items.filter(function (d) { return d.id !== selectedId; });
    selectedId = null;
    commit();
    updateProps();
    dirty = true;
  }

  function buildProps() {
    propsEl = document.createElement('div');
    propsEl.className = 'draw-props';
    propsEl.hidden = true;
    propsEl.innerHTML =
      '<div class="dp-swatches"></div>' +
      '<label class="dp-custom" title="Eigene Farbe"><input type="color" id="dpColor"></label>' +
      '<select id="dpWidth" title="Linienstärke / Schriftgröße">' +
      '<option value="1">1</option><option value="2">2</option><option value="3">3</option><option value="4">4</option></select>' +
      '<button id="dpDash" title="Gestrichelt">┄</button>' +
      '<button id="dpText" title="Text bearbeiten">Text</button>' +
      '<button id="dpLevels" title="Fibonacci-Levels bearbeiten">Levels</button>' +
      '<button id="dpDelete" class="dp-delete" title="Löschen (Entf)">' +
      '<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg></button>';
    wrap.appendChild(propsEl);
    // Klicks in der Leiste nicht an den Chart weitergeben
    propsEl.addEventListener('pointerdown', function (e) { e.stopPropagation(); });

    const sw = propsEl.querySelector('.dp-swatches');
    SWATCHES.forEach(function (c) {
      const b = document.createElement('button');
      b.className = 'dp-swatch';
      b.style.background = c;
      b.title = c;
      b.dataset.color = c;
      b.addEventListener('click', function () { setColor(c, true); });
      sw.appendChild(b);
    });
    const colorInput = propsEl.querySelector('#dpColor');
    colorInput.addEventListener('input', function () { setColor(colorInput.value, false); });
    colorInput.addEventListener('change', function () { setColor(colorInput.value, true); });
    propsEl.querySelector('#dpWidth').addEventListener('change', function (e) {
      const d = selected();
      if (!d) return;
      d.width = +e.target.value;
      commit();
      dirty = true;
    });
    propsEl.querySelector('#dpDash').addEventListener('click', function () {
      const d = selected();
      if (!d) return;
      d.dash = !d.dash;
      commit();
      updateProps();
      dirty = true;
    });
    propsEl.querySelector('#dpText').addEventListener('click', function () {
      const d = selected();
      if (!d) return;
      const txt = window.prompt('Text bearbeiten:', d.text);
      if (txt === null) return;
      if (!txt.trim()) { removeSelected(); return; }
      d.text = txt;
      commit();
      dirty = true;
    });
    propsEl.querySelector('#dpLevels').addEventListener('click', editLevels);
    propsEl.querySelector('#dpDelete').addEventListener('click', removeSelected);
  }

  function setColor(c, final) {
    const d = selected();
    if (!d) return;
    d.color = c;
    if (final) {
      settings.colors[d.type] = c; // als Standard für neue Zeichnungen dieses Typs merken
      saveSettings();
      commit();
      updateProps();
    }
    dirty = true;
  }

  function editLevels() {
    const d = selected();
    if (!d || d.type !== 'fib') return;
    const current = fibLevels(d).join('  ');
    const input = window.prompt(
      'Fibonacci-Levels, getrennt durch Leerzeichen oder Semikolon (Komma oder Punkt als Dezimalzeichen).\n' +
      'Gilt für diese Zeichnung und als Standard für neue.', current);
    if (input === null) return;
    const levels = input.split(/[\s;]+/)
      .map(function (s) { return parseFloat(s.replace(',', '.')); })
      .filter(function (v) { return isFinite(v); });
    const uniq = levels.filter(function (v, i) { return levels.indexOf(v) === i; }).sort(function (a, b) { return a - b; });
    if (!uniq.length) { CT.toast('Keine gültigen Levels erkannt.', true); return; }
    d.levels = uniq;
    settings.fibLevels = uniq.slice();
    saveSettings();
    commit();
    dirty = true;
  }

  function updateProps() {
    if (!propsEl) return;
    const d = hidden ? null : selected();
    propsEl.hidden = !d;
    if (!d) return;
    propsEl.querySelectorAll('.dp-swatch').forEach(function (b) {
      b.classList.toggle('active', b.dataset.color.toLowerCase() === d.color.toLowerCase());
    });
    propsEl.querySelector('#dpColor').value = d.color;
    propsEl.querySelector('#dpWidth').value = String(d.width);
    propsEl.querySelector('#dpDash').classList.toggle('active', d.dash);
    propsEl.querySelector('#dpDash').hidden = d.type === 'text';
    propsEl.querySelector('#dpText').hidden = d.type !== 'text';
    propsEl.querySelector('#dpLevels').hidden = d.type !== 'fib';
  }

  /* =================== Werkzeugleiste =================== */
  function setTool(t) {
    if (!TOOLS[t]) return;
    if (draft) cancelDraft();
    tool = t;
    if (t !== 'cursor') select(null);
    document.querySelectorAll('[data-tool]').forEach(function (b) {
      const on = b.dataset.tool === t;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', on);
    });
    wrap.classList.toggle('cur-draw', t !== 'cursor');
    wrap.classList.remove('cur-move', 'cur-handle');
  }

  function setHidden(h) {
    hidden = h;
    CT.store.set('drawHidden', h);
    if (h) { cancelDraft(); selectedId = null; }
    const btn = document.querySelector('[data-action="hide"]');
    if (btn) {
      btn.classList.toggle('active', h);
      btn.title = h ? 'Zeichnungen einblenden' : 'Zeichnungen ausblenden';
    }
    updateProps();
    dirty = true;
  }

  function clearAll() {
    if (!items.length) return;
    if (!window.confirm('Alle ' + items.length + ' Zeichnungen für ' + symbol + ' löschen?\n(Rückgängig mit Strg+Z möglich)')) return;
    items = [];
    selectedId = null;
    commit();
    updateProps();
    dirty = true;
  }

  function updateHistoryButtons() {
    const u = document.querySelector('[data-action="undo"]');
    const r = document.querySelector('[data-action="redo"]');
    if (u) u.disabled = !undoStack.length;
    if (r) r.disabled = !redoStack.length;
  }

  /* =================== Export / Import =================== */
  function exportJson() {
    const backup = CT.store.exportAll();
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'chart-tool-sicherung-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    const n = CT.store.keys('drawings.').reduce(function (sum, k) { return sum + (CT.store.get(k, []) || []).length; }, 0);
    CT.toast('Exportiert: ' + n + ' Zeichnungen');
  }

  function importJson(file) {
    const reader = new FileReader();
    reader.onload = function () {
      let backup;
      try { backup = JSON.parse(reader.result); } catch (e) { CT.toast('Datei ist kein gültiges JSON.', true); return; }
      if (!backup || backup.app !== 'chart-tool' || !backup.data) { CT.toast('Keine gültige Chart-Tool-Sicherung.', true); return; }
      const syms = Object.keys(backup.data).filter(function (k) { return k.indexOf('drawings.') === 0; });
      if (!window.confirm('Sicherung importieren?\n\nZeichnungen für ' + syms.length + ' Symbol(e) und Einstellungen werden übernommen. ' +
        'Bestehende Zeichnungen dieser Symbole werden ersetzt.')) return;
      try {
        CT.store.importAll(backup);
      } catch (e) {
        CT.toast(e.message, true);
        return;
      }
      // Aktuelles Symbol neu laden (rückgängig machbar)
      settings = loadSettings();
      const fresh = sanitize(CT.store.get('drawings.' + symbol, []));
      items = fresh;
      selectedId = null;
      commit();
      setHidden(CT.store.get('drawHidden', false));
      updateProps();
      dirty = true;
      CT.toast('Import fertig: ' + syms.length + ' Symbol(e)');
    };
    reader.readAsText(file);
  }

  /* =================== Tastatur =================== */
  function onKey(e) {
    const t = e.target;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable) return;
    const modal = document.getElementById('searchModal');
    if (modal && !modal.hidden) return;
    const mod = e.ctrlKey || e.metaKey;

    if (e.key === 'Escape') {
      if (draft) cancelDraft();
      else if (measure) { measure = null; dirty = true; }
      else if (tool !== 'cursor') setTool('cursor');
      else select(null);
      return;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
      e.preventDefault();
      removeSelected();
      return;
    }
    if (mod && e.code === 'KeyZ') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if (mod && e.code === 'KeyY') { e.preventDefault(); redo(); return; }
    if (e.altKey && !mod) {
      const map = { KeyT: 'trend', KeyH: 'hline', KeyV: 'vline', KeyF: 'fib', KeyB: 'rect', KeyM: 'measure', KeyX: 'ray', KeyK: 'text' };
      if (map[e.code]) { e.preventDefault(); setTool(map[e.code]); }
    }
  }

  /* =================== Start =================== */
  function init(wrapEl, chartElement) {
    wrap = wrapEl;
    chartEl = chartElement;
    canvas = document.createElement('canvas');
    canvas.className = 'draw-layer';
    wrap.appendChild(canvas);
    ctx = canvas.getContext('2d');
    buildProps();

    wrap.addEventListener('pointerdown', onDown, true);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', function () { if (drag || phase === 'down' || phase === 'down1') cancelDraft(); });
    wrap.addEventListener('pointerleave', function () { wrap.classList.remove('cur-move', 'cur-handle'); });
    document.addEventListener('keydown', onKey);

    document.querySelectorAll('[data-tool]').forEach(function (b) {
      b.addEventListener('click', function () {
        setTool(tool === b.dataset.tool && b.dataset.tool !== 'cursor' ? 'cursor' : b.dataset.tool);
      });
    });
    const fileInput = document.getElementById('importFile');
    const actions = {
      undo: undo,
      redo: redo,
      hide: function () { setHidden(!hidden); },
      clear: clearAll,
      export: exportJson,
      import: function () { fileInput.value = ''; fileInput.click(); },
    };
    document.querySelectorAll('[data-action]').forEach(function (b) {
      b.addEventListener('click', function () { if (actions[b.dataset.action]) actions[b.dataset.action](); });
    });
    fileInput.addEventListener('change', function () { if (fileInput.files[0]) importJson(fileInput.files[0]); });

    CT.chart.on('data', function () { dirty = true; });
    setHidden(hidden);
    updateHistoryButtons();
    requestAnimationFrame(loop);
  }

  return {
    init: init,
    setSymbol: setSymbol,
    setTool: setTool,
    undo: undo,
    redo: redo,
    get items() { return items; },
    get tool() { return tool; },
    // für Tests / spätere Schritte
    _timeToLogical: timeToLogical,
    _logicalToTime: logicalToTime,
  };
})();
