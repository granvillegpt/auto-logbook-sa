# Routelist Template Detection and Parser Routing – Audit Report

**Date:** Audit performed against current codebase.  
**Scope:** Template detection, parser selection, and routing only. No logic changes; verification and temporary debug logs only.

---

## 1. Where Excel headers are read

### Business template (detection path)
- **File:** `public/js/logbook-page.js`
- **Location:** Inside `processRoutelistFile()`, in the `readFileAsArrayBuffer(file).then(function (buffer) { ... })` callback.
- **Mechanism:** SheetJS reads the buffer: `XLSX.read(buffer, { type: 'array', cellDates: false })`, first sheet, then `XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: null })` → `sheetRows`. Row 0 is used as headers: `row0 = (sheetRows[0] || []).map(...).trim()`, `row0Lower = row0.map(h => h.toLowerCase())`.
- **Approx. lines:** 283–288 (workbook read, sheetRows, row0, row0Lower).

### Sales / weekday template (when sales path runs)
- **File:** `engine/parseRouteListExcel.js`
- **Location:** `parseRawRouteListExcel(arrayBuffer)`: sheet read via `XLSX.read`, `sheet_to_json(..., { header: 1 })` → `jsonData`. Header row is chosen by `detectHeaderRow(jsonData, maxRowsToScan)` (lines 77–94). That row is used to build `columnMap` with aliases for address, suburb, city, province, customer, Monday–Saturday, weeks, frequency, start/end date (lines 124–139).
- **Approx. lines:** 103–119 (read + header detection), 124–139 (column mapping).

---

## 2. Where template detection occurs

- **File:** `public/js/logbook-page.js`
- **Function:** `processRoutelistFile`
- **Approx. lines:** 273–296

**Logic:**
- Default: `templateType = 'sales'`.
- If SheetJS is available, a try block:
  - Reads first sheet, row 0 → `row0`, `row0Lower`.
  - `hasLocation = row0Lower.indexOf('location') !== -1`
  - `hasDay = row0Lower.indexOf('day') !== -1`
  - `hasFrequency = row0Lower.indexOf('frequency') !== -1`
  - If **all three** are true → `templateType = 'business'`, `headerLabels = row0`.
- So:
  - **Business:** Row 0 must contain a column whose header is exactly `"location"` (after trim/lowercase), one exactly `"day"`, and one exactly `"frequency"`. (e.g. "Location", "Day", "Frequency").
  - **Sales:** Otherwise (missing any of those, or SheetJS read fails) → remains `'sales'`.

**Important:** `row0Lower.indexOf('day')` requires an array element equal to the string `'day'`. A column named "Monday" becomes `"monday"`, so it does **not** match `'day'`. So the weekday template (Monday, Tuesday, …) is correctly treated as sales, not business.

---

## 3. Parser functions – existence and location

| Parser / helper            | File                              | Status   | Notes |
|---------------------------|-----------------------------------|----------|--------|
| `parseBusinessRoutes`     | `engine/parsers/businessRouteParser.js` | Present  | Exported to `global.parseBusinessRoutes` (line 134). |
| `parseRouteListExcel`     | `engine/parseRouteListExcel.js`   | Present  | Lines 315–318; `parseRawRouteListExcel` + `enrichRouteRows`. Exposed on `global` (line 322). |
| `parseRawRouteListExcel`  | `engine/parseRouteListExcel.js`   | Present  | Lines 103–159. Used by UI for sales path and by `parseRouteListExcel`. |
| `enrichRouteRows`         | `engine/parseRouteListExcel.js`   | Present  | Lines 212–310. Used by UI for sales path and by `parseRouteListExcel`. |

**Script load order** (`public/logbook.html`): SheetJS → `engine/parseRouteListExcel.js` → `engine/parsers/businessRouteParser.js` → … → `js/logbook-page.js`. So both parser scripts load before the page script; `window.parseBusinessRoutes` and `window.parseRouteListExcel` (and `parseRawRouteListExcel` / `enrichRouteRows`) are available when `processRoutelistFile` runs.

---

## 4. Parser routing logic

- **File:** `public/js/logbook-page.js`
- **Function:** `processRoutelistFile`
- **Approx. lines:** 302–335

**Flow:**
1. If `templateType !== 'business'`: `raw = parseRawRouteListExcel(buffer)` and headerLabels from raw; otherwise `raw` stays `null`.
2. Single branching:
   - **If** `templateType === 'business'` **and** `typeof window.parseBusinessRoutes === 'function'` **and** `sheetRows && sheetRows.length > 0`:
     - Build `rowObjects` from `sheetRows` (data rows) keyed by `headerLabels`.
     - `routes = window.parseBusinessRoutes(rowObjects)`.
     - Log: `[PARSER_USED] parseBusinessRoutes`.
   - **Else:**
     - If `raw != null`: `routes = enrichRouteRows(raw)`, then customer map/filter, then log: `[PARSER_USED] parseRouteListExcel`.
     - If `raw == null`: `routes = []`.

