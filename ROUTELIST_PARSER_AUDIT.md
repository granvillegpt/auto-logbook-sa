# Routelist Parsing System – Architecture Audit

**Goal:** Understand how Excel templates are parsed so we can determine whether the delivery template can reuse or extend the existing parser. No code changes; audit only.

---

## 1. Parser-related files and paths

| Path | Purpose |
|------|--------|
| **engine/parseRouteListExcel.js** | Main parser: raw Excel ingest + column detection + row enrichment. Exposes `parseRawRouteListExcel`, `enrichRouteRows`, `parseRouteListExcel`. Used by the Routelist Review flow. |
| **engine/parsers/businessRouteParser.js** | Business Travel parser: converts rows with Location, Purpose, Day, Frequency, Start/End Date into the same internal route format. Exposes `parseBusinessRoutes`. Loaded by logbook.html. |
| **engine/workflow2TemplateParser.js** | Workflow 2 Business Travel: parses Client/Location, Visit Type, Day, Frequency, Start Date, End Date; expands to trip dates. **Not loaded** by `public/logbook.html`; not part of the current Routelist Review pipeline. |
| **public/js/logbook-page.js** | UI entry point: file upload, template detection, calls parsers, orchestrates enrich → resolve → preview. Contains `processRoutelistFile`, `readFileAsArrayBuffer`, `renderRoutelistPreview`. |
| **public/logbook.html** | Loads SheetJS (CDN), `engine/parseRouteListExcel.js`, `engine/parsers/businessRouteParser.js`, then `js/logbook-page.js`. |
| **engine/routing/googleGeocodeService.js** | Post-parse: resolves route addresses (geocode/Places). Consumes the same route object shape output by parsers. |

**Relevant function names:** `parseRawRouteListExcel`, `parseRouteListExcel`, `enrichRouteRows`, `parseBusinessRoutes`, `parseWorkflow2Excel` (unused in routelist flow), `processRoutelistFile`.

---

## 2. Main entry point for Excel uploads

**Where it’s triggered**

- **Page:** Routelist Review section on `public/logbook.html` (routelist card with “Generate Routelist (Free)”).
- **UI:** File input `#routeFileInput` (hidden) and dropzone `#routelist-dropzone`; button `#parseRouteBtn`.
- **Handler:** In `public/js/logbook-page.js`, `initRoutelistDropzone()` wires:
  - dropzone click → file input click
  - file input `change` → `processRoutelistFile(file)` (or stores file and clears preview)
  - `#parseRouteBtn` click → same `processRoutelistFile(file)` using dropped/file-input file.

**Where the Excel file is read**

- `processRoutelistFile(file)` calls `readFileAsArrayBuffer(file)` (FileReader `readAsArrayBuffer`), yielding an `ArrayBuffer`.
- For **template detection**, the buffer is also read with SheetJS in-place: `XLSX.read(buffer, { type: 'array', cellDates: false })`, first sheet, then `XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: null })` to get `sheetRows` and inspect row 0 for Business template headers.

**How rows are extracted**

- **Sales/delivery path:** `parseRawRouteListExcel(buffer)` in `engine/parseRouteListExcel.js`:
  - `XLSX.read(arrayBuffer)` → workbook, first sheet.
  - `XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: null })` → 2D array `jsonData`.
  - `detectHeaderRow(jsonData, maxRowsToScan)` picks the “best” header row (see below).
  - Data rows = everything after the detected header row index.
- **Business path:** Uses `sheetRows` from the in-page SheetJS read; row 0 = headers, rows 1+ = data. Each data row is turned into an object keyed by header labels, then `window.parseBusinessRoutes(rowObjects)`.

**How columns are mapped**

- **parseRouteListExcel.js:** Builds `columnMap` from the detected header row:
  - **Address:** `findColumnIndexByPartialAliases(headerRow, ADDRESS_ALIASES)` (e.g. street address, address, street, location, …).
  - **Suburb, City, Province:** Same pattern with SUBURB_ALIASES, CITY_ALIASES, PROVINCE_ALIASES.
  - **Customer:** CUSTOMER_ALIASES (customer, client, location, site, store, outlet, …).
  - **Mon–Sat:** `findColumnIndexWithAliases(headerRow, ['monday', 'mon'])` etc. (exact match after lowercase/trim).
  - **Weeks:** `findColumnIndexWithAliases(headerRow, ['weeks', 'week'])`.
- **businessRouteParser.js:** Expects row **objects** with keys like Location, Purpose, Day, Frequency, Start Date, End Date (case-insensitive lookup via `getVal(row, 'Location')` etc.). No column indices; column mapping is done in logbook-page.js when building row objects from `sheetRows` and `headerLabels`.

