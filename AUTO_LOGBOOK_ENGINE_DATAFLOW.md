### Auto Logbook SA Engine – End‑to‑End Data Flow (Read‑Only Audit)

This document describes the **current** behaviour (no proposed fixes) of the Auto Logbook SA engine from input Excel to final logbook output, with a focus on:

- **Store names → addresses**
- **Addresses → lat/lng**
- **Routes → final logbook entries**

---

### 1. Entry Point – Route List Upload (Frontend → Backend)

**User action**: Uploads an Excel file on `logbook.html`.

- **File**: `public/js/logbook-page.js`
- **Key flow (Excel → routes → resolver call)**:

```1000:1178:public/js/logbook-page.js
readFileAsArrayBuffer(file).then(function (buffer) {
  // ...
  if (templateType !== 'business') {
    raw = parseRawRouteListExcel(buffer);
    // ...
    routes = enrichRouteRows(raw);
    // build canonical customer, filter invalid
  } else {
    // business template → window.parseBusinessRoutes
  }
  // ...
  routes = routes.map(function (r, i) {
    return Object.assign({}, r, {
      _routeId: i,
      id: i,
      manualAddress: r.manualAddress != null ? String(r.manualAddress).trim() : '',
      addressEdited: r.addressEdited === true
    });
  });
  // audit
  fetchResolveStoreJson(routes).then(function (result) {
    // merge + preview
    finishWithProcessedRoutes(result, routes);
  })
});
```

**Resolver call (frontend)**:

- **Function**: `fetchResolveStoreJson(routesArray)`
- **File**: `public/js/logbook-page.js`

```150:217:public/js/logbook-page.js
function fetchResolveStoreJson(routesArray) {
  return buildLogbookApiHeaders().then(function (headers) {
    assertResolveStoreAuthHeaders(headers);
    var routes = routesArray || [];
    return fetch('/engine/resolve-store', {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({ routes: routes })
    })
    .then(res => res.json())
    .then(function (apiEnriched) {
      if (!Array.isArray(apiEnriched)) {
        throw new Error('Invalid resolver response');
      }
      return apiEnriched;
    });
  });
}
```

**Backend entrypoint for resolution**:

- **Endpoint**: `POST /engine/resolve-store`
- **File**: `functions/src/index.js`

```359:369:functions/src/index.js
app.post("/engine/resolve-store", async (req, res) => {
  setCors(req, res);
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed. Use POST." });
  try {
    await assertResolveStoreAllowedHttp(req, ADMIN_KEY);
    const body = req.body && (req.body.routes != null ? req.body : { routes: req.body });
    const routes = Array.isArray(body.routes) ? body.routes : [];
    if (routes.length === 0) return res.status(400).json({ error: "Missing or empty routes array." });

    const enriched = await resolveStoreAddresses(routes, GOOGLE_API_KEY || "");
    res.status(200).json(enriched);
  } catch (err) {
    const code = err && err.statusCode;
    if (code === 403) {
      return res.status(403).json({ error: err.message || "Invalid token" });
    }
    console.error("resolveStore error:", err);
    res.status(500).json({ error: "Resolver failed" });
  }
});
```

- **Primary backend function**: `resolveStoreAddresses(routes, apiKey)`
- **File**: `functions/src/resolveStore.js`

---

### 1.4 Route + Lat/Lng Audit – UI Pipeline (Read‑Only)

#### 1.4.1 Route count across stages (frontend)

- **After Excel parse (`parseRouteListExcel` / `enrichRouteRows`)**

```1088:1153:public/js/logbook-page.js
        } else {
          if (raw != null) {
            routes = enrichRouteRows(raw);
            routes = routes.map(function (row) {
              var rawCustomer = (row.Customer || row.Location || row.client || row.location || row.customer || '');
              var customer = buildCanonicalCustomer(rawCustomer);
              if (!customer || customer === '<TEMP>') return null;
              return Object.assign({}, row, { customer: customer });
            }).filter(Boolean);
            auditParserUsed = 'enrichRouteRows';
            console.log('[PARSER_USED]', 'parseRouteListExcel');
          } else {
            routes = [];
            auditParserUsed = 'skipped (raw null)';
          }
        }
        console.log('[AUDIT PARSER USED]', auditParserUsed);
        if (routes && routes.length > 0) {
          routes.forEach(function (route) {
            console.log('STEP 1 PARSED ROUTE:', {
              customer: route.customer,
              address: route.address,
              suburb: route.suburb,
              city: route.city,
              province: route.province
            });
          });
        }
        console.log('RAW ROUTES:', routes);
        console.log('[AUDIT RAW ROUTES]', routes);
```

- **Before first `/engine/resolve-store` call**

```1184:1200:public/js/logbook-page.js
        routes = routes.map(function (r, i) {
          return Object.assign({}, r, {
            _routeId: i,
            id: i,
            manualAddress: r.manualAddress != null ? String(r.manualAddress).trim() : '',
            addressEdited: r.addressEdited === true
          });
        });
        if (routes && routes[0]) {
          console.log('[AUDIT BEFORE ENRICH]', routes[0]);
          console.log('[resolveStore payload sample]', {
            manualAddress: routes[0].manualAddress,
            addressEdited: routes[0].addressEdited
          });
        }
        fetchResolveStoreJson(routes).then(function (result) {
          console.log('API RESPONSE:', result);
          console.log('BEFORE MERGE:', routes);
          console.log("FINAL:", result);
          finishWithProcessedRoutes(result, routes);
        })
```

