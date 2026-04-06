# Manual Trip Mileage Calculation — Audit Report

**Audit date:** 2026-03-14  
**Scope:** Logbook engine pipeline for manual trip insertion, route processing, distance calculation, and odometer updates.  
**Rule:** Diagnostic only — no code changes, no fixes implemented.

---

## 1. Where manual trips enter the engine

### 1.1 UI: manual trip creation

**File:** `public/js/logbook-page.js`

**Location:** ~lines 998–1027 (`saveAdj` click handler in `initManualModals()`).

When the user clicks **“Save”** in the **“Add missing trip”** modal (manualAdjustmentModal):

- **Collected fields:** date, reason (purpose), from (tripFrom), to (tripTo).
- **Object pushed to `manualEntriesArray`:**

```javascript
var entry = {
  date: dateVal,
  from: fromVal,
  to: toVal,
  purpose: reason,
  day: new Date(dateVal + 'T12:00:00').toLocaleDateString('en-ZA', { weekday: 'short' }),
  businessKm: 0,   // ← hardcoded
  privateKm: 0     // ← hardcoded
};
manualEntriesArray.push(entry);
```

- **Not set:** `distance_km`, `km`, `openingKm`, `closingKm`. From/to addresses are stored but **never sent to the routing service**.
- **Conclusion:** Manual trip object structure is fixed at creation: **`businessKm` and `privateKm` are always 0**. No distance is computed or stored at insertion time.

### 1.2 Engine input

**File:** `public/js/logbook-page.js`

**Location:** ~lines 1117–1133 (`engineInput` built in `runEngineWithRoutes()`).

- `manualEntriesArray` is passed into the engine only when non-empty:  
  `if (manualEntriesArray && manualEntriesArray.length > 0) engineInput.manualEntries = manualEntriesArray;`
- So manual trips enter the engine as **pre-built objects** with `businessKm: 0`, `privateKm: 0`, and no `km` or distance field.

---

## 2. Where distance calculation occurs

### 2.1 Pipeline that computes distances

**File:** `public/engine/logbookEngine.js`

**Flow:** `runLogbookEngine(input)` (starts ~line 896).

1. **Step 1 (~934–963):** Expand **routes** into **visits** (or use precomputed visits). **Manual entries are not used here** — they are not turned into visits.
2. **Step 2 (~965–972):** `routingService.getDistances(homeAddress, uniqueAddresses)` — distances **from home to each unique visit address**. Only **visit** addresses; no manual from/to.
3. **Step 3 (~974–1015):** For each date, for **sequential visits**, `routingService.getDistance(fromAddress, toAddress)` for visit→visit and last visit→home. Again **only visit addresses**.
4. **Step 4 (~1017–1030):** Build `allDistances` from:
   - Home → visit (by fullAddress)
   - Sequential visit → visit and last visit → home  
   **No keys or calls involve manual trip from/to.**
5. **Step 5 (~1032–1035):** `generateLogbookEntries(visits, allDistances, ..., manualEntries, ...)`.

So **distance calculation runs only for route-derived visits**. Manual trips are **never** passed to `routingService.getDistance()` or `getDistances()`.

### 2.2 How generated entries get businessKm

**File:** `public/engine/logbookEngine.js`

**Location:** ~549–602, 704–799 (inside `generateLogbookEntries()`).

- For each day, for each segment (home→first, visit→visit, last→home):
  - Distance is read from `distances` (the `distanceMap` / `allDistances`) using keys like `HOME→${fullAddress}` or `${fromAddress}→${toAddress}`.
  - That distance is used as `segmentKm` / `tripDistance` and stored as **`businessKm`** on the generated logbook row.
- So **generated trips get businessKm from the precomputed distance map**, which is populated only from **visits**.

---

## 3. Why manual trips end up with distance = 0

### 3.1 How manual entries are merged

**File:** `public/engine/logbookEngine.js`

**Location:** ~835–865 (inside `generateLogbookEntries()`).

```javascript
if (manualEntries && Array.isArray(manualEntries) && manualEntries.length > 0) {
    manualEntries.forEach(manual => {
        const manualDateStr = ...;
        const businessKm = Number(manual.businessKm) != null && manual.businessKm !== ''
            ? Number(manual.businessKm)
            : (Number(manual.km) || 0);
        const privateKm = Number(manual.privateKm) || 0;
        const manualEntry = {
            date: manualDateStr,
            day: ...,
            openingKm: manual.openingKm,
            closingKm: manual.closingKm,
            businessKm,
            privateKm,
            purpose: manual.purpose || 'Manual Trip',
            from: manual.from != null ? String(manual.from) : '',
            to: manual.to != null ? String(manual.to) : '',
            type: 'manual'
        };
        generatedDays = generatedDays.filter(d => d.date !== manualDateStr);
        generatedDays.push(manualEntry);
    });
    ...
}
```

