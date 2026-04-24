const admin = require("firebase-admin");
const crypto = require("crypto");
const functions = require("firebase-functions");

function readFirebaseConfigGoogleKey() {
  try {
    const cfg = functions.config();
    return (cfg && cfg.google && cfg.google.key) || "";
  } catch (_e) {
    return "";
  }
}

const GOOGLE_API_KEY =
  readFirebaseConfigGoogleKey() ||
  process.env.GOOGLE_API_KEY ||
  "";

const FieldValue =
  admin.firestore && admin.firestore.FieldValue
    ? admin.firestore.FieldValue
    : null;

if (!admin.apps.length) {
  admin.initializeApp();
}

/** Authoritative permanent store rows (canonicalName query + doc id aligned with admin approval). */
const STORE_LOCATIONS = "storeLocations";
/** Doc id = sha256(normalized input); optional non-authoritative memo / negative cache only. */
const STORE_RESOLUTION_COLLECTION = "storeResolution";
/** @deprecated Alias for admin upload / index — same collection as STORE_RESOLUTION_COLLECTION. */
const API_CACHE_STORE_RESOLUTION = STORE_RESOLUTION_COLLECTION;

function sha256(utf8String) {
  return crypto
    .createHash("sha256")
    .update(String(utf8String || ""), "utf8")
    .digest("hex");
}

/** In-memory resolver cache: normalized key → negative marker only (success always re-checks storeLocations). */
const __resolverMemoryCache = new Map();

/**
 * Resolver persistent-cache key: trim, lowercase, collapse spaces, stable ", South Africa" suffix.
 */
function normalizeResolverCacheKey(input) {
  if (input == null) return "";
  let s = String(input).trim().toLowerCase().replace(/\s+/g, " ").trim();
  if (!s) return "";
  if (!/\bsouth\s+africa\b/.test(s)) {
    s = `${s}, south africa`;
  }
  return s;
}

function resolverCacheDocIdFromUserInput(userInput) {
  const nk = normalizeResolverCacheKey(String(userInput || "").trim());
  if (!nk) return "";
  return sha256(nk);
}

/** ~center of South Africa for Find Place location bias (metres, lat, lng). */
const SA_LOCATION_BIAS = "circle:500000@-28.5,25.0";

const REGION_MAP = {
  western_cape: {
    bias: "circle:250000@-33.9249,18.4241",
    province: "western cape"
  },
  eastern_cape: {
    bias: "circle:300000@-32.2968,26.4194",
    province: "eastern cape"
  },
  gauteng: {
    bias: "circle:150000@-26.2041,28.0473",
    province: "gauteng"
  },
  garden_route: {
    bias: "circle:150000@-34.0351,23.0465",
    province: "western cape"
  }
};

async function runWithConcurrency(items, limit, iteratee) {
  if (!items || items.length === 0) return [];
  const results = new Array(items.length);
  let next = 0;
  const workerCount = Math.max(1, Math.min(limit, items.length));

  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= items.length) break;
      results[i] = await iteratee(items[i], i);
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

/**
 * When Place Details omits geometry, derive lat/lng from the formatted address via Geocoding API.
 */