- **After resolver response + merge into UI**

```1463:1503:public/js/logbook-page.js
  function finishWithProcessedRoutes(resolvedRoutes, originalRoutes) {
    console.log("STEP 4 TO UI:", resolvedRoutes.map(function (r) { return { customer: r.customer, address: r.address, suburb: r.suburb, city: r.city, province: r.province }; }));
    console.log('STEP 3 FINAL TO UI:', resolvedRoutes);
    var status = document.getElementById('routeStatus');
    var finalRoutes = resolvedRoutes;
    if (originalRoutes && originalRoutes.length > 0 && resolvedRoutes && resolvedRoutes.length > 0) {
      var map = new Map();
      resolvedRoutes.forEach(function (r) {
        map.set(routeIdMapKey(r._routeId), r);
      });
      finalRoutes = originalRoutes.map(function (r) {
        var key = routeIdMapKey(r._routeId);
        if (map.has(key)) {
          var resolved = map.get(key);
          var merged = Object.assign({}, r, resolved);
          if (resolved.suburb !== undefined && resolved.suburb !== "") {
            merged.suburb = resolved.suburb;
          } else {
            merged.suburb = r.suburb;
          }
          if (resolved.address !== undefined && resolved.address !== "") {
            merged.address = resolved.address;
          } else {
            merged.address = r.address;
          }
          if (resolved._resolved !== undefined) {
            merged._resolved = resolved._resolved;
          }
          merged.fullAddress = fullAddressFromBackend(merged);
          return merged;
        }
        console.warn("MISSING ROUTE ID:", r._routeId);
        return r;
      });
    }
    console.log("FINAL ROUTES AFTER ID MERGE:", finalRoutes);
    console.log("TO UI:", finalRoutes.map(function (r) { return { customer: r.customer, address: r.address, suburb: r.suburb, city: r.city }; }));
    window.currentRoutes = finalRoutes;
    console.log('[ROUTES] stored:', finalRoutes.length);
    console.log('UI DATA SOURCE:', window.currentRoutes);
    console.log('FINAL ROUTES TO UI:', finalRoutes);
```

- **Reprocess flow (collect → re‑send → merge)**

```1671:1712:public/js/logbook-page.js
  function collectRoutesFromPreviewTable() {
    var base = window.currentRoutes;
    if (!base || !Array.isArray(base)) return [];
    var content = document.getElementById('routelistPreviewContent');
    if (!content) return base.slice();
    var result = [];
    for (var i = 0; i < base.length; i++) {
      var route = base[i];
      if (!route) continue;
      var prevCustomer = (route.customer != null ? String(route.customer) : '').trim();
      var copy = Object.assign({}, route);
      ...
      copy.fullAddress = fullAddressFromBackend(copy);
      result.push(copy);
    }
    return result;
  }
```

```1854:1933:public/js/logbook-page.js
  function initReprocessAddressesButton() {
    var btn = document.getElementById('reprocess-addresses-btn');
    var status = document.getElementById('routeStatus');
    if (!btn) return;
    btn.addEventListener('click', function () {
      var updatedRoutes = collectRoutesFromPreviewTable();
      if (!updatedRoutes || updatedRoutes.length === 0) {
        if (status) { status.textContent = 'No routes to reprocess.'; status.style.color = 'red'; }
        return;
      }
      window.currentRoutes = updatedRoutes;
      console.log('REGEN INPUT:', updatedRoutes);
      ...
      var routesForApi = updatedRoutes.map(function (r, i) {
        ...
        var payloadRow = Object.assign({}, r, {
          _routeId: i,
          id: i,
          storeName: r.customer,
          ...
          suburb: liveSuburb,
          address: liveAddress,
          reprocessAddresses:
            r.resolutionStatus === 'needs_attention' ||
            r.resolutionStatus === 'REJECT' ||
            r.addressEdited === true
        });
        console.log('REPROCESS PAYLOAD:', {
          store: payloadRow.customer,
          manualAddress: payloadRow.manualAddress,
          addressEdited: payloadRow.addressEdited,
          suburb: payloadRow.suburb,
          address: payloadRow.address
        });
        return payloadRow;
      });
      if (routesForApi && routesForApi[0]) {
        console.log('[AUDIT BEFORE ENRICH]', routesForApi[0]);
      }
      fetchResolveStoreJson(routesForApi).then(function (result) {
        console.log('API RESPONSE:', result);
        console.log('BEFORE MERGE:', routesForApi);
        console.log("FINAL:", result);
        finishWithProcessedRoutes(result, routesForApi);
      }).catch(function (err) {
        console.error('FUNCTION ERROR:', err);
        hideRoutelistProcessing(false);
        if (status) {
          status.textContent = (err && err.message) ? err.message : 'Could not reprocess addresses.';
          status.style.color = 'red';
        }
      });
    });
  }
```

- **Before calling `/api/generateLogbook` (engine input)**

```3239:3243:public/js/logbook-page.js
      var resolvedRoutes = window.currentRoutes;
      console.log('UI DATA SOURCE:', window.currentRoutes);
      console.log('[AUDIT ENGINE INPUT COUNT]', resolvedRoutes ? resolvedRoutes.length : 0);
      console.log('[AUDIT ENGINE INPUT SAMPLE]', resolvedRoutes ? resolvedRoutes.slice(0, 3) : null);
      runEngineWithRoutes(resolvedRoutes);
```

