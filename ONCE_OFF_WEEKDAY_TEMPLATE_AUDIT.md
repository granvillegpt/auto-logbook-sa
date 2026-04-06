# Audit: Once-Off Handling in Weekday Template Path

**Scope:** Weekday template only (parseRawRouteListExcel + enrichRouteRows). No changes to business parser, template detection, or Excel format.

---

## 1. Full weekday-template pipeline (traced)

| Stage | File | What happens |
|-------|------|----------------|
| **Raw parse** | `engine/parseRouteListExcel.js` | `parseRawRouteListExcel(buffer)` reads sheet, `detectHeaderRow()`, builds `columnMap` including `frequencyCol`, `startDateCol`, `endDateCol`, `weeksCol` via aliases (e.g. `['frequency', 'repeat']`, `['start date', 'startdate', 'start']`, `['end date', 'enddate', 'end']`, `['weeks', 'week']`). |
| **Enrichment** | `engine/parseRouteListExcel.js` | `enrichRouteRows(raw)` builds each route: **weeks** default `[1,2,3,4]`, overridden only from `columnMap.weeksCol` (parsed as comma-separated integers 1–4). **frequency** / **startDate** / **endDate** read from columns and attached to route only if present (`route.frequency`, `route.startDate`, `route.endDate`). **Frequency is never used to set `weeks`.** |
| **Route object** | Same | Route has `customer`, `address`, `days`, `weeks`, `rowIndex`, `fullAddress`; plus optional `frequency`, `startDate`, `endDate` when those columns exist. |
| **Normalization** | Not in parser | `normalizeFrequency()` and `isOnceOffFrequency()` live in **logbookEngine.js** only. They are not applied in the weekday parser or enrichment. |
| **Engine expansion** | `engine/logbookEngine.js` | `expandRoutes()` splits routes: **if `route.startDate`** → `routesWithOwnDates` (per-route date range; `isOnceOffFrequency(route.frequency)` used to set `rangeEnd = rangeStart` for once-off). **Else** → `legacyRoutes` (global date range + `route.weeks` and week cycle). |

---

## 2. Does the weekday parser store frequency, startDate, endDate?

**Yes.**

- **Location:** `engine/parseRouteListExcel.js`, `enrichRouteRows`, ~lines 253–261, 302–304.
- **frequency:** Read from `columnMap.frequencyCol` (header aliases `['frequency', 'repeat']`), trimmed string; set `route.frequency` if not null.
- **startDate / endDate:** Read from `columnMap.startDateCol` / `endDateCol`, parsed via `parseExcelDateToISOString()`, set `route.startDate` / `route.endDate` if not null.
- Raw Excel values are stored (e.g. `"Once-Off"`); no normalization in the parser.

---

## 3. Does the logbook engine use those fields for weekday routes?

**Yes, but only if `route.startDate` is set.**

- **Location:** `engine/logbookEngine.js`, `expandRoutes()`, ~lines 314–344.
- **Split:** `if (route.startDate)` → route goes to `routesWithOwnDates`; else to `legacyRoutes`.
- **routesWithOwnDates:** Uses `route.startDate`, `route.endDate`, `route.frequency`. For once-off (`isOnceOffFrequency(route.frequency)`), `rangeEnd = rangeStart`, so `expandRouteWithDateRange` produces a single day (startDate) when the weekday matches.
- **legacyRoutes:** Uses global date range and `route.weeks` (and week cycle). Does **not** use `route.frequency` or `route.startDate`/`route.endDate`. So weekday-template routes **without** Start Date are expanded as recurring over the full range with `weeks` (default [1,2,3,4]).

---

## 4. Does the weekday route object always get weeks = [1,2,3,4] when frequency is Once-Off?

**Yes, in the current code.**

- **Location:** `engine/parseRouteListExcel.js`, `enrichRouteRows`, ~lines 244–251, 298.
- **Logic:** `weeks = [1, 2, 3, 4]` by default. Overridden only when the **Week(s)** column has a value (comma-separated integers 1–4). The **Frequency** column is never used to set `weeks`.
- So for a row with Frequency = "Once-Off" and no Week(s) value, the route still has `weeks: [1, 2, 3, 4]`. That affects:
  - **Preview:** Weeks column shows `1,2,3,4` (from `route.weeks` in `renderRoutelistPreview`, logbook-page.js ~426).
  - **Engine:** Only matters for **legacy** routes (no startDate). For routes **with** startDate, the engine uses the per-route date range and `isOnceOffFrequency`, not `weeks`, so expansion can still be once-off if startDate is set.

---

## 5. Where "Once-Off" is effectively ignored

