# Saturday Handling Audit — Logbook Generation Engine

**Audit type:** Read-only (no files modified)  
**Goal:** Confirm whether Saturday is treated exactly like Monday–Friday during trip generation.

---

## PART 1 — Template parsing

**File:** `public/engine/parseRouteListExcel.js`

### Saturday column detection

- **Line 136:** Saturday column is resolved the same way as other weekdays:
  ```javascript
  satCol: findColumnIndexWithAliases(headerRow, ['saturday', 'sat']) || findWeekdayColumnByPartialMatch(headerRow, 'saturday'),
  ```
- Same pattern as `monCol`–`friCol`: exact aliases then partial match. No extra logic for Saturday.

### Cell value → boolean

- **Lines 161–167:** `cellToBoolean(value)` is shared by all weekday columns. No Saturday-specific branch.
- **Lines 264–270:** `route.days` is built uniformly:
  ```javascript
  var days = {
    mon: columnMap.monCol != null ? cellToBoolean(r[columnMap.monCol]) : false,
    ...
    sat: columnMap.satCol != null ? cellToBoolean(r[columnMap.satCol]) : false
  };
  ```
- No code after this overwrites or overrides `route.days.sat`. Row filtering uses `hasActiveDay` (any day true), not Saturday specifically.

### Conclusion (Part 1)

**1. Is `route.days.sat` correctly parsed?**  
**Yes.** Saturday is parsed like Monday–Friday: same column resolution, same `cellToBoolean()`, same `route.days.sat` assignment. No extra logic modifies or overrides `route.days.sat`.

---

## PART 2 — Visit generation

**File:** `public/engine/logbookEngine.js`

### Weekday mapping

- **Lines 159–169:** `weekdayToDayKey(weekday)`:
  ```javascript
  const mapping = {
    1: 'mon', 2: 'tue', 3: 'wed', 4: 'thu', 5: 'fri', 6: 'sat'
  };
  return mapping[weekday] || null;
  ```
- Saturday (6) → `'sat'`. Same pattern as other weekdays; Sunday (0) correctly returns `null` (not in mapping).

### Visit expansion (routes with startDate)

- **Lines 265–267** in `expandRouteWithDateRange`:
  ```javascript
  const weekday = getWeekday(currentDate);
  const dayKey = weekdayToDayKey(weekday);
  if (dayKey && route.days && route.days[dayKey]) {
      visits.push({ ... });
  }
  ```
- One condition for all weekdays: `route.days[dayKey]` (including `route.days['sat']`). No special case for Saturday.

### Visit expansion (legacy routes, no startDate)

- **Lines 361–374** in `expandRoutes`:
  ```javascript
  const weekday = getWeekday(currentDate);
  const dayKey = weekdayToDayKey(weekday);
  ...
  for (const route of legacyRoutes) {
      if (!dayKey || !route.days[dayKey]) continue;
      ...
      visits.push({ ... });
  }
  ```
- Same rule: `route.days[dayKey]` for any weekday, including Saturday. No code prevents Saturday visits when `route.days.sat === true`.

### Conclusion (Part 2)

**2. Are Saturday visits generated using the same logic as other weekdays?**  
**Yes.** Visit generation uses `weekdayToDayKey` (6 → `'sat'`) and `if (route.days[dayKey])` for every weekday. When `route.days.sat === true`, Saturday visits are created. There is no branch that blocks Saturday visits in the visit-expansion step.

---

## PART 3 — Workday logic and special Saturday handling

**Files:** `public/engine/logbookEngine.js`, `public/engine/dateRange.js`

### workDays derivation (logbookEngine.js)

- **Lines 442–460** in `generateLogbookEntries`:
  - `workDays` is built from `route.days` via a single `dayMap` that includes `sat: 6`.
  - Any route with `route.days.sat === true` adds 6 to `enabledDays`, so Saturday is in `workDays`.
  - No `workSaturdays`, `includeSaturday`, or `weekendOverrides` in this file. No special block that adds or removes Saturday from `workDays`.

### Where Saturday is treated differently: `isWorkDay(currentDate)`

- **Line 526** in `generateLogbookEntries`:
  ```javascript
  } else if (!isWorkDay(currentDate)) {
      generatedDays.push({ ..., purpose: "Non-Work Day", ... });
  } else if (visitsByDate.has(dateStr)) {
      // Generate trips for work days with visits
  ```
- The decision “is this date a work day?” uses `isWorkDay(currentDate)`. The local `workDays` array (which includes 6 when the template has Saturday checked) is **not** used here.

### Definition of `isWorkDay`

- **File:** `public/engine/dateRange.js`  
- **Lines 38–41:**
  ```javascript
  function isWorkDay(date) {
    var d = new Date(date);
    var day = d.getDay();
    return day !== 0 && day !== 6;
  }
  ```
- **JSDoc (lines 33–34):** “Returns true if the given date is a weekday (Monday–Friday), false for Saturday/Sunday.”
- So **Saturday (6) and Sunday (0) always yield false.** This is fixed Monday–Friday logic; it does not depend on routes or `workDays`.

