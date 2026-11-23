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
- **Speichern:** `localStorage` (Präfix `ct.`). Zeichnungen pro Symbol unter `ct.drawings.<SYMBOL>`.
  Export/Import als JSON-Sicherung über die Werkzeugleiste. Exportiert wird alles, was das Tool speichert,
  außer der Symbolliste (die wird ohnehin neu geladen).

## Aufbau

```
index.html        Layout: Topbar, Werkzeugleiste links, Chart, Watchlist rechts, Suchfenster
css/style.css     Dunkles Design, Grid-Layout, schmale Bildschirme
js/storage.js     CT.store – localStorage-Hilfen (get/set/remove/keys) und JSON-Sicherung (exportAll/importAll)
js/binance.js     CT.binance – REST (klines, exchangeInfo) und WebSocket mit Auto-Reconnect
js/chart.js       CT.chart – Kerzen, Volumen, Legende, Log-Skala, Live-Updates, Historie nachladen
js/symbols.js     CT.symbols – Symbolliste laden, zwischenspeichern, durchsuchen
js/drawings.js    CT.drawings – Zeichenwerkzeuge: Canvas-Ebene, Treffer, Ziehen, Eigenschaften, Verlauf, Export
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

**Zeichnungen:** Eine eigene Canvas liegt über dem Chart (`pointer-events: none`). Maus und Touch werden auf
`.chart-wrap` in der Capture-Phase abgefangen, bevor Lightweight Charts sie bekommt. Während gezeichnet oder
gezogen wird, ist Verschieben/Zoomen des Charts gesperrt. Punkte werden als `{ t, p }` gespeichert
(UTC-ms, Preis). Für die Anzeige wird `t` über die Kerzen des aktuellen Zeitrahmens in einen gebrochenen
Kerzenindex umgerechnet. Außerhalb der Daten wird mit der Kerzenlänge weitergerechnet, so lässt sich auch in die
Zukunft zeichnen. Achtung: `timeScale().logicalToCoordinate()` kennt nur ganze Indizes, deshalb interpoliert
`xOf()` selbst. Die Ebene wird nur neu gezeichnet, wenn sich Ansicht, Daten oder Zeichnungen ändern.

## Bedienung

| Aktion | So geht's |
|---|---|
| Symbol wechseln | Auf das Symbol oben links klicken oder einfach lostippen (z. B. `ETH`), Enter |
| Zeitrahmen | Leiste oben: 1m, 3m, 5m, 15m, 30m, 1h, 2h, 4h, 6h, 8h, 12h, 1D, 3D, 1W, 1M |
| Zoom | Mausrad / Pinch, Ziehen auf Preis- oder Zeitachse |
| Log-Skala | Knopf `Log` oder `Alt+L` |
| Ansicht zurücksetzen | Knopf rechts neben `Log` oder `Alt+R` |
| Link teilen | Die URL enthält Symbol und Zeitrahmen, z. B. `index.html#SOLUSDT/4h` |
| Zeichnen | Werkzeug links wählen, dann ziehen **oder** zweimal klicken (Start- und Endpunkt) |
| Trendlinie / Strahl | `Alt+T` / `Alt+X` |
| Horizontale / vertikale Linie | `Alt+H` / `Alt+V` (ein Klick) |
| Rechteck / Text | `Alt+B` / `Alt+K` |
| Fibonacci | `Alt+F`, Levels über „Levels“ in der Eigenschaftsleiste ändern (Standard inkl. 0.886) |
| Messen | `Alt+M`: Preis- und Prozentdifferenz, Anzahl Kerzen, Dauer. Wird nicht gespeichert |
| Bearbeiten | Zeichnung anklicken: Körper ziehen = verschieben, Punkt ziehen = Punkt ändern; Leiste oben: Farbe, Stärke, gestrichelt |
| Löschen | `Entf`/`Backspace` oder Papierkorb in der Leiste; alle Zeichnungen des Symbols: Papierkorb links |
| Rückgängig / Wiederholen | `Strg+Z` / `Strg+Y` (oder `Strg+Umschalt+Z`) |
| Abbrechen | `Esc` |
| Sicherung | Pfeil nach unten = Export als JSON, Pfeil nach oben = Import |

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
- [x] **Schritt 2 – Zeichenwerkzeuge mit Speichern und Export** *(fertig)*
  - Trendlinie, Strahl, horizontale/vertikale Linie, Rechteck, Text (mehrzeilig), Fibonacci, Messwerkzeug
  - Fibonacci mit eigenen Levels (Standard 0 / 0.236 / 0.382 / 0.5 / 0.618 / 0.786 / 0.886 / 1), zuletzt gewählte Levels werden Standard
  - Auswählen, Verschieben (ganze Zeichnung oder einzelne Punkte), Farbe (8 Vorgaben + frei wählbar), Linienstärke, gestrichelt
  - Zuletzt gewählte Farbe pro Werkzeug wird zum Standard für neue Zeichnungen
  - Löschen einzeln oder alle, Rückgängig/Wiederholen (500 Schritte), Ausblenden
  - Unbegrenzt viele Zeichnungen, gespeichert pro Symbol, sichtbar auf allen Zeitrahmen, Zeichnen in die Zukunft möglich
  - JSON-Sicherung: Export und Import (ungültige Einträge werden beim Laden aussortiert)
  - Getestet: Zeichnen per Ziehen und per Klick-Klick, Verschieben ohne Chart-Mitbewegung, Farbe, Undo/Redo,
    Entf, Zeitrahmenwechsel 1h → 4h → 1D, Symbolwechsel, Neuladen, Import
  - Noch nicht auf einem echten Touch-Gerät getestet → in Schritt 5 (Handy-Ansicht) prüfen
- [ ] **Schritt 3 – Standard-Indikatoren** *(als Nächstes)*
  - SMA, EMA, Bollinger-Bänder, VWAP (im Chart); RSI, MACD, Stochastic RSI, ATR (eigene Bereiche darunter); Volumen-MA
  - Jeder Indikator ein-/ausschaltbar mit eigenen Parametern, Einstellungen speichern (fließen automatisch in die JSON-Sicherung)
  - Idee: Lightweight Charts v5 kann mehrere Bereiche (`addSeries(…, paneIndex)`) für Oszillatoren
- [ ] Schritt 4 – Eigene Indikatoren aus den Pine-Dateien (Momentum-Sigma, Pullback-Oszillator, Deviation-Bänder, Weekly MA50)
- [ ] Schritt 5 – Watchlist mit Live-Kurs, Design-Feinschliff, Handy-Ansicht, README

## Lokal starten

`index.html` im Browser öffnen. Optional mit lokalem Server, z. B. `python -m http.server` im Projektordner.

## GitHub Pages

Veröffentlicht aus Branch `main`, Ordner `/ (root)` (Repository → Settings → Pages).
Erreichbar unter https://pacino112.github.io/chart-tool/.
