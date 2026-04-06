# Routelist setup: in-depth flow (template entry → finished preview)

This document traces the exact call sequence, data shapes, and file/line references from the moment the user supplies an Excel file until the preview table is rendered.

---

## 1. Entry points (how the file gets in)

| Trigger | Element | Handler | Result |
|--------|---------|---------|--------|
| User selects file | `#routeFileInput` | `change` → `e.target.files[0]` | `processRoutelistFile(f)` |
| User drops file | `#routelist-dropzone` | `drop` → `e.dataTransfer.files[0]` | `processRoutelistFile(f)` |
| User clicks "Parse" | `#parseRouteBtn` | `click` → `droppedRoutelistFile \|\| fileInput.files[0]` | `processRoutelistFile(file)` |

All paths call **`processRoutelistFile(file)`** (`logbook-page.js` ~522).

---

## 2. `processRoutelistFile(file)` — entry

**File:** `public/js/logbook-page.js`  
**Lines:** ~522–628

**Steps:**

1. **Guard:** `file` exists and `file.name` matches `/\.(xlsx|xls)$/i`. Else return.
2. **`lastProcessedRoutelistFileId = file.name + '-' + file.size`** — used to avoid re-processing same file on Parse button.
3. **`showRoutelistProcessing()`** (~504): removes `hidden` from `#routelistLoading`.
4. **`readFileAsArrayBuffer(file)`** (~488):
   - `new FileReader()`, `reader.readAsArrayBuffer(file)`.
   - Resolves with `reader.result` (ArrayBuffer).
5. **`.then(function (buffer) { ... })`** — all parsing and resolution run inside this callback.
6. **Optional clear:** `logbookService.clearRoutes()` (may return a promise). Then:
   - If promise: `cleared.then(runAfterClear)`.
   - Else: `runAfterClear()` called synchronously.

Everything below is inside **`runAfterClear`** (sync or after clear).

---

## 3. Template detection and raw read (inside `runAfterClear`)

**File:** `public/js/logbook-page.js`  
**Lines:** ~531–571

### 3.1 Workbook and first sheet

- **`XLSX.read(buffer, { type: 'array', cellDates: false })`** — SheetJS; returns `workbook`.
- **`workbook.SheetNames[0]`** → first sheet name.
- **`workbook.Sheets[sheetName]`** → worksheet.
- **`XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: null })`** → **`sheetRows`**: array of rows, each row an array of cell values.

### 3.2 Business vs sales template

- **`row0 = sheetRows[0]`** (trimmed strings).
- **`row0Lower`** = row0 lowercased.
- **Business template** iff `row0Lower` includes all of: `'location'`, `'monday'`, `'frequency'`.
- **`templateType`** = `'business'` or `'sales'`.

### 3.3 Sales path: raw parse

Only when **`templateType !== 'business'`**:

- **`raw = parseRawRouteListExcel(buffer)`**  
  **File:** `public/engine/parseRouteListExcel.js`  
  **Function:** `parseRawRouteListExcel` (~103–161)

  - Uses `XLSX.read(arrayBuffer, readOpts)` again on same buffer.
  - **`XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: null })`** → `jsonData`.
  - **`detectHeaderRow(jsonData, 10)`**: scans first 10 rows for keyword matches (customer, address, suburb, city, province, mon, tue, …), returns **`headerRowIndex`**.
  - **`headerRow = jsonData[headerRowIndex]`**.
  - **`columnMap`** built via:
    - `findColumnIndexByPartialAliases(headerRow, ADDRESS_ALIASES)` → `addressCol`, etc.
    - Same for suburb, city, province, customer, mon–sat, weeks, frequency, start date, end date.
  - **`rows`** = `jsonData.slice(headerRowIndex + 1)` (data rows only).
  - **Returns:** `{ headerRowIndex, headerRow, columnMap, detectedColumnNames, rows }`.

- **`headerLabels`** for logbook-page = `(raw.headerRow || []).map(trim)`.

---

## 4. Building the `routes` array (parser branch)

**File:** `public/js/logbook-page.js`  
**Lines:** ~573–606

Exactly one branch runs.

### 4.1 Business branch

**Condition:** `templateType === 'business'` and `window.parseBusinessRoutes` is a function and `sheetRows.length > 0`.

- **`dataRows = sheetRows.slice(1)`** (drop header).
- **`rowObjects`** = each row turned into an object keyed by **`headerLabels[c]`** (column header → cell value).
- **`routes = window.parseBusinessRoutes(rowObjects)`**  
  **File:** `public/engine/parsers/businessRouteParser.js`  
  **Function:** `parseBusinessRoutes(rows)` (~84–126)

  - For each row: **`location = getVal(row, 'Location')`** (case-insensitive key match).
  - Skip if no location.
  - **`days`** from weekday columns (Monday … Saturday) via `isChecked(getValRaw(row, 'Monday'))` etc.
  - **`weeks = frequencyToWeeks(getVal(row, 'Frequency'))`** (e.g. monthly → [1], once-off → [1]).
  - **`startDate` / `endDate`** from Start Date / End Date (Excel serial or string → `YYYY-MM-DD`).
  - **One route object per row:**
    ```js
    {
      customer: location,
      location, purpose, frequency, startDate, endDate,
      days: { mon, tue, wed, thu, fri, sat },
      weeks, sourceRow, rowIndex,
      address: null, suburb: null, city: null, province: null, fullAddress: null
    }
    ```
  - Returns **array of these route objects**.