#### 1.4.2 Route reduction before engine (6 → 2)

- **Filter predicate**:

```336:360:public/js/logbook-page.js
  function isMeaningfulRoute(route, mode) {
    if (!route || typeof route !== 'object') return false;

    if (!route.customer || String(route.customer).trim() === '') {
      return false;
    }

    // SALES REP MODE
    if (mode === 'salesRep') {
      var days = route.days || {};
      var hasDay = !!(days.mon || days.tue || days.wed || days.thu || days.fri || days.sat);
      if (!hasDay) {
        return false;
      }

      if (route.mode === 'cycle') {
        if (!Array.isArray(route.weeks) || route.weeks.length === 0) {
          return false;
        }
      }
    }

    // BUSINESS MODE (DATE-BASED)
    if (mode === 'business') {
      if (!route.startDate) {
        return false;
      }
```

- **Application of filter + engine input construction:**

```2862:2903:public/js/logbook-page.js
      function runEngineWithRoutes(routes) {
        routes = routes || [];
        var engineMode = window._routelistMode || 'salesRep';

        console.log('[ENGINE MODE]', engineMode);
        console.log('[ROUTES BEFORE FILTER]', routes.length);
        console.log('[AUDIT BEFORE FILTER]', routes.length);

        var uiRoutes = (routes || []).filter(function (r) {
          return isMeaningfulRoute(r, engineMode);
        });
        routes = uiRoutes;

        console.log('[ROUTES AFTER FILTER]', routes.length);
        console.log('[AUDIT AFTER FILTER]', routes.length);
        if (typeof console !== 'undefined' && console.log) {
          console.log('CLEAN ROUTES:', routes.length);
        }
        console.log("ENGINE INPUT ROUTES (sample):", routes.slice(0, 3));
        console.log("ROUTES WITH LAT/LNG COUNT:", routes.filter(r => r.lat != null && r.lng != null).length);
        ...
        var engineMode = window._routelistMode || (function () {
          try { var sm = localStorage.getItem('routelistMode'); if (sm === 'business' || sm === 'salesRep') return sm; } catch (e) { /* ignore */ }
          return 'salesRep';
        })();
        console.log('[AUDIT ENGINE MODE]', engineMode);
        ...
        var engineInput = {
          routes: uiRoutes,
          startDate: startDate,
          endDate: endDate,
          homeAddress: originAddress,
          openingKm: openingKm,
          currentWeek: currentWeek,
          leaveDays: leaveDaysArray || [],
          employerName: employerName || null,
          mode: engineMode,
          vehicle: { ... }
        };
```

#### 1.4.3 Engine‑level “Missing coordinates …” checks

- **Global route validation (server engine copy):**

```1361:1370:functions/engine/logbookEngine.js
    if (routes && Array.isArray(routes)) {
        for (let rci = 0; rci < routes.length; rci++) {
            const route = routes[rci];
            if (route && route.customer != null && String(route.customer).trim() !== '') {
                if (!Number.isFinite(route.lat) || !Number.isFinite(route.lng)) {
                    throw new Error(`Missing coordinates for ${route.customer}`);
                }
            }
        }
    }
```

- **Per‑visit validation during trip construction (representative snippet):**

```1487:1492:functions/engine/logbookEngine.js
                    const firstVisit = dayVisits[0];
                    const firstVisitAddress = firstVisit.fullAddress || buildFullAddress(firstVisit);
                    if (!Number.isFinite(firstVisit.lat) || !Number.isFinite(firstVisit.lng)) {
                        throw new Error(`Missing coordinates for ${firstVisit.customer}`);
                    }
```

The browser engine (`public/engine/logbookEngine.js`) contains identical checks and messages.

---

### 2. Store Resolution Flow – Store Name → Structured Address (+ Lat/Lng)

All logic below lives in **`functions/src/resolveStore.js`**.

#### 2.1 Normalization helpers

- **Name normalizer for Places query**: `normalizeStoreName(input)`

```49:127:functions/src/resolveStore.js
function normalizeStoreName(input) {
  if (!input) return "";
  let str = String(input).toLowerCase().trim();
  // punctuation & spacing cleanup
  // BRAND NORMALIZATION (PnP, Checkers, Dis-Chem, Clicks, Spar, Makro, Game, Woolworths, Food Lovers)
  // NOISE removal: pty, ltd, limited, store, branch, sa, south africa, group, division
  // final cleanup
  return str;
}
```

- **Cache key normalizer**: `normalizeStoreQuery(input)` using `expandAbbreviations`:

```147:203:functions/src/resolveStore.js
function expandAbbreviations(input) { /* expands "pnp" → "pick n pay"; strips "qualisave", "corp"; cleans spacing */ }

function normalizeStoreQuery(input) {
  if (input == null || String(input).trim() === "") return null;
  const original = String(input).trim();
  let s = original.toLowerCase();
  s = expandAbbreviations(s);
  s = s.replace(/[^a-z0-9\s]+/g, " ");
  s = s.replace(/\s+/g, " ").trim();
  s = s.replace(/\bsouth\s+africa\b/gi, " ");
  s = s.replace(/\s+/g, " ").trim();
  const words = s.split(/\s+/).filter(Boolean);
  const kept = words.filter((w) => !NORMALIZE_STORE_NOISE.has(w));
  s = kept.join(" ").replace(/\s+/g, " ").trim();
  return s || null;
}
```

