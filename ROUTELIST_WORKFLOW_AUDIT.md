# Routelist + Logbook Workflow Audit Report

**Goal:** Determine why the Business Travel template does not generate preview rows while the Sales Rep template works.

**Scope:** Excel → Routelist → Preview → Logbook pipeline. Audit only; no code changes.

---

## 1. Parsing Status

### 1.1 Excel parsing logic (SheetJS)

- **Location:** `engine/parseRouteListExcel.js` (loaded by `public/logbook.html`).
- **Entry:** `parseRawRouteListExcel(arrayBuffer)`.
- **Flow:**
  - SheetJS `XLSX.read()` + `sheet_to_json(..., { header: 1 })` → 2D array.
  - `detectHeaderRow(jsonData, maxRowsToScan)` picks the row that matches the most keywords among: `customer`, `client`, `address`, `street`, `location`, `place`, `suburb`, `city`, `province`, `mon`, `tue`, `wed`, `thu`, `fri`, `sat`, `week`.
  - Header row and data rows (everything after header row index) are extracted.
- **Empty row filtering:** None in `parseRawRouteListExcel`. Rows are passed as-is to `enrichRouteRows`. Empty rows are dropped later in `enrichRouteRows` by the `!customerName || !hasActiveDay` logic.

### 1.2 Debug logging (current)

- In `public/js/logbook-page.js` (when `DEBUG_ROUTELIST` is true):
  - `[DEBUG_ROUTELIST] columnMap (detected column indices):`, `detected column names`, `raw parsed` (rowCount, firstRows), `enriched routes`, `preview data`.
- **Missing for full audit:** No explicit `[AUDIT] headers detected`, `[AUDIT] parsed rows: N`, `[AUDIT] first parsed row:` in the codebase. Adding these would require new log lines (audit did not add them).

### 1.3 Parsing result (inferred)

- **Sales Rep template:** Headers typically include Customer/Client, Address, Suburb, City, Province, Mon–Sat, Week(s). These match the parser’s aliases and day columns, so `columnMap` is populated and `enrichRouteRows` produces rows with `hasActiveDay === true`.
- **Business Travel template:** Headers typically include **Location**, **Purpose**, **Day**, **Frequency**, **Start Date**, **End Date**. Same parser is used; see Column Mapping below.

---

## 2. Column mapping results

### 2.1 Where columnMap is built

- **File:** `engine/parseRouteListExcel.js`.
- **Uses:** `findColumnIndexByPartialAliases(headerRow, ALIASES)` for address, suburb, city, province, customer; `findColumnIndexWithAliases(headerRow, ['monday','mon'])` etc. for Mon–Sat and Weeks (exact match after lowercase/trim).

### 2.2 Aliases (current)

| Field    | Aliases |
|----------|---------|
| Address  | street address, address, street, **location**, outlet address, delivery address, site address, place |
| Customer | customer, client, **location**, site, store, outlet, outlet name, account, customer name |
| Suburb   | suburb, town, area, district |
| City     | city, municipality, metro |
| Province | province, region, state |
| Mon      | monday, mon (exact) |
| Tue–Sat  | tuesday/tue, … saturday/sat (exact) |
| Weeks    | weeks, week (exact) |

### 2.3 Business Travel headers vs parser

- Business Travel columns: **Location**, **Purpose**, **Day**, **Frequency**, **Start Date**, **End Date**.
- **Location:** Matches both ADDRESS_ALIASES and CUSTOMER_ALIASES. The first column index that matches “location” is assigned to `addressCol` (built first), then the same index is assigned to `customerCol`. So `addressCol` and `customerCol` can both point to the Location column (e.g. index 0). No problem for customer/address source.
- **Purpose / Day / Frequency / Start Date / End Date:** Not in the parser’s alias lists. So:
  - **suburbCol, cityCol, provinceCol** → typically **null** (unless template adds Suburb/City/Province).
  - **monCol … satCol** → **null** (header is “Day” with values like “Monday”, not separate “Mon”/“Monday” columns).
  - **weeksCol** → **null** (no “Weeks”/“Week” header).

### 2.4 Example columnMap for Business Travel

- Example: `{ addressCol: 0, suburbCol: null, cityCol: null, provinceCol: null, customerCol: 0, monCol: null, tueCol: null, … }` (Location in column 0).
- The reported `{ addressCol: null, suburbCol: 0, cityCol: null, provinceCol: null, customerCol: null }` suggests either a different sheet layout (e.g. “Suburb” in column 0 and no “Location”/“Customer” match) or header detection picking a different row. Either way, **customerCol null** means no customer/location column was matched, so all rows will fail the customer check in enrichment.

---

## 3. Resolver input row count

### 3.1 Where rows enter the “resolver”

