# Chart-Tool

Ein eigenes Chart-Tool im Browser, das sich wie TradingView bedienen lässt – ohne Abo, ohne Limits, mit eigenen Indikatoren.
Läuft komplett statisch (HTML, CSS, JavaScript) auf GitHub Pages, als Teil meines Portfolios neben dem
[Makro-Terminal](https://github.com/pacino112/makro-terminal).

**Live:** https://pacino112.github.io/chart-tool/

## Technik

- **Kein Server, kein Build-Prozess** – `index.html` öffnen und loslegen (auch direkt per Doppelklick).
- **Chart-Darstellung:** [Lightweight Charts](https://github.com/tradingview/lightweight-charts) v5.0.8 (Apache-2.0), eingebunden über unpkg.
  Das TradingView-Logo unten links ist die von der Lizenz verlangte Namensnennung.
- **Daten:** öffentliche Binance-API ohne Schlüssel
  - Kerzen über REST: `/api/v3/klines` (1000 Kerzen pro Abruf, ältere werden beim Scrollen nach links unbegrenzt nachgeladen)
  - Live-Kerze über WebSocket: `<symbol>@kline_<interval>`
  - Symbolliste: `/api/v3/exchangeInfo` (24 h im Browser zwischengespeichert)
  - Ausweich-Server, falls `api.binance.com` nicht erreichbar oder gesperrt ist: `data-api.binance.vision` / `data-stream.binance.vision`
- **Speichern:** `localStorage` (Präfix `ct.`), Export/Import als JSON folgt in Schritt 2.

## Aufbau

```
index.html        Layout: Topbar, Werkzeugleiste links, Chart, Watchlist rechts, Suchfenster
css/style.css     Dunkles Design, Grid-Layout, schmale Bildschirme
js/storage.js     CT.store – localStorage-Hilfen (get/set/remove)
js/binance.js     CT.binance – REST (klines, exchangeInfo) und WebSocket mit Auto-Reconnect
js/chart.js       CT.chart – Kerzen, Volumen, Legende, Log-Skala, Live-Updates, Historie nachladen
js/symbols.js     CT.symbols – Symbolliste laden, zwischenspeichern, durchsuchen
js/app.js         Verdrahtung: Zeitrahmen, Symbolsuche, Tastenkürzel, URL-Hash, Status
```

Alle Module hängen am globalen Objekt `window.CT` und werden als normale `<script>`-Dateien geladen
(keine ES-Module), damit das Tool auch ohne Webserver per `file://` läuft.

**Zeitstempel:** Die Chart-Zeit ist immer echte UTC-Zeit in Sekunden (`toChartTime(ms)` = `ms / 1000`).
Die Ortszeit entsteht nur bei der Anzeige über `timeFormatter` und `tickMarkFormatter`
(Tages-/Wochen-/Monatskerzen werden in UTC formatiert, damit das Datum stimmt).
Zeiten nie pro Kerze in Ortszeit verschieben: Bei der Zeitumstellung entstehen sonst doppelte
Zeitstempel, und Lightweight Charts zeichnet gar nichts mehr. Zeichnungen und Indikatoren speichern
echte UTC-Millisekunden (`openTime`) und rechnen mit `toChartTime` / `fromChartTime` um.

## Bedienung

| Aktion | So geht's |
|---|---|
| Symbol wechseln | Auf das Symbol oben links klicken oder einfach lostippen (z. B. `ETH`), Enter |
| Zeitrahmen | Leiste oben: 1m, 3m, 5m, 15m, 30m, 1h, 2h, 4h, 6h, 8h, 12h, 1D, 3D, 1W, 1M |
| Zoom | Mausrad / Pinch, Ziehen auf Preis- oder Zeitachse |
| Log-Skala | Knopf `Log` oder `Alt+L` |
| Ansicht zurücksetzen | Knopf rechts neben `Log` oder `Alt+R` |
| Link teilen | Die URL enthält Symbol und Zeitrahmen, z. B. `index.html#SOLUSDT/4h` |

Der Punkt oben rechts zeigt die Live-Verbindung: grün = live, gelb = verbindet, rot = getrennt.

## Fortschritt

Das Projekt wird in 5 Sitzungen gebaut, pro Sitzung ein Schritt.

- [x] **Schritt 1 – Grundgerüst, Chart, Binance-Daten, Zeitrahmen, Symbolsuche** *(fertig)*
  - Layout mit Topbar, Werkzeugleiste links (Platzhalter), Watchlist rechts (Platzhalter)
  - Kerzen + Volumen, Live-Update per WebSocket mit automatischem Neuverbinden und Lückenschluss
  - Alle 15 Zeitrahmen, unbegrenztes Nachladen älterer Historie beim Scrollen nach links
  - Fadenkreuz mit OHLC, Veränderung und Volumen in der Legende
  - Logarithmische Skala, Zoom, Ansicht zurücksetzen
  - Symbolsuche über alle Binance-Spot-Paare mit Quote-Filter, „Zuletzt geöffnet“ und „Beliebt“
  - Preisnachkommastellen passend zur Tick-Größe des Paars
  - Symbol, Zeitrahmen und Log-Einstellung werden gespeichert und stehen in der URL
- [ ] **Schritt 2 – Zeichenwerkzeuge mit Speichern und Export** *(als Nächstes)*
  - Trendlinie, horizontale/vertikale Linie, Strahl, Rechteck, Text, Fibonacci (eigene Levels inkl. 0,886), Messwerkzeug
  - Verschieben, Farbe ändern, löschen, Rückgängig/Wiederholen
  - Speichern pro Symbol (sichtbar auf allen Zeitrahmen), Export/Import als JSON
  - Werkzeuge kommen in die linke Leiste (`nav.toolbar` in `index.html`)
- [ ] Schritt 3 – Standard-Indikatoren (SMA, EMA, Bollinger, VWAP, RSI, MACD, Stoch RSI, ATR, Volumen-MA)
- [ ] Schritt 4 – Eigene Indikatoren aus den Pine-Dateien (Momentum-Sigma, Pullback-Oszillator, Deviation-Bänder, Weekly MA50)
- [ ] Schritt 5 – Watchlist mit Live-Kurs, Design-Feinschliff, Handy-Ansicht, README

## Lokal starten

`index.html` im Browser öffnen. Optional mit lokalem Server, z. B. `python -m http.server` im Projektordner.

## GitHub Pages

Veröffentlicht aus Branch `main`, Ordner `/ (root)` (Repository → Settings → Pages).
Erreichbar unter https://pacino112.github.io/chart-tool/.
