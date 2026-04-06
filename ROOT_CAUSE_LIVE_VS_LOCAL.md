# ROOT CAUSE ANALYSIS: Live fails but local works (tracing only)

## What was added (diagnostic logging only)

### 1. Frontend (`public/js/logbook-page.js`)

- **PAYLOAD SENT:** Logs `routes.length`, `toResolve.length`, `payload.length`, and the full `payload` array **before** the fetch.
- So you can see exactly how many routes are sent and whether `payload` is `toResolve` (subset) or `routes` (full list).

### 2. Backend entry (`functions/src/index.js`)

- **INPUT ROUTES:** Logs `routes.length` and a summary of each route (customer, address, suburb) **after** parsing `req.body`.
- Confirms how many routes the Cloud Function received.

### 3. Resolver (`functions/src/routeAddressResolver.js`)

- **INPUT ROUTES count** at start of `resolveRouteAddresses`.
- **SKIP** log when a route is dropped (no customer and no address).
- **QUEUE length** and **skipped** count (how many routes are actually resolved).
- **GEOCODE QUERY:** Per-route query string sent to Google (same as LOOKUP INPUT).
- **GOOGLE RESPONSE:** Full JSON response from:
  - Geocode API
  - Find Place From Text
  - Place Text Search
- **DECISION:** For each route, one of:
  - `ACCEPTED reason=cache|place_cache|places_or_findplace|geocode|address_cache|area_fallback`
  - `REJECTED reason=no_query|no_geocode_query|address_cache_empty|all_methods_failed`
- **RETURNING routes count** before returning from `resolveRouteAddresses`.

---

## Factual code path (no guessing)

### Backend never reduces array length

- `resolveRouteAddresses(routes, apiKey, options)` receives one array, `routes`.
- It builds a **queue** from routes that have `hasCustomer || hasAddress`; routes without both are **skipped** (not queued) but **remain in `routes`**.
- It processes only **queue** items and **mutates** the corresponding element of `routes` in place (`item.route` is `routes[routeIndex]`).
- It **returns** the same `routes` array: `return routes;`.
- So: **number of elements returned === number of elements received.** The backend does not drop or filter by length.

### So if LIVE returns 6, LIVE received 6

- If the client receives 6 routes in the response, the Cloud Function was given 6 routes in the request.
- So the difference is **what the frontend sends**, not backend filtering by count.

### What the frontend sends

- `payload = toResolve.length > 0 ? toResolve : routes`
- So:
  - If **any** route is in `toResolve`, the request body is **only** `toResolve` (a subset).
  - If **no** route is in `toResolve` (all from cache), the request body is **full** `routes`.

### How `toResolve` is built

- For each route in `routes`:
  - If `addressCache` has a hit for `buildAddressCacheKey(r)` with valid `lat`, `lng`, `fullAddress`, the route is **not** added to `toResolve` (it gets `applyCachedAddress` and is skipped for API).
  - Otherwise the route is pushed to `toResolve`.
- So **payload length = length of routes not satisfied by current address cache.**

---

## Evidence to collect (LOCAL vs LIVE)

Run the same Excel and flow on LOCAL and on LIVE, then compare:

| Check | Where to look | Compare |
|-------|----------------|--------|
| Payload length | Browser console: `PAYLOAD SENT: ... payload.length=` | LOCAL vs LIVE |
| What is sent | Browser console: `PAYLOAD SENT:` (full array) | Same 11 routes or different? |
| Backend received | Cloud Function logs: `[API] INPUT ROUTES count:` | Must equal payload length |
| Queue size | Cloud Function logs: `[ROUTE_RESOLVER] QUEUE length` | Same as INPUT ROUTES (unless some have no customer/address) |
| Skipped (no customer/address) | `[ROUTE_RESOLVER] SKIP route index=...` | Any on LIVE that are not skipped on LOCAL? |
| Per-route query | `GEOCODE QUERY:` / `LOOKUP INPUT:` | Same string on LOCAL vs LIVE for same row? |
| Google response | `GOOGLE RESPONSE (findPlace):` / `(placeTextSearch):` / `(geocode):` | Same status/results on LOCAL vs LIVE? |
| Decision | `[ROUTE_RESOLVER] DECISION: ACCEPTED|REJECTED reason=...` | Which routes REJECTED on LIVE? |
| Return count | `[ROUTE_RESOLVER] RETURNING routes count:` | Must equal INPUT ROUTES count |

---

## Factual conclusion (once you have logs)

- **If on LIVE `payload.length` is 6 and `routes.length` is 11:**  
  Then the frontend is sending only 6 because 5 routes were served from the address cache. So: **Live “fails” (only 6 resolved) because only 6 routes are sent to the API; the other 5 are filled from cache. If that cache is wrong or from an old run, you get inconsistent state.**

- **If on LIVE `payload.length` is 11** but the response has 6:  
  Then the backend would have to be returning a different array (e.g. a slice). The current code does not do that; it returns `routes`. So this would only be possible if some other code path or middleware changed the response. The added logs (`INPUT ROUTES count` and `RETURNING routes count`) will confirm.

- **If the same 11 routes are sent on both:**  
  Then compare `GEOCODE QUERY`, `GOOGLE RESPONSE`, and `DECISION` for each route on LOCAL vs LIVE. Any difference (e.g. different API key, region, or error response) will show why LIVE accepts/rejects differently.

---

## No fixes in this task

- No code was changed except adding the above logs.
- No theories or fixes were implemented; only tracing and a factual framework for the conclusion once you have LOCAL vs LIVE logs.
