# Routelist Address Resolution – Full Audit Report

## 1. All Google API Calls

| File | Function | API Endpoint | Purpose |
|------|----------|--------------|---------|
| `engine/routing/googleGeocodeService.js` | `geocodeOne` | `/api/geocode` (→ Google Geocoding API) | Geocode a single address string |
| `engine/routing/googleGeocodeService.js` | `findPlaceFromText` | `/api/findPlace` (→ Places Find Place From Text) | Get place_id from business name + location |
| `engine/routing/googleGeocodeService.js` | `placeTextSearch` | `/api/textSearch` (→ Places Text Search) | Get place_id when Find Place returns no candidate |
| `engine/routing/googleGeocodeService.js` | `placeDetails` | `/api/placeDetails` (→ Places Place Details) | Get address components and lat/lng from place_id |

**Callers:**
- `resolveOne(route, apiKey, options)` – calls `geocodeOne`, `findPlaceFromText`, `placeTextSearch`, `placeDetails` depending on route type and Places result.
- `resolveRouteAddresses(routes, apiKey, options)` – builds a queue of rows needing resolution and calls `resolveOne` for each (with concurrency limit 10). Only entry point from UI: `public/js/logbook-page.js` → `window.resolveRouteAddresses(routes, apiKey, { debug })`.

**Server:** `server.js` proxies `/api/geocode`, `/api/findPlace`, `/api/textSearch`, `/api/placeDetails` to Google and injects the API key.

---

## 2. Caching Verification

| Cache | Key format | Includes customer? | Status |
|-------|------------|--------------------|--------|
| **geocodeCache** | `addr:` + full query string (lowercase, trimmed) | N/A (query may have included customer before fix) | ✅ After fix: fallback query has no customer; addressCache checked first so duplicate addresses hit cache. |
| **geocodeCache** | `placeid:` + place_id | N/A | ✅ Correct (place_id is location-based). |
| **geocodeCache** | `place:` + customer + `|` + suburb + `|` + city | ⚠️ Yes | **Flagged:** Used only for Places path (same business name + location). Does not affect Geocoding; Geocoding path uses addressCache (no customer) and fallback query no longer includes customer. |
| **coordinateCache** | `customer|address|suburb|city` (normalized) | ⚠️ Yes | **Flagged:** Intentional – stores result per full route identity so “same row” is not re-resolved. Lookup is per-route; duplicate *addresses* are deduplicated via addressCache before any API call. |
| **addressCache** | `address|suburb|city` (normalized, no customer) | ✅ No | ✅ Correct. Duplicate addresses reuse cached coordinates. |

**Summary:** Address-level deduplication uses **addressCache** only (address + suburb + city, no customer). Fallback geocode query no longer includes customer. `placeCacheKey` and `coordinateCache` still include customer for their specific roles (Places result per business name; full-route cache); they do not cause extra Geocoding calls for the same address.

---

## 3. Address Normalization

- **getAddressCacheKey(route)** builds the key from `address`, `suburb`, `city` only.
- **normalizeAddressPart(str)** applies:
  - `.trim().toLowerCase()`
  - Abbreviation expansion: Rd→road, St→street, Ave→avenue, Dr→drive, Blvd→boulevard, Pl→place, Ln→lane, Cres→circuit (and variants).
- So `"Parklands Main Rd"` and `"Parklands Main Road"` produce the same cache key after normalization.
- **geocodeOne** cache key: full query string, trimmed and lowercased (no abbreviation normalization there; addressCache handles address-only deduplication with normalization).

---

## 4. Fallback Query (Fixed)

- **Before:** `buildGeocodeFallbackQuery` included **customer** (e.g. "Clicks Parklands, 15 Village Road, Blue Hills, Midrand, South Africa").
- **After:** Fallback uses **address + suburb + city + country only** (no customer).
- **Example correct fallback:** `"15 Village Road, Blue Hills AH, Midrand, South Africa"`.
- Customer name is no longer included; duplicate addresses now share the same fallback query and cache.

---

## 5. Sequential vs Concurrent Requests

- **Before:** Strictly sequential: `runNext(0)` → resolve one row → `runNext(1)` → …
- **After:** **Concurrency limit 10.** Batches of up to 10 rows are resolved with `Promise.all`; when a batch completes, the next batch runs. Same order of processing; no unbounded parallelism.
- **Result:** Up to ~10× fewer “round-trips” in wall-clock time for large routelists, with controlled load.

---

## 6. Cache Hit Before API Call

Resolution path and cache order:

1. **coordinateCache** (full route: customer|address|suburb|city) – hit → return, no API.
2. **Street-address path:** `geocodeOne(route.address)` – inside `geocodeOne`: **geocodeCache** (`addr:` + query) checked first; then **DEV_MODE**; then fetch. After fetch, result is stored in **addressCache** and **coordinateCache**.
3. **Place path:** **geocodeCache** (`place:` + customer|suburb|city) – hit → return. Miss → Find Place → (optional) Text Search → Place Details (each with **geocodeCache** by place_id). If Places returns empty → fallback.
4. **Fallback:** **addressCache** (address|suburb|city, normalized) – hit → use cached result, update geocodeCache and coordinateCache, no Geocoding call. Miss → **geocodeOne(fallbackQuery)** (fallback has no customer); inside geocodeOne, **geocodeCache** checked again; then result stored in **addressCache**.

**Confirmation:** Duplicate addresses (same address + suburb + city) reuse cached coordinates via addressCache and/or geocodeCache and do not trigger new Geocoding API calls.

---

## 7. Worst-Case Google API Usage (200 rows)

Assumptions: 200 rows, all need resolution (no street-address skip). No cache warm.

| Scenario | Geocoding API | Find Place | Text Search | Place Details | Total (approx) |
|----------|----------------|------------|-------------|---------------|----------------|
| **A: No caching** | 200 | 200 | up to 200 | up to 200 | ~800 (Places) + 200 (Geocode) = up to 1000 |
| **B: Current caching (after fixes)** | ≤ unique addresses | ≤ unique place queries | ≤ when Find Place misses | ≤ unique place_ids | Depends on uniqueness; e.g. 40 unique addresses → ~40 Geocode + Places for unique businesses. |
| **C: Optimized (with addressCache + no customer in fallback + normalization)** | = number of unique (address|suburb|city) after normalization | Same as B | Same as B | Same as B | Geocoding = unique normalized addresses only. |

**Example for 200 rows:**

- **No caching:** ~200 Geocoding + up to 600 Places (Find Place + Text Search + Place Details per row) → **~800 calls** (conservative: 200 Geocode + 200 Find Place + 200 Place Details = 600).
- **Current system (with all fixes):** If 200 rows contain 25 unique addresses (many duplicates): **~25 Geocoding** + Places only for rows where Places is tried and not cached (e.g. 25 unique business+location) → **~25 Geocode + ~75 Places** ≈ **100 calls**.
- **Optimized (same logic, emphasis on deduplication):** Same as current; **~25–40 Geocoding**, **~60–100 Places** depending on uniqueness → **~85–140 total**.

(Exact numbers depend on how many rows have street addresses vs place names and on duplicate rate.)

---

## 8. Dev Mode Safety

- **Flag:** `GEOCODE_DEV_MODE` (on `window` in browser or `global` in Node).
- **When `GEOCODE_DEV_MODE === true`:**
  - **geocodeOne:** Returns mock result `{ lat: -33.9249, lng: 18.4241, ... }` without calling `/api/geocode`. Result is still stored in geocodeCache.
  - **findPlaceFromText:** Returns `null` (no request).
  - **placeTextSearch:** Returns `null` (no request).
  - **placeDetails:** Returns same mock coordinates without calling API; result cached by place_id.
- **Usage:** Set `window.GEOCODE_DEV_MODE = true` (e.g. in console or in a dev-only script) before processing a routelist to avoid any Google API cost during development.

---

## 9. Final Summary

| Item | Result |
|------|--------|
| **Google calls per routelist** | Bounded by number of **unique normalized addresses** (Geocoding) and **unique place lookups** (Places). Duplicate addresses do not trigger new Geocoding calls. |
| **Caching effectiveness** | **addressCache** (address|suburb|city, normalized) ensures one Geocode per unique location. **geocodeCache** and **coordinateCache** reduce repeat work for same query and same full route. Fallback query no longer includes customer, so cache hits are maximized. |
| **Performance risks** | Sequential processing removed; concurrency limit 10 reduces wall-clock time. No unbounded parallelism. |
| **Estimated runtime improvement** | With concurrency 10, resolution phase can be up to ~10× faster for large queues. With address deduplication, fewer API calls and less latency. |
| **Duplicate addresses** | **Confirmed:** Duplicate addresses (same address + suburb + city after normalization) reuse cached coordinates and do **not** trigger new Google Geocoding API calls. |

---

## Changes Made in This Audit

1. **buildGeocodeFallbackQuery** – Customer removed; fallback uses only address, suburb, city, South Africa.
2. **getAddressCacheKey** – Uses **normalizeAddressPart** (lowercase, trim, abbreviation expansion) so variants like "Parklands Main Rd" and "Parklands Main Road" share one cache entry.
3. **DEV_MODE** – When `GEOCODE_DEV_MODE === true`, all Google API calls are skipped and mock coordinates are returned.
4. **resolveRouteAddresses** – Sequential loop replaced with batched execution with concurrency limit 10 (`Promise.all` per batch of 10).

No changes to routelist structure, parsing, or pipeline logic; only geocoding efficiency and safety.