---

## 3. Template formats currently supported

### 3.1 Sales / “routelist” style (parseRouteListExcel.js)

**Expected column names (flexible)**

- **Customer:** customer, client, location, site, store, outlet, outlet name, account, customer name (partial/alias match).
- **Address:** street address, address, street, location, outlet address, delivery address, site address, place.
- **Suburb:** suburb, town, area, district.
- **City:** city, municipality, metro.
- **Province:** province, region, state.
- **Days:** Monday/Mon, Tuesday/Tue, Wednesday/Wed, Thursday/Thu, Friday/Fri, Saturday/Sat (exact match after lowercase).
- **Weeks:** weeks, week (exact).

**Expected sheet format**

- First sheet only.
- Header row: detected by scanning up to 10 rows and choosing the row that matches the most keywords among: customer, client, address, street, location, place, suburb, city, province, mon, tue, wed, thu, fri, sat, week.
- All rows after the header row are data rows (no strict “data region” validation).

**Validation rules (in enrichRouteRows)**

- Skip row if no customer (or customer fallback from address) or customer length &lt; 3 or customer is numeric-only, `'<TEMP>'`, `'0'`, `'-'`.
- Skip row if no “active day”: at least one of Mon–Sat must be truthy (`cellToBoolean`: true, 1, "true", "x", "yes").
- Weeks: if present, parsed as comma-separated integers 1–4; default `[1,2,3,4]`.
- Address parts (address, suburb, city, province) are optional; `fullAddress` is built from non-null parts. If city is null and suburb present, suburb is used as city.

**How rows become route visits**

- Each data row → one route object: `{ customer, address, suburb, city, province, days: { mon, tue, … }, weeks, rowIndex, fullAddress }`.
- One Excel row = one “visit” record; which weekdays apply come from the day columns; which weeks from the Week(s) column.

### 3.2 Business Travel (businessRouteParser.js)

**Expected columns (row objects)**

- Location (required), Purpose, Day (e.g. "Monday"), Frequency, Start Date, End Date (case-insensitive keys).

**Detection (in logbook-page.js)**

- Row 0 (first row) of first sheet must contain (lowercase) `location`, `day`, and `frequency` to be treated as Business template.

**Behaviour**

- Converts each row to the same internal route shape (customer/location, days derived from Day, weeks from Frequency), with address/suburb/city/province/fullAddress null. Downstream geocoding may then resolve from `customer` (location name).

---

## 4. Multiple template types

**Yes.** The pipeline supports two template types with conditional parsing:

- **Detection:** In `processRoutelistFile`, after reading the file:
  - SheetJS reads the first sheet; row 0 is normalized to lowercase.
  - If row 0 contains `location`, `day`, and `frequency` → `templateType = 'business'`.
  - Otherwise → `templateType = 'sales'`.
- **Branching:**
  - `if (templateType === 'business' && typeof window.parseBusinessRoutes === 'function' && sheetRows && sheetRows.length > 0)`: build row objects from sheetRows/headerLabels, call `window.parseBusinessRoutes(rowObjects)`.
  - Else: `raw = parseRawRouteListExcel(buffer)`, then `routes = enrichRouteRows(raw)` (plus a small customer fallback map/filter).
- **No** generic “template type” enum or user-selectable template type; no `switch(templateType)` beyond this if/else. Column detection is inside each parser (parseRouteListExcel uses aliases; business uses fixed key names).

---

## 5. Supporting the new “delivery” template

**New template structure**

- Columns: **Customer**, **Monday**, **Tuesday**, **Wednesday**, **Thursday**, **Friday**, **Saturday**, **Week**.
- Example row: Customer = "Belmont Blue Bottle", Monday = TRUE, Week = 1,2,3,4.

**Assessment**

- The **existing** `engine/parseRouteListExcel.js` already:
  - Detects header row using keywords that include `mon`, `tue`, …, `week`.
  - Maps day columns with `findColumnIndexWithAliases(headerRow, ['monday', 'mon'])` etc., so “Monday”, “Tuesday”, … are already supported.
  - Maps Customer (via CUSTOMER_ALIASES) and Week (weeks/week).
  - Treats address/suburb/city/province as optional; they can all be null.
- So the delivery layout (Customer + Monday…Saturday + Week) is **already** a valid input to the same parser; no structural change is required for this format.

**Recommendation**

