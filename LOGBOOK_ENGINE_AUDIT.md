# Auto Logbook SA – Logbook Engine Audit Report

**Scope:** Analysis-only audit of the logbook engine implementation in the standalone app.  
**Date:** 2026-03-11.

---

## 1. Files Responsible for Logbook Generation

| Area | File(s) | Role |
|------|--------|------|
| **Engine core** | `engine/logbookEngine.js` | Visit expansion, distance orchestration, logbook entry generation, totals, SARS-compliant structure |
| **Engine – parsing** | `engine/parseRouteListExcel.js` | Raw Excel ingest (`parseRawRouteListExcel`), route enrichment (`enrichRouteRows`) |
| **Engine – date range** | `engine/dateRange.js` | Tax-year string → start/end date range (`taxYearToDateRange`) |
| **Engine – routing** | `engine/routing/mockRouting.js` | Distance API: `getDistance(from, to)`, `getDistances(home, addresses)` — **mock only** (fixed 10 km) |
| **Engine – geocoding** | `engine/routing/googleGeocodeService.js` | Address resolution for routelist (Geocode / Find Place / Text Search / Place Details). **Not used for driving distances.** |
| **Public / UI** | `public/js/logbook-page.js` | Orchestrates: upload → parse/enrich → preview → form → `runLogbookEngine` and XLSX export |
| **Public / UI** | `public/logbook.html` | Page shell; loads SheetJS, parseRouteListExcel, dateRange, logbookEngine, mockRouting, geocode, logbook-page.js |
| **Calendar (UI only)** | `public/js/logbook-page.js` | `renderLeaveCalendar()`, leave-day picker (month grid + `selectedDates`). No engine calendar module. |

**Summary:** Logbook generation is driven by `engine/logbookEngine.js`. Route list comes from `engine/parseRouteListExcel.js` (raw + enrich). Distances are provided by `engine/routing/mockRouting.js` only; there is no real routing/distance API in this project.

---

## 2. Pipeline After Routelist Preview

**enrichedRoutelist → ? → ? → logbook rows**

- **enrichedRoutelist**  
  - In-memory in `public/js/logbook-page.js` (variable `enrichedRoutelist`).  
  - Either from “Generate Routelist” (parse → enrich → optional `resolveRouteAddresses`) or re-parsed from uploaded Excel when generating logbook without using the preview.

- **→ runEngineWithRoutes(routes)**  
  - Builds engine input (routes, startDate, endDate, homeAddress, openingKm, currentWeek, leaveDays, workSaturdays, `routingService: window.mockRoutingService`, optional closingKm, manualEntries, employerName).  
  - Calls `window.logbookEngine.runLogbookEngine(engineInput)`.

- **→ runLogbookEngine (engine/logbookEngine.js)**  
  - Step 1: **expandRoutes** → `visits` (per-day visit list in date range).  
  - Step 2: **getDistances(home, uniqueAddresses)** → `homeToVisits` (HOME→address map).  
  - Step 3: Group visits by date; for each day, **getDistance** for each consecutive pair and for last visit→HOME → `sequentialDistances`.  
  - Step 4: **Combine** homeToVisits + sequentialDistances → `allDistances`.  
  - Step 5: **generateLogbookEntries(visits, allDistances, …)** → `entries` (logbook rows).  
  - Post: odometer checks, single-source totals, optional closingKm adjustment.  
  - Returns `{ entries, totals, meta }`.

- **→ logbook rows**  
  - `result.entries` is the array of logbook rows.  
  - UI calls `exportLogbookToXlsx(result)` and downloads `auto-logbook-sa-logbook.xlsx`.

So the pipeline is:

**enrichedRoutelist → runEngineWithRoutes (input build) → runLogbookEngine (expand → distances → combine → generateLogbookEntries) → result.entries (logbook rows) → exportLogbookToXlsx.**

---

## 3. Step-by-Step Documentation

### Step 1 – Visit expansion (calendar of visits)

| Item | Value |
|------|--------|
| **File** | `engine/logbookEngine.js` |
| **Function** | `expandRoutes(routes, startDate, endDate, currentWeek, leaveDays)` |
| **Responsibility** | Builds the calendar of visits: iterates every day from `startDate` to `endDate`; for each day derives weekday and 4-week cycle; for each route, if that route’s `days[dayKey]` and `weeks` match, adds a visit (date, customer, address parts, fullAddress, rowIndex). Skips leave days. Returns sorted, deduplicated visits (by date + customer). No separate “calendar generation” module – this is the engine’s calendar logic. |

### Step 2 – Route filtering

| Item | Value |
|------|--------|
| **File** | `public/js/logbook-page.js` (routelist path); `engine/parseRouteListExcel.js` (enrich) |
| **Function** | Filter in UI: after `enrichRouteRows(raw)` a `.filter()` keeps rows with valid customer (non-empty, length ≥ 3, not numeric-only, not `<TEMP>` etc.). `enrichRouteRows` itself drops rows without customer or without any active day. |
| **Responsibility** | Ensure only valid, active routes are passed to the engine. No separate “route filtering” step inside `runLogbookEngine`; filtering is in parse/enrich and in the UI before calling the engine. |

### Step 3 – Trip sequence generation

| Item | Value |
|------|--------|
| **File** | `engine/logbookEngine.js` |
| **Function** | `generateLogbookEntries` (and the preceding grouping in `runLogbookEngine`). Visits are grouped by date in `runLogbookEngine` (`visitsByDate`); within each day, visits are ordered by `rowIndex`. Trip sequence per day is fixed: Home → first visit → … → last visit → Home. |
| **Responsibility** | Define the daily trip order: visits sorted by `rowIndex`; sequence is Home → V1 → V2 → … → Vn → Home. No separate “trip sequence” function; sequence is implied by visit order and then implemented inside `generateLogbookEntries`. |

