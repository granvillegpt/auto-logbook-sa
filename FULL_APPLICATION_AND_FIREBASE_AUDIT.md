# Full Application and Firebase Audit — Auto Logbook SA

**Audit type:** Read-only analysis. No files were modified.  
**Scope:** Frontend application, logbook engine, Excel export, manual adjustments, Firebase configuration.  
**Goal:** Identify structural risks, logic issues, performance concerns, and Firebase configuration problems before production.

---

## 1. Application Architecture Review

### 1.1 Separation of concerns

| Layer | Location | Notes |
|-------|----------|--------|
| UI | `public/js/logbook-page.js`, `public/logbook.html`, `public/css/*.css` | Single IIFE; no framework. |
| Engine | `public/engine/logbookEngine.js` | Exposed as `window.logbookEngine`; also supports `module.exports` for Node. |
| Parser | `public/engine/parseRouteListExcel.js`, `public/engine/parsers/businessRouteParser.js` | Raw parse + enrich; no dependency on UI. |
| Export | `exportLogbookToXlsx()` inside `logbook-page.js` | Export logic lives in the UI file; reads DOM and `result` + module-level `leaveDaysArray` / `manualEntriesArray`. |
| Date utilities | `public/engine/dateRange.js` | `taxYearToDateRange`, `isWorkDay` (Monday–Friday only). |

- **Finding:** Export and engine input assembly are in the same file as the UI and rely on global state (`leaveDaysArray`, `manualEntriesArray`, `window.currentRoutes`). This is acceptable for a single-page flow but couples export and summary to the page’s in-memory state.
- **Circular dependencies:** Script load order in `logbook.html` is explicit (XLSX → parseRouteListExcel → businessRouteParser → dateRange → logbookEngine → routing → config → geocode → logbook-page). No circular `require`/import; the engine does not reference the UI.

### 1.2 Issues

| # | File(s) | Explanation | Severity | Recommended fix |
|---|--------|-------------|----------|------------------|
| A1 | `public/js/logbook-page.js` | `exportLogbookToXlsx` and engine-input building live in the UI script and depend on global arrays. Summary “Leave Days Applied” uses only `leaveDaysArray` (no merge with engine result), so if the user never opened the leave modal, leave days from a previous session could be stale or empty. | Low | Document that export reflects current in-memory state; optionally persist/restore leave and manual data on load. |
| A2 | `public/js/logbook-page.js` vs `public/js/services/logbookService.js` | Logbook page uses `localStorage.getItem('autoLogbookRoutes')` and `localStorage.setItem(...)` directly. `logbookService.js` abstracts get/save/clear with a `STORAGE_MODE` (local/firebase) but is not used on the logbook page. | Medium | Use `logbookService.getRoutes()` / `saveRoutes()` / `clearRoutes()` so that when `STORAGE_MODE === 'firebase'` the same UI works with Firestore. |

---

## 2. Engine Logic Review

### 2.1 Visit generation and workDays

- **workDays:** Derived only from `route.days` (mon–sun). No `workSaturdays` or other special flags; Saturday is treated like other weekdays when present in a route.
- **No-visits branch:** After “leave” and “holiday”, the engine checks `visitsByDate.has(dateStr)`. If false, it then treats Sunday (0) and Saturday (6) as “Weekend”, and other weekdays not in `workDays` as “Non-Work Day”. Work weekdays with no visits produce no row (no “no trips” placeholder).
- **Manual trips:** Injected after the main date loop; same-date generated entries are removed and replaced by one entry per manual. Odometer is then recalculated in a single forward pass.

### 2.2 Odometer and totals

- **Odometer:** Rebuilt in one pass after manual merge; each entry’s `openingKm` / `closingKm` set from `runningOdometer` and `businessKm`/`privateKm`. Post-step verifies first `openingKm` and sequential continuity.
- **Totals:** Single block: `totalBusinessKm` from entries; if `closingKm` provided, `totalTravelKm = closing - opening`, `totalPrivateKm = totalTravelKm - totalBusinessKm`, with guards for negative values and `businessUsePercentage` capped at 100.
- **Closing KM override:** When user provides closing Km, the last entry’s `closingKm` is overwritten with that value for display; the rest of the chain is already consistent.

### 2.3 Edge cases and risks

