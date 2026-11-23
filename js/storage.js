/* Speichern im Browser (localStorage). Alle Schlüssel bekommen das Präfix "ct.".
   Fehler (privater Modus, voller Speicher) werden abgefangen, das Tool läuft dann ohne Speichern weiter. */
window.CT = window.CT || {};

CT.store = (function () {
  const PREFIX = 'ct.';

  function get(key, fallback) {
    try {
      const raw = localStorage.getItem(PREFIX + key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch (e) {
      return fallback;
    }
  }

  function set(key, value) {
    try {
      localStorage.setItem(PREFIX + key, JSON.stringify(value));
      return true;
    } catch (e) {
      console.warn('Speichern fehlgeschlagen:', key, e);
      return false;
    }
  }

  function remove(key) {
    try { localStorage.removeItem(PREFIX + key); } catch (e) { /* ignorieren */ }
  }

  /** Alle gespeicherten Schlüssel (ohne Präfix), optional gefiltert nach Anfang. */
  function keys(startsWith) {
    const out = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.indexOf(PREFIX) === 0) {
          const key = k.slice(PREFIX.length);
          if (!startsWith || key.indexOf(startsWith) === 0) out.push(key);
        }
      }
    } catch (e) { /* ignorieren */ }
    return out;
  }

  /* ---------- Sicherung als JSON ----------
     Exportiert alles, was das Tool speichert (Zeichnungen, Einstellungen, später Indikatoren),
     außer Zwischenspeichern, die sich neu laden lassen. */
  const NOT_EXPORTED = ['symbols.v1'];

  function exportAll() {
    const data = {};
    keys().forEach(function (k) {
      if (NOT_EXPORTED.indexOf(k) === -1) data[k] = get(k, null);
    });
    return { app: 'chart-tool', version: 1, exportedAt: new Date().toISOString(), data: data };
  }

  /** Schreibt eine Sicherung zurück. Vorhandene Schlüssel mit gleichem Namen werden überschrieben. */
  function importAll(backup) {
    if (!backup || backup.app !== 'chart-tool' || typeof backup.data !== 'object' || !backup.data) {
      throw new Error('Keine gültige Chart-Tool-Sicherung');
    }
    let count = 0;
    Object.keys(backup.data).forEach(function (k) {
      if (NOT_EXPORTED.indexOf(k) !== -1 || !/^[\w.\-]+$/.test(k)) return;
      if (set(k, backup.data[k])) count++;
    });
    return count;
  }

  return { get, set, remove, keys, exportAll, importAll };
})();