async function geocodeLatLngFromAddress(formattedAddress, apiKey) {
  if (!formattedAddress || !apiKey) {
    return { lat: null, lng: null };
  }
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(
    formattedAddress
  )}&key=${apiKey}`;
  const res = await fetch(url);
  const data = await res.json();
  if (
    data.status !== "OK" ||
    !data.results ||
    !data.results[0] ||
    !data.results[0].geometry ||
    !data.results[0].geometry.location
  ) {
    return { lat: null, lng: null };
  }
  const loc = data.results[0].geometry.location;
  const latN = Number(loc.lat);
  const lngN = Number(loc.lng);
  if (!Number.isFinite(latN) || !Number.isFinite(lngN)) {
    return { lat: null, lng: null };
  }
  return { lat: latN, lng: lngN };
}

async function writeStoreResolutionCache(payload) {
  const docId = resolverCacheDocIdFromUserInput(
    payload.customer != null ? payload.customer : payload.address || ""
  );
  if (!docId) return;
  const cacheDoc = {
    notFound: false,
    customer: payload.customer,
    address: payload.address,
    suburb: payload.suburb != null ? payload.suburb : "",
    city: payload.city != null ? payload.city : "",
    province: payload.province != null ? payload.province : "",
    lat: payload.lat != null ? payload.lat : null,
    lng: payload.lng != null ? payload.lng : null,
    canonicalName: payload.canonicalName != null ? payload.canonicalName : "",
    source: payload.source || "google_places",
    updatedAt: Date.now()
  };
  if (payload.placeId != null) cacheDoc.placeId = payload.placeId;
  if (payload.googleFormattedAddress != null) {
    cacheDoc.googleFormattedAddress = payload.googleFormattedAddress;
  }
  await db()
    .collection(STORE_RESOLUTION_COLLECTION)
    .doc(docId)
    .set(cacheDoc, { merge: true });
}

async function writeNegativeResolverCache(userInput) {
  const docId = resolverCacheDocIdFromUserInput(userInput);
  if (!docId) return;
  await db()
    .collection(STORE_RESOLUTION_COLLECTION)
    .doc(docId)
    .set({
      notFound: true,
      updatedAt: Date.now()
    });
}

/** Same doc id as writeStoreResolutionCache — hash of normalizeResolverCacheKey(raw user input). */
function cacheKeySourceFromResolved(resolved) {
  if (!resolved || typeof resolved !== "object") return "";
  if (
    resolved._resolverInputRaw != null &&
    String(resolved._resolverInputRaw).trim() !== ""
  ) {
    return String(resolved._resolverInputRaw).trim();
  }
  return String(resolved.customer || resolved.address || "").trim();
}

async function readStoreResolutionFromDb(resolved) {
  const docId = resolverCacheDocIdFromUserInput(cacheKeySourceFromResolved(resolved));
  if (!docId) return null;
  const snap = await db()
    .collection(STORE_RESOLUTION_COLLECTION)
    .doc(docId)
    .get();
  if (!snap.exists) return null;
  const data = snap.data();
  if (data && data.notFound === true) return null;
  return data;
}

function normalizeStoreName(input) {
  if (!input) return "";

  return String(input)
    .toLowerCase()
    .replace(/\s*-\s*\w+\s*$/g, "")
    .replace(/\s+\d+$/g, "")
    .replace(/\b(\w+)\s+\1\b/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/** Cache / search key normalizer (admin upload, buildSearchQuery). */
function normalizeStoreQuery(input) {
  if (input == null || String(input).trim() === "") return "";
  return normalizeStoreName(String(input).trim());
}

function aliasFieldsForCacheWrite(originalInput) {
  const s = originalInput != null ? String(originalInput).trim() : "";
  if (!s) return {};
  return {
    originalInput: s,
    aliases: FieldValue ? FieldValue.arrayUnion(s) : [s]
  };
}

function db() {
  return admin.firestore();
}

function isValidStoreName(name) {
  const s = String(name || "").trim();
  if (s.length < 3) return false;
  if (/^\d+$/.test(s)) return false;
  if (!/[a-zA-Z]/.test(s)) return false;
  return true;
}

function cleanStoreName(name) {
  return String(name || "")
    .trim()
    .replace(/\(cl\d+\)/gi, "") // remove (CL123)
    .replace(/-\s*\d+/g, "") // remove - 35839 ANYWHERE
    .replace(/\(\s*\)/g, "") // remove empty ()
    .replace(/\s+/g, " ") // collapse spaces
    .trim();
}

function getComponent(components, typeOrTypes) {
  if (!Array.isArray(components)) return "";
  if (Array.isArray(typeOrTypes)) {
    const c = components.find(
      (c) =>
        Array.isArray(c.types) &&
        typeOrTypes.some((t) => c.types.includes(t))
    );
    return c && c.long_name ? c.long_name : "";
  }
  const c = components.find(
    (x) => Array.isArray(x.types) && x.types.includes(typeOrTypes)
  );
  return c ? c.long_name : "";
}

const METRO_MAP = {
  "City of Cape Town": "Cape Town",
  "City of Johannesburg": "Johannesburg",
  "City of Tshwane": "Pretoria",
  "City of Ekurhuleni": "Ekurhuleni",
  "Ekurhuleni Metropolitan Municipality": "Ekurhuleni",
  "eThekwini Metropolitan Municipality": "Durban",
  "City of eThekwini": "Durban",
  "Nelson Mandela Bay Metropolitan Municipality": "Gqeberha",
  "Buffalo City Metropolitan Municipality": "East London",
  "Mangaung Metropolitan Municipality": "Bloemfontein",
  "Msunduzi Local Municipality": "Pietermaritzburg"
};

function buildAddress({ street, suburb, city, province }) {
  const parts = [];
  if (street) parts.push(street);
  if (suburb) parts.push(suburb);
  if (city) parts.push(city);
  if (province) parts.push(province);
  parts.push("South Africa");
  return parts.join(", ");
}

/** Rebuild display address from structured route fields (street optional). */
function rebuildAddressFromRoute(r) {
  const street =
    r && r.street != null && String(r.street).trim()
      ? String(r.street).trim()
      : "";
  return buildAddress({
    street,
    suburb: (r && r.suburb) || "",
    city: (r && r.city) || "",
    province: (r && r.province) || ""
  });
}

function needsAddressRebuild(r) {
  const addr = r && r.address != null ? String(r.address) : "";
  if (!addr || !addr.includes("South Africa")) {
    return true;
  }
  if (!r || !r._resolved) {
    return false;
  }
  if (r.suburb && !addr.includes(r.suburb)) {
    return true;
  }
  if (r.city && !addr.includes(r.city)) {
    return true;
  }
  if (r.province && !addr.includes(r.province)) {
    return true;
  }
  return false;
}

/**
 * After resolveStore merge: align address with structured fields, then log + validate for UI.
 */
function finalizeRoutesForUi(routes) {
  const list = Array.isArray(routes) ? routes : [];
  const merged = list.map((r) => {
    if (needsAddressRebuild(r)) {
      return {
        ...r,
        address: rebuildAddressFromRoute(r)
      };
    }
    return { ...r };
  });

  merged.forEach((r, i) => {
    console.log("📍 ROUTE CHECK", {
      index: i,
      customer: r.customer,
      address: r.address,
      suburb: r.suburb,
      city: r.city,
      province: r.province
    });
  });

  merged.forEach((r) => {
    if (!r.address) {
      console.error("❌ MISSING ADDRESS", r.customer);
    }
    if (!r.suburb) {
      console.warn("⚠️ MISSING SUBURB", r.customer);
    }
    if (!r.city) {
      console.warn("⚠️ MISSING CITY", r.customer);
    }
    if (!r.province) {
      console.warn("⚠️ MISSING PROVINCE", r.customer);
    }
    if (r.address && !r.address.includes("South Africa")) {
      console.error("❌ COUNTRY MISSING", r.address);
    }
  });

  merged.forEach((r) => {
    if (r.suburb && r.address && !r.address.includes(r.suburb)) {
      console.error("❌ SUBURB NOT IN ADDRESS", r);
    }
    if (r.city && r.address && !r.address.includes(r.city)) {
      console.error("❌ CITY NOT IN ADDRESS", r);
    }
    if (r.province && r.address && !r.address.includes(r.province)) {
      console.error("❌ PROVINCE NOT IN ADDRESS", r);
    }
  });

  return merged;
}

/** Runtime check: canonical address must not contain empty segments or duplicate country. */
function validateFormattedAddress(formattedAddress) {
  if (!formattedAddress || typeof formattedAddress !== "string") {
    throw new Error("formattedAddress: invalid");
  }
  if (/,(\s*,)/.test(formattedAddress)) {
    throw new Error("formattedAddress: empty comma segment");
  }
  const lower = formattedAddress.toLowerCase();
  if (
    lower.includes("south africa, south africa") ||
    lower.includes("south africa south africa")
  ) {
    throw new Error("formattedAddress: duplicate South Africa");
  }
}

/**
 * SA-specific structured address from Places address_components (spec order).
 */
function buildStructuredSaAddressFromComponents(result) {
  const components = result.address_components || [];

  const streetNumber = getComponent(components, "street_number");
  const route = getComponent(components, "route");
  let streetLine = "";
  if (streetNumber && route) {
    streetLine = `${streetNumber} ${route}`.trim();
  } else if (route) {
    streetLine = route;
  }

  const adminArea2 = getComponent(components, "administrative_area_level_2");

  let suburb =
    getComponent(components, "sublocality_level_1") ||
    getComponent(components, "sublocality") ||
    getComponent(components, "locality") ||
    "";

  let city =
    getComponent(components, "locality") ||
    adminArea2 ||
    "";

  const province = getComponent(components, "administrative_area_level_1") || "";

  if (adminArea2 && METRO_MAP[adminArea2]) {
    city = METRO_MAP[adminArea2];
  }

  let suburbOut = suburb;
  if (suburbOut && city && suburbOut === city) {
    suburbOut = "";
  }

  const canonicalAddress = buildAddress({
    street: streetLine,
    suburb: suburbOut,
    city,
    province
  });

  validateFormattedAddress(canonicalAddress);

  return {
    streetLine,
    suburb: suburbOut,
    city,
    province,
    canonicalAddress,
    customerName:
      typeof result.name === "string" && result.name.trim()
        ? result.name.trim()
        : ""
  };
}

/** @deprecated Use buildStructuredSaAddressFromComponents */
function postProcessGooglePlaceResult(result) {
  const o = buildStructuredSaAddressFromComponents(result);
  return {
    suburb: o.suburb,
    city: o.city,
    province: o.province,
    formattedAddress: o.canonicalAddress
  };
}

function googleFormattedAddressLooksSouthAfrican(formatted) {
  if (!formatted || typeof formatted !== "string") return false;
  return formatted.toLowerCase().includes("south africa");
}

/**
 * Text Search (region=za) → Find Place (ZA bias) if no result → Place Details.
 * Returns enriched result or null on failure / invalid SA address.
 */
async function fetchGooglePlaceResult(searchInput, apiKey, trace, selectedRegions = ["south_africa"], alreadyRetried = false) {
  let bias = SA_LOCATION_BIAS;
  if (selectedRegions && selectedRegions.length === 1) {
    const regionKey = selectedRegions[0];
    if (REGION_MAP[regionKey]) {
      bias = REGION_MAP[regionKey].bias;
    }
  }

  console.log(
    "[AUDIT] Final query sent to Places API (textsearch primary):",
    JSON.stringify(searchInput)
  );
  console.log("[AUDIT] API used: google_places_textsearch");

  const textUrl =
    `https://maps.googleapis.com/maps/api/place/textsearch/json` +
    `?query=${encodeURIComponent(searchInput)}` +
    `&region=za` +
    `&key=${apiKey}`;

  if (trace && Array.isArray(trace.apiCalls)) {
    trace.apiCalls.push({
      api: "google_places_textsearch",
      input: searchInput
    });
  }

  let placeId = null;

  try {
    const textRes = await fetch(textUrl);
    const textData = await textRes.json();

    console.log("GOOGLE TEXT SEARCH STATUS:", {
      status: textData.status,
      resultsCount: textData.results ? textData.results.length : 0
    });

    if (
      textData.status === "OK" &&
      textData.results &&
      textData.results.length > 0 &&
      textData.results[0].place_id
    ) {
      placeId = textData.results[0].place_id;
    }
  } catch (e) {
    console.error("google_places_textsearch network error:", e);
  }

  if (!placeId) {
    console.log(
      "[AUDIT] Fallback triggered: textsearch returned no results"
    );
    console.log(
      "[AUDIT] Final query sent to Places API (findplace fallback):",
      JSON.stringify(searchInput)
    );
    console.log("[AUDIT] API used: google_places_findplacefromtext");

    const findPlaceUrl =
      `https://maps.googleapis.com/maps/api/place/findplacefromtext/json` +
      `?input=${encodeURIComponent(searchInput)}` +
      `&inputtype=textquery` +
      `&fields=place_id,name` +
      `&locationbias=${encodeURIComponent(bias)}` +
      `&key=${apiKey}`;

    if (trace && Array.isArray(trace.apiCalls)) {
      trace.apiCalls.push({
        api: "google_places_findplace",
        input: searchInput
      });
    }

    try {
      const findRes = await fetch(findPlaceUrl);
      const findData = await findRes.json();

      console.log("GOOGLE API RESPONSE STATUS:", {
        status: findData.status,
        candidatesCount: findData.candidates ? findData.candidates.length : 0
      });

      if (
        findData.status === "OK" &&
        findData.candidates &&
        findData.candidates.length > 0 &&
        findData.candidates[0].place_id
      ) {
        placeId = findData.candidates[0].place_id;
      }
    } catch (e) {
      console.error("google_places_findplace network error:", e);
      return null;
    }
  }

  if (!placeId) {
    return null;
  }

  console.log("[AUDIT] API used: google_places_details");
  const detailsUrl =
    `https://maps.googleapis.com/maps/api/place/details/json` +
    `?place_id=${encodeURIComponent(placeId)}` +
    `&fields=address_components,formatted_address,name,geometry,place_id` +
    `&key=${apiKey}`;

  if (trace && Array.isArray(trace.apiCalls)) {
    trace.apiCalls.push({
      api: "google_places_details",
      placeId
    });
  }

  let detailsData;
  try {
    const detailsRes = await fetch(detailsUrl);
    detailsData = await detailsRes.json();
  } catch (e) {
    console.error("google_places_details network error:", e);
    return null;
  }

  if (detailsData.status !== "OK" || !detailsData.result) {
    console.log("GOOGLE API FAILURE (place/details):", detailsData.status);
    return null;
  }

  const result = detailsData.result;
  const formatted =
    typeof result.formatted_address === "string"
      ? result.formatted_address.trim()
      : "";

  const provinceComponent = (result.address_components || []).find(c =>
    c.types && c.types.includes("administrative_area_level_1")
  );
  const province = provinceComponent && provinceComponent.long_name
    ? String(provinceComponent.long_name).toLowerCase()
    : "";

  const country = getComponent(result.address_components, ["country"]);

  if (!country || country.toLowerCase() !== "south africa") {
    return {
      address: "",
      suburb: "",
      city: "",
      province: "",
      lat: null,
      lng: null,
      _resolved: false,
      resolutionStatus: "not_found"
    };
  }

  if (selectedRegions && selectedRegions.length > 0 && selectedRegions[0] !== "south_africa") {
    const allowed = selectedRegions.some(regionKey => {
      const region = REGION_MAP[regionKey];
      return region && province.includes(region.province);
    });

    if (!allowed) {
      if (trace && Array.isArray(trace.steps)) {
        trace.steps.push("Rejected: outside selected region → " + province);
      }
      if (!alreadyRetried && selectedRegions && selectedRegions.length > 0) {
        const regionName = selectedRegions[0].replace("_", " ");
        const retryQuery = searchInput + " " + regionName;
        if (trace && Array.isArray(trace.steps)) {
          trace.steps.push("Retry with region: " + retryQuery);
        }
        console.log("[AUDIT] Fallback triggered: wrong_region retry");
        console.log("[AUDIT] Fallback query:", JSON.stringify(retryQuery));
        return await fetchGooglePlaceResult(retryQuery, apiKey, trace, selectedRegions, true);
      }
      return {
        _resolved: false,
        resolutionStatus: "wrong_region"
      };
    }
  }

  let structured;
  try {
    structured = buildStructuredSaAddressFromComponents(result);
  } catch (e) {
    console.error("buildStructuredSaAddressFromComponents:", e);
    return null;
  }

  const googleFormattedAddress = formatted;

  return {
    ...result,
    place_id: result.place_id || placeId,
    suburb: structured.suburb,
    city: structured.city,
    province: structured.province,
    streetLine: structured.streetLine,
    canonicalAddress: structured.canonicalAddress,
    customerName: structured.customerName,
    formatted_address: structured.canonicalAddress,
    googleFormattedAddress
  };
}

