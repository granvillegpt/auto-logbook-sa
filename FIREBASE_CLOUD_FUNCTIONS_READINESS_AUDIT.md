# Firebase Cloud Functions Readiness Audit

**Project:** Auto Logbook SA  
**Scope:** `public/engine/` and listed engine/supporting modules.  
**Type:** Read-only architecture audit. No code was modified.

---

## Engine Compatibility

| File | Status | Notes |
|------|--------|------|
| **logbookEngine.js** | **NEEDS MINOR ADJUSTMENT** | No DOM/browser APIs. Uses `typeof window !== 'undefined'` only to attach `window.logbookEngine`; has `module.exports` for Node. Depends on **global `isWorkDay`** (set by dateRange.js). Module-level `holidayYearCache` (Map) is safe (keyed by year). Pure async input → output; routing injected via `routingService`. |
| **parseRouteListExcel.js** | **NEEDS MINOR ADJUSTMENT** | No DOM. Expects **`global.XLSX`** (SheetJS). Uses `global`/`window`/`this` IIFE and `module.exports`. In Node, caller must set `global.XLSX = require('xlsx')` (or equivalent) before use, or XLSX must be injected. Handles `Buffer` for read type. |
| **businessRouteParser.js** | **SAFE** | Pure parsing. IIFE attaches to global and `module.exports`. No browser APIs, no XLSX, no fetch. |
| **dateRange.js** | **NEEDS MINOR ADJUSTMENT** | No DOM. **No `module.exports`** — only `global.dateRange` and `global.isWorkDay`. Works in Node if loaded before engine (so `isWorkDay` is on global). Prefer adding `module.exports` for clear Node/CF use. |
| **distanceMatrixRouting.js** | **NEEDS MINOR ADJUSTMENT** | No DOM. Uses **`fetch(url)`** with **`API_PATH = '/api/distancematrix'`** (relative). In Cloud Functions there is no origin; relative URLs fail. **Requires:** configurable base URL or direct Google API calls with server-side API key. Uses `AbortController` (Node 18+) and `module.exports`. In-memory cache/queue are request-agnostic (keyed by address pairs). |
| **googleGeocodeService.js** | **NEEDS MINOR ADJUSTMENT** | No DOM. Uses **`fetch(url)`** with **relative paths:** `GEOCODE_URL = '/api/geocode'`, `FIND_PLACE_URL`, `TEXT_SEARCH_URL`, `PLACE_DETAILS_URL`. Same as above: in CF these must be absolute or replaced with direct Google API calls + API key. Uses `module.exports`. |

**Other engine files (not in primary list but present):**

| File | Status | Notes |
|------|--------|------|
| **workflow2TemplateParser.js** | **NEEDS MINOR ADJUSTMENT** | Same as parseRouteListExcel: expects **`global.XLSX`**. No DOM. |
| **mockRouting.js** | **SAFE** | Pure in-memory mock; no network, no DOM. |

---

## Browser Dependency Check

- **`window`:** Used only for **environment detection** and **attaching globals** in IIFEs:  
  `(typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : this)`.  
  No DOM access. Safe for Node when `global` is used.
- **`document`:** Not used in any audited engine file.
- **`localStorage`:** Not used in any audited engine file.
- **`alert`:** Not used in any audited engine file.
- **DOM APIs:** None (no getElementById, querySelector, addEventListener, etc.) in `public/engine/`.

**Conclusion:** No browser-only DOM or storage usage. Only environment binding (window vs global) and, in routing/geocode modules, **relative URLs** that assume a browser origin.

---

## Module Compatibility

