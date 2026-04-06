# FORENSIC AUDIT — LOGBOOK ENGINE DISTANCE PIPELINE

## SECTION A — ROUTING LAYER

### A1. Google Routes API Response
**File:** `logbook-engine-core/lab/lib/routing/googleRouting.js`
- **Line 104:** `const meters = route?.distanceMeters;`
- **Line 110:** `const km = meters / 1000;` ✅ CORRECT (divides by 1000)
- **Line 130:** `const roundedKm = Number(km.toFixed(2));` ✅ CORRECT (rounds at output)
- **Line 133-137:** Returns `{ km: roundedKm, minutes: roundedMinutes, source: 'google-routes' }` ✅ CORRECT

**What getDistance() returns:**
- **File:** `logbook-engine-core/lab/lib/routing/googleRouting.js`
- **Line 24-27:** `getDistance()` calls `getDistances()` and returns `results.get(destination) || { km: 0, minutes: 0, source: 'error' }`
- **Returns:** `{ km: number, minutes: number, source: string }` ✅ CORRECT

**What getDistances() returns:**
- **File:** `logbook-engine-core/lab/lib/routing/googleRouting.js`
- **Line 33-59:** `getDistances()` returns `Map<string, { km: number, minutes: number, source: string }>`
- **Line 44:** Sets result: `results.set(destination, result)` where `result = { km, minutes, source }` ✅ CORRECT

### A2. Cached Routing Layer
**File:** `logbook-engine-core/lab/lib/routing/cachedRouting.js`

**getDistance() behavior:**
- **Line 64-112:** Wraps provider's `getDistance()`
- **Line 70-74:** Returns cached: `{ km: cached.km, minutes: cached.minutes, source: ... }` ✅ CORRECT
- **Line 90:** Fetches from provider: `const result = await this.provider.getDistance(...)`
- **Line 93-97:** Stores in cache: `{ km: result.km, minutes: result.minutes, source: result.source }` ✅ CORRECT
- **Line 102:** Returns `result` (which has `.km` property) ✅ CORRECT

**getDistances() behavior:**
- **Line 117-179:** Wraps provider's `getDistances()`
- **Line 129-133:** Returns cached: `{ km: cached.km, minutes: cached.minutes, source: ... }` ✅ CORRECT
- **Line 145:** Fetches from provider: `const providerResults = await this.provider.getDistances(...)`
- **Line 148-156:** Stores in cache and results: `{ km: result.km, minutes: result.minutes, source: result.source }` ✅ CORRECT
- **Line 155:** Sets in results Map: `results.set(dest, result)` where `result = { km, minutes, source }` ✅ CORRECT

**⚠️ POTENTIAL ISSUE — Cache File:**
- **Line 32-34:** Cache loads from JSON file: `this.cache = new Map(Object.entries(cacheData))`
- **Line 50-51:** Cache saves to JSON: `JSON.stringify(cacheObject, null, 2)`
- **RISK:** If cache file contains old data in meters (from before fix), it will be loaded and used
- **Cache file location:** `logbook-engine-core/lab/.cache/distances.json`
- **Cache structure:** `{ "origin -> destination": { km: number, minutes: number, source: string } }`

---

## SECTION B — ENGINE CONSUMPTION

### B1. Home to Visits Distances
**File:** `logbook-engine-core/src/logbookEngine.js`
- **Line 390:** `const homeToVisitsRaw = await routingService.getDistances(homeAddress, uniqueAddresses);`
  - **Returns:** `Map<string, { km: number, minutes: number, source: string }>` ✅ CORRECT TYPE
- **Line 392-396:** Converts to Map with km values:
  ```javascript
  const homeToVisits = new Map();
  for (const [address, distanceResult] of homeToVisitsRaw.entries()) {
      const distance = typeof distanceResult === 'object' && distanceResult.km !== undefined ? distanceResult.km : distanceResult;
      homeToVisits.set(address, distance);
  }
  ```
  - **Variable:** `distance`
  - **Using:** `distanceResult.km` ✅ CORRECT (extracts .km property)
  - **Fallback:** If not object, uses `distanceResult` directly (for backward compatibility)
  - **Result:** `homeToVisits` is `Map<string, number>` where values are km ✅ CORRECT

