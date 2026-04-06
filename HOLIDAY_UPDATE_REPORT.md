# SA Public Holiday System – Update Report

## File(s) modified

- **engine/logbookEngine.js** (only file changed)

---

## Where the old holiday logic was replaced

- **Removed:** The static object `SA_PUBLIC_HOLIDAYS_2026` (fixed 2026-only dates) and the function `applySundayShift(holidayMap)` that built a single shifted map. The constant `HOLIDAYS` that was used for all dates was removed.

- **Replaced:** The single day-evaluation block inside the main logbook day loop (the `while (currentDate <= end)` loop that builds `generatedDays`). Previously it used:
  - `const isHoliday = Boolean(HOLIDAYS[dateStr]);`
  - `purpose: "Public Holiday"`
  It now uses:
  - `const year = currentDate.getFullYear();`
  - `const holidayMap = getHolidayMapForYear(year);`
  - `const holidayName = holidayMap[dateStr];`
  - `const isHoliday = Boolean(holidayName);`
  - `purpose: holidayName` (so the holiday name appears in the logbook row).

No other files were changed. Routing, parsers, export, and UI were not modified.

---

## Functions added

| Function | Purpose |
|----------|--------|
| `getEasterDate(year)` | Computes Easter Sunday for a given year (deterministic algorithm). |
| `toISODate(date)` | Returns `YYYY-MM-DD` from a Date using local date (avoids UTC shift). |
| `cloneDate(date)` | Returns a new Date with the same time value. |
| `addHolidayWithObservedRule(holidays, date, name)` | Adds the holiday on its calendar date; if that date is Sunday, also adds the next day (Monday) as `name + " (Observed)"`. |
| `generateSAHolidays(year)` | Builds the full SA holiday map for a year: fixed-date holidays (with observed rule) plus Good Friday and Family Day from Easter. |
| `getHolidayMapForYear(year)` | Returns the holiday map for the year, using the in-memory `holidayYearCache` so each year is only generated once. |

---

## Confirmation: automatic SA public holidays for any year

- Holidays are no longer tied to 2026. For each date in the range, the engine gets the year, then `getHolidayMapForYear(year)` returns (or generates and caches) that year’s map.
- Fixed-date holidays: New Year's Day (Jan 1), Human Rights Day (Mar 21), Freedom Day (Apr 27), Workers Day (May 1), Youth Day (Jun 16), National Women's Day (Aug 9), Heritage Day (Sep 24), Day of Reconciliation (Dec 16), Christmas Day (Dec 25), Day of Goodwill (Dec 26).
- Easter-based: Good Friday (Easter − 2 days), Family Day (Easter + 1 day).

---

## Confirmation: observed Monday holidays

- `addHolidayWithObservedRule` is used for all fixed-date holidays. The calendar date is always in the map. If that date is a Sunday (`getDay() === 0`), the following Monday is also added with the same name plus `" (Observed)"`.
- Good Friday and Family Day are written directly into the map (no observed rule), which matches the requirement unless their actual date falls on a Sunday (in which case the current design does not add an extra observed day for them; the task stated to use the observed rule “consistently” and to add the Monday when the holiday falls on Sunday—so for Easter-based holidays we only add the observed Monday when the fixed-date holidays fall on Sunday).

---

## Validation examples (expected behaviour)

| Date | Expected label |
|------|----------------|
| 2024-06-17 | Youth Day (Observed) — 2024-06-16 is Sunday. |
| 2025-04-28 | Freedom Day (Observed) — 2025-04-27 is Sunday. |
| 2026-08-10 | National Women's Day (Observed) — 2026-08-09 is Sunday. |
| 2026-04-03 | Good Friday — Easter 2026 is 2026-04-05, so Good Friday is 2026-04-03. |
| 2026-04-06 | Family Day — Easter Sunday + 1. |

---

## Confirmation: no routing / export / UI changes

- No changes were made to routing, parsers, XLSX export, or any UI.
- Only holiday handling inside the logbook engine was changed: removal of static data, addition of the generator and cache, and year-aware lookup with holiday name in the purpose field. Leave days, manual entries, weekends, work Saturdays, odometer logic, and export formatting are unchanged.

---

## Debug logging

- When `global.DEBUG_HOLIDAYS` is truthy (e.g. `window.DEBUG_HOLIDAYS = true` in the browser):
  - On generating a year’s holidays: `[DEBUG_HOLIDAYS] generated holidays for year <year>`.
  - When a date matches a holiday: `[DEBUG_HOLIDAYS] matched holiday <dateStr> = <holidayName>`.
