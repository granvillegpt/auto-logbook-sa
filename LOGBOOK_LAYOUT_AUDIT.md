# Logbook layout and data source audit

**Scope:** XLSX logbook export layout and where each value comes from (form → engine → export).  
**Files:** `public/js/logbook-page.js` (export + form submit), `engine/logbookEngine.js` (return shape), `public/logbook.html` (form fields).

---

## 1. Export layout (order of rows in the sheet)

The export builds a single sheet with:

| Row / block | Content |
|-------------|--------|
| **TITLE** | Literal label `TITLE` |
| | `Auto Logbook SA` |
| **SECTION 1 – TAXPAYER** | Label, then 2-column table (Field \| Value) |
| | Full Name, Tax Number, Employer |
| **SECTION 2 – VEHICLE** | Label, then 2-column table |
| | Make, Model, Registration |
| **SECTION 3 – TAX PERIOD** | Label, then 2-column table |
| | Tax Year, Period |
| **SECTION 4 – ODOMETER SUMMARY** | Label, then 2-column table |
| | Opening KM, Closing KM, Total Travel KM, Total Business KM, Total Private KM, Method |
| **TRIP TABLE** | Label row then header row |
| | **Columns:** Date, Day, From, To, Shop Name, Purpose, Opening KM, Closing KM, Business KM, Distance KM |
| Data rows | One row per engine entry |

---

## 2. Where each value comes from

### 2.1 Data flow overview

```
Form (logbook.html)  →  initFormSubmit (logbook-page.js)  →  engineInput
                                                                    ↓
                                                    runLogbookEngine (logbookEngine.js)
                                                                    ↓
result = { entries, totals, meta }  ←  engine return
       ↓
exportLogbookToXlsx(result)  →  XLSX file
```

Only some form fields are read and passed into the engine. The engine returns `result.entries`, `result.totals`, and `result.meta`. The export uses **only** these three; it does not read the form.

---

### 2.2 SECTION 1 – TAXPAYER

| Export field | Source in export | Ultimate source | Notes |
|--------------|------------------|-----------------|--------|
| **Full Name** | Hard-coded `''` | — | Form has `firstName` and `surname` but they are **not** read on submit and **not** passed to the engine, so export has no value. |
| **Tax Number** | Hard-coded `''` | — | Form has `idNumber` but it is **not** read on submit or passed to the engine. |
| **Employer** | `result.meta.employerName` | Form `#employerName` | Form value is read in `initFormSubmit`, passed as `engineInput.employerName`, engine puts it in `meta.employerName`. |

---

### 2.3 SECTION 2 – VEHICLE

| Export field | Source in export | Ultimate source | Notes |
|--------------|------------------|-----------------|--------|
| **Make** | Hard-coded `''` | — | Form has `#vehicleMake` but it is **not** read on submit or passed to the engine. |
| **Model** | Hard-coded `''` | — | Form has `#vehicleModel` but it is **not** read on submit or passed to the engine. |
| **Registration** | Hard-coded `''` | — | Form has `#registrationNumber` but it is **not** read on submit or passed to the engine. |

---

### 2.4 SECTION 3 – TAX PERIOD

| Export field | Source in export | Ultimate source | Notes |
|--------------|------------------|-----------------|--------|
| **Tax Year** | `taxYearStr` | Derived from `meta.startDate` and `meta.endDate` | Export builds it as `startDate.slice(0,4) + '/' + endDate.slice(0,4)` (e.g. `2024/2025`). Engine gets `startDate`/`endDate` from form `#startDate` and `#endDate`. |
| **Period** | `periodStr` | Same `meta.startDate`, `meta.endDate` | Export builds `startDate + ' to ' + endDate`. Form dates come from tax year selector or manual date inputs. |

---

### 2.5 SECTION 4 – ODOMETER SUMMARY

| Export field | Source in export | Ultimate source | Notes |
|--------------|------------------|-----------------|--------|
| **Opening KM** | `firstEntry.openingKm` (or `''` if none) | Form `#openingKm` → engine input `openingKm` | Engine sets first entry’s `openingKm` from input; export uses first entry’s value. |
| **Closing KM** | `meta.closingKm` else `lastEntry.closingKm` | Form `#closingKm` → engine input `closingKm`; engine may overwrite last entry’s `closingKm` to match | Engine returns `meta.closingKm` when user provided closing; otherwise export falls back to last entry’s `closingKm`. |
| **Total Travel KM** | `result.totals.totalKm` | Engine-computed from entries and optional closing km | From engine’s single-source totals block. |
| **Total Business KM** | `result.totals.totalBusinessKm` | Sum of `entry.businessKm` in engine | From engine totals. |
| **Total Private KM** | `result.totals.totalPrivateKm` | Engine-computed (e.g. when closing km provided) | From engine totals. |
| **Method** | Literal `'Odometer Reconciliation'` | — | Fixed text in export. |

---

### 2.6 TRIP TABLE (per row)

Each row is one element of `result.entries`. The engine creates entries in `generateLogbookEntries()` with this shape:

