# Forensic isolation audit: route address resolution

**Goal:** Identify the exact step where route address resolution fails. No code changes; only isolate the break.

**Example route:** `"BELMONT BLUE BOTTLE LIQUORS"` (sales template: customer-only row, no address/suburb/city).

**Files audited:** `public/js/logbook-page.js`, `functions/src/index.js`, `functions/src/routeAddressResolver.js`.

---

## STEP 1 — Parser output

**Source:** Sales template uses `parseRawRouteListExcel` → `enrichRouteRows` (in `public/engine/parseRouteListExcel.js`). Then `logbook-page.js` maps rows to set `customer` from `row.Customer` (or `Location` / `client` / `location` / `customer`) and filters out null/`<TEMP>`.

**Exact route object after parsing, before resolver call** (customer-only row, no address columns filled):

```json
{
  "customer": "BELMONT BLUE BOTTLE LIQUORS",
  "address": null,
  "suburb": null,
  "city": null,
  "province": null,
  "fullAddress": null,
  "lat": undefined,
  "lng": undefined
}
```

*(Plus `days`, `weeks`, `rowIndex` from the parser; `lat`/`lng` are not set by the parser.)*

- **customer:** `"BELMONT BLUE BOTTLE LIQUORS"`
- **address:** `null`
- **suburb:** `null`
- **city:** `null`
- **province:** `null`
- **fullAddress:** `null` (from `buildFullAddressFromParts(null, null, null, null)`)
- **lat:** `undefined` (absent)
- **lng:** `undefined` (absent)

---

## STEP 2 — Resolver request

**Source:** `logbook-page.js`: `buildAddressCacheKey(r)` → `c + '|' + s + '|' + t` (customer, suburb, city, lowercased). If no cache hit with `lat`/`lng`/`fullAddress`, route is pushed to `toResolve`. Then `fetch('/api/resolveRouteAddresses', { method: 'POST', body: JSON.stringify({ routes: toResolve, debug: DEBUG_ROUTELIST }) })`.

**Is the route included in `toResolve`?** Yes. Cache key for this route is `"belmont blue bottle liquors||"`. Unless that key was previously populated, `cached` is falsy and the route is pushed to `toResolve`.

**Exact request body shape:**

```json
{
  "routes": [
    {
      "customer": "BELMONT BLUE BOTTLE LIQUORS",
      "address": null,
      "suburb": null,
      "city": null,
      "province": null,
      "fullAddress": null,
      "days": { ... },
      "weeks": [1,2,3,4],
      "rowIndex": 1
    }
  ],
  "debug": false
}
```

So the payload to `POST /api/resolveRouteAddresses` is exactly `{ routes: toResolve, debug: DEBUG_ROUTELIST }`; the route above is one element of `toResolve`.

---

## STEP 3 — Resolver execution

**Source:** `functions/src/index.js` reads `body.routes`, then calls `resolveRouteAddresses(routes, GOOGLE_API_KEY, { debug })`. In `functions/src/routeAddressResolver.js`:

- **Queue:** `hasCustomer = true`, `hasAddress = false` → `!hasCustomer && !hasAddress` is false → route is **queued** (`queue.push({ route: r, routeIndex: i })`).
- **resolveOne(route, apiKey, options, cache):**
  - `customerRaw` = `"BELMONT BLUE BOTTLE LIQUORS"`, `cleanedCustomer` = same (no `*KBA*`/`*COD*`/etc.).
  - `strongQuery` = `buildGeocodeSearchQuery({ ...route, customer: cleanedCustomer })` → parts `["BELMONT BLUE BOTTLE LIQUORS", null, null, null, null, "South Africa"]` → filtered and joined → **`"BELMONT BLUE BOTTLE LIQUORS South Africa"`**.
  - `searchQuery` = `strongQuery` (since `strongQuery !== "South Africa"`).
  - Coordinate cache: key `normalizedAddressKey(route)` = `"belmont blue bottle liquors|||"`; if not in cache, continue.
  - `searchQuery` is truthy → no early return for “no query”.
  - Place cache: key `"place:belmont_blue_bottle_liquors"`; if not in cache, continue.
  - **1) Places Text Search:** `placeId = await placeTextSearch(searchQuery, apiKey)` with **query string `"BELMONT BLUE BOTTLE LIQUORS South Africa"`**.
    - `placeTextSearch` calls `googleFetch("/place/textsearch/json?query=" + encodeURIComponent(query) + "&region=za", apiKey)`.
    - If `data.status !== "OK"` or `!data.results` or `data.results.length === 0`, it **returns `null`** (line 210).
  - **2) Find Place From Text:** If `!placeId`, `findPlaceFromText(searchQuery, apiKey)` is called with the same query; result may set `placeId`.
  - **3) Place Details:** `parsed = placeId ? await placeDetails(placeId, apiKey, cache) : null`. So **placeDetails runs only when `placeId` is truthy** (i.e. when Text Search or Find Place returned a place_id).
  - If `parsed` has `lat`/`lng`, resolver returns that and writes back to `item.route`.
  - **4) Geocode fallback:** If we did not get coords from Places, `geocodeQuery = strongQuery || searchQuery` = `"BELMONT BLUE BOTTLE LIQUORS South Africa"`. `getAddressCacheKey(route)` for this route is `""` (no address/suburb/city), so no address-cache hit. Then `geocodeOne(geocodeQuery, apiKey, cache)` is called. If it returns coords, those are written back; otherwise we continue to the final return.
  - **Exact condition that causes resolution to stop (unresolved):** We end at `return empty` (line 384) when:
    - `placeTextSearch` returned `null`, and
    - `findPlaceFromText` did not return a `placeId` (or placeDetails then returned no coords / non-ZA), and
    - `geocodeOne` did not return `lat`/`lng`.

So the route **does** enter the queue, **does** call `placeTextSearch` with `"BELMONT BLUE BOTTLE LIQUORS South Africa"`, then either gets a `placeId` and calls `placeDetails`, or falls back to `findPlaceFromText` and then `placeDetails` if a place_id is found, and finally to `geocodeOne`. The break is at the **first** of these that fails in practice: if `placeTextSearch` returns `null`, **placeDetails is not called** for that path until/unless `findPlaceFromText` supplies a `placeId`.

---

## STEP 4 — Resolver output

**When the route is unresolved** (all of placeTextSearch, findPlaceFromText/placeDetails, and geocodeOne fail or return no coords), the backend still mutates `item.route` with the result of `resolveOne`. `resolveOne` returns `empty`:

```js
const empty = { address: null, suburb: null, city: null, province: null, lat: null, lng: null };
```

So the **exact returned route object** (for the failing case) is:

- **address:** `null`
- **suburb:** `null`
- **city:** `null`
- **province:** `null`
- **fullAddress:** `null` (from `buildFullAddressFromParts(null, null, null, null)` in the mutating loop)
- **lat:** `undefined` (from `parsed.lat != null ? parsed.lat : undefined`)
- **lng:** `undefined` (from `parsed.lng != null ? parsed.lng : undefined`)

So the route leaves the resolver with no address parts and no coordinates.

---

## Answers to the three questions

1. **What is the first exact line where the route stops behaving correctly?**  
   **`functions/src/routeAddressResolver.js` line 210** inside `placeTextSearch`:  
   `if (data.status !== "OK" || !data.results || data.results.length === 0) return null;`  
   When this condition is true, the function returns `null`. The route then has no `placeId` from Text Search, so the next step that would have used it (placeDetails) is skipped for this branch. Behaviour “stops being correct” at this return (Places returns no result or error, and we give up the Text Search path).

2. **What function is supposed to run next but does not?**  
   **`placeDetails(placeId, apiKey, cache)`** is the function that would run next with a valid `place_id` to fill address and lat/lng. It does not run for the Text Search path because `placeId` is `null` after `placeTextSearch` returns null. (It may still run later if `findPlaceFromText` returns a place_id.)

3. **What single minimal code change would restore the old working behaviour?**  
   In `resolveOne` (routeAddressResolver.js), **call `geocodeOne(geocodeQuery, apiKey, cache)` before calling `placeTextSearch` when the route has no address parts** (i.e. when `getAddressCacheKey(route)` is empty). That way the Geocoding path that previously worked for customer-only rows runs first and can resolve the route without depending on Places Text Search returning a result. One way: after the coordinate and place caches are checked and `searchQuery` is set, if `!getAddressCacheKey(route)` and `geocodeQuery` is truthy, call `geocodeOne`, and if it returns coords, return that result and skip Places/Find Place/placeDetails for that route.

---

*Audit complete. No code was modified.*