### 4.2 Sales branch

**Condition:** else (sales template or fallback).

- If **`raw == null`** (e.g. business template but no parseBusinessRoutes): **`routes = []`**.
- Else:
  - **`routes = enrichRouteRows(raw)`**  
    **File:** `public/engine/parseRouteListExcel.js`  
    **Function:** `enrichRouteRows(rawResult)` (~212–314)

    - **`columnMap = rawResult.columnMap`**, **`rows = rawResult.rows`**.
    - For each row `r`:
      - **Address parts:** `address` = `r[columnMap.addressCol]` (trim), same for suburb, city, province; null if column missing or empty.
      - If `city == null && suburb != null` then **`city = suburb`**.
      - **`customer`** = `r[columnMap.customerCol]` or fallback to `address`; trimmed only.
      - **`weeks`** from `r[columnMap.weeksCol]` (e.g. "1,2,3" → [1,2,3]), default [1,2,3,4].
      - **`frequency`**, **`startDate`**, **`endDate`** from corresponding columns (dates via `parseExcelDateToISOString`).
      - **`days`** = `{ mon, tue, wed, thu, fri, sat }` from `cellToBoolean(r[columnMap.monCol])` etc.
      - **`fullAddress`** = `buildFullAddressFromParts(address, suburb, city, province)` (comma-joined, no "South Africa").
      - Rows skipped if no customer, length < 3, all digits, or no active day.
    - **Returns:** array of objects:
      ```js
      {
        customer, address, suburb, city, province,
        days, weeks, rowIndex, fullAddress
        [, frequency, startDate, endDate ]
      }
      ```

  - **Then in logbook-page:**  
    **`routes = routes.map(row => ({ ...row, customer: row.Customer || row.Location || row.client || row.location || row.customer || '' })).filter(Boolean)`**  
    and filter out falsy customer or `'<TEMP>'`.  
    (Note: enrichRouteRows already sets `customer`; this map may override from other key names.)

**Logging:** STEP 1 PARSED ROUTE (per route), RAW ROUTES (full array).

---

## 5. Hiding preview and calling the resolver

**File:** `public/js/logbook-page.js`  
**Lines:** ~611–623

- **`#routelistPreview`** → `classList.add('hidden')**.
- **`preprocessRoutes(routes)`** (~726):
  - If `!routes || routes.length === 0` → **`Promise.resolve(routes || [])`**.
  - Else:
    - **`fetch('/api/cleanResolveRouteAddresses', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ routes }) })`**.
    - **`res.json()`** → promise of **`resolvedRoutes`** (array).

- **`.then(function (resolvedRoutes) { ... })`** (~613):
  - Log STEP 2 RESOLVED ROUTES.
  - **`finishWithProcessedRoutes(resolvedRoutes)`**.

- **`.catch(...)`**: status message, **`hideRoutelistProcessing(false)`**.

---

## 6. Backend: clean resolver (during `fetch`)

**File:** `functions/src/clean-resolver.js`  
**Endpoint:** `POST /api/cleanResolveRouteAddresses` (`functions/src/index.js`)

- Request body: **`{ routes: routes }`** (array of route objects).
- **`cleanResolveRouteAddresses(routes, GOOGLE_API_KEY)`** (~69–74):
  - **`Promise.all(routes.map(r => cleanResolveRoute(r, apiKey)))`**.

**`cleanResolveRoute(route, apiKey)`** (~5–67):

1. **Input string:**  
   **`input = \`${route.customer} ${route.suburb || ''} ${route.city || ''} South Africa\`.replace(/\s+/g, ' ').trim()`**  
   Logged as `QUERY USED:`.

2. **Find Place:**  
   **`GET https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=...&inputtype=textquery&fields=place_id,name&components=country:za&key=...`**  
   If **`!data1.candidates || data1.candidates.length === 0`** → return **`{ ...route, _resolved: false }`**.

3. **Place Details:**  
   **`placeId = data1.candidates[0].place_id`**  
   **`GET .../place/details/json?place_id=...&fields=formatted_address,address_components,geometry&key=...`**  
   If **`!data2.result`** → return **`{ ...route, _resolved: false }`**.

4. **Parse `address_components`:**
   - `street_number` → prepend to **`address`**.
   - `route` → append to **`address`**.
   - `sublocality` / `sublocality_level_1` → **`suburb`**.
   - `locality` → **`city`**.
   - `administrative_area_level_1` → **`province`**.

