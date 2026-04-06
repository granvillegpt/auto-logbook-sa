# Logbook Generation Pipeline – Logic Audit

## Scope

Audit of why:
1. Sick leave entries are missing from the Summary sheet  
2. A Saturday route marked in the template does not appear in the Logbook sheet  
3. "Weekend Trips Detected" shows "No weekend travel detected" when Saturday was selected  

**Files traced:** route template parsing, logbook engine, non-driving day handling, `exportLogbookToXlsx`, Summary `summaryData` construction.

---

## PART 1 — Non–driving day handling (Leave Days in Summary)

### Where the UI stores leave entries

- **Single source:** `leaveDaysArray` in `public/js/logbook-page.js` (module-level).
- **UI:** "Select Non-Working Days" modal (`#leaveModal`). Reason dropdown: "Leave" → type `annual-leave`, purpose "Annual Leave"; "Other" → type `non-travel`, purpose user text (e.g. "Sick leave", "Training", "Repairs").
- **Display:** `updateAdjustmentsSummary()` renders tags from `leaveDaysArray` using `(item.purpose || item.reason) + ' · ' + item.date`.

### What is passed to the engine

- **Export path:** `runEngineWithRoutes(routes)` builds `engineInput.leaveDays = leaveDaysArray || []` and passes it to the engine.
- **Engine:** `logbookEngine.js` accepts `leaveDays` as `string[]` or `{ date, reason? }` or `{ date, type, purpose? }[]`. It does **not** filter by type; `isLeaveDay()` and `getLeaveReason()` treat any matching date as a leave day.

### Previous Summary behaviour (root cause of missing sick leave)

- Summary "Leave Days Applied" was built **only** from `leaveDaysArray` and did **not** filter by type (all `item.date` were used).
- So in code, sick leave was not excluded. Missing sick leave in the Summary could only happen if:
  - Those dates were never in `leaveDaysArray` (e.g. different flow or state), or  
  - Export ran with a stale or overwritten `leaveDaysArray`.

### Fix applied (Summary sheet only)

- **File:** `public/js/logbook-page.js`, `exportLogbookToXlsx`, "Leave Days Applied" section.
- **Change:** Leave dates are now the **union** of:
  1. All dates from `leaveDaysArray` (UI state), and  
  2. All dates from `result.entries` that are non-driving days in the logbook: single entry for that date, 0 km, and purpose not "Non-Work Day", "Weekend", or "Public Holiday" (i.e. leave/holiday rows the engine actually wrote).
- **Effect:** The Summary now includes every leave-type date that appears in the generated logbook (sick leave, annual leave, training, repairs, etc.), even if `leaveDaysArray` were incomplete or out of sync.

### Confirmation

- **Logbook sheet:** Unchanged. Only the Summary "Leave Days Applied" construction was changed.
- **Engine:** No change to calculations or leave handling.

---

## PART 2 — Saturday route detection

### Pipeline

1. **Template parsing**  
   - **File:** `public/engine/parseRouteListExcel.js`  
   - **Saturday column:** `satCol = findColumnIndexWithAliases(headerRow, ['saturday', 'sat']) || findWeekdayColumnByPartialMatch(headerRow, 'saturday')`.  
   - **Cell value:** `cellToBoolean(r[columnMap.satCol])` → true for truthy, "x", "yes", "1", "true".  
   - **Route object:** `days.sat = columnMap.satCol != null ? cellToBoolean(r[columnMap.satCol]) : false`.  
   - If the header is not recognised or the cell is not truthy, **every** route gets `days.sat = false`, so no Saturday visits are produced.

2. **Visit expansion**  
   - **File:** `public/engine/logbookEngine.js`  
   - **Routes with `startDate`:** `expandRouteWithDateRange(route, …)` adds a visit when `route.days[dayKey]` is true; `weekdayToDayKey(6) === 'sat'`. So if `route.days.sat === true`, Saturday visits are created.  
   - **Routes without `startDate` (legacy):** Loop over the global date range; for each date, `dayKey = weekdayToDayKey(weekday)` and `route.days[dayKey]`; again, Saturday is included when `days.sat` is true.

