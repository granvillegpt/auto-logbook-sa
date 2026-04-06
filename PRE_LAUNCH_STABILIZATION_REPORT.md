# Pre-launch stabilization pass – summary report

## Scope

Structural fixes, CSS separation, dependency reliability, API safety, and maintainability only. **No changes were made to logbook calculation logic, route generation, distance calculations, Excel export structure, or parser algorithms.**

---

## Files changed

| File | Change |
|------|--------|
| **public/components/legal-modals.html** | **Created.** Single shared partial containing Disclaimer, Terms, Privacy, and Refund Policy modals. |
| **public/js/legal-modals.js** | **Created.** Fetches `components/legal-modals.html`, injects into `#legal-modals-root`, and binds footer links and close handlers. |
| **public/index.html** | Removed duplicate legal modal markup and Refund modal block; added `#legal-modals-root`, `legal-modals.js`; removed inline legal modal binding; kept Example Logbook and Review modal logic. |
| **public/logbook.html** | Removed duplicate Disclaimer/Terms/Privacy modals; added `#legal-modals-root`, Refund Policy footer link, `legal-modals.js`; replaced inline `style="display:none"` with class `hidden` where applicable; enhanced engine script-order comment; mobile/desktop toggle now uses `classList` for `.hidden`. |
| **public/css/styles.css** | Removed logbook-only rules: `.page-container`, `.routes-table-wrapper`, `.route-address-grid`, `.optional-adjustments-section`, `.optional-adjustments-label`. Added `.hidden { display: none !important; }`. |
| **public/css/logbook-page.css** | Added moved logbook-only rules (page-container, routes-table-wrapper, route-address-grid, optional-adjustments-section, optional-adjustments-label). Removed duplicate `.secondary-btn` block (standardized on `.btn-secondary` from styles.css). |
| **public/js/logbook-page.js** | Replaced `style.display` toggles with `classList.add('hidden')` / `classList.remove('hidden')` for clear-routes btn, loading block, otherReasonContainer, and generate-button visibility in all success/error branches. All error paths in generate flow now clear loading and restore button state. |
| **public/js/reviews.js** | Replaced `successEl.style.display` with `classList.add('hidden')` / `classList.remove('hidden')` for review success message. |
| **public/engine/routing/distanceMatrixRouting.js** | Set `DELAY_BETWEEN_BATCHES_MS` from 75 to **100 ms** (throttling already in place: max 5 concurrent, queue, delay between batches). No change to distance or haversine logic. |
| **server.js** | Added **20 s** timeout for Google API proxy (`proxyToGoogle`) and for `/api/distancematrix`; on timeout, return 504 with clear error message. **API key check:** server now exits with `process.exit(1)` if `GOOGLE_GEOCODE_API_KEY` is not set (single required env var). |
| **README.md** | **Created.** Includes “Script load order (logbook page)” table and basic run instructions. |
| **PRE_LAUNCH_STABILIZATION_REPORT.md** | This report. |

---

## Fixes implemented

1. **FIX 1 – Legal modals**  
   Single source of truth: `public/components/legal-modals.html`. Loaded via `js/legal-modals.js` into both `index.html` and `logbook.html`. Refund Policy link added to logbook footer.

2. **FIX 2 – Logbook-only CSS**  
   `.page-container`, `.routes-table-wrapper`, `.route-address-grid`, `.optional-adjustments-section`, `.optional-adjustments-label` moved from `styles.css` to `logbook-page.css`. `styles.css` kept for global/landing styles only.

3. **FIX 3 – Button system**  
   Logbook uses `.btn .btn-primary` and `.btn .btn-secondary` only. Clear Routelist button updated to `btn btn-secondary hidden`. Duplicate `.secondary-btn` rules removed from `logbook-page.css`.

4. **FIX 4 – XLSX localized**  
   Confirmed: XLSX is vendored at `public/vendor/xlsx.full.min.js` and loaded in logbook with script order 1–9 unchanged.

5. **FIX 5 – Rate protection**  
   Throttling in `distanceMatrixRouting.js`: max 5 concurrent requests, **100 ms** delay between batches. No change to calculations or haversine fallback.

6. **FIX 6 – Server timeout**  
   Google API proxy and `/api/distancematrix` use a 20 s abort; on timeout, response is 504 with message: “Google API request timed out after 20 seconds. Please try again.”

7. **FIX 7 – Inline display styles**  
   Replaced `style="display:none"` / `style="display: none"` with class `.hidden` in logbook and index. JS toggles updated to `classList.add('hidden')` / `classList.remove('hidden')`. `.hidden` defined in both `styles.css` and `logbook-page.css`.

8. **FIX 8 – Script order documented**  
   `logbook.html` comment expanded to describe why each script is in order. README added with “Script load order (logbook page)” table.

9. **FIX 9 – API key validation**  
   Server requires `GOOGLE_GEOCODE_API_KEY`; if missing, logs “Google API key missing. Set GOOGLE_GEOCODE_API_KEY in the environment.” and exits with `process.exit(1)`.

10. **FIX 10 – Loading state reset**  
    All generate-logbook error/short-circuit paths (no routes, engine not loaded, promise rejection) now call the same cleanup: hide loading block (`classList.add('hidden')`), show button (`classList.remove('hidden')`), and `validateForm()` so the UI is never stuck in loading.

---

## Confirmation: engine logic untouched

- **public/engine/logbookEngine.js** – not modified.
- **public/engine/parseRouteListExcel.js** – not modified.
- **public/engine/parsers/businessRouteParser.js** – not modified.
- **public/engine/dateRange.js** – not modified.
- **public/engine/routing/distanceMatrixRouting.js** – only throttle constants and queue/run logic; no change to `haversineKm`, `haversineFallbackKm`, `parseMatrixResponse*`, `tryHaversine*`, or distance calculations.
- **public/engine/routing/googleGeocodeService.js** – not modified.
- Excel export in **logbook-page.js** (`exportLogbookToXlsx`) – not modified (weekend/holiday export formatting was done earlier; not part of this pass).

---

## Line-count summary (approximate)

| Area | Effect |
|------|--------|
| HTML (index + logbook) | Net reduction (removed ~90 lines of duplicate modals; added root + script refs). |
| CSS | ~50 lines moved from styles.css to logbook-page.css; ~20 lines removed (duplicate .secondary-btn, .primary-btn already removed earlier). |
| JS (logbook-page, reviews) | ~25 lines touched (display → classList; error-path cleanup). |
| Server | ~25 lines (timeout + API key check). |
| New files | legal-modals.html (~95), legal-modals.js (~75), README.md (~45), this report. |

Total: **10 fixes** applied; **engine calculation and parser logic unchanged.**