### B2. Sequential Visit Distances (Visit to Visit)
**File:** `logbook-engine-core/src/logbookEngine.js`
- **Line 426:** `const distanceResult = await routingService.getDistance(fromAddress, toAddress);`
  - **Returns:** `{ km: number, minutes: number, source: string }` ✅ CORRECT TYPE
- **Line 427:** `const distance = typeof distanceResult === 'object' && distanceResult.km !== undefined ? distanceResult.km : distanceResult;`
  - **Variable:** `distance`
  - **Using:** `distanceResult.km` ✅ CORRECT (extracts .km property)
  - **Line 428:** `sequentialDistances.set(tripKey, distance);`
  - **Result:** `sequentialDistances` is `Map<string, number>` where values are km ✅ CORRECT

### B3. Return to Home Distances
**File:** `logbook-engine-core/src/logbookEngine.js`
- **Line 441:** `const distanceResult = await routingService.getDistance(lastAddress, homeAddress);`
  - **Returns:** `{ km: number, minutes: number, source: string }` ✅ CORRECT TYPE
- **Line 442:** `const distance = typeof distanceResult === 'object' && distanceResult.km !== undefined ? distanceResult.km : distanceResult;`
  - **Variable:** `distance`
  - **Using:** `distanceResult.km` ✅ CORRECT (extracts .km property)
  - **Line 443:** `sequentialDistances.set(returnKey, distance);`
  - **Result:** Stored as km number ✅ CORRECT

### B4. Combining Distances into allDistances Map
**File:** `logbook-engine-core/src/logbookEngine.js`
- **Line 452-455:** Adding homeToVisits to allDistances:
  ```javascript
  for (const [address, distanceResult] of homeToVisits.entries()) {
      const distance = typeof distanceResult === 'object' && distanceResult.km !== undefined ? distanceResult.km : distanceResult;
      allDistances.set(`HOME→${address}`, distance);
  }
  ```
  - **⚠️ ISSUE FOUND:** `homeToVisits` already contains numbers (km values), not objects
  - **Line 452:** Iterates over `homeToVisits.entries()` where values are already numbers
  - **Line 453:** Tries to extract `.km` from a number (will be undefined)
  - **Line 453:** Falls back to `distanceResult` (the number itself) ✅ WORKS BUT REDUNDANT
  - **Result:** Correct km values stored, but unnecessary object check

- **Line 458-460:** Adding sequentialDistances to allDistances:
  ```javascript
  for (const [key, distance] of sequentialDistances.entries()) {
      allDistances.set(key, distance);
  }
  ```
  - **Variable:** `distance` (already a number from line 427/442)
  - **Using:** Direct value ✅ CORRECT
  - **Result:** Correct km values stored ✅ CORRECT

### B5. Entry Generation
**File:** `logbook-engine-core/src/logbookEngine.js`
- **Line 463:** `const entries = generateLogbookEntries(visits, allDistances, openingKm, homeAddress);`
  - **Passes:** `allDistances` Map where values are numbers (km) ✅ CORRECT

**Inside generateLogbookEntries():**
- **Line 220-233:** Home to first visit:
  - **Line 225:** `const homeToFirstDistance = distances.get(homeToFirstKey);`
  - **Variable:** `homeToFirstDistance` (number in km)
  - **Line 242:** `businessKm: homeToFirstDistance` ✅ CORRECT

- **Line 264-286:** Visit to visit:
  - **Line 264:** `const tripDistance = distances.get(tripKey);`
  - **Variable:** `tripDistance` (number in km)
  - **Line 281:** `businessKm: tripDistance` ✅ CORRECT

- **Line 298-320:** Last visit to home:
  - **Line 298:** `const lastToHomeDistance = distances.get(lastToHomeKey);`
  - **Variable:** `lastToHomeDistance` (number in km)
  - **Line 315:** `businessKm: lastToHomeDistance` ✅ CORRECT