function logStoreResolutionAudit(trace) {
  console.log("STORE RESOLUTION AUDIT", JSON.stringify(trace));
}

function buildResolverQueryAttempts(raw, cleaned) {
  console.log(
    "[AUDIT] Before buildResolverQueryAttempts:",
    "raw=",
    JSON.stringify(raw),
    "cleaned=",
    JSON.stringify(cleaned)
  );
  const attempts = [];
  const seen = new Set();
  const add = (s) => {
    const beforeAdd = String(s || "").trim();
    console.log("[AUDIT] Before buildResolverQueryAttempts add():", JSON.stringify(beforeAdd));
    let q = String(s || "")
      .trim()
      .replace(/\s+/g, " ")
      .trim();
    if (!q) return;
    const lower = q.toLowerCase();
    if (!/\bsouth\s+africa\b/.test(lower)) {
      q = `${q}, South Africa`;
    }
    const k = q.toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    console.log("[AUDIT] After buildResolverQueryAttempts add():", JSON.stringify(q));
    attempts.push(q);
  };
  const base = cleaned || raw;
  add(base);
  if (String(cleaned || "").trim() !== String(raw).trim()) {
    add(raw);
  }
  console.log("[AUDIT] After buildResolverQueryAttempts:", JSON.stringify(attempts));
  return attempts;
}