- **require:** No engine file uses `require()`. Dependencies (XLSX, fetch) are expected as globals or environment.
- **module.exports:** Present in: logbookEngine.js, parseRouteListExcel.js, businessRouteParser.js, distanceMatrixRouting.js, googleGeocodeService.js, mockRouting.js, workflow2TemplateParser.js. **Missing in dateRange.js.**
- **Global usage:**  
  - **logbookEngine:** Reads `global.DEBUG_HOLIDAYS`; expects **`isWorkDay`** on global (from dateRange.js).  
  - **parseRouteListExcel / workflow2TemplateParser:** Expect **`global.XLSX`**.  
  - **distanceMatrixRouting:** Reads `global.DEBUG_ROUTING`; attaches `global.distanceMatrixRoutingService`.  
  - **googleGeocodeService:** Reads `global.GEOCODE_DEV_MODE`; attaches `global.geocodeCache`, `resolveRouteAddresses`, `geocodeOne`.  

All of this is compatible with Node/Cloud Functions provided globals are set (and, for XLSX/fetch, dependencies are provided or URLs fixed).

---

## External Dependencies

| Dependency | Where | Cloud Functions note |
|------------|--------|----------------------|
| **XLSX (SheetJS)** | parseRouteListExcel.js, workflow2TemplateParser.js | Not browser-only. In CF, use `require('xlsx')` and set `global.XLSX` (or inject) before loading parsers. |
| **fetch** | distanceMatrixRouting.js, googleGeocodeService.js | Available in Node 18+. Use **Node 18+** runtime in Firebase. |
| **AbortController** | distanceMatrixRouting.js | Available in Node 18+. |

No other external libraries detected in the audited engine files.

---

## Google API Calls

- **distanceMatrixRouting.js:** Calls **`fetch(API_PATH + '?origins=...&destinations=...')`** where `API_PATH = '/api/distancematrix'`. Designed for a **same-origin proxy** that adds the API key. In CF, either:  
  - Call an **absolute URL** to your own proxy, or  
  - Call **Google Distance Matrix API directly** with API key from config/env (and adjust this module or replace it with a CF-specific implementation).
- **googleGeocodeService.js:** Same pattern: **relative URLs** to `/api/geocode`, `/api/findPlace`, `/api/textSearch`, `/api/placeDetails`. In CF, same options: absolute proxy URL or direct Google API calls with key.

No browser-only networking (e.g. XMLHttpRequest). `fetch` in Node 18+ is suitable.

---

## Separation of Concerns

