# harmony-bay

Begleitseite für die Harmony-Bay-Runde: eine Touristen-Fassade mit News und Wetter. Über das Copyright „1983“ kommt man mit Passwort ins Ermittlungs-Backend. Alle Daten liegen live in einer Firebase Realtime Database. Es gibt keinen Build-Schritt; die Seite läuft direkt als statische Seite (z. B. GitHub Pages).

## Aufbau

| Datei | Inhalt |
|---|---|
| `index.html` | Markup aller Ansichten |
| `css/style.css` | Komplettes Styling inkl. Mobile-Anpassungen |
| `js/core.js` | Firebase-Init, gemeinsame Helfer (Escaping, Menü, Toast, Bearbeiten-Modus, Zoom-Gesten) |
| `js/news.js` | Wetter & Bekanntmachungen |
| `js/personen.js` | Personen-Akten |
| `js/chronik.js` | Chronik/Zeitstrahl & Spieler-Notizen |
| `js/karte.js` | Lageplan: Pins, Pin-Arten, Zoom |
| `js/pinnwand.js` | Pinnwand: Karten, Fäden, Zoom, Bild-Export |
| `js/archiv.js` | Beweismittel |
| `js/system.js` | Backup & Wiederherstellung |
| `js/app.js` | Login, Tabs, Walkman, Tastatur – startet zuletzt alle Firebase-Listener |

Die Skripte werden in dieser Reihenfolge geladen. `core.js` muss zuerst kommen, `app.js` zuletzt.

Nach Änderungen an CSS oder JS sollte die Versionsnummer `?v=…` in `index.html` erhöht werden, sonst bekommen Spieler womöglich noch die alte Version aus dem Browser-Cache.