async function readResolverPersistentCache(userInput) {
  const docId = resolverCacheDocIdFromUserInput(userInput);
  if (!docId) return { type: "miss" };
  try {
    const snap = await db()
      .collection(STORE_RESOLUTION_COLLECTION)
      .doc(docId)
      .get();
    if (!snap.exists) return { type: "miss" };
    const data = snap.data();
    if (data && data.notFound === true) return { type: "negative" };
    return { type: "hit", data };
  } catch (e) {
    console.error("readResolverPersistentCache:", e);
    return { type: "miss" };
  }
}

function cachePayloadFromFirestore(data, raw) {
  return {
    _resolverInputRaw: raw,
    customer:
      data.customer != null && String(data.customer).trim()
        ? String(data.customer).trim()
        : raw,
    canonicalName:
      data.canonicalName != null && String(data.canonicalName).trim()
        ? String(data.canonicalName).trim()
        : normalizeStoreName(raw),
    address: data.address != null ? String(data.address) : "",
    suburb: data.suburb != null ? String(data.suburb) : "",
    city: data.city != null ? String(data.city) : "",
    province: data.province != null ? String(data.province) : "",
    lat: data.lat != null ? data.lat : null,
    lng: data.lng != null ? data.lng : null,
    source: data.source != null ? data.source : "cache",
    placeId: data.placeId != null ? data.placeId : null,
    googleFormattedAddress:
      data.googleFormattedAddress != null
        ? String(data.googleFormattedAddress)
        : null,
    updatedAt: data.updatedAt != null ? data.updatedAt : null,
    _resolved: true,
    resolutionStatus: "ok_cache"
  };
}