#### 2.2 Array resolver: `resolveStoreAddresses`

```910:947:functions/src/resolveStore.js
function resolveStoreAddresses(routes, apiKey) {
  return Promise.all(routes.map((r) => resolveStore(r, apiKey))).then((resolvedArray) => {
    return routes.map((route, i) => {
      const resolved = resolvedArray[i];
      if (!resolved) {
        return {
          ...route,
          address: route.address != null ? String(route.address) : "",
          suburb: route.suburb != null ? String(route.suburb) : "",
          city: route.city != null ? String(route.city) : "",
          province: route.province != null ? String(route.province) : "",
          lat: null,
          lng: null,
          confidence: 0,
          resolutionStatus: "needs_attention",
          _resolved: false
        };
      }
      const row = {
        ...route,
        address: resolved.address != null ? resolved.address : route.address != null ? String(route.address) : "",
        suburb: resolved.suburb != null ? resolved.suburb : route.suburb != null ? String(route.suburb) : "",
        city: resolved.city != null ? resolved.city : route.city != null ? String(route.city) : "",
        province: resolved.province != null ? resolved.province : route.province != null ? String(route.province) : "",
        lat: resolved.lat != null ? resolved.lat : null,
        lng: resolved.lng != null ? resolved.lng : null,
        confidence: 100,
        resolutionStatus: resolved.resolutionStatus ?? "ok",
        _resolved: resolved._resolved ?? true
      };
      if (resolved.reason) row.reason = resolved.reason;
      if (resolved.source) row.source = resolved.source;
      delete row.reprocessAddresses;
      if (row._resolved === true) row.addressEdited = false;
      return row;
    });
  });
}
```

#### 2.3 Single store resolver: `resolveStore(route, apiKey)`

Skeleton (omitting internal helpers for brevity):

```567:903:functions/src/resolveStore.js
async function resolveStore(route, GOOGLE_API_KEY) {
  const rawName = String(route.customer || route.address || "").trim();
  const storeName = normalizeStoreName(rawName) || rawName;
  if (!storeName) return null;

  const googleApiKey = GOOGLE_API_KEY || process.env.GOOGLE_API_KEY;
  if (!googleApiKey || String(googleApiKey).trim() === "") {
    throw new Error("GOOGLE_API_KEY is required");
  }

  const normalizedQuery = normalizeStoreQuery(rawName || route.address);
  if (!normalizedQuery) return null;

  const docId = sha256(normalizedQuery);
  const cacheRef = db().collection(API_CACHE_STORE_RESOLUTION).doc(docId);

  let cacheSnap = null;

  // 1) REPROCESS branch (manual edits)
  if (route && route.reprocessAddresses === true) { ... }

  // 2) Normal path: in-memory cache, Firestore where, Firestore doc
  if (!(route && route.reprocessAddresses === true)) {
    // addressCache[normalizedQuery]
    // Firestore where("normalizedQuery" == normalizedQuery)
  }

  if (!cacheSnap) {
    cacheSnap = await cacheRef.get();
  }

  if (cacheSnap.exists) {
    const d = cacheSnap.data() || {};
    if (d.isResolved === true && d.address) {
      // return finalizeLatLng(structured-from-doc)
    }
    if (d.isResolved === false) {
      if (!(route && route.reprocessAddresses === true)) {
        addressCache[normalizedQuery] = null;
        return null;
      }
    }
  }

  // 3) Google Places chain (FindPlace → TextSearch → Details)
  // (runs only if DB/cache did not yield a usable result)
  // ...
}
```

##### 2.3.1 Reprocess / manual override branch

When `route.reprocessAddresses === true`:

```589:652:functions/src/resolveStore.js
if (route && route.reprocessAddresses === true) {
  cacheSnap = await cacheRef.get();
  const cached = cacheSnap.exists ? cacheSnap.data() : null;

  // "new" values from route (manualAddress or address/suburb/city/province)
  // "old" values from cached doc
  const changed =
    newAddress !== oldAddress ||
    newSuburb !== oldSuburb ||
    newCity !== oldCity ||
    newProvince !== oldProvince;

  // MANUAL CHANGE
  if (changed && newAddress) {
    return persistManualRouteToCache(route, normalizedQuery, storeName, cacheRef);
  }

  // INVALID CACHE → FORCE API
  if (!cached || cached.isResolved !== true || !cached.address) {
    delete addressCache[normalizedQuery];
    // fall through to API
  }

  // VALID CACHE → RETURN (no change)
  if (cached && cached.isResolved === true && cached.address) {
    return finalizeLatLng(
      {
        customer: cached.customer || storeName,
        address: cached.address,
        suburb: cached.suburb || "",
        city: cached.city || "",
        province: cached.province || "",
        _resolved: true,
        resolutionStatus: "ok"
      },
      normalizedQuery,
      cacheRef,
      storeName
    );
  }
}
```

**Manual override persistence:**

```507:565:functions/src/resolveStore.js
async function persistManualRouteToCache(route, normalizedQuery, storeName, cacheRef) {
  // build "structured" from route.manualAddress / address / suburb / city / province
  // mark _resolved:true, resolutionStatus:"ok"
  // write provider:"manual", source:"user" etc. into API_CACHE_STORE_RESOLUTION
  return finalizeLatLng(structured, normalizedQuery, cacheRef, originalInput);
}
```

##### 2.3.2 Normal path cache checks (no reprocess)

Order of checks when `reprocessAddresses !== true`:

