# Auto Logbook SA

SARS-compliant travel logbook generator. Upload a route list (Excel), configure details, and generate a formatted logbook for download.

## Script load order (logbook page)

The logbook page (`public/logbook.html`) loads engine and UI scripts in a **fixed order**. Do not reorder or skip scripts:

| Order | Script | Purpose |
|-------|--------|---------|
| 1 | `vendor/xlsx.full.min.js` | SheetJS – parse Excel files |
| 2 | `engine/parseRouteListExcel.js` | Read workbook, depends on XLSX |
| 3 | `engine/parsers/businessRouteParser.js` | Parse rows into route objects |
| 4 | `engine/dateRange.js` | Date utilities |
| 5 | `engine/logbookEngine.js` | Core logbook generation |
| 6 | `engine/routing/distanceMatrixRouting.js` | Distance Matrix / haversine |
| 7 | `js/local-config.js` | API base URL etc. |
| 8 | `engine/routing/googleGeocodeService.js` | Geocoding |
| 9 | `js/logbook-page.js` | UI controller (must load last) |

Changing this order can break parsing, routing, or the UI.

## Running locally

1. Set `GOOGLE_GEOCODE_API_KEY` in the environment.
2. `npm install` then `node server.js`.
3. Open the app in the browser (e.g. `http://localhost:3000`).