3. **Work days and Saturday checkbox**  
   - **File:** `public/engine/logbookEngine.js`, `generateLogbookEntries()`  
   - **workDays:** Built from **all** routes: for each `route.days[dayKey] === true`, the corresponding weekday number (e.g. 6 for `sat`) is added.  
   - **workSaturdays:** If `workSaturdays` is true, 6 is added to `workDays` even if no route has `sat`.  
   - So: **either** at least one route with `days.sat === true` **or** `workSaturdays === true` is enough for Saturday to be a work day. When there are Saturday visits and Saturday is in `workDays`, the engine generates a Saturday trip.

### Likely cause of missing Saturday trip

- **Saturday column not detected**  
  - Header not one of the supported forms (e.g. "Saturday", "Sat", or text containing "saturday"), so `satCol` is null and `days.sat` is always false for every route.  
- **Saturday cell not truthy**  
  - Empty, "no", or other value that `cellToBoolean` treats as false, so even with a correct column, `days.sat` is false.

### What to verify

- In the route list Excel: the column used for Saturday has a header that matches `saturday` or `sat` (exact or partial), and the Saturday row has a value that `cellToBoolean` treats as true (e.g. "x", "yes", "1", or TRUE).  
- In the UI: "Include Saturdays as work days" is checked if you want Saturdays to be work days when the template marks Saturday.

### Minimal fix (if Saturday column is the issue)

- **File:** `public/engine/parseRouteListExcel.js`  
- **Option:** Add another alias or partial match for the Saturday column (e.g. ensure "Sat", "Saturdays", or the exact header text used in your template is matched). Current logic already supports "saturday" and "sat" and partial "saturday".  
- **Do not** change engine calculations or routing; only column detection/interpretation in the parser.

### Confirmation

- **Logbook sheet:** Unchanged.  
- **Engine:** No change to visit expansion or work-day logic; only parsing of the template can be adjusted if the column name/cell value is wrong.

---

## PART 3 — Weekend detection logic

### Current behaviour

- **File:** `public/js/logbook-page.js`, `exportLogbookToXlsx`, "Weekend Trips Detected" section.  
- **Source:** **Only** `result.entries` (the generated logbook entries).  
- **Rule:** For each entry, if `e.date` is a weekend (Sat/Sun), and it is **not** a "no trips" day (`!isNoTripsDay(e)`), it is added to `weekendTrips`.  
- **No trips day:** Exactly one entry for that date and `businessKm` is 0 or empty.

So weekend detection is already driven by the generated logbook. If a Saturday **trip** (non-zero km) exists in `result.entries`, it will appear under "Weekend Trips Detected". If it does not appear, it is because there is no such Saturday trip in `result.entries` (i.e. the same root cause as Part 2: Saturday route/visit not generated or not in the logbook).

### Fix

- No change to weekend detection logic.  
- Once the Saturday route is correctly parsed and the engine produces a Saturday trip in `result.entries`, the Summary will show it under "Weekend Trips Detected" automatically.

---

## Summary table

| Issue | Root cause | Where it happens | Fix |
|-------|------------|------------------|-----|
| Sick leave (and similar) missing from Summary | Summary used only `leaveDaysArray`; if that was incomplete or out of sync, leave dates could be missing | `logbook-page.js`, `exportLogbookToXlsx`, "Leave Days Applied" | Summary now merges leave dates from **both** `leaveDaysArray` and from `result.entries` (non-driving rows: single entry, 0 km, purpose not Non-Work Day / Weekend / Public Holiday). |
| Saturday route not in Logbook | Saturday column or cell not recognised → `days.sat` always false → no Saturday visits | `parseRouteListExcel.js` (column/cell), then engine visit expansion | Ensure template Saturday header matches `saturday`/`sat` (or extend parser aliases) and cell is truthy; optionally enable "Include Saturdays as work days". No engine logic change. |
| "No weekend travel detected" despite Saturday | Saturday trip never appears in `result.entries` (same as above) | Weekend block reads from `result.entries` only | No code change; fix Saturday visit generation (Part 2). |

---

## Confirmation

- **Logbook worksheet:** Structure and data source are unchanged; only the **Summary** worksheet "Leave Days Applied" construction was modified.  
- **Engine:** No changes to calculations, routing, or logbook entry generation.  
- **Minimal changes:** One change in `logbook-page.js` (Summary leave dates). Saturday/weekend behaviour is correct once the route template is parsed so that `days.sat` is true where intended.