5. **Return:**  
   **`{ ...route, address, suburb, city, province, fullAddress: result.formatted_address, lat: result.geometry?.location?.lat, lng: result.geometry?.location?.lng, _resolved: true }`**.

So each route becomes either **resolved** (with address parts and lat/lng) or **unresolved** (`_resolved: false`, rest unchanged). The backend responds with the **array of these objects**.

---

## 7. `finishWithProcessedRoutes(resolvedRoutes)` — wiring to UI

**File:** `public/js/logbook-page.js`  
**Lines:** ~738–752

1. **`console.log('STEP 3 FINAL TO UI:', resolvedRoutes)`**.
2. **`window.currentRoutes = resolvedRoutes`** — single source for UI.
3. **`renderRoutelistPreview(window.currentRoutes)`** — builds the table (see below).
4. **`updateClearRoutelistButtonVisibility()`** — show clear button iff `window.currentRoutes.length > 0`.
5. **`updateStepProgress()`** — mark step 1 complete if there are routes.
6. **`hideRoutelistProcessing(false)`** — hide `#routelistLoading`, show table wrapper.
7. **`updateRouteStatusFromRoutes(window.currentRoutes)`** — set `#routeStatus` text (e.g. "X not resolved" / "All resolved").
8. **`window.validateLogbookForm()`** if present.
9. **`userHasEditedAddress = false`**, hide **`#reprocess-addresses-btn`**.

---

## 8. `renderRoutelistPreview(routes)` — finished preview

**File:** `public/js/logbook-page.js`  
**Lines:** ~639–708

- **`#routelistPreview`**, **`#routelistPreviewTable tbody`**.
- If no routes: add `hidden` to wrapper, clear tbody, return.
- **`routes.forEach(function (r, idx) { ... })`**:
  - **`resolved`** = `r._resolved === true || (r.lat != null && r.lng != null)`.
  - **`verified`** = `r._verified === true`.
  - **`state`** = `'error'` | `'warning'` | `'success'` (unresolved → error, resolved but not verified → warning, verified → success).
  - **Row classes:** `route-unresolved`, `route-low-confidence`, `route-verified` (and matching labels).
  - **Cell values:** `addrVal` = `r.address`, `suburbVal` = `r.suburb`, `cityVal` = `r.city`, `provinceVal` = `r.province`.
  - **Weeks display:** from `r.weeks` or "Once-Off" if frequency is once-off.
  - **Markup:** one `<tr>` with customer cell and address cell containing four inputs (`data-index=idx`, `data-field="address"|"suburb"|"city"|"province"`), days text, weeks text.
- **`tbody.appendChild(tr)`** per route.
- **Wrapper:** `classList.remove('hidden')`.

That is the **finished preview**: the table is visible and populated from **`window.currentRoutes`** (resolver output).

---

## 9. Data shape summary

| Stage | Shape (per route) |
|-------|-------------------|
| After **parseBusinessRoutes** | `customer`, `location`, `purpose`, `frequency`, `startDate`, `endDate`, `days`, `weeks`, `sourceRow`, `rowIndex`, `address: null`, `suburb: null`, `city: null`, `province: null`, `fullAddress: null` |
| After **enrichRouteRows** (+ map) | `customer`, `address`, `suburb`, `city`, `province`, `days`, `weeks`, `rowIndex`, `fullAddress` [, `frequency`, `startDate`, `endDate` ] |
| After **cleanResolveRoute** (resolved) | spread of input route + `address`, `suburb`, `city`, `province`, `fullAddress`, `lat`, `lng`, `_resolved: true` |
| After **cleanResolveRoute** (unresolved) | `{ ...route, _resolved: false }` |
| **window.currentRoutes** / preview | Array of the resolved/unresolved objects above |

---

## 10. File reference quick index

| Purpose | File | Key functions/lines |
|--------|------|----------------------|
| Entry, orchestration | `public/js/logbook-page.js` | `processRoutelistFile` 522, `runAfterClear` 530, `preprocessRoutes` 726, `finishWithProcessedRoutes` 738, `renderRoutelistPreview` 639 |
| File read / UI state | `public/js/logbook-page.js` | `readFileAsArrayBuffer` 488, `showRoutelistProcessing` 504, `hideRoutelistProcessing` 509 |
| Sales raw + enrich | `public/engine/parseRouteListExcel.js` | `parseRawRouteListExcel` 103, `detectHeaderRow` 76, `enrichRouteRows` 212 |
| Business parser | `public/engine/parsers/businessRouteParser.js` | `parseBusinessRoutes` 84 |
| Resolver (server) | `functions/src/clean-resolver.js` | `cleanResolveRoute` 5, `cleanResolveRouteAddresses` 69 |
| API route | `functions/src/index.js` | `POST /api/cleanResolveRouteAddresses` |

---

End of in-depth flow.