### Step 4 – Distance calculation

| Item | Value |
|------|--------|
| **File** | `engine/logbookEngine.js` (orchestration); `engine/routing/mockRouting.js` (implementation) |
| **Function** | In `runLogbookEngine`: Step 2 calls `routingService.getDistances(homeAddress, uniqueAddresses)` for HOME→each visit address. Step 3 calls `routingService.getDistance(fromAddress, toAddress)` for each consecutive visit pair and for last visit→HOME. `mockRouting.js`: `getDistance` and `getDistances` return fixed 10 km (no real routing). |
| **Responsibility** | Produce a distance map used by the engine: keys like `HOME→{fullAddress}` and `{fullAddress1}→{fullAddress2}` or `{fullAddress}→HOME`, values in km. In this project, all distances are mock (10 km). |

### Step 5 – Logbook row creation

| Item | Value |
|------|--------|
| **File** | `engine/logbookEngine.js` |
| **Function** | `generateLogbookEntries(visits, distanceMap, vehicleOpeningKm, homeAddress, startDate, endDate, routes, manualEntries, workSaturdays, leaveDays)` |
| **Responsibility** | For the full date range: add placeholder rows for leave days, public holidays, non-work days (openingKm = closingKm, 0 km). For work days with visits: emit one logbook row per segment (Home→first, then each visit→next, then last→Home) with openingKm, closingKm, businessKm, privateKm (0), purpose, from, to. Apply manual entry overrides; then recompute odometer continuity from `vehicleOpeningKm`. Return the final array of logbook rows. |

---

## 4. Logbook Entry Structure (Current)

Each logbook row in `result.entries` is an object with the following shape (as produced by the engine and exported to Excel):

```js
{
  date,        // string, YYYY-MM-DD
  day,         // string, e.g. "Mon" (en-ZA short weekday)
  openingKm,   // number
  closingKm,   // number
  businessKm,  // number
  privateKm,   // number (0 for engine-generated segments)
  purpose,     // string, e.g. "Sales Visit – CustomerName", "Return Home", "Leave Day", "Public Holiday", "Non-Work Day"
  from,        // string (address or "HOME" / homeAddress)
  to           // string (address or homeAddress)
}
```

Excel export in `public/js/logbook-page.js` uses the column order:  
Date, Day, Opening KM, Closing KM, Business KM, Private KM, Purpose, From, To.

So the project uses a **richer** structure than the minimal `{ date, from, to, purpose, distanceKm }`: it includes odometer (opening/closing), business vs private km, and day label.

---

## 5. What’s Missing vs a Full Logbook Generator

| Gap | Current state | Full generator expectation |
|-----|----------------|----------------------------|
| **Real distance calculation** | Only `engine/routing/mockRouting.js` (fixed 10 km). No Directions/Distance Matrix API. | Real routing (e.g. Google Directions/Distance Matrix or equivalent) to get driving km between addresses. |
| **Real routing service in app** | Logbook page always uses `window.mockRoutingService`. Server has no routing endpoints. | Optional use of a routing service (with API key) and/or server-side proxy for distance APIs. |
| **Calendar generation as a dedicated module** | No separate “calendar” module. Visit expansion is inside `expandRoutes`; leave calendar is UI-only. | Optional: reusable calendar/date-range utility used by both UI and engine (e.g. explicit “business days in range” or public-holiday list). |
| **Visit ordering / trip optimisation** | Trip order per day is by routelist `rowIndex` only. No optimisation (e.g. shortest route). | Optional: reorder same-day visits to minimise distance or time. |
| **Export layer** | Export is inline in `logbook-page.js` (`exportLogbookToXlsx`). No shared export module or formatting layer. | Optional: dedicated export/formatter (e.g. in `engine/` or `engine/exports/`) for XLSX and any future formats. |
| **Reason/purpose on routes** | Visit purpose defaults to `firstVisit.reason || 'Sales Visit'`. Routelist parser does not map a “reason” column. | Optional: routelist column for purpose/reason and pass-through to logbook purpose. |
| **Private km / closing odometer** | Engine supports `closingKm` and computes private km and business-use % when provided. No UI prefill or validation. | Optional: clearer UI for closing odometer and validation (e.g. closing ≥ last entry’s closingKm). |
| **Address resolution before engine** | Geocoding only enriches routelist addresses. Engine uses addresses as-is; distance is mock. | With real routing, address resolution (and possibly validation) is important so that routing API receives consistent addresses. |
| **Engine tests in this repo** | No tests under `engine/` or `public/js/` in the standalone app. | Unit/integration tests for expandRoutes, generateLogbookEntries, and runLogbookEngine. |
| **Configurable public holidays** | `logbookEngine.js` uses a fixed `SA_PUBLIC_HOLIDAYS_2026` (and Sunday shift). | Configurable or yearly holiday list (or external source). |

---

## Summary

- **Present:** Routelist parsing and enrichment, visit expansion over a date range with 4-week cycle and leave days, distance orchestration (with a pluggable `routingService`), logbook entry generation with SARS-oriented fields, odometer continuity, totals and optional closing km, XLSX export, leave-day calendar UI. Logbook entry structure is full (date, day, opening/closing/business/private km, purpose, from, to).
- **Missing for a “full” generator in this codebase:** Real distance calculation (replace or supplement mock routing), optional trip ordering/optimisation, dedicated export/formatting layer, routelist “reason” column, configurable holidays, and tests for the engine.

---

*End of audit. No code was modified.*