| # | File | Explanation | Severity | Recommended fix |
|---|------|-------------|----------|------------------|
| E1 | `public/engine/logbookEngine.js` | Fallback branch when `!startDate \|\| !endDate`: iterates only over `visitsByDate.entries()`, so dates in range with no visits are omitted. If something ever called the engine without dates, the logbook would have date gaps. | Low | Document that `startDate` and `endDate` are required for full-date-range behaviour; keep the fallback only for legacy/code paths that rely on it. |
| E2 | `public/engine/logbookEngine.js` | `generateLogbookEntries` when `routes` is null/empty: `workDays` defaults to `[1,2,3,4,5]`. So “no routes” still produces weekdays; only visit expansion would yield no visits. | Low | Acceptable; document that “no routes” implies no route-driven visits but weekdays are still work days. |
| E3 | `public/engine/logbookEngine.js` | Manual entries with same date: each manual removes all generated entries for that date and pushes one manual entry. Two manual entries for the same date result in two rows for that date (both manual). | Low | Optional: dedupe manual entries by date in the engine or prevent duplicate dates in the UI. |

---

## 3. Manual Adjustments System Review

### 3.1 Data and integration

- **leaveDaysArray:** Array of `{ date, type?, purpose?, reason?, businessKm? }`. Used by the engine as `input.leaveDays` and by the Summary from the same in-memory array.
- **manualEntriesArray:** Array of `{ date, from, to, purpose, day, businessKm, privateKm }`. Passed as `engineInput.manualEntries`; engine injects them and uses routing for distance when from/to present.
- **selectedManualDates:** Multi-date selection; on Save, one entry per selected date is pushed to `manualEntriesArray` (no duplicate-date check in the selection).

### 3.2 Integrity

- **Multi-date selection:** Calendar toggles dates in/out of `selectedManualDates`; chips show reason + date and remove by date. Behaviour is consistent with the Leave modal pattern.
- **Duplicate prevention:** No check that the same date is not added twice in one “Add manual trip” action (e.g. two clicks on the same day). Result would be two manual entries for the same date. | Low | Optional: when adding, filter `selectedManualDates` to unique dates or prevent re-adding in the calendar.
- **Engine input:** `leaveDays: leaveDaysArray || []` and `manualEntries: manualEntriesArray` (when length > 0) are passed correctly; no transformation or filtering.

### 3.3 Normalize leave days

- **normalizeLeaveDays** (logbook-page.js): Converts string dates to `{ date, reason: 'Leave' }`; objects with both `type` and `purpose` keep them; otherwise uses `reason`. Used when opening the leave modal. All leave types (sick, annual, etc.) are stored in one array and passed as-is to the engine.

---

## 4. Excel Export Review

### 4.1 Logbook sheet

- **Source:** `result.entries` only. Columns: Date, Day, From, To, Shop Name, Purpose, Opening KM, Closing KM, Business KM, Distance KM. “Weekend”/“Public Holiday”/“Non-Work Day” rows use merged From/To and purpose label.
- **Totals row:** Uses last entry’s `closingKm`, `totals.totalBusinessKm`, and same again for the last two columns.
- **Numeric format:** `#,##0.00` applied to numeric cells in the data range; headers and structure are consistent.

### 4.2 Summary sheet

- **Manual Trips Added:** Built from `manualEntriesArray`; for each item, a matching entry in `result.entries` (by date + from/to) is used for From/To/Distance KM when found; otherwise raw manual values. Correct for showing engine-derived distance when available.
- **Leave Days Applied:** Built only from `leaveDaysArray`; each row is date + description (weekday + purpose). No filtering by type.
- **Weekend Trips Detected:** From `result.entries`: weekend dates with `!isNoTripsDay(e)` (i.e. has business km). Reporting-only.
- **Early return:** `if (!result || !result.entries || result.entries.length === 0) return;` — so if the engine returned no entries (e.g. full leave range or bug), no file is generated and the user gets no feedback beyond no download. | Medium | When `result.entries.length === 0`, show a message (e.g. “No logbook entries for this period”) and optionally still export a minimal workbook with headers/metadata.

### 4.3 Filters and column order

- No filters applied to `result.entries` for the Logbook sheet; column order is fixed. Business KM and Distance KM both show `businessKm` (correct for SARS-style logbook).

---

## 5. UI Stability Review

### 5.1 State and modals

- **Global state:** `leaveDaysArray`, `manualEntriesArray`, `selectedDates` (Set), `selectedManualDates` (array), `currentCalendarMonth/Year`, `window.currentRoutes`, `enrichedRoutelist`, `lastLogbookResult`. All are module-level; no formal state machine.
- **Modal open/close:** Leave and manual-trip modals clear their error elements and (where applicable) selection on open and on close (X and backdrop). Manual trip clears `selectedManualDates` on open and after save.

### 5.2 Event listeners