### How the engine gets `isWorkDay`

- **Script order in** `public/logbook.html` (lines 436–437): `engine/dateRange.js` then `engine/logbookEngine.js`.
- `dateRange.js` attaches `isWorkDay` to the global (e.g. `window.isWorkDay`).
- `logbookEngine.js` does not define its own `isWorkDay`; it calls `isWorkDay(currentDate)` at line 526, so it uses the global from `dateRange.js`.

### Effect on Saturday

- For every Saturday in the date range, `isWorkDay(currentDate)` is **false**.
- So the engine always takes the `!isWorkDay(currentDate)` branch and pushes a “Non-Work Day” entry.
- It never reaches `else if (visitsByDate.has(dateStr))` for Saturday, so **Saturday trips from visits are never written to `generatedDays`**, even when Saturday visits exist in `visitsByDate`.

### Conclusion (Part 3)

**3. Does any special Saturday logic exist?**  
**Yes.** It is not named “workSaturdays” or “includeSaturday,” but the behavior is special-case:

- **Location:** `public/engine/logbookEngine.js` **line 526** uses `isWorkDay(currentDate)`.
- **Definition:** `public/engine/dateRange.js` **lines 38–41** define `isWorkDay` as Monday–Friday only (explicitly false for Saturday and Sunday).
- **Effect:** Saturday is always treated as a non–work day in the entry-generation loop, so Saturday trips are suppressed regardless of `route.days.sat` or the locally computed `workDays`.

**4. Exact place where Saturday handling diverges from other weekdays**

- **File:** `public/engine/logbookEngine.js`  
- **Line:** 526  
- **Code:** `} else if (!isWorkDay(currentDate)) {`  
- **Reason:** The function used here (`dateRange.js` `isWorkDay`) does not use the engine’s `workDays` (which includes Saturday when the template has Saturday checked). It uses a fixed Monday–Friday rule, so Saturday (and Sunday) are always classified as non–work days and never get trip entries from `visitsByDate`.

---

## PART 4 — Weekend detection

**File:** `public/js/logbook-page.js`

### Where it runs

- **Lines 185–191:** `isWeekend(dateStr)` (Saturday/Sunday) is defined inside `exportLogbookToXlsx`.
- **Lines 418–427:** “Weekend Trips Detected” is built by iterating `result.entries` (the generated logbook), keeping entries where `isWeekend(e.date)` and `!isNoTripsDay(e)` (i.e. business km &gt; 0), and pushing to `weekendTrips` for the Summary.

### Does it affect generation?

- Weekend detection only reads `result.entries` and builds Summary content. It does not call the engine, does not change visits or routes, and does not alter `generatedDays` or `result.entries`. So it is reporting-only and does not block or change trip generation.

### Conclusion (Part 4)

**5. Does weekend detection affect generation or only reporting?**  
**Only reporting.** Weekend detection uses the already-generated entries to build the “Weekend Trips Detected” section of the Summary. It does not affect whether Saturday (or any) trips are generated.

---

## Summary table

| Question | Answer |
|----------|--------|
| 1. Is `route.days.sat` correctly parsed? | **Yes.** Same as other weekdays; no override. |
| 2. Are Saturday visits generated with the same logic as other weekdays? | **Yes.** `weekdayToDayKey(6) === 'sat'` and `route.days[dayKey]`; no blocking of Saturday in visit expansion. |
| 3. Does any special Saturday logic exist? | **Yes.** Entry generation uses global `isWorkDay` (Monday–Friday only), so Saturday is always treated as non–work day and never gets trip entries. |
| 4. Exact break point for Saturday trips | **logbookEngine.js line 526:** `isWorkDay(currentDate)` is the global from **dateRange.js lines 38–41**, which returns false for Saturday; the engine never uses the local `workDays` array here, so Saturday trips are suppressed. |
| 5. Does weekend detection affect generation? | **No.** Reporting only (Summary). |

---

## Root cause (break point)

Saturday is lost **after** visit generation:

1. **Parser:** Sets `route.days.sat` from the template (correct).
2. **Visit expansion:** Creates Saturday visits when `route.days.sat === true` (correct).
3. **Entry generation:** For each date, the engine uses **global `isWorkDay(currentDate)`** (dateRange.js) instead of the **local `workDays`** array. That global returns false for Saturday, so every Saturday is turned into a “Non-Work Day” row and the branch that would emit the real trip from `visitsByDate` is never taken.

So the exact break point is: **`generateLogbookEntries` does not use the derived `workDays` to decide “work day or not”; it uses the global `isWorkDay`, which hard-codes Saturday (and Sunday) as non–work days.**

To make Saturday behave like Monday–Friday, entry generation would need to treat a date as a work day when `workDays.includes(currentDate.getDay())` (or equivalent) instead of calling the global `isWorkDay(currentDate)`.