async function resolveStoreName(storeName, options = {}) {
  const raw = String(storeName || "").trim();
  console.log("[AUDIT] Original storeName input:", JSON.stringify(raw));
  console.log("=== RESOLVER START ===", { raw });
  if (!raw) return null;

  const memKey = normalizeResolverCacheKey(raw);
  const trace = {
    input: raw,
    canonical: normalizeStoreName(raw),
    steps: [],
    dbLookupTried: false,
    dbHit: false,
    dbReturnedEarly: false,
    apiCalls: [],
    finalSource: null,
    finalAddress: null
  };

  if (memKey && __resolverMemoryCache.has(memKey)) {
    const entry = __resolverMemoryCache.get(memKey);
    if (entry.negative) {
      trace.finalSource = "memory_negative";
      logStoreResolutionAudit(trace);
      return null;
    }
    // Positive memory entries are not returned here — storeLocations must stay authoritative.
  }

  console.log("[AUDIT] Before normalizeStoreName:", JSON.stringify(raw));
  const canonical = normalizeStoreName(raw);
  trace.canonical = canonical;
  console.log("[AUDIT] After normalizeStoreName:", JSON.stringify(canonical));

  const isTooShort = raw.length < 3;
  const isDigitsOnly = /^\d+$/.test(raw);
  console.log("[AUDIT] Before cleanStoreName:", JSON.stringify(raw));
  const cleaned =
    isTooShort || isDigitsOnly ? raw : cleanStoreName(raw);
  console.log("[AUDIT] After cleanStoreName:", JSON.stringify(cleaned));

  let existingRef = null;
  let existing = null;

  trace.dbLookupTried = true;
  if (canonical) {
    const snap = await db()
      .collection(STORE_LOCATIONS)
      .where("canonicalName", "==", canonical)
      .limit(1)
      .get();

    if (!snap.empty) {
      existingRef = snap.docs[0].ref;
      existing = snap.docs[0].data();
    }
  }

  trace.steps.push({
    step: "db_lookup",
    result: existingRef && existing ? "hit" : "miss",
    canonical
  });

  if (existing && existing.address) {
    trace.dbHit = true;
    trace.dbReturnedEarly = true;
    trace.finalSource = "db";
    trace.finalAddress = existing.address;

    const ret = {
      ...existing,
      _resolverInputRaw: raw,
      customer: raw,
      canonicalName: existing.canonicalName || canonical,
      _resolved: true,
      resolutionStatus: "ok_db",
      _storeLocationId: existingRef.id
    };

    try {
      await writeStoreResolutionCache({
        customer: raw,
        address: existing.address,
        suburb: existing.suburb != null ? existing.suburb : "",
        city: existing.city != null ? existing.city : "",
        province: existing.province != null ? existing.province : "",
        lat: existing.lat != null ? existing.lat : null,
        lng: existing.lng != null ? existing.lng : null,
        canonicalName: existing.canonicalName || canonical,
        source: existing.source || "db"
      });
    } catch (e) {
      console.error("STORE RESOLUTION CACHE WRITE FAILED (db hit):", e);
    }

    logStoreResolutionAudit(trace);
    return ret;
  }

  if (existingRef && existing) {
    trace.dbHit = true;
    trace.dbReturnedEarly = false;
  } else {
    trace.dbHit = false;
  }

  const pCache = await readResolverPersistentCache(raw);
  if (pCache.type === "negative") {
    trace.finalSource = "persistent_negative";
    if (memKey) __resolverMemoryCache.set(memKey, { negative: true });
    logStoreResolutionAudit(trace);
    return null;
  }
  if (pCache.type === "hit") {
    const data = pCache.data;
    const cacheCanonical =
      (data.canonicalName != null && String(data.canonicalName).trim()) ||
      canonical ||
      normalizeStoreName(raw) ||
      raw;
    const syncPayload = {
      customer:
        data.customer != null && String(data.customer).trim()
          ? String(data.customer).trim()
          : raw,
      canonicalName: cacheCanonical,
      address: data.address != null ? String(data.address) : "",
      suburb: data.suburb != null ? String(data.suburb) : "",
      city: data.city != null ? String(data.city) : "",
      province: data.province != null ? String(data.province) : "",
      lat: data.lat != null ? data.lat : null,
      lng: data.lng != null ? data.lng : null,
      source:
        data.source != null && String(data.source).trim()
          ? String(data.source).trim()
          : "resolution_cache_sync",
      updatedAt: Date.now()
    };
    if (data.placeId != null) syncPayload.placeId = data.placeId;
    if (data.googleFormattedAddress != null) {
      syncPayload.googleFormattedAddress = String(data.googleFormattedAddress);
    }
    try {
      await db()
        .collection(STORE_LOCATIONS)
        .doc(cacheCanonical)
        .set(syncPayload, { merge: true });
    } catch (e) {
      console.error("storeLocations backfill from storeResolution cache failed:", e);
    }
    const ret = cachePayloadFromFirestore(data, raw);
    ret._storeLocationId = cacheCanonical;
    trace.finalSource = "persistent_hit";
    trace.finalAddress = ret.address;
    logStoreResolutionAudit(trace);
    return ret;
  }

  if (!GOOGLE_API_KEY) {
    trace.finalSource = "none";
    logStoreResolutionAudit(trace);
    return null;
  }

  const attempts = buildResolverQueryAttempts(raw, cleaned);
  let placeResult = null;
  for (const q of attempts) {
    console.log("[AUDIT] Resolver loop attempt query:", JSON.stringify(q));
    const r = await fetchGooglePlaceResult(
      q,
      GOOGLE_API_KEY,
      trace,
      options.selectedRegions || ["south_africa"]
    );
    if (!r) continue;
    if (r.resolutionStatus === "not_found") continue;
    if (r.resolutionStatus === "wrong_region") continue;
    placeResult = r;
    break;
  }

  if (!placeResult) {
    trace.finalSource = "none";
    trace.finalAddress = null;
    try {
      await writeNegativeResolverCache(raw);
    } catch (e) {
      console.error("writeNegativeResolverCache:", e);
    }
    if (memKey) __resolverMemoryCache.set(memKey, { negative: true });
    logStoreResolutionAudit(trace);
    return null;
  }

  const loc =
    placeResult.geometry && placeResult.geometry.location
      ? placeResult.geometry.location
      : null;

  const latNum = loc && loc.lat != null ? Number(loc.lat) : NaN;
  const lngNum = loc && loc.lng != null ? Number(loc.lng) : NaN;
  let lat = Number.isFinite(latNum) ? latNum : null;
  let lng = Number.isFinite(lngNum) ? lngNum : null;

  const address =
    typeof placeResult.canonicalAddress === "string"
      ? placeResult.canonicalAddress.trim()
      : typeof placeResult.formatted_address === "string"
        ? placeResult.formatted_address.trim()
        : "";

  if (!address) {
    trace.finalSource = "none";
    try {
      await writeNegativeResolverCache(raw);
    } catch (e) {
      console.error("writeNegativeResolverCache:", e);
    }
    if (memKey) __resolverMemoryCache.set(memKey, { negative: true });
    logStoreResolutionAudit(trace);
    return null;
  }

  if (lat == null || lng == null) {
    console.log(
      "[AUDIT] Fallback triggered: missing lat/lng from Place Details; using Geocoding API"
    );
    console.log(
      "[AUDIT] Fallback query (geocode address):",
      JSON.stringify(placeResult.googleFormattedAddress || address)
    );
    console.log("[AUDIT] API used: google_geocoding");
    const geo = await geocodeLatLngFromAddress(
      placeResult.googleFormattedAddress || address,
      GOOGLE_API_KEY
    );
    if (geo.lat != null && geo.lng != null) {
      lat = geo.lat;
      lng = geo.lng;
    }
  }

  const suburb =
    typeof placeResult.suburb === "string" ? placeResult.suburb : "";
  const city = typeof placeResult.city === "string" ? placeResult.city : "";
  const province =
    typeof placeResult.province === "string" ? placeResult.province : "";
  const displayCustomer =
    (typeof placeResult.customerName === "string" &&
      placeResult.customerName.trim()) ||
    raw;
  const placeId =
    placeResult.place_id != null ? String(placeResult.place_id) : null;
  const googleFormattedAddress =
    typeof placeResult.googleFormattedAddress === "string"
      ? placeResult.googleFormattedAddress.trim()
      : "";

  const safeCanonical = canonical || raw;

  trace.finalSource = "google_places";
  trace.finalAddress = address;

  const ref =
    existingRef || db().collection(STORE_LOCATIONS).doc(safeCanonical);
  const payload = {
    customer: displayCustomer,
    canonicalName: safeCanonical,
    address,
    suburb: suburb || "",
    city: city || "",
    province: province || "",
    lat,
    lng,
    source: "google_places",
    updatedAt: Date.now(),
    placeId,
    googleFormattedAddress
  };

  await ref.set(payload, { merge: true });

  try {
    await writeStoreResolutionCache({
      customer: raw,
      address,
      suburb: suburb || "",
      city: city || "",
      province: province || "",
      lat,
      lng,
      canonicalName: safeCanonical,
      source: "google_places",
      placeId,
      googleFormattedAddress
    });
  } catch (e) {
    console.error("STORE RESOLUTION CACHE WRITE FAILED:", e);
  }

  const ret = {
    ...payload,
    _resolverInputRaw: raw,
    _resolved: true,
    resolutionStatus: "ok_places",
    _storeLocationId: ref.id
  };

  logStoreResolutionAudit(trace);
  return ret;
}