- **Count:** Dozens of `addEventListener` calls in `logbook-page.js` (single form submit, multiple buttons and modals). Listeners are attached once during init (e.g. `initManualModals`, `initLeaveModal`, `initFormSubmit`). No obvious duplicate registration for the same element and event.
- **Risk:** If init functions were ever called more than once (e.g. dynamic re-mount of the page section), listeners would stack. Currently there is no re-init; page loads once.

### 5.3 Memory and cleanup

- **No teardown:** No `removeEventListener` or cleanup on navigation. For a single static logbook page this is acceptable.
- **References:** `window.currentRoutes` and `lastLogbookResult` hold references to potentially large objects; they are replaced on new generate/load, so no growing leak.

### 5.4 Issues

| # | File | Explanation | Severity | Recommended fix |
|---|------|-------------|----------|------------------|
| U1 | `public/js/logbook-page.js` | `validateForm()` requires both opening and closing Km. If the product allows “business only” (no closing), the UI currently blocks generate. | Low | If “business only” is supported, make closing Km optional in validation and document behaviour when it’s missing. |
| U2 | `public/logbook.html` | Scripts loaded synchronously; XLSX and engine are blocking. Large routelists could make the first interaction feel slow. | Low | Consider async loading of XLSX or engine after first paint; keep current order for correctness. |

---

## 6. Performance Risks

| # | Location | Explanation | Severity | Recommended fix |
|---|----------|-------------|----------|------------------|
| P1 | `public/engine/logbookEngine.js` | Sequential distance calls: for each (date, visit list) and for each manual trip, `getDistance`/`getDistances` are awaited one-by-one. Large routelists and many manual trips increase latency. | Medium | Batch or parallelise distance requests where the routing API allows (e.g. matrix or multi-destination). |
| P2 | `public/js/logbook-page.js` (export) | Manual Trips Summary: for each `manualEntriesArray` item, a linear scan over `result.entries` to find a match. O(n×m). | Low | For very large n/m, build a map by (date, from, to) once and look up per manual entry. |
| P3 | `public/engine/parseRouteListExcel.js` | Rows processed in a single loop; no chunking. Very large sheets could hold a lot in memory. | Low | Document max recommended rows; consider streaming or row limits for very large files. |
| P4 | `public/engine/logbookEngine.js` | `getHolidayMapForYear(year)` cached in `holidayYearCache`. No size limit; long-running process could cache many years. | Low | Acceptable; optional cap on cache size. |

---

## 7. Error Handling Review

### 7.1 Engine

- **Throws:** Missing/invalid `visits`, `distanceMap`, `vehicleOpeningKm`, `homeAddress`; invalid `startDate`/`endDate`; missing `routingService`; odometer mismatch; missing/invalid distance for a segment. These surface as rejected promises and are shown in the status area.
- **invalidAddresses:** Routing can return a list of invalid addresses; the UI formats them with store names and shows them in the status area. Good for debugging.

### 7.2 Parser

- **parseRawRouteListExcel:** Throws if no XLSX, no sheet, or empty sheet. Does not throw on bad header or no weekday columns; `columnMap` can have nulls and rows can be skipped by `enrichRouteRows` (e.g. no customer, no active day). Empty result is possible.
- **cellToBoolean:** Only `true`, `1`, `x`, `yes` (case-insensitive) are true. Other values (e.g. “Y”, “✓”) become false. Documented in prior audits; no change in this audit.

### 7.3 UI validation

- **Form:** `validateForm()` ensures required fields and routes and confirmation checkbox; Generate is disabled when invalid.
- **Manual trip Save:** Checks at least one date selected, reason present, and all selected dates within tax year range; errors shown in modal.
- **Leave modal:** Same pattern: at least one date; range check; errors in modal.

### 7.4 Gaps

| # | File | Explanation | Severity | Recommended fix |
|---|------|-------------|----------|------------------|
| H1 | `public/js/logbook-page.js` | `exportLogbookToXlsx(result)` returns early when `result.entries.length === 0` with no user message. | Medium | Show status message when there are no entries and skip download, or export minimal file with message in a sheet. |
| H2 | `public/engine/logbookEngine.js` | Routing failures (e.g. network or API limit) propagate as rejections; message is generic. | Low | Map known error types to clearer messages (e.g. “Distance service unavailable”). |
| H3 | `public/engine/parseRouteListExcel.js` | Sparse rows: `r[columnMap.satCol]` may be undefined if the row has fewer cells than the column index; `cellToBoolean(undefined)` is false. | Low | Document or handle undefined (e.g. treat as false explicitly) so behaviour is obvious. |

---

## 8. Firebase Configuration Audit

### 8.1 Project layout

