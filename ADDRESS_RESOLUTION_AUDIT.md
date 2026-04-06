# Address resolution audit and changes

## 1. Audit: was Places already used for store resolution?

**Yes.** The existing flow in `engine/routing/googleGeocodeService.js` already used Google Places for store/client names when the address column did not look like a street address.

- **Current (pre-change) flow in `resolveOne`:**
  - If `route.address` looks like a street address (e.g. number + word) → **Geocoding API only** (`/api/geocode`).
  - Otherwise, if `route.customer` exists → **Places path**: Find Place From Text (`/api/findPlace`) with input `customer + ", South Africa"` → if no candidate, Place Text Search (`/api/textSearch`) with query `customer + " South Africa"` → Place Details (`/api/placeDetails`).
- **Endpoints used:** `/api/geocode`, `/api/findPlace`, `/api/textSearch`, `/api/placeDetails` (server proxies to Google Geocoding and Places APIs).
- **Store/client names** were already sent to Find Place From Text and Place Text Search (customer name only; suburb/city were not included in the query).

So Places was in use for store resolution; the updates add **better queries** (store + suburb + city), **geocode fallback** when Places returns nothing, **validation** with user-facing errors, and **debug logging**.

---

## 2. Files updated

| File | Changes |
|------|--------|
| **engine/routing/googleGeocodeService.js** | `resolveOne`: Places query now includes suburb and city; geocode fallback when Places returns empty; debug logs (`resolver=places`, `resolver=geocode fallback`, `resolver failed`). `resolveRouteAddresses`: passes `options` into `resolveOne`; after resolution, collects rows with no `fullAddress` and rejects with `error.unresolvedRows`. `placeDetails`: request now includes `types` field. Helpers: `isParsedEmpty`, `buildGeocodeFallbackQuery`. |
| **public/js/logbook-page.js** | In `processRoutelistFile`, the `.catch` for `resolveRouteAddresses` now checks `err.unresolvedRows` and shows a user-friendly message (row index, client, address) instead of a generic error. |

No changes were made to: logbook engine, routelist parser, routing service, XLSX export, or server API routes.

---

## 3. New resolver order

1. **Street-like address**  
   If `route.address` looks like a street address (e.g. number + street name):  
   - Use **Geocoding only** (no Places).  
   - Log: `[DEBUG_ROUTELIST] resolver=geocode (street address) store="..."`.

2. **Store/client name (no street address)**  
   - **A. Places first**  
     - Query: `"<storeName> <suburb> <city> South Africa"` (suburb/city omitted if missing).  
     - Find Place From Text → if no candidate, Place Text Search → Place Details.  
     - Log: `[DEBUG_ROUTELIST] resolver=places store="..."`.  
     - If Place Details returns a usable address (any of address/suburb/city/province), use it and stop.
   - **B. Geocode fallback**  
     - If Places returns empty or no usable address:  
       - Build query from customer, address, suburb, city + ", South Africa".  
       - Call Geocoding API.  
       - Log: `[DEBUG_ROUTELIST] resolver=geocode fallback store="..."`.  
     - If geocode also returns empty:  
       - Log: `[DEBUG_ROUTELIST] resolver failed store="..."`.  
       - Row is left with no usable address and will be reported in validation.

3. **Validation (after all rows are processed)**  
   - Any row that needed resolution but still has no `fullAddress` is added to `unresolvedRows`.  
   - If `unresolvedRows.length > 0`, `resolveRouteAddresses` rejects with `error.unresolvedRows` (rowIndex, customer, address, reason).  
   - The UI shows a user-friendly message listing those entries (row, client, address).

---

## 4. Geocode fallback intact

- The existing Geocoding path is unchanged for street-like addresses.  
- For store/client names, the existing Places path (Find Place → Text Search → Place Details) is still used first, with an improved query.  
- **New:** When Places returns no usable result, the code now falls back to **Geocoding** using a query built from customer + address + suburb + city + ", South Africa".  
- No geocode logic was removed; fallback is additive.

---

## 5. Output shape and constraints

- Resolved route objects still have: `customer`, `address`, `suburb`, `city`, `province`, `fullAddress`, `rowIndex` (and any other existing fields).  
- No engine math, routing service, or export layout changes.  
- No broad refactor; only the resolver and its UI error handling were updated.