- **businessKm** is taken only from `manual.businessKm` or `manual.km`. Both are **never set** in the UI (UI sets `businessKm: 0` and does not set `km`), so **businessKm is always 0**.
- **Manual trips do not go through the distance map.** They are not looked up in `distances`; there is no `routingService.getDistance(manual.from, manual.to)` anywhere. So even though `manual.from` and `manual.to` exist, they are **never used for distance calculation**.

### 3.2 Odometer updates for manual trips

**File:** `public/engine/logbookEngine.js`

**Location:** ~866–876 (same function, after manual merge).

```javascript
let runningOdometer = vehicleOpeningKm;
for (let i = 0; i < generatedDays.length; i++) {
    const entry = generatedDays[i];
    entry.openingKm = runningOdometer;
    const businessKm = Number(entry.businessKm) || 0;
    const privateKm = Number(entry.privateKm) || 0;
    entry.closingKm = runningOdometer + businessKm + privateKm;
    runningOdometer = entry.closingKm;
}
```

- **All** entries (including manual) get **openingKm** and **closingKm** recalculated for odometer continuity.
- For manual entries, `businessKm` and `privateKm` are 0, so **closingKm = openingKm**. Odometer progression is correct but **distance for the manual row remains 0** because **businessKm was never calculated**.

---

## 4. Root cause summary

| Question | Answer |
|----------|--------|
| **Why do manual trips show 0 km?** | They are created with `businessKm: 0` and never get a distance computed from their from/to addresses. |
| **Missing distance calculation?** | **Yes.** No code path calls the routing service for `manual.from` → `manual.to`. |
| **Skipped pipeline stage?** | **Yes.** Manual entries are not turned into visits and are not included in the distance-calculation steps (Steps 2–4). They are merged in later with whatever `businessKm`/`km` they already have (0). |
| **Incorrect trip object structure?** | Partly. Structure is valid (date, from, to, purpose, businessKm, privateKm), but **businessKm is hardcoded to 0** at creation and **no `km` field is set**. |
| **Missing route lookup?** | **Yes.** The engine never looks up or computes a distance for the manual from→to pair; `allDistances` has no key for manual trips. |

---

## 5. Exact files and code locations

| Responsibility | File | Location |
|----------------|------|----------|
| Manual trip object created with **businessKm: 0**, **privateKm: 0**; from/to captured but not used for distance | `public/js/logbook-page.js` | ~1011–1020 (`entry` object and `manualEntriesArray.push(entry)`) |
| Manual entries passed into engine | `public/js/logbook-page.js` | ~1133 (`engineInput.manualEntries = manualEntriesArray`) |
| Distance map built **only from visits** (no manual from/to) | `public/engine/logbookEngine.js` | ~965–1030 (Steps 2–4 in `runLogbookEngine`) |
| Manual entries merged into logbook using **only** `manual.businessKm` / `manual.km` (no distance lookup) | `public/engine/logbookEngine.js` | ~837–855 (`manualEntries.forEach`, `businessKm` derivation, `manualEntry` build) |
| Odometer recalc (correct; does not fix businessKm) | `public/engine/logbookEngine.js` | ~868–876 |

---

## 6. Conditional logic that affects manual trips

- There is **no** conditional that explicitly **skips** distance for manual trips inside the engine (e.g. no `if (manual) skip distance`).  
- The behaviour is structural: **manual entries are never fed into the distance-calculation pipeline**. They are only merged in after all distances have been computed from **visits**.
- The only relevant condition is: **if** `manualEntries` is non-empty, **then** merge them with the existing `businessKm`/`privateKm` (and thus 0 km) and then run the odometer pass.

---

## 7. Conclusion

- **Where manual trips enter:** Created in `logbook-page.js` (manualAdjustmentModal Save) with **businessKm: 0**, **privateKm: 0**; passed in `engineInput.manualEntries`.
- **Where distance is calculated:** In `logbookEngine.js` only for **visits** (from routes); `allDistances` is filled from home→visit and visit→visit→home. Manual from/to are **never** used in this step.
- **Why manual trips show 0 km:** (1) UI always sets **businessKm** and **privateKm** to 0 and never calls the routing service for the manual from/to. (2) Engine never looks up or computes distance for manual trips; it only copies **manual.businessKm** / **manual.km** into the logbook row, which remain 0.
- **Exact cause:** **Missing distance calculation** for manual trips (no routing call for `manual.from` → `manual.to`) and **skipped pipeline stage** (manual entries are not part of the visit-based distance computation). The trip object structure is valid but **businessKm is hardcoded to 0** at creation and never updated.

**End of audit.**
