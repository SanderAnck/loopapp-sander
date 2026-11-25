# Pace

Persoonlijke loopcoach als Progressive Web App (PWA). Eén statische site, geen backend,
alle gegevens lokaal op het toestel (IndexedDB).

## Structuur

| Pad | Inhoud |
| --- | --- |
| `index.html` | App-shell met topbalk en tabbalk |
| `css/app.css` | Design system (kleuren, typografie, kaarten, knoppen), licht en donker |
| `js/app.js` | Router, tabbalk, service worker en update-melding |
| `js/views.js` | Schermen: Vandaag, Schema, Voortgang, Profiel |
| `js/db.js` | IndexedDB-opslag plus export/import |
| `js/version.js` | Versienummer, verhogen bij elke release |
| `sw.js` | Service worker voor offline gebruik |
| `icons/` | App-iconen |

## Lokaal testen

Elke statische server werkt, bijvoorbeeld `python3 -m http.server 8000` in deze map,
en open dan `http://localhost:8000`.

## Publiceren

De site draait op GitHub Pages vanaf de `main`-branch (map `/`).
Verhoog `js/version.js` bij elke wijziging, zodat geïnstalleerde apps de update ophalen.