1. **In‑memory cache**: `addressCache[normalizedQuery]`
2. **Firestore** `where("normalizedQuery", "==", normalizedQuery).limit(1)`
3. **Firestore doc** `cacheRef.get()`

Only if all three fail to yield a usable address do we go to Places.

##### 2.3.3 Google Places calls for store resolution

If DB/cache did not resolve:

```728:775:functions/src/resolveStore.js
const inputQuery = `${storeName}, South Africa`;
const encInput = encodeURIComponent(inputQuery);

let placeId = null;
let source = "findplace";

// 1) FIND PLACE
const findUrl = `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=${encInput}&inputtype=textquery&fields=place_id,name&components=country:za&key=${encodeURIComponent(googleApiKey)}`;
const findRes = await fetch(findUrl);
const findData = await findRes.json();
if (findData.candidates && findData.candidates.length > 0) {
  placeId = findData.candidates[0].place_id;
}

// 2) TEXTSEARCH FALLBACK
if (!placeId) {
  source = "textsearch";
  const textUrl = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encInput}&region=za&location=-30.5595,22.9375&radius=2000000&key=${encodeURIComponent(googleApiKey)}`;
  const textRes = await fetch(textUrl);
  const textData = await textRes.json();
  if (textData.results && textData.results.length > 0) {
    placeId = textData.results[0].place_id;
  }
}

// 3) Negative cache if still no placeId
if (!placeId) {
  const neg = { query: storeName, normalizedQuery, isResolved: false, updatedAt: Date.now() };
  logApiCacheWrite(normalizedQuery, cacheRef);
  await cacheRef.set(neg, { merge: true });
  addressCache[normalizedQuery] = null;
  return null;
}

// 4) DETAILS (no geometry requested)
const detailsUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(placeId)}&fields=name,address_components,formatted_address&key=${encodeURIComponent(googleApiKey)}`;
const detailsRes = await fetch(detailsUrl);
const detailsData = await detailsRes.json();
const result = detailsData.result;

// validation (formatted address & country must be South Africa)
// build structured address via indexAddressComponents + buildStructuredFromComponents
// save structured doc with provider:"google", source, placeId, etc.
// then call finalizeLatLng(out, normalizedQuery, cacheRef, storeName)
```

**Key points:**

- Places is used **only** to derive the **structured address** and store name; the `details` call does **not** request `geometry`, so Places is **not** the source of lat/lng.
- All coordinates are filled later via `finalizeLatLng` → `geocodeAddress` (see next section).

---

### 3. Address → Coordinates Flow

There are two relevant paths:

1. **Store cache coordinates** (used for routes in the main upload flow) – driven by `finalizeLatLng` and `geocodeAddress` in `resolveStore.js`.
2. **Generic route resolver** (`routeAddressResolver.js`) – not wired into the public `/engine/resolve-store` flow, but present in the codebase.

#### 3.1 `geocodeAddress` (Nominatim → Google Geocode)

- **File**: `functions/src/resolveStore.js`
- **Purpose**: Given a full address string, return `{ lat, lng }` via Nominatim first, then Google Geocoding if Nominatim fails.

```254:288:functions/src/resolveStore.js
/**
 * Geocode via Nominatim (retries + delays), then Google Geocoding once if Nominatim fails.
 */
async function geocodeAddress(address) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1`;
      const res = await fetch(url, {
        headers: {
          "User-Agent": "AutoLogbookApp/1.0",
          Accept: "application/json"
        }
      });
      const data = await res.json();
      const first = Array.isArray(data) && data[0];
      if (first) {
        const lat = parseFloat(first.lat);
        const lng = parseFloat(first.lon);
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
          return { lat, lng };
        }
      }
    } catch (e) {
      // log + ignore
    }
    await new Promise(r => setTimeout(r, 2500));
  }

  // GOOGLE FALLBACK
  console.log("[FALLBACK] Nominatim failed → Google", address);
  try {
    const googleUrl =
      "https://maps.googleapis.com/maps/api/geocode/json?address=" +
      encodeURIComponent(address) +
      "&components=country:za&key=" +
      encodeURIComponent(process.env.GOOGLE_API_KEY || "");
    const geoRes = await fetch(googleUrl);
    const geoData = await geoRes.json();
    // return first valid lat/lng or null
  } catch (e) {
    // log + ignore
  }
  return null;
}
```

#### 3.2 `finalizeLatLng` – attach / validate coordinates for a structured store

- **File**: `functions/src/resolveStore.js`
- **Role**: Given a structured store (with customer, address, suburb, city, province, `_resolved:true`), ensure it has valid lat/lng:
  - If coords already present and valid → possibly skip geocode, but still run confidence gate vs existing Firestore coords.
  - If no coords → build a full address string from the structured fields, call `geocodeAddress`, apply confidence/distance gates, and write coords back to Firestore if good.

**High‑level snippet:**

```340:503:functions/src/resolveStore.js
async function finalizeLatLng(structured, normalizedQuery, cacheRef, originalInput = "") {
  if (!structured || structured._resolved !== true) return structured;

  let lat = structured.lat;
  let lng = structured.lng;

  const hasCoordsAlready =
    typeof lat === "number" && !Number.isNaN(lat) &&
    typeof lng === "number" && !Number.isNaN(lng);

  const existingSnap = await cacheRef.get();
  const existing = existingSnap.exists ? existingSnap.data() || null : null;

  if (!hasCoordsAlready) {
    const addressString = buildFullAddressFromParts({
      customer: structured.customer,
      address: structured.address,
      suburb: structured.suburb,
      city: structured.city,
      province: structured.province
    });
    const geo = await geocodeAddress(addressString);
    // if geo has valid lat/lng:
    //   compute distance vs existing coords (if any)
    //   apply 5km distance gate
    //   if existingHasCoords && !isGood → mark needsAdminReview:true, keep old coords
    //   if isGood → write lat/lng, missingCoords:false, needsAdminReview:false, isResolved:true
    // else:
    //   write missingCoords:true, needsAdminReview:true
  }

  const out = { ...structured, lat, lng };
  if (hasValidLatLng(out)) {
    await mergeSuccessAliases(cacheRef, normalizedQuery, originalInput);
  }
  addressCache[normalizedQuery] = out;
  return out;
}
```

**Answer to “Address → coordinates” questions (main store flow):**

- **Uses Nominatim?** Yes, first, via `geocodeAddress`.
- **Fallback to Geocode?** Yes, Google Geocoding is the fallback.
- **Uses Places for coordinates?** No. Places is used only to obtain structured address/name; coords come only from Nominatim + Google Geocode.

#### 3.3 Generic route resolver (`routeAddressResolver.js`) – alternate, not main flow

- **File**: `functions/src/routeAddressResolver.js`
- **Purpose**: Resolve coordinates for generic routes using Places and a Google Geocode fallback, without Nominatim.

Key points:

```1:226:functions/src/routeAddressResolver.js
async function geocodeFallback(route, apiKey) {
  // Google Geocode only (no Nominatim)
}