- **File:** `public/js/logbook-page.js`, function `processRoutelistFile`.
- **Flow:** `routes = enrichRouteRows(raw)` then `routes = routes.map(...).filter(Boolean)` (customer fallback). Then `resolveRouteAddresses(routes, apiKey, options)`.
- **Resolver:** `engine/routing/googleGeocodeService.js` → `resolveRouteAddresses(routes, apiKey, options)`.

### 3.2 Resolver input (inferred)

- **Sales Rep:** `routes.length` can be > 0 because `enrichRouteRows` returns rows that have both a valid customer and `hasActiveDay === true` (Mon–Sat columns present).
- **Business Travel:** `enrichRouteRows` returns **[]** because of the `hasActiveDay` requirement (see Section 5). So **rows entering resolver: 0** for a pure Business Travel sheet. No logging of “rows entering resolver” exists today; adding it would require a code change.

---

## 4. Resolver output row count / geocode failures

### 4.1 Resolver behavior

- **File:** `engine/routing/googleGeocodeService.js`.
- **Flow:** Builds a queue of rows that need resolution (no street address, have customer). Runs `resolveOne(route, ...)` per row (batched, concurrency 10). Mutates each route with address/lat/lng/fullAddress. After all batches, collects rows where `fullAddress` is still empty into `unresolved`.
- **Failure handling:** If `unresolved.length > 0`, the promise **rejects** with `Error('UNRESOLVED_ROUTE_ADDRESSES')` and `err.unresolvedRows = unresolved`. It does **not** return a partial list of resolved rows.
- **Effect:** **One unresolved row aborts the entire routelist.** The UI then shows the error message (e.g. “We could not resolve a routable location for this entry…”) and does not render the preview.

### 4.2 Resolver output

- When all rows resolve: output row count = input row count (same array, mutated).
- When any row fails: no output; promise rejects, so `enrichedRoutelist` is never set and preview is not rendered.

---

## 5. Why preview does not render

### 5.1 Two separate causes

**Cause A — Empty enriched routes (Business Travel, before resolver)**

- **Where:** `engine/parseRouteListExcel.js` → `enrichRouteRows`.
- **Logic:** For each row, `days = { mon: …, tue: …, … }` is built from `columnMap.monCol … columnMap.satCol`. Then `hasActiveDay = Object.keys(days).some(k => days[k] === true)`. If `!hasActiveDay`, the row is skipped (`continue`).
- **Business Travel:** Headers are “Day”, “Frequency”, “Start Date”, “End Date” — not “Mon”, “Tue”, etc. So `monCol … satCol` are **null**, so every row has `days = { mon: false, …, sat: false }`, so **hasActiveDay is always false**, so **every row is dropped**. So `enriched = []`.
- **Downstream:** `routes = enrichRouteRows(raw)` → `[]`. The customer fallback in logbook-page.js cannot add rows that were never emitted. So `resolveRouteAddresses` is called with an empty array (or never adds to queue), and then `renderRoutelistPreview(resolvedRoutes)` is called with 0 rows.
- **Preview:** In `renderRoutelistPreview(routes)`, `if (!routes || routes.length === 0) { wrap.classList.add('hidden'); return; }`. So **preview is hidden and not rendered** because the array is empty.

**Cause B — Resolver reject (any template)**

- If `enrichRouteRows` does return rows but **one or more rows fail geocode/Places resolution**, `resolveRouteAddresses` rejects. The `.catch()` in `processRoutelistFile` runs, so `enrichedRoutelist` is never set (or stays stale), and `renderRoutelistPreview` is not called with resolved data. So **preview is blocked by the error UI** (and often no preview table is shown).

### 5.2 Summary

- **Business Travel → empty preview:** Pipeline uses the **Sales-style** parser only. That parser **requires** separate Mon–Sat (or equivalent) columns to set `hasActiveDay`. Business Travel has a single “Day” column, so all rows are dropped in `enrichRouteRows`, leading to **enriched routes: []** and **preview data: 0 rows**. Preview is hidden because `routes.length === 0`.
- **Sales Rep works:** Same parser; Sales template has Mon–Sat (and Customer/Address/etc.), so `hasActiveDay` is true for rows that have at least one day checked, and rows are emitted and can be resolved and rendered.
- **“Sometimes blocks with error”:** When the template does produce some rows (e.g. hybrid or mis-detected headers) but one location fails to resolve, the resolver rejects and the error path runs, so preview does not render.

---

## 6. Compare templates (structure only)

- **No template files found** in the repo (`**/*.xlsx` search returned 0 files). Comparison is based on typical structure and parser expectations.

### 6.1 Sales Rep (routelist) template (expected)

- **Headers:** Customer/Client, Address, Suburb, City, Province, Mon, Tue, Wed, Thu, Fri, Sat, Week(s) (or similar).
- **Column order:** Varies; parser uses header names, not order.
- **Day columns:** Separate columns per weekday; values treated as boolean (x, 1, true, yes, etc.).
- **Result:** columnMap gets customer, address, suburb, city, province, mon…sat, weeks; rows can have `hasActiveDay === true`; enrichment and preview can succeed.

