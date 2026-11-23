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

  return { get, set, remove };
})();