- **UI logic:** Confirmed in **logbook-page.js** (event handlers, DOM, form, export trigger). Not in `public/engine/`.
- **Engine logic:** Isolated in **public/engine/**. No DOM or UI code in the audited files.
- **Conclusion:** Clear separation; engine is callable from a server/CF context without DOM.

---

## Pure Engine Contract

**Input (runLogbookEngine):** Accepts a single object, e.g.:

- `routes` (array)
- `startDate`, `endDate` (YYYY-MM-DD)
- `homeAddress` (string)
- `openingKm` (number)
- `currentWeek` (1–4), `leaveDays` (optional), `closingKm` (optional), `employerName` (optional)
- **`routingService`** (object with `getDistance(origin, destination)` and `getDistances(origin, destinations)` returning Promises)

Optional: `visits` (precomputed), `manualEntries`, etc. as documented in the file.

**Output:** Promise resolving to:

- `entries` (array of logbook entry objects)
- `totals` (totalKm, totalBusinessKm, totalPrivateKm, businessUsePercentage)
- `meta` (startDate, endDate, employerName, generatedAt, closingKm, warnings)

No reliance on session, cookie, or browser state. **Contract is pure and stateless** for a given input; routing/geocode state is inside the injected services (caches/keyed by data, not by user/session).

---

## Statelessness

- **logbookEngine:** Stateless per invocation. Uses only input and injected `routingService`. `holidayYearCache` is keyed by year only (no user data).
- **Parsers (parseRouteListExcel, businessRouteParser, workflow2TemplateParser):** Stateless; no retained state between calls.
- **dateRange:** Stateless utilities only.
- **distanceMatrixRouting / googleGeocodeService:** Module-level **in-memory caches** (Map). Keys are addresses/address pairs, not user IDs. Safe for concurrent invocations from a reuse perspective; for strict per-request isolation you could use a new instance or clear caches per request (optional).

No use of session state or browser storage. No global mutation of user-specific data.

---

## Concurrency Safety

- Engine and parsers: Safe for parallel executions (no shared mutable user state).
- **distanceMatrixRouting / googleGeocodeService:** Shared in-memory caches across invocations (when the same Node process serves multiple calls). Cache keys are address-based; cross-request reuse is acceptable and can reduce API usage. No per-user state in cache keys.
- **holidayYearCache** in logbookEngine: Keyed by year; safe to share.

**Conclusion:** Safe to run in parallel Cloud Function invocations. Optional: instantiate routing/geocode per request if you want full isolation.

---

## API Layer Readiness

A wrapper of the form:

```js
exports.generateLogbook = onCall(async (request) => {
  return runLogbookEngine(request.data);
});
```

**cannot run as-is** because:

1. **`request.data`** must include a **`routingService`** with `getDistance` and `getDistances`. In CF you must construct this service (e.g. a version of distanceMatrixRouting that calls Google APIs with a key from env/config, or an HTTP client to your own proxy).
2. **Geocoding:** If the client sends raw Excel and you run parsing in CF, you need address resolution. That implies either:
   - Running **resolveRouteAddresses** in CF (with googleGeocodeService configured to use absolute URLs or direct Google API), or  
   - Resolving addresses elsewhere and sending pre-resolved routes to the engine.
3. **XLSX:** If parsing runs in CF, `global.XLSX` (or equivalent) must be set before requiring the route list parser.
4. **isWorkDay:** logbookEngine expects **global.isWorkDay**. So dateRange.js must be loaded (or its exports assigned to `global.isWorkDay`) before running the engine.

With the **structural changes** below, the engine can run behind a Cloud Function wrapper that:

- Loads/sets dateRange, XLSX, and a CF-compatible routing (and optionally geocode) service.
- Passes `request.data` (including `routingService`) into `runLogbookEngine` and returns the result.

---

## Required Changes Before Firebase Deployment

**Structural only (no change to calculation, routing, or export logic):**

1. **Configurable API base URL (or direct Google API)**  
   - **distanceMatrixRouting.js:** Replace or make configurable `API_PATH = '/api/distancematrix'` so that in CF it either calls an absolute URL (e.g. from env) or the Google Distance Matrix API directly with API key.  
   - **googleGeocodeService.js:** Same for `GEOCODE_URL`, `FIND_PLACE_URL`, `TEXT_SEARCH_URL`, `PLACE_DETAILS_URL`: configurable base or direct Google API with key.

2. **XLSX in Node**  
   - Before using parseRouteListExcel (or workflow2TemplateParser) in CF, set `global.XLSX = require('xlsx')` (or pass XLSX in and have parsers use it instead of global). No change to parser algorithm.

3. **dateRange.js export**  
   - Add `module.exports = { taxYearToDateRange, isWorkDay };` (or equivalent) and have the engine receive `isWorkDay` via dependency or ensure `global.isWorkDay` is set after requiring dateRange in the CF entrypoint.

4. **Runtime**  
   - Use **Node 18+** in Cloud Functions (for `fetch` and `AbortController`).

5. **CF entrypoint**  
   - Require/load: dateRange (and set global or pass isWorkDay), XLSX (set global or inject), routing service (CF-compatible), optionally geocode service. Then call `runLogbookEngine(request.data)` with a valid `routingService` (and optionally pre-resolved routes).

No changes to logbook math, trip generation, distance calculations, or Excel export structure.

---

## Final Verdict

**READY WITH MINOR CHANGES**

The engine and supporting modules are free of browser/DOM dependencies and are compatible with Node.js. They can run inside Firebase Cloud Functions (Node 18+) after:

- Making API base URLs configurable or switching to direct Google API calls with server-side API key.
- Providing XLSX and `isWorkDay` (dateRange) in the CF environment.
- Constructing and passing a CF-compatible `routingService` (and optionally geocode) into `runLogbookEngine`.

No refactor of core logic is required; only wiring and configuration for the server environment.