- **firebase.json / .firebaserc:** Not found in the project root. Hosting, Firestore rules, and deployment config may live in another repo or be added later.
- **Cloud Functions:** Present under `functions/`: `index.js` (HTTP `generateLogbook`), `engineAdapter.js`, `services/routingService.js`.

### 8.2 Functions

- **index.js:** POST-only; validates `routes`, `startDate`, `endDate`, `homeAddress`, `openingKm`; forwards full `req.body` to `generateLogbook(input)`. Returns 200 with `{ success: true, data: result }` or 500 with `err.message`. No CORS, rate limit, or auth.
- **engineAdapter.js:** Requires `../engine/logbookEngine` and `../engine/dateRange`. In this repo, `engine/logbookEngine.js` exists at project root (sibling to `public/`), so the require path resolves. Uses `./services/routingService`.
- **routingService.js:** Placeholder: `getDistance` and `getDistances` both return `Promise.reject(...)`. So any call to the Cloud Function that needs distances will fail until a real implementation (e.g. Google Distance Matrix with API key) is provided.

### 8.3 Frontend and Firebase

- **Storage mode:** `public/js/services/storageAdapter.js` sets `STORAGE_MODE = 'local'`. `logbookService.js` has firebase placeholders (`firebaseGetRoutes`, etc.) but they are not used because the logbook page uses `localStorage` directly.
- **No Firebase SDK in logbook flow:** The main logbook page does not initialise Firebase or Firestore; it is built to run standalone (local only). Firebase is only relevant for optional future storage and for Cloud Functions if the UI is switched to call them.

---

## 9. Firebase Security Risks

| # | Area | Explanation | Severity | Recommended fix |
|---|------|-------------|----------|------------------|
| F1 | Cloud Function | No authentication on `generateLogbook`. Anyone who can reach the function URL can send arbitrary body and consume routing/CPU. | High | Add authentication (e.g. Firebase Auth ID token or API key) and reject unauthenticated requests. |
| F2 | Cloud Function | No CORS headers. Browser requests from a different origin may be blocked or behave inconsistently. | Medium | Set CORS (e.g. allowed origins) for the HTTP function. |
| F3 | Request size | No limit on `req.body` size. Very large `routes` could cause high memory or timeouts. | Medium | Enforce a max body size and/or max length of `routes`. |
| F4 | Firestore | No `firestore.rules` or Firebase config in the repo. If Firestore is enabled later, default rules might be open. | High | Add and deploy strict Firestore rules before going live; never leave test-mode read/write. |
| F5 | API keys | Google Geocode API key is expected from `window.GOOGLE_GEOCODE_API_KEY` (e.g. in local-config). If deployed, key must be restricted (HTTP referrer, API restrictions). | Medium | Document key restriction; avoid committing keys; use env or secure config in production. |
| F6 | Cloud Function routing | Placeholder routing service rejects all calls. No API key or secrets management shown. | Medium | Implement routing with key from environment (e.g. `functions.config().google.api_key` or Secret Manager). |

---

## 10. Recommended Fixes (Prioritized)

### High

1. **F1 – Cloud Function auth:** Add authentication (e.g. Firebase Auth ID token or API key) to `generateLogbook` and return 401 when missing/invalid.
2. **F4 – Firestore rules:** Add and deploy Firestore rules before production; ensure no open read/write.

### Medium

3. **A2 – Use logbookService:** Refactor logbook page to use `logbookService.getRoutes()` / `saveRoutes()` / `clearRoutes()` instead of direct `localStorage` so Firebase storage mode works when enabled.
4. **H1 – Empty export feedback:** When `result.entries.length === 0`, show a clear message and do not silently skip download (or export a minimal workbook with a message).
5. **F2 – CORS:** Configure CORS for the Cloud Function if the app is served from a different origin.
6. **F3 – Request size:** Limit request body size and/or max `routes` length for the Cloud Function.
7. **P1 – Routing performance:** Where possible, batch or parallelise distance requests in the engine (or in the Cloud routing service).

### Low

8. **E3 – Duplicate manual dates:** Optionally dedupe manual entries by date in the engine or prevent duplicate dates in manual trip selection.
9. **U1 – Closing Km optional:** If “business only” is supported, make closing Km optional in `validateForm` and document behaviour.
10. **H2 – Routing errors:** Improve error messages for known failure types from the routing service.
11. **H3 – Parser sparse rows:** Document or handle undefined cell values for weekday columns when row is sparse.
12. **P2 – Summary manual match:** For very large data, build a (date, from, to) map once for the Manual Trips Summary section.

---

**End of audit.** No code or configuration was changed; this document is analysis and recommendation only.