- `date` – ISO date string for the trip date  
- `day` – Short weekday (e.g. `Mon`) from `toLocaleDateString('en-ZA', { weekday: 'short' })`  
- `from` – Origin address (home or visit `fullAddress`)  
- `to` – Destination address (visit `fullAddress` or home)  
- `purpose` – e.g. `"Sales Visit – CustomerName"`, `"Return Home"`, `"Leave Day"`, `"Public Holiday"`, `"Non-Work Day"`  
- `openingKm` – Odometer at start of segment (chained from previous row’s closing)  
- `closingKm` – `openingKm + businessKm` (and optionally adjusted for user closing km on last row)  
- `businessKm` – Distance for that segment from the routing service  

| Export column | Source in export | Ultimate source | Notes |
|---------------|------------------|-----------------|--------|
| **Date** | `e.date` | Engine: date of the calendar day for that entry | From `expandRoutes` date loop and `generateLogbookEntries`. |
| **Day** | `e.day` | Engine: weekday from that date | `toLocaleDateString('en-ZA', { weekday: 'short' })`. |
| **From** | `e.from` | Engine: home address or visit `fullAddress` | Home from input `homeAddress`; visit addresses from routelist (address/suburb/city/province → `fullAddress`). |
| **To** | `e.to` | Engine: visit `fullAddress` or home address | Same as above. |
| **Shop Name** | `shopNameFromPurpose(e.purpose)` | Derived in export from `e.purpose` | Export parses: if `purpose === 'Return Home'` → blank; else text after `" – "` in purpose (customer name from routelist). Engine sets purpose as `"Sales Visit – " + customer` or `"Return Home"`; customer comes from routelist `route.customer`. |
| **Purpose** | `e.purpose` | Engine | As above: visit purpose includes customer name; return/home/leave/holiday/non-work are fixed strings. |
| **Opening KM** | `e.openingKm` | Engine | Chained: first row = input `openingKm`; each next = previous row’s `closingKm`. |
| **Closing KM** | `e.closingKm` | Engine | `openingKm + businessKm` (last row may be set to user `closingKm` if provided). |
| **Business KM** | `e.businessKm` | Engine | Segment distance from `routingService.getDistance` / `getDistances` (Distance Matrix API). |
| **Distance KM** | Same as Business KM | Same as Business KM | Export uses `e.businessKm` for both columns (distance = business for these segments). |

---

## 3. What the form has vs what is used

| Form field (logbook.html) | Read in initFormSubmit? | Passed to engine? | In engine return? | In export? |
|---------------------------|-------------------------|-------------------|-------------------|------------|
| `#firstName` | No | No | No | No (Full Name blank) |
| `#surname` | No | No | No | No (Full Name blank) |
| `#idNumber` | No | No | No | No (Tax Number blank) |
| `#vehicleMake` | No | No | No | No (Make blank) |
| `#vehicleModel` | No | No | No | No (Model blank) |
| `#registrationNumber` | No | No | No | No (Registration blank) |
| `#vehicleYear` | No | No | No | — |
| `#employerName` | Yes | Yes (`employerName`) | `meta.employerName` | Yes (Employer) |
| `#homeAddress` | Yes | Yes (`homeAddress`) | Used in engine to build entries (from/to) | Yes (in trip From/To) |
| `#taxYear` | No (dates used instead) | — | — | — |
| `#startDate` | Yes | Yes (`startDate`) | `meta.startDate` | Yes (Tax Year, Period) |
| `#endDate` | Yes | Yes (`endDate`) | `meta.endDate` | Yes (Tax Year, Period) |
| `#openingKm` | Yes | Yes (`openingKm`) | First entry + totals | Yes (Opening KM, trip Opening KM) |
| `#closingKm` | Yes | Yes (`closingKm`) | `meta.closingKm`, last entry | Yes (Closing KM, totals) |
| `#currentWeek` | Yes | Yes (`currentWeek`) | Used in expandRoutes | — |
| `#workSaturdays` | Yes | Yes (`workSaturdays`) | Used in generateLogbookEntries | — |
| Leave days, manual entries | Yes | Yes | Used in engine / manual overrides | Reflected in entries |

So: **Full Name, Tax Number, Make, Model, and Registration** in the export are always blank because those form fields are never read or passed to the engine.

---

## 4. Engine return shape (reference)

```js
result = {
  entries: [
    { date, day, from, to, purpose, openingKm, closingKm, businessKm, privateKm }
  ],
  totals: {
    totalKm,
    totalBusinessKm,
    totalPrivateKm,
    businessUsePercentage
  },
  meta: {
    startDate,
    endDate,
    employerName,
    generatedAt,
    closingKm,  // if user provided closing km
    warnings
  }
}
```

The export does **not** use `privateKm` or `businessUsePercentage` in the current layout.

---

## 5. Summary

- **Layout:** Header sections (TITLE, Taxpayer, Vehicle, Tax Period, Odometer Summary) then trip table. All built in `exportLogbookToXlsx()` in `logbook-page.js`.
- **Filled from engine/form:** Employer, Tax Year, Period, Opening/Closing KM, totals, and every trip column (Date, Day, From, To, Shop Name from purpose, Purpose, Opening KM, Closing KM, Business KM, Distance KM).
- **Always blank in export:** Full Name, Tax Number, Make, Model, Registration — form collects them but submit handler does not read them and they are not in the engine result, so the export has no data to show.

To populate Full Name, Tax Number, Make, Model, and Registration in the XLSX you would need to (a) read those form fields in the submit handler, (b) pass them to the engine (or bypass engine and pass to export), and (c) either include them in the engine’s return or pass a separate payload into `exportLogbookToXlsx` so the export can write them into the header section.
