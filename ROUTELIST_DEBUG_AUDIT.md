# Routelist Debug Audit – Why Weekday-Column Template Produces Zero Rows

**Context:** New Excel template with weekday columns (Monday, Tuesday, …) results in `enriched routes: Array(0)`. Raw parse and header detection succeed. Audit only; no code changes.

---

## 1. Full pipeline from processRoutelistFile()

**Entry:** `public/js/logbook-page.js` → `processRoutelistFile(file)` (called from dropzone or "Generate Routelist (Free)" button).

**Flow:**

1. **File read:** `readFileAsArrayBuffer(file)` → `buffer` (ArrayBuffer).

2. **Template detection (logbook-page.js ~254–270):**
   - Workbook and first sheet read with SheetJS; `sheetRows = sheet_to_json(..., { header: 1 })`.
   - `row0` = first row, trimmed; `row0Lower` = row0 lowercased.
   - `hasLocation = row0Lower.indexOf('location') !== -1` (any cell **equals** `'location'`).
   - `hasDay = row0Lower.indexOf('day') !== -1` (any cell **equals** `'day'`).
   - `hasFrequency = row0Lower.indexOf('frequency') !== -1`.
   - If **all three** true → `templateType = 'business'`; else → `templateType = 'sales'`.

3. **Sales path (your case):**
   - `raw = parseRawRouteListExcel(buffer)` in `engine/parseRouteListExcel.js`.
   - `routes = enrichRouteRows(raw)` (same file).
   - Optional `.map(…).filter(Boolean)` on `customer` in logbook-page.js (lines 294–298).
   - Then `resolveRouteAddresses(routes, …)` and `renderRoutelistPreview(resolvedRoutes)`.

4. **Business path (not taken for NEW template):**
   - Would use `parseBusinessRoutes(rowObjects)` which expects a single **"Day"** column (e.g. "Mon,Tue,Fri"), not separate Monday/Tuesday columns.

So for the NEW template (Location | Purpose | Monday | Tuesday | … | Frequency | …), the flow is: **sales path** → `parseRawRouteListExcel` → `enrichRouteRows` → all rows dropped there.

---

## 2. Where rows are rejected

### 2.1 parseRawRouteListExcel() – no row rejection

**File:** `engine/parseRouteListExcel.js` (lines 89–142).

- Reads workbook, first sheet, `sheet_to_json(..., { header: 1 })`.
- `detectHeaderRow(jsonData, 10)` picks the row with the most keyword matches (customer, client, address, location, mon, tue, wed, thu, fri, sat, week, etc.).
- Builds `columnMap` from that header row; slices **all** rows after the header into `raw.rows`.
- **It does not drop rows.** It only returns `{ headerRowIndex, headerRow, columnMap, detectedColumnNames, rows }`. So "raw parsed" having data is expected.

### 2.2 enrichRouteRows() – only place rows are dropped

**File:** `engine/parseRouteListExcel.js` (lines 171–252).

Rows are skipped in two places:

**A) Empty row (lines 177–180):**

```js
if (!r || r.length === 0) {
  continue;
}
```

**B) Validation gate (lines 222–235):**

```js
var customerName = (customer || '').toString().trim();
var hasActiveDay = Object.keys(days).some(function (k) { return days[k] === true; });
if (
  !customerName ||
  customerName.length < 3 ||
  /^\d+$/.test(customerName) ||
  customerName === '<TEMP>' ||
  customerName === '0' ||
  customerName === '-' ||
  !hasActiveDay
) {
  continue;
}
```

So every row that reaches `enriched` must have:

- Non-empty `customerName` (length ≥ 3, not only digits, not placeholders).
- **At least one active day** (`hasActiveDay === true`).

If **all** rows are dropped, then for **every** row either:

1. **Customer failed** (empty, &lt; 3 chars, numeric, or placeholder), or  
2. **hasActiveDay is false** (no weekday column is truthy).

---

## 3. Does enrichRouteRows() expect a "Day" column?

**No.** The sales/enrich path does **not** use a single "Day" column.