| Stage | What happens |
|-------|----------------|
| **Parser (parseRawRouteListExcel)** | Does not read frequency; only builds column indices. No issue. |
| **Enrichment (enrichRouteRows)** | Reads and stores `route.frequency` (and start/end dates). **Does not** derive `weeks` from frequency. So `weeks` stays `[1,2,3,4]` for Once-Off rows (unless Week(s) column is set). Once-Off is “ignored” for the **weeks** value and thus for **preview display**. |
| **Engine (expandRoutes)** | Once-Off is **not** ignored for routes that have `route.startDate`: they go to `routesWithOwnDates` and `isOnceOffFrequency(route.frequency)` is used. Once-Off is **ignored** for routes **without** `route.startDate`: they go to legacy path and are expanded as recurring (weeks 1–4). |
| **Preview (renderRoutelistPreview)** | Renders `route.weeks` only (e.g. `r.weeks.join(',')`). Does not show or derive anything from `route.frequency`. So Once-Off routes still show "1,2,3,4" in the Weeks column. |

**Summary:** Once-Off is ignored (1) in **enrichment** for the purpose of setting `weeks`, (2) in **preview** because it only displays `weeks`, and (3) in the **engine** for any route without `route.startDate` (treated as legacy recurring).

---

## 6. Temporary debug log added

**Location:** `engine/parseRouteListExcel.js`, inside `enrichRouteRows`, immediately before `enriched.push(route)`.

```js
console.log('[WEEKDAY_ROUTE_FREQUENCY]', route.customer || route.location, route.frequency, route.startDate, route.endDate, route.weeks);
```

This logs every route produced by the weekday path (enrichRouteRows), so you can confirm raw frequency, start/end dates, and weeks per route. Remove when no longer needed.

---

## 7. Confirmations

| Question | Answer |
|----------|--------|
| Does the weekday parser store the raw Excel frequency? | **Yes.** `route.frequency` is set from the Frequency column (trimmed string), e.g. `"Once-Off"`. |
| Is `normalizeFrequency()` applied in the weekday path? | **No.** It exists only in `logbookEngine.js` and is used in `expandRoutes()` for routes that already have `route.frequency`. The parser does not normalize. |
| Is `isOnceOffFrequency()` reached for weekday-template routes? | **Only for routes with `route.startDate`.** Those go to `routesWithOwnDates` and `isOnceOffFrequency(route.frequency)` is used. Routes without startDate go to legacy and never go through `isOnceOffFrequency`. |

---

## 8. Audit report summary

- **Where frequency is read:** `engine/parseRouteListExcel.js`, `enrichRouteRows`, from `r[columnMap.frequencyCol]` (column detected via aliases `['frequency', 'repeat']`). Stored as `route.frequency`.
- **Where start/end dates are read:** Same place; `columnMap.startDateCol` / `endDateCol`, parsed with `parseExcelDateToISOString()`, stored as `route.startDate` / `route.endDate`.
- **Where weeks are assigned:** Same loop: default `weeks = [1, 2, 3, 4]`; override only from the Week(s) column (comma-separated 1–4). Frequency is not used to set `weeks`.
- **Why Once-Off becomes recurring (or shows as 1,2,3,4):**
  1. **Preview:** Always shows `route.weeks`; enrichment never sets `weeks` from frequency, so Once-Off rows show 1,2,3,4.
  2. **Engine:** Routes without `route.startDate` are legacy; they use `route.weeks` and the global range, so they expand as recurring. So if the template has Frequency = Once-Off but no Start Date (or engine never sees startDate), the route is treated as recurring.
- **Smallest safe fix (recommendation, not implemented in this audit):**
  - **In `enrichRouteRows` only:** After building `route` and before pushing, if `route.frequency` is set and normalizes to once-off (e.g. same logic as `normalizeFrequency` or a one-line check like `String(route.frequency).toLowerCase().replace(/\s+/g, '').includes('once')`), set `weeks = [1]`. That way:
    - Preview shows "1" for Once-Off.
    - Legacy engine path (no startDate) would still only include week 1 (and only one occurrence per matching weekday in that week, depending on how week cycle is used).
  - For full once-off semantics (single occurrence on one date), routes should have Start Date (and optionally End Date) so they go to `routesWithOwnDates`; the engine already handles once-off there. So the minimal parser-side fix is: **derive `weeks` from frequency in enrichRouteRows when frequency indicates once-off** (e.g. set `weeks = [1]`), and encourage Start Date for true single-day visits.

---

**Conclusion:** The weekday parser stores frequency and start/end dates. The engine uses them only for routes that have `route.startDate`. `weeks` is never derived from frequency in the weekday path, so Once-Off rows keep `weeks: [1,2,3,4]` and appear recurring in the preview and in the legacy engine path. The temporary log `[WEEKDAY_ROUTE_FREQUENCY]` was added in `enrichRouteRows` to verify per-route values.
