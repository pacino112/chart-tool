/* Technische Analyse – reine Rechenfunktionen, angelehnt an das Verhalten der Pine-Funktionen (ta.*).
   Eingabe: Arrays von Zahlen (null = kein Wert). Ausgabe: gleich lange Arrays, null solange zu wenig Daten.
   Wird von den Standard-Indikatoren (Schritt 3) und den eigenen Indikatoren (Schritt 4) benutzt. */
window.CT = window.CT || {};

CT.ta = (function () {
  function valid(v) { return v !== null && v !== undefined && isFinite(v); }
  function empty(n) { return new Array(n).fill(null); }

  /** Kursquelle wie in Pine: close, open, high, low, hl2, hlc3, ohlc4 */
  function source(bars, src) {
    return bars.map(function (b) {
      switch (src) {
        case 'open': return b.open;
        case 'high': return b.high;
        case 'low': return b.low;
        case 'hl2': return (b.high + b.low) / 2;
        case 'hlc3': return (b.high + b.low + b.close) / 3;
        case 'ohlc4': return (b.open + b.high + b.low + b.close) / 4;
        default: return b.close;
      }
    });
  }

  /** Einfacher Durchschnitt über die letzten n zusammenhängenden gültigen Werte (ta.sma) */
  function sma(vals, n) {
    const out = empty(vals.length);
    let sum = 0;
    let cnt = 0;
    for (let i = 0; i < vals.length; i++) {
      const v = vals[i];
      if (!valid(v)) { sum = 0; cnt = 0; continue; }
      sum += v;
      cnt++;
      if (cnt > n) sum -= vals[i - n];
      if (cnt >= n) out[i] = sum / n;
    }
    return out;
  }

  /** Exponentieller Durchschnitt mit beliebigem alpha, Start = SMA der ersten n Werte */
  function smoothed(vals, n, alpha) {
    const out = empty(vals.length);
    let prev = null;
    let seedSum = 0;
    let seedCnt = 0;
    for (let i = 0; i < vals.length; i++) {
      const v = vals[i];
      if (!valid(v)) { if (prev === null) { seedSum = 0; seedCnt = 0; } continue; }
      if (prev === null) {
        seedSum += v;
        seedCnt++;
        if (seedCnt === n) { prev = seedSum / n; out[i] = prev; }
        continue;
      }
      prev = alpha * v + (1 - alpha) * prev;
      out[i] = prev;
    }
    return out;
  }

  function ema(vals, n) { return smoothed(vals, n, 2 / (n + 1)); }
  /** Wilder-Glättung (ta.rma), z. B. für RSI und ATR */
  function rma(vals, n) { return smoothed(vals, n, 1 / n); }

  /** Standardabweichung über n Werte (wie ta.stdev, Grundgesamtheit) */
  function stdev(vals, n) {
    const out = empty(vals.length);
    let sum = 0;
    let sq = 0;
    let cnt = 0;
    for (let i = 0; i < vals.length; i++) {
      const v = vals[i];
      if (!valid(v)) { sum = 0; sq = 0; cnt = 0; continue; }
      sum += v;
      sq += v * v;
      cnt++;
      if (cnt > n) { const o = vals[i - n]; sum -= o; sq -= o * o; }
      if (cnt >= n) {
        const mean = sum / n;
        out[i] = Math.sqrt(Math.max(0, sq / n - mean * mean));
      }
    }
    return out;
  }

  function highest(vals, n) { return windowed(vals, n, Math.max); }
  function lowest(vals, n) { return windowed(vals, n, Math.min); }

  function windowed(vals, n, fn) {
    const out = empty(vals.length);
    let cnt = 0;
    for (let i = 0; i < vals.length; i++) {
      if (!valid(vals[i])) { cnt = 0; continue; }
      cnt++;
      if (cnt >= n) {
        let r = vals[i];
        for (let k = i - n + 1; k < i; k++) r = fn(r, vals[k]);
        out[i] = r;
      }
    }
    return out;
  }

  function change(vals) {
    return vals.map(function (v, i) { return i > 0 && valid(v) && valid(vals[i - 1]) ? v - vals[i - 1] : null; });
  }

  function rsi(vals, n) {
    const ch = change(vals);
    const up = rma(ch.map(function (c) { return c === null ? null : Math.max(c, 0); }), n);
    const down = rma(ch.map(function (c) { return c === null ? null : Math.max(-c, 0); }), n);
    return up.map(function (u, i) {
      const d = down[i];
      if (!valid(u) || !valid(d)) return null;
      if (d === 0) return 100;
      if (u === 0) return 0;
      return 100 - 100 / (1 + u / d);
    });
  }

  /** ta.stoch(src, src, src, n) – Lage von src im Bereich der letzten n Werte in % */
  function stoch(vals, n) {
    const hi = highest(vals, n);
    const lo = lowest(vals, n);
    return vals.map(function (v, i) {
      if (!valid(hi[i]) || !valid(lo[i])) return null;
      const r = hi[i] - lo[i];
      return r === 0 ? null : (v - lo[i]) / r * 100;
    });
  }

  function trueRange(bars) {
    return bars.map(function (b, i) {
      if (i === 0) return b.high - b.low;
      const pc = bars[i - 1].close;
      return Math.max(b.high - b.low, Math.abs(b.high - pc), Math.abs(b.low - pc));
    });
  }

  function atr(bars, n) { return rma(trueRange(bars), n); }

  function sub(a, b) { return a.map(function (v, i) { return valid(v) && valid(b[i]) ? v - b[i] : null; }); }

  function macd(vals, fast, slow, signal) {
    const line = sub(ema(vals, fast), ema(vals, slow));
    const sig = ema(line, signal);
    return { macd: line, signal: sig, hist: sub(line, sig) };
  }

  /** VWAP, zurückgesetzt je Periode (UTC): 'Tag', 'Woche' oder 'Monat' */
  function vwap(bars, anchor) {
    const out = empty(bars.length);
    let key = null;
    let pv = 0;
    let vol = 0;
    for (let i = 0; i < bars.length; i++) {
      const b = bars[i];
      const k = periodKey(b.openTime, anchor);
      if (k !== key) { key = k; pv = 0; vol = 0; }
      const tp = (b.high + b.low + b.close) / 3;
      pv += tp * b.volume;
      vol += b.volume;
      out[i] = vol > 0 ? pv / vol : tp;
    }
    return out;
  }

  function periodKey(ms, anchor) {
    const d = new Date(ms);
    const day = Math.floor(ms / 864e5);
    if (anchor === 'Monat') return d.getUTCFullYear() * 12 + d.getUTCMonth();
    if (anchor === 'Woche') return day - (d.getUTCDay() + 6) % 7; // Montag als Wochenbeginn
    return day;
  }

  /* =================== Volumenprofil-Rechnung ===================
     Das Volumen jeder Kerze wird anteilig auf alle Preiszeilen verteilt, die die Kerze von Tief bis Hoch
     überdeckt (Näherung – Binance liefert keine Umsätze pro Preis). Grüne Kerzen zählen als Kauf-,
     rote als Verkaufsvolumen. POC = Zeile mit dem meisten Volumen. Value Area = vom POC aus nach oben/unten
     erweitert (jeweils zur volumenstärkeren Seite), bis der eingestellte Anteil des Gesamtvolumens erreicht ist. */
  function volumeProfile(bars, from, to, rows, vaPct) {
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = from; i <= to; i++) { lo = Math.min(lo, bars[i].low); hi = Math.max(hi, bars[i].high); }
    if (!isFinite(lo) || hi <= lo) return null;
    const step = (hi - lo) / rows;
    const up = new Array(rows).fill(0);
    const down = new Array(rows).fill(0);
    for (let i = from; i <= to; i++) {
      const b = bars[i];
      const target = b.close >= b.open ? up : down;
      const span = b.high - b.low;
      if (span <= 0) {
        target[Math.min(rows - 1, Math.floor((b.close - lo) / step))] += b.volume;
        continue;
      }
      const r0 = Math.max(0, Math.floor((b.low - lo) / step));
      const r1 = Math.min(rows - 1, Math.floor((b.high - lo) / step));
      for (let r = r0; r <= r1; r++) {
        const overlap = Math.min(b.high, lo + (r + 1) * step) - Math.max(b.low, lo + r * step);
        if (overlap > 0) target[r] += b.volume * overlap / span;
      }
    }
    const total = up.map(function (u, r) { return u + down[r]; });
    const sum = total.reduce(function (a, v) { return a + v; }, 0);
    let poc = 0;
    total.forEach(function (v, r) { if (v > total[poc]) poc = r; });
    let a = poc;
    let z = poc;
    let acc = total[poc];
    while (acc < sum * vaPct / 100 && (a > 0 || z < rows - 1)) {
      const below = a > 0 ? total[a - 1] : -1;
      const above = z < rows - 1 ? total[z + 1] : -1;
      if (above >= below) { z++; acc += total[z]; } else { a--; acc += total[a]; }
    }
    return {
      lo: lo, step: step, up: up, down: down, total: total, max: total[poc], poc: poc, vaLow: a, vaHigh: z,
      pocPrice: lo + (poc + 0.5) * step, vah: lo + (z + 1) * step, val: lo + a * step,
    };
  }
  return {
    valid, source, sma, ema, rma, stdev, highest, lowest, change, rsi, stoch,
    trueRange, atr, macd, vwap, sub, volumeProfile,
  };
})();