async function geocodeAddressOnly(addressQuery, apiKey) {
  // Google Geocode only for free-form address
}

async function resolveRoute(route, apiKey) {
  const hasCoords = ...; // if lat/lng present → return with _resolved:true
  // otherwise:
  let query = route._googlePlacesInput || buildSearchQuery(route);
  // ensure ", South Africa"

  // 1. Google Places FindPlace
  // 2. If no placeId → TextSearch
  // 3. If placeId → Places Details with geometry → lat/lng directly from Places
  // 4. If still no result → Google Geocode fallback (geocodeFallback)
}

async function resolveRouteAddresses(routes, apiKey) {
  const resolvedRoutes = await Promise.all(routes.map(route => resolveRoute(route, apiKey)));
  return resolvedRoutes;
}
```

- **Important**: This module is imported in `functions/src/index.js` but is **not** used in `/engine/resolve-store` or `/api/generateLogbook` for the public flow. The main path uses `resolveStoreAddresses` instead.

---

### 4. Data Persistence – Where and When Data Is Stored

#### 4.1 Firestore collections

- `apiCache_storeResolution` (`API_CACHE_STORE_RESOLUTION`)
- `store_locations` (`STORE_LOCATIONS`)

Both defined/exported in `functions/src/resolveStore.js` and used across multiple modules.

##### 4.1.1 `apiCache_storeResolution` – store resolution cache

**Reads:**

- In `resolveStore`:
  - In‑memory `addressCache[normalizedQuery]`
  - Firestore `where("normalizedQuery", "==", normalizedQuery).limit(1)`
  - Direct `doc.get()` on `docId`
- In `persistManualRouteToCache`:
  - Reads existing doc to preserve `createdAt`.
- In `getStore(storeName)`:

```963:968:functions/src/resolveStore.js
async function getStore(storeName) {
  const nq = normalizeStoreQuery(storeName);
  if (!nq) return null;
  const docId = sha256(nq);
  const snap = await db().collection(API_CACHE_STORE_RESOLUTION).doc(docId).get();
  return snap.exists ? snap.data() || null : null;
}
```

**Writes:**

- After Places Details succeeds (structured address but before coords):
  - Provider: `"google"`, `source` (findplace/textsearch), `placeId`, structured address, `formattedAddress`, `country:"ZA"`, `isResolved:true`, `missingCoords:false`, timestamps.
- In `finalizeLatLng` when coords are successfully geocoded and pass the confidence gate:
  - Updates `lat`, `lng`, `missingCoords:false`, `needsAdminReview:false`, `isResolved:true`, `updatedAt`.
- In negative cases (no `placeId`, non‑SA formatted address, bad country, geocode failure):
  - Writes `{ isResolved:false, normalizedQuery, query, updatedAt, missingCoords:true, needsAdminReview:true }` as appropriate.
- In manual overrides (`persistManualRouteToCache`):
  - Writes `provider:"manual"`, `source:"user"`, structured fields, `isResolved:true`, `missingCoords:false`, alias fields, timestamps.

**Timing:**

- **Before external APIs**: all DB/cache checks (memory + Firestore).
- **After Places Details, before coords**: writes structured address (provider/source/placeId/etc.).
- **After coordinates confirmed by `finalizeLatLng`**: writes lat/lng + flags.

##### 4.1.2 `store_locations` – admin‑curated store locations

- **File**: `functions/src/adminUploadStores.js`
- **Usage**: Admin bulk upload into `apiCache_storeResolution` and `store_locations`.

Snippet:

```5:13:functions/src/adminUploadStores.js
const {
  normalizeStoreQuery,
  finalizeLatLng,
  aliasFieldsForCacheWrite,
  API_CACHE_STORE_RESOLUTION,
  STORE_LOCATIONS
} = require("./resolveStore");
...
155:167:functions/src/adminUploadStores.js
await db()
  .collection(STORE_LOCATIONS)
  .doc(locationDocId)
  .set(
    {
      customer: row.Customer,
      address: row.Address,
      city: row.City,
      suburb: row.Suburb,
      province: row.Province,
      lat,
      lng,
      updatedAt: Date.now()
    },
    { merge: true }
  );