So:
- **Business:** Only `parseBusinessRoutes` runs (and only when the three conditions hold).
- **Sales:** Only `parseRawRouteListExcel` + `enrichRouteRows` run (sales path); no call to `parseBusinessRoutes`. Exactly one parser path runs per file.

---

## 5. Both parsers reachable

- **parseBusinessRoutes:** Runs when the user uploads a file whose first row has headers that normalize to `location`, `day`, and `frequency`. No later code overwrites `templateType`. So the business parser is reachable.
- **parseRouteListExcel (sales path):** Runs when `templateType` is not `'business'` or when business conditions fail (e.g. no SheetJS, no sheet rows, or `parseBusinessRoutes` not a function). Then `raw` is set by `parseRawRouteListExcel(buffer)` and `enrichRouteRows(raw)` runs. So the sales parser is reachable.
- **Dead code:** The routing is a single if/else; no unreachable branch found.
- **Condition that could force one parser only:** If `window.parseBusinessRoutes` were missing (script load failure), the business branch would be skipped and the sales path would run (with `raw` set only when `templateType !== 'business'`). So in that failure mode only the sales path runs. Similarly, if the file never has row 0 with location + day + frequency, only the sales path runs. This is by design, not a bug.

---

## 6. Detection not overridden later

- `templateType` is set only in the block above (lines 274, 293–294) and is never reassigned later in `processRoutelistFile`. The parser branch uses this same `templateType`. No later override of template detection was found.

---

## 7. Cached routes (localStorage) and template detection

- **Storage key:** `autoLogbookRoutes` (used in `logbook-page.js` and `logbookService.js`).
- **Restore:** `restoreRoutesFromStorage()` reads `localStorage.getItem('autoLogbookRoutes')`, parses JSON, sets `window.currentRoutes` and `enrichedRoutelist`, and calls `renderRoutelistPreview(routes)`. It does **not** read an Excel file and does **not** run template detection or any parser.
- **When detection runs:** Only inside `processRoutelistFile()`, when a file is read (file input change or Generate button with a file). So cached routes do **not** bypass template detection: detection runs only on upload/parse; restore just displays previously parsed routes.

---

## 8. Temporary debug logs added

- **Existing (unchanged):**
  - `console.log('[TEMPLATE_SELECTED]', templateType);`
  - `console.log('[PARSER_USED]', 'parseBusinessRoutes');` (business branch)
  - `console.log('[PARSER_USED]', 'parseRouteListExcel');` (sales branch)
- **Added for this audit:**
  - `console.log('[BUSINESS_PARSER_EXISTS]', typeof window.parseBusinessRoutes);`
  - `console.log('[SALES_PARSER_EXISTS]', typeof window.parseRouteListExcel);`

These run in `processRoutelistFile` immediately after template selection, on each file process. Remove when no longer needed.

---

## 9. Summary

| Item | Result |
|------|--------|
| **Template detection location** | `public/js/logbook-page.js`, `processRoutelistFile`, ~lines 273–296 (row 0: location, day, frequency → business; else sales). |
| **Business parser location** | `engine/parsers/businessRouteParser.js` (`parseBusinessRoutes`). |
| **Sales parser location** | `engine/parseRouteListExcel.js` (`parseRawRouteListExcel`, `enrichRouteRows`, `parseRouteListExcel`). |
| **Both parsers exist** | Yes; both scripts loaded in `logbook.html` before page script. |
| **Template detection runs** | Yes; on every file process inside `processRoutelistFile` before any parser runs. |
| **Correct parser for template** | Yes; business → `parseBusinessRoutes`; sales → `parseRawRouteListExcel` + `enrichRouteRows`. |
| **Risk: one parser unreachable** | Low. Business path requires business headers + SheetJS + `parseBusinessRoutes`; sales path runs otherwise. Only realistic unreachability is if a parser script fails to load. |
| **Condition forcing one parser only** | Only by file content (no location/day/frequency in row 0 → always sales) or missing `window.parseBusinessRoutes` (always sales). No incorrect forcing found. |

---

**Conclusion:** Template detection and parser routing are implemented as intended. Two templates (business vs sales/weekday) are supported, detection is based on the first row of the first sheet, and exactly one parser path runs per upload. Cached routes do not bypass detection. Temporary debug logs for template selection and parser existence have been added and can be removed after verification.