---

## SECTION C — TOTALS CALCULATION

**File:** `logbook-engine-core/src/logbookEngine.js`
- **Line 465-474:** Calculate totals:
  ```javascript
  let totalBusinessKm = 0;
  let totalPrivateKm = 0;
  let totalKm = 0;

  for (const entry of entries) {
      totalBusinessKm += entry.businessKm || 0;
      totalPrivateKm += entry.privateKm || 0;
      totalKm += (entry.businessKm || 0) + (entry.privateKm || 0);
  }
  ```
  - **Source:** `entry.businessKm` (which comes from distances Map)
  - **Accumulation:** Simple addition ✅ CORRECT
  - **No multiplication:** ✅ CORRECT
  - **No division:** ✅ CORRECT
  - **Result:** Totals are in km ✅ CORRECT

---

## SECTION D — EXPORT LAYER

**File:** `logbook-engine-core/lab/lib/exports/exportSchema.js`
- **Line 117:** `const distanceKm = (entry.businessKm || 0) + (entry.privateKm || 0);`
  - **Source:** `entry.businessKm` and `entry.privateKm` (already in km)
  - **Calculation:** Addition only ✅ CORRECT
  - **No modification:** ✅ CORRECT

**File:** `logbook-engine-core/lab/server.js`
- **Line 460-463:** Entry mapping:
  ```javascript
  businessKm: roundTo2Decimals(entry.businessKm || 0),
  privateKm: roundTo2Decimals(entry.privateKm || 0),
  openingKm: roundTo2Decimals(entry.openingKm || 0),
  closingKm: roundTo2Decimals(entry.closingKm || 0)
  ```
  - **Source:** `entry.businessKm` (already in km from engine)
  - **Operation:** Rounding only ✅ CORRECT
  - **No multiplication:** ✅ CORRECT

---

## CRITICAL FINDINGS

### ✅ CORRECT BEHAVIOR:
1. **Routing layer** correctly converts meters → km (divide by 1000)
2. **Routing layer** returns `{ km, minutes, source }` objects
3. **Engine** correctly extracts `.km` from routing results
4. **Engine** stores distances as numbers (km) in Maps
5. **Engine** uses distances directly (no further conversion)
6. **Totals** accumulate correctly (simple addition)
7. **Export layer** does not modify values

### ⚠️ POTENTIAL ISSUE — CACHE FILE:
**File:** `logbook-engine-core/lab/lib/routing/cachedRouting.js`
- **Line 32-34:** Cache loads from JSON file
- **Risk:** If cache file (`.cache/distances.json`) contains old data from before the unit conversion fix, those values might be in meters
- **Cache structure:** `{ "origin -> destination": { km: number, minutes: number, source: string } }`
- **If old cache exists:** Values in `km` field might actually be meters (if cached before fix)

### 🔍 VERIFICATION NEEDED:
1. Check if `.cache/distances.json` exists
2. If it exists, check if `km` values are suspiciously large (e.g., 14127.63 instead of 14.13)
3. If cache contains meter values, they need to be cleared or converted

---

## SUMMARY

**Pipeline Flow:**
1. Google Routes API → returns `distanceMeters` (meters) ✅
2. `googleRouting.js` → converts `meters / 1000` → returns `{ km: number }` ✅
3. `cachedRouting.js` → stores/returns `{ km: number }` ✅
4. Engine → extracts `.km` from objects → stores as numbers ✅
5. Engine → uses numbers directly in entry generation ✅
6. Engine → totals accumulate correctly ✅
7. Export → uses values as-is (rounding only) ✅

**All code paths appear correct. The issue is likely:**
- **Old cache file** containing meter values stored as `km` values
- **Solution:** Clear cache file or verify cache values are in km

---

## RECOMMENDED ACTION

1. **Check cache file:** `logbook-engine-core/lab/.cache/distances.json`
2. **If cache exists:** Inspect `km` values - if they look like meters (e.g., 14127.63), delete cache
3. **Clear cache:** Delete `.cache/distances.json` and regenerate