```

- Admin routes also pass through `finalizeLatLng`, so they use the same Nominatim → Google Geocode pipeline and confidence gate before coordinates are stored.

---

### 5. Final Logbook Output – Routes → Engine → Entries

#### 5.1 Frontend call to generate logbook

- **File**: `public/js/logbook-page.js`
- **Trigger**: Submitting the main logbook form (`initFormSubmit`), after route preview is resolved and confirmed.

Key call:

```3022:3051:public/js/logbook-page.js
// Diagnostic call in DEBUG_LOCAL_ENGINE (no auth)
fetch('/api/generateLogbook', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(engineInput)
});

// Main path
var generateUrl = (typeof window.LOGBOOK_FUNCTION_URL === 'string' && window.LOGBOOK_FUNCTION_URL.trim())
  ? window.LOGBOOK_FUNCTION_URL.trim()
  : '/api/generateLogbook';
// ...
fetch(generateUrl, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', /* plus logbook token/auth */ },
  body: JSON.stringify(engineInput)
});
```

`engineInput` includes:

- `routes[]` – already enriched with addresses and lat/lng from `resolveStoreAddresses`.
- `homeLat`, `homeLng`, `homeAddress`
- `startDate`, `endDate`
- `openingKm`, and other meta.

#### 5.2 Backend handler and engine adapter

**Local server** (`server.js`):

```223:277:server.js
app.post('/api/generateLogbook', async (req, res) => {
  // access checks via resolveStoreGate
  const { routes, startDate, endDate, homeAddress, openingKm } = req.body;
  // validations ...
  const result = await generateLogbook(req.body); // require('./functions/engineAdapter')
  const entries = result.entries || [];
  const meta = result.meta || {};
  res.json({
    success: true,
    data: result
  });
});
```

**Cloud Functions version** (`functions/src/index.js`):

```380:460:functions/src/index.js
app.all("/api/generateLogbook", async (req, res) => {
  setCors(req, res);
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed. Use POST." });
  }
  // body & size validation, access check ...
  try {
    const result = await generateLogbook(req.body);
    const entries = result.entries || [];
    const meta = result.meta || {};
    res.json({
      success: true,
      data: result
    });
  } catch (err) {
    res.status(400 or 500)...;
  }
});
```

**Adapter → engine** (`functions/engineAdapter.js`):

```14:17:functions/engineAdapter.js
async function generateLogbook(input) {
  const body = input && typeof input === "object" ? input : {};
  return runLogbookEngine(body);
}
```

#### 5.3 Core engine – route usage and lat/lng requirements

- **File**: `functions/engine/logbookEngine.js` (mirrored in `public/engine/logbookEngine.js`)
- The engine:
  - Uses `routes` (with lat/lng) to build visits.
  - Requires `input.homeLat` / `input.homeLng`.

Key requirement:

```1353:1370:functions/engine/logbookEngine.js
function generateLogbookEntries(visits, vehicleOpeningKm, homeAddress, startDate, endDate, routes, manualEntries, workSaturdays, leaveDays, input) {
  if (!Array.isArray(visits)) {
    throw new Error('Visits array is required');
  }
  const homeLat = input && typeof input.homeLat === 'number' && !isNaN(input.homeLat) ? input.homeLat : null;
  const homeLng = input && typeof input.homeLng === 'number' && !isNaN(input.homeLng) ? input.homeLng : null;
  if (homeLat == null || homeLng == null) {
    throw new Error('generateLogbookEntries requires input.homeLat and input.homeLng');
  }
  // Uses routes (with coords) + visits to produce SARS-compliant entries
}
...
2136:2138:functions/engine/logbookEngine.js
const entries = generateLogbookEntries(
  visits,
  openingKm,
  homeAddress,
  startDate,
  endDate,
  routesForWorkDays,
  manualEntries,
  workSaturdays,
  leaveDays,
  input
);
```

**Final flow (current):**

> Excel upload → routes parsed on frontend → `/engine/resolve-store` → `resolveStoreAddresses` / `resolveStore` (DB + Places + Nominatim/Geocode for coords) → enriched routes with lat/lng → preview and possible manual reprocess → `/api/generateLogbook` → `generateLogbook` / `runLogbookEngine` → final logbook entries.

---

### 6. Comparison vs Desired Cleartrack‑Style Architecture

#### 6.1 Desired architecture (as specified)

- **Store names → structured addresses**:  
  `DB → Google Places (FindPlace → TextSearch → Details)`

- **Addresses → coordinates (lat/lng)**:  
  `Nominatim → fallback → Google Geocode`

#### 6.2 Actual store resolution flow (current)

**For store *addresses* (structured data):**

1. **DB / cache:**
   - Memory `addressCache[normalizedQuery]`
   - Firestore `apiCache_storeResolution` via `where("normalizedQuery" == normalizedQuery)`
   - Firestore `doc.get()` on `docId`
2. **If unresolved:**
   - Google Places **FindPlace**
   - Google Places **TextSearch** fallback
   - Google Places **Details** (name, address_components, formatted_address)
   - Validation to enforce South Africa
   - Structured address built; saved to Firestore (`provider:"google"`, `source`, `placeId`, etc.).
3. **Then coordinates:**
   - `finalizeLatLng` → `geocodeAddress(structured address)`:
     - Nominatim (2 attempts) → Google Geocode fallback
     - Confidence/distance gate vs existing coords in Firestore
     - Lat/lng written to Firestore only if safe.

**Summary (store side, current):**

> **Memory cache → Firestore apiCache_storeResolution → Google Places (FindPlace → TextSearch → Details) → Nominatim → Google Geocode → Firestore update lat/lng**

#### 6.3 Actual generic address → coordinates flow

For store‑based routes (main flow):

> `structured address → geocodeAddress → Nominatim → Google Geocode`

For alternate generic routes (`routeAddressResolver.js`, not main flow):

> `Places FindPlace → TextSearch → Details (with geometry) → Google Geocode fallback` (no Nominatim).

---

### 7. Issues / Mismatches vs Desired Architecture

This section lists **observed behaviours only** (no fixes).

#### 7.1 Coupled store resolution and coordinate generation

- **Where**: `functions/src/resolveStore.js`, `finalizeLatLng`, `geocodeAddress`.
- **Observation**: Store resolution (Places) and coordinate generation (Nominatim + Google Geocode) are coupled in the same function (`finalizeLatLng`) that is called as part of `resolveStore`. There is no standalone “address → coords” service; coords are attached as a tail step of store resolution.

#### 7.2 Store coordinates come from Nominatim / Google Geocode, not Places geometry

- **Where**: `functions/src/resolveStore.js`, Places `details` call and `finalizeLatLng`.
- **Observation**:
  - The Places `details` request only asks for `name,address_components,formatted_address` (no `geometry`), so it never consumes Places lat/lng.
  - All store coordinates come from `geocodeAddress`, which uses **Nominatim first** and then **Google Geocode** as fallback.

#### 7.3 Nominatim is used for store coordinates, not just generic address geocoding

- **Where**: `functions/src/resolveStore.js`, `geocodeAddress` / `finalizeLatLng`.
- **Observation**: Anytime a store’s structured address needs lat/lng (whether Google, manual, or admin), `geocodeAddress` is called, making Nominatim the first source for store coordinates, with Google Geocode as fallback. Places geometry is not used for coord values.

#### 7.4 Alternate generic route resolver uses Google Geocode only (no Nominatim) and is not wired into the main flow

- **Where**: `functions/src/routeAddressResolver.js`.
- **Observation**:
  - For generic routes, `resolveRoute` uses:
    - Places FindPlace → TextSearch → Details (with geometry)
    - Then **Google Geocode fallback** (no Nominatim).
  - This is closer to the Cleartrack architecture but:
    - It omits Nominatim entirely.
    - It is **not** used in `/engine/resolve-store`; the main public flow uses `resolveStoreAddresses` instead.

#### 7.5 Confidence / distance gate can preserve stale or null coordinates

- **Where**: `functions/src/resolveStore.js`, `finalizeLatLng`.
- **Observation**:
  - When `geocodeAddress` returns coords, `finalizeLatLng`:
    - Computes distance vs existing lat/lng in the cache.
    - If distance > 5 km → treats new coords as low‑confidence (`isGood = false`).
    - If existingHasCoords && !isGood → marks `needsAdminReview:true`, keeps old coords, and returns `_resolved:false, resolutionStatus:"needs_attention"`.
  - As a result, new geocode results may **not** overwrite existing lat/lng, preserving potentially stale values.

#### 7.6 Admin‑uploaded stores share the same Nominatim → Geocode + gate logic

- **Where**: `functions/src/adminUploadStores.js` (via `finalizeLatLng`).
- **Observation**: Admin uploads do not use a separate pipeline; they rely on `finalizeLatLng` and thus share Nominatim + Google Geocode and its confidence/distance rules, even though the input is explicitly curated.

#### 7.7 Architectural duplicate: two resolution systems with different behaviours

- **Where**:
  - `functions/src/resolveStore.js` – DB + Places for names, Nominatim + Geocode for coords.
  - `functions/src/routeAddressResolver.js` – Places for names + geometry, Google Geocode fallback only.
- **Observation**:
  - There are **two** separate resolution stacks in the codebase:
    - One for store names (main public flow).
    - One generic route resolver (currently not wired into `/engine/resolve-store`).
  - This duplication makes the overall behaviour harder to reason about and diverges from a single, clear Cleartrack‑style pipeline.

---

### 8. Concise Flow Summary (Current Behaviour)

**Store resolution (names → structured addresses + coords) – production path:**

> **Memory cache → Firestore `apiCache_storeResolution` → (if unresolved) Google Places FindPlace → TextSearch → Details → write structured address → `finalizeLatLng` → Nominatim → Google Geocode → write lat/lng (if passes gate)**.

**Addresses → lat/lng (for stores and admin uploads):**

> **Nominatim (2 attempts, with delay) → Google Geocode fallback → confidence/distance gate vs existing coords → Firestore update**.

**Route list → final logbook output:**

> **Excel upload (frontend) → routes parsed → `/engine/resolve-store` → `resolveStoreAddresses` (`resolveStore`) → enriched routes with structured addresses + lat/lng → user preview/edit/reprocess → `/api/generateLogbook` → `generateLogbook` → `runLogbookEngine` → SARS‑compliant logbook entries returned to frontend.**