- **A) Extend the existing parser** – Sufficient. Ensure the first row of the delivery file is detected as the header (it will be, given customer, monday–saturday, week). No new parser needed.
- **B) New parser** – Not required for this format; would duplicate logic.
- **C) Modular parser system** – Optional improvement: introduce a small “parser registry” (e.g. detect template type → call `salesParser(buffer)` or `deliveryParser(buffer)` or `businessParser(sheetRows)`), each returning the same route array. The delivery “parser” could be a thin wrapper around `parseRawRouteListExcel` + `enrichRouteRows` for clarity and future delivery-specific rules.

---

## 6. Where a delivery parser would plug in

**Current flow**

1. User uploads file → `processRoutelistFile(file)`.
2. Buffer read; optional SheetJS read for detection.
3. **Template selection:** Business vs sales is decided by header row 0 (location + day + frequency → business).
4. **Sales path:** `parseRawRouteListExcel(buffer)` → `enrichRouteRows(raw)` → routes.
5. **Business path:** Build row objects from sheetRows → `parseBusinessRoutes(rowObjects)` → routes.
6. Routes → `resolveRouteAddresses(...)` → preview and logbook.

**Best architecture for sales vs delivery**

- **salesParser:** Current “sales” path = `parseRawRouteListExcel` + `enrichRouteRows` (optionally with address-heavy validation or messaging).
- **deliveryParser:** Same pipeline: `parseRawRouteListExcel` + `enrichRouteRows`. The delivery template is a subset (Customer + Mon–Sat + Week; no address columns). Optionally a dedicated name (e.g. `parseDeliveryRouteListExcel`) that calls the same two functions for clarity and any delivery-only validation later.
- **Parser selection:** Keep it in **one place**: inside `processRoutelistFile` (or a small `selectParser(buffer, sheetRows)` helper), **after** file read:
  - If Business headers (location + day + frequency) → business parser.
  - Else if desired to distinguish delivery (e.g. “Customer” + day columns, no Address) → could add a branch that still uses `parseRawRouteListExcel` + `enrichRouteRows` but with a “delivery” template label for UI/messaging.
  - Else → sales (current default).

So: **no separate delivery parser implementation is required** for the described format; the existing parser already handles it. The “plug-in” point is the same as today: the template-detection block in `processRoutelistFile`. If you want a named delivery path, add a branch that calls the same parse+enrich and optionally sets a template type for the UI.

---

## 7. Architecture summary

**Current parser design**

- **Single main parser** for “routelist” style: `parseRouteListExcel.js` does raw read (with header detection and alias-based column mapping) and enrichment into a fixed route object shape. Tolerant of missing address columns; requires customer and at least one active day.
- **Second parser** for Business Travel: different column semantics (Location, Day, Frequency, dates); converts to the same route shape so resolution and logbook engine stay unchanged.
- **Orchestration** in the UI script (`logbook-page.js`): file read, template detection by header row, branch to business or sales path, then shared resolve + preview + logbook.

**Weak points**

- Template type is inferred only by header keywords; no explicit “template type” dropdown or config.
- Business template uses a single “Day” column (value like "Monday"); the main parser expects separate Mon–Sat columns. So Business cannot be handled by the main parser.
- Two separate code paths (business vs sales) and two parser scripts; no shared “parser interface” or registry.
- workflow2TemplateParser exists but is not used in the logbook/routelist flow, which can cause confusion.

**Best place to extend**

- **For the delivery template:** No change strictly required; it already fits the main parser. Optional: in `processRoutelistFile`, add a “delivery” detection (e.g. has Customer + day columns, no Address) and call the same parse+enrich, optionally with a `templateType: 'delivery'` for UI or analytics.
- **For future new templates:** Extend the detection block in `processRoutelistFile` and either reuse `parseRawRouteListExcel` + `enrichRouteRows` (if column layout matches) or add a new parser that returns the same route array shape.

**Recommended structure going forward**

- **Short term:** Keep using the existing parser for delivery; document that Customer + Monday…Saturday + Week is supported. Optionally add a delivery branch in detection that still uses the same parser.
- **Medium term:** Introduce a small “parser selector” in one place (e.g. `getParserForBuffer(buffer)` or inline in `processRoutelistFile`) that returns a promise or sync result of routes, so all template-specific logic lives in:
  - `parseRouteListExcel.js` (sales/delivery),
  - `businessRouteParser.js` (business),
  - and optionally a thin `deliveryParser.js` that re-exports or wraps the same parse+enrich.
- **Contract:** Every parser returns an array of route objects with at least: `customer`, `address`, `suburb`, `city`, `province`, `fullAddress`, `days`, `weeks`, `rowIndex`. The UI and resolution layer then stay unchanged when adding or switching templates.

---

*End of audit. No implementation code was added.*