- It uses **six separate** day columns: **Mon, Tue, Wed, Thu, Fri, Sat** (lines 111–118, 212–218).
- They are mapped with **exact** header match (after lowercase + trim):
  - `monCol: findColumnIndexWithAliases(headerRow, ['monday', 'mon'])`
  - same for tue, wed, thu, fri, sat.
- There is **no** `dayCol` or "Day" in this parser. A single "Day" column (e.g. "Mon,Tue,Fri") is only used in the **Business** path (`businessRouteParser.js`).

So for the NEW format (Monday | Tuesday | …), the **only** way to get `hasActiveDay === true` is for at least one of **Monday … Saturday** to be mapped and to have a truthy value in that row. If those columns are **not** mapped, then `monCol … satCol` are null and `days` are all false → `hasActiveDay` false → every row skipped.

---

## 4. Why rows are rejected – checks

### 4.1 Missing "Day" column

- **Sales path:** Does not use "Day"; it uses Monday … Saturday. So "missing Day" is not the issue.
- **Business path:** Uses "Day"; NEW template has no "Day" column. But NEW template is **not** detected as Business (see below), so this path is not used.

### 4.2 Missing "Address"

- Address is **optional** in `enrichRouteRows`. If `addressCol` is null, `address` is null; `fullAddress` can be null. There is no check that rejects a row for missing address. So missing Address does **not** cause rejection.

### 4.3 Mismatched "Frequency"

- `weeksCol` is optional; default `weeks = [1,2,3,4]`. No validation rejects rows based on Frequency. So Frequency mismatch does **not** cause rejection.

### 4.4 Weekday flags not interpreted as true

- **If columns are mapped:** `days.mon = cellToBoolean(r[columnMap.monCol])` etc. `cellToBoolean` (lines 145–151) treats as true: `true`, non-zero number, `"true"`, `"1"`, `"x"`, `"yes"` (case-insensitive). So Excel TRUE or 1 or "x" would be true.
- **If columns are NOT mapped:** `columnMap.monCol != null` is false → `days.mon = false` (and same for tue…sat). So **all** days are false → **hasActiveDay is false** → every row is skipped.

So the only way the NEW template yields zero enriched rows while raw parse and headers “work” is: **either** (1) **customer** fails for every row, **or** (2) **hasActiveDay** is false for every row. Given the NEW template has Location and weekday columns, the most plausible is **(2) hasActiveDay false for every row** because **weekday columns are not mapped** (monCol … satCol all null).

---

## 5. Root cause – exact header match for weekday columns

**Exact location of the filtering logic:**  
`engine/parseRouteListExcel.js`, lines **222–235** (the `if (!customerName || ... || !hasActiveDay) { continue; }` block). That is the only place rows are removed in the sales path.

**Why hasActiveDay is false for every row:**

- Day columns are set in **parseRawRouteListExcel** (lines 116–118):
  - `monCol: findColumnIndexWithAliases(headerRow, ['monday', 'mon'])`, etc.
- **findColumnIndexWithAliases** → **findColumnIndex** (lines 14–22): match is **exact** after `toLowerCase().trim()`:
  - `headerRow[i].toString().toLowerCase().trim() === normalizedName`
  - So the header cell must be exactly `"monday"` or `"mon"` (and similarly for tue…sat).
- If the actual headers in the file differ in any way (extra spaces, different Unicode space, "Mon " with trailing space, or any character that doesn’t trim to exactly `"monday"` / `"mon"`), then **findColumnIndex** returns **null** for that column.
- If **all** of Mon–Sat fail to match, then `monCol … satCol` are all **null**. In **enrichRouteRows** (lines 212–218), when `columnMap.monCol != null` is false, `days.mon` is set to **false** (and same for tue…sat). So **hasActiveDay** is always false and **every row is skipped**.

So:

- **Root cause:** Weekday columns (Monday … Saturday) are **not** being matched to the column map because matching is **exact**. So `monCol … satCol` are null, `days` are all false, and the validation at 226–234 drops every row.

**Secondary possibility:** Customer could also fail (e.g. if "Location" weren’t matched and both customer and address fallback were empty), but for a template that has Location and weekday headers, the dominant failure mode is **day columns not mapped**.