### 6.2 Business Travel template (expected)

- **Headers:** Location, Purpose, Day, Frequency, Start Date, End Date (or similar).
- **Column order:** N/A for parser; header names matter.
- **Day column:** Single “Day” column with values like “Monday”, “Tuesday”. Parser looks for headers exactly “monday”/“mon”, etc., so the “Day” column is **not** mapped to monCol…satCol.
- **Result:** No Mon–Sat columns → `hasActiveDay` always false → all rows dropped in enrichment → 0 rows → preview does not render.

### 6.3 workflow2TemplateParser.js

- **Exists:** `engine/workflow2TemplateParser.js` implements a **Business Travel** parser (Location, Purpose, Day, Frequency, Start Date, End Date) and expands rows into trip dates.
- **Not used in routelist flow:** `public/logbook.html` does **not** load `workflow2TemplateParser.js`. The logbook page only uses `parseRouteListExcel.js` and `engine/routing/googleGeocodeService.js` for the “Generate Routelist” upload. So the **Business Travel parser is never used** in the current routelist → preview pipeline.

---

## 7. Exact fix recommendation

### 7.1 Root cause

- The **same** parser (`parseRouteListExcel.js`) is used for **all** uploads. It is designed for **Sales-style** routelists (Customer, Address, Mon–Sat, etc.). Business Travel uses a **different** layout (Location, Purpose, Day, Frequency, Start Date, End Date). The parser does not map “Day” to weekday columns and **requires** `hasActiveDay`, so every Business Travel row is dropped in `enrichRouteRows`, yielding **enriched routes: []** and **preview data: 0 rows**.

### 7.2 Recommended direction (no code written in this audit)

**Option 1 — Use Workflow 2 parser for Business Travel in the same UI**

- **Detect template type** (e.g. by presence of “Location” + “Frequency” + “Start Date” vs “Mon”/“Tue”/…).
- If Business Travel: load/use `parseWorkflow2Excel` and `workflow2ToVisits` (or equivalent) to produce a list of visits with customer/location and dates; then **convert** that output into the route shape expected by `resolveRouteAddresses` and `renderRoutelistPreview` (customer, address, suburb, city, etc.), or add a separate preview path for workflow-2 trips.
- Ensures Business Travel layout is interpreted correctly and can produce preview rows.

**Option 2 — Relax Sales parser so “Day” column counts as active**

- In `parseRouteListExcel.js`, add detection for a single “Day” (or “Weekday”) column. If present, for each row treat the cell value (e.g. “Monday”) as “that weekday is active” and set e.g. `days.mon = true` when value contains “mon”/“monday”, etc. Then `hasActiveDay` can be true for Business Travel rows.
- May require additional mapping (e.g. Frequency, Start/End Date) if the rest of the logbook flow expects them; otherwise only “Location” and days would be used for preview/resolution.

**Option 3 — Separate flow for Business Travel**

- On the logbook page, add a template selector or a second upload path that explicitly uses `workflow2TemplateParser.js` and a dedicated “Business Travel” flow that produces trips and then either shows a different preview or converts trips to the existing route format before resolution and preview.

### 7.3 Geocode “one failure aborts all” (optional hardening)

- Currently, if **any** row fails to get a `fullAddress`, `resolveRouteAddresses` rejects and no preview is shown.
- Optional improvement: resolve all rows, then either (a) return resolved routes and attach `unresolvedRows` to the result so the UI can show partial preview + errors, or (b) filter out unresolved rows and show only resolved ones, with a warning. This would reduce “preview blocked by a single bad row” without changing the core parsing/column mapping.

---

## 8. File reference summary

| Area              | File(s) |
|-------------------|---------|
| Excel parsing     | `engine/parseRouteListExcel.js` (parseRawRouteListExcel, enrichRouteRows) |
| Column mapping    | `engine/parseRouteListExcel.js` (columnMap, findColumnIndexByPartialAliases, findColumnIndexWithAliases) |
| Routelist flow    | `public/js/logbook-page.js` (processRoutelistFile, customer fallback, resolveRouteAddresses call) |
| Resolver/geocode  | `engine/routing/googleGeocodeService.js` (resolveRouteAddresses, resolveOne, Places + geocode fallback) |
| Preview render    | `public/js/logbook-page.js` (renderRoutelistPreview, enrichedRoutelist) |
| Business Travel   | `engine/workflow2TemplateParser.js` (not loaded on logbook page) |
| Script load order | `public/logbook.html`: SheetJS → parseRouteListExcel.js → … → googleGeocodeService.js → logbook-page.js |

---

**End of audit.** No code was modified.