/**
 * Address-only resolver for a single route.
 * Wraps the ClearTrack-style storeName → structured resolver and adds _resolved / resolutionStatus.
 */
async function resolveStore(route, options = {}) {
  console.log("🔥 GOOGLE KEY ACTIVE:", GOOGLE_API_KEY ? "YES" : "NO");
  let raw =
    (route && (route.customer || route.name || route.address || "")) || "";

  console.log(
    "[AUDIT] Before resolveStore route strip:",
    JSON.stringify(String(raw))
  );
  raw = String(raw)
    .replace(/\(.*?\)/g, "") // remove (CL9)
    .replace(/\s*-\s*.*$/, "") // remove "- G770/167701"
    .trim();

  const rawName = raw;
  console.log(
    "[AUDIT] After resolveStore route strip:",
    JSON.stringify(rawName)
  );

  if (!rawName) {
    return {
      id: route && route.id,
      customer: "",
      address: route && route.address != null ? String(route.address) : "",
      suburb: (route && route.suburb) || "",
      city: (route && route.city) || "",
      province: (route && route.province) || "",
      lat: route && route.lat != null ? route.lat : null,
      lng: route && route.lng != null ? route.lng : null,
      _resolved: false,
      resolutionStatus: "no_input",
    };
  }

  console.log("➡️ START", rawName);

  const base = await resolveStoreName(rawName, options);

  if (!base) {
    return {
      id: route && route.id,
      customer: rawName,
      address: route && route.address != null ? String(route.address) : "",
      suburb: (route && route.suburb) || "",
      city: (route && route.city) || "",
      province: (route && route.province) || "",
      lat: null,
      lng: null,
      _resolved: false,
      resolutionStatus: "needs_attention",
    };
  }

  return {
    ...base,
    id: route && route.id
  };
}

/**
 * Resolves each route via resolveStore; merges resolver output onto the original route.
 */
async function resolveStoreAddresses(routes, options = {}) {
  const list = Array.isArray(routes) ? routes : [];
  const results = [];

  for (let i = 0; i < list.length; i++) {
    const route = list[i];
    const resolved = await resolveStore(route, options);

    results.push({
      ...route,
      ...resolved,
      _routeId: route._routeId ?? route.id ?? i ?? null
    });
  }

  return results;
}

module.exports = {
  GOOGLE_API_KEY,
  resolveStore,
  resolveStoreAddresses,
  resolveStoreName,
  postProcessGooglePlaceResult,
  buildStructuredSaAddressFromComponents,
  buildAddress,
  rebuildAddressFromRoute,
  finalizeRoutesForUi,
  validateFormattedAddress,
  getComponent,
  METRO_MAP,
  STORE_LOCATIONS,
  STORE_RESOLUTION_COLLECTION,
  API_CACHE_STORE_RESOLUTION,
  normalizeStoreQuery,
  normalizeResolverCacheKey,
  aliasFieldsForCacheWrite,
  cleanStoreName,
  buildResolverQueryAttempts,
  runWithConcurrency
};
