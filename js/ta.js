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

  return {
    valid, source, sma, ema, rma, stdev, highest, lowest, change, rsi, stoch,
    trueRange, atr, macd, vwap, sub,
  };
})();