---

## 6. Minimal fix that supports BOTH formats

**Requirement:** Support both (1) OLD: single **Day** column with values like "Mon,Tue,Fri", and (2) NEW: separate **Monday**, **Tuesday**, … columns with checkmarks/TRUE, without breaking existing templates.

**Recommended approach:**

1. **Keep current behaviour for weekday columns**  
   Leave `findColumnIndexWithAliases(headerRow, ['monday', 'mon'])` etc. as-is so existing templates with "Monday"/"Mon" continue to work.

2. **In the same file, in the same column map**, add support for a **single "Day" column** when the NEW-style columns are **not** present:
   - After building the current `columnMap` (lines 111–123), **if** all of `monCol … satCol` are null, try to find a column with header exactly `"day"` or `"days"` (e.g. with `findColumnIndexWithAliases(headerRow, ['day', 'days'])`).
   - Do **not** change the structure of `columnMap` or the rest of the pipeline; only add this fallback when the six weekday columns are missing.

3. **In enrichRouteRows**, when a single "Day" column exists and the six weekday columns do **not**:
   - **If** `columnMap.dayCol != null` and `monCol … satCol` are all null, then for each row read the cell at `dayCol`, parse the value (e.g. split by comma/semicolon/space, normalize to "mon"/"tue"/…/"sat"), and set `days.mon`, `days.tue`, … accordingly (e.g. "Mon", "Monday" → mon: true).
   - **Else** keep the existing logic: `days.mon = columnMap.monCol != null ? cellToBoolean(r[columnMap.monCol]) : false`, etc.

So:

- **OLD format:** Either already has Mon/Tue/… columns (unchanged), or gets a new path: single "Day" column → parsed into `days` in enrichRouteRows.
- **NEW format:** Headers "Monday", "Tuesday", … must match exactly; if they do not in your file, the **minimal** fix is to relax the match **only for weekday columns** (e.g. allow partial match like "monday" contained in the header, or trim/normalize more aggressively) so that "Monday", "Tuesday", … in the file are found. The smallest change is in **parseRawRouteListExcel**: for the six day columns only, use a **partial/containment** match (e.g. header contains "monday" or "mon") so that "Monday", " Monday", "Monday ", etc. still map. That way you don’t add a "Day" column to the NEW template; you just make the existing Monday–Saturday column detection more tolerant.

**Concrete minimal change (recommended):**

- **File:** `engine/parseRouteListExcel.js`.
- **Place:** Where `monCol … satCol` are set (lines 116–121). Instead of **only** `findColumnIndexWithAliases` (exact), add a **fallback** for each day: if the exact alias match returns null, call a **partial** matcher (e.g. same as `findColumnIndexByPartialAliases` or a helper that returns the first column whose header, lowercased and trimmed, **contains** `"monday"` or `"mon"`). Use that only for the day columns so Address/Customer/Suburb/City/Province remain exact or partial as they are today.
- **Result:** NEW template headers like "Monday", "Tuesday", … (and minor variants) will map to monCol … satCol; `days` will be set from the cells; `hasActiveDay` will be true where a day is checked; rows will no longer be dropped. OLD templates (with "Mon"/"Monday" or a single "Day" column) can be supported as above if you also add the single "Day" fallback; otherwise, with only the partial match for weekday headers, OLD format with separate Mon/Tue columns still works, and OLD format with single "Day" column would require the separate "Day" parsing in enrichRouteRows as described.

**Summary:**

- **Root cause:** Rows are dropped in **enrichRouteRows** (lines 226–234) because **hasActiveDay** is false for every row, due to **monCol … satCol** being null when weekday headers don’t match **exactly**.
- **Exact location of filtering:** `engine/parseRouteListExcel.js` lines **222–235**.
- **Minimal fix:** In `parseRawRouteListExcel`, make weekday column detection tolerant for "Monday"/"Tuesday"/… (e.g. partial/containment match for day names only). Optionally add support for a single "Day" column in the same file and in **enrichRouteRows** when the six weekday columns are absent, so both OLD and NEW formats work without breaking existing routelist templates.
