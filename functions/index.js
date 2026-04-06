// resolver-query-v2 (force redeploy)
const crypto = require("crypto");
const { onRequest, onCall, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { defineSecret } = require("firebase-functions/params");
const express = require("express");
const admin = require("firebase-admin");
const { FieldValue } = require("firebase-admin/firestore");
let app;
try {
  app = require("./src/index");
} catch (err) {
  console.error("🔥 src/index FAILED TO LOAD:", err.message);
}
const { handlePaymentWebhook } = require("./src/paymentWebhook");
const { handleAdminDashboardApi } = require("./src/adminDashboardApi");
const { endDateValueToISOString } = require("./src/adBookingHelpers");
const { sendGridEmail, SENDGRID_API_KEY } = require("./src/email");

if (!admin.apps.length) {
  admin.initializeApp();
}

const payfastPassphrase = defineSecret("PAYFAST_PASSPHRASE");
const LOGBOOK_TEMPLATE_ID = "d-b4f86a57a18a4be083f9eb8700162203";

exports.api = onRequest(app);

const paymentWebhookApp = express();
paymentWebhookApp.use(express.urlencoded({ extended: true }));
paymentWebhookApp.use(express.json());
paymentWebhookApp.post("/", handlePaymentWebhook);
exports.handlePaymentWebhook = onRequest(
  { secrets: [payfastPassphrase] },
  paymentWebhookApp
);

const adminApiApp = express();
adminApiApp.use(express.json());
adminApiApp.all("*", handleAdminDashboardApi);
exports.adminDashboardApi = onRequest(
  { secrets: [SENDGRID_API_KEY] },
  adminApiApp
);

async function getLogbookPricing() {
  const doc = await admin.firestore().collection("pricing").doc("default").get();
  if (!doc.exists) {
    throw new Error("Pricing not configured");
  }
  const data = doc.data() || {};
  return {
    price: data?.tools?.logbook?.price,
    tokens: data?.tools?.logbook?.tokensIncluded,
  };
}

async function getLogbookTokensSafe() {
  try {
    const pricing = await getLogbookPricing();
    const n = Number(pricing && pricing.tokens);
    return Number.isFinite(n) && n > 0 ? n : 1;
  } catch (_err) {
    return 1;
  }
}

function parsePositiveInteger(value) {
  const n = parseInt(String(value == null ? "" : value).trim(), 10);
  return Number.isInteger(n) && n >= 1 ? n : null;
}

function generateSignature(data, passphrase = "") {
  const payload = { ...(data && typeof data === "object" ? data : {}) };
  delete payload.signature;

  const sortedKeys = Object.keys(payload).sort();

  let queryString = sortedKeys
    .map(
      (key) =>
        `${key}=${encodeURIComponent(String(payload[key] ?? "")).replace(/%20/g, "+")}`
    )
    .join("&");

  if (passphrase) {
    queryString += `&passphrase=${encodeURIComponent(passphrase).replace(/%20/g, "+")}`;
  }

  return crypto.createHash("md5").update(queryString).digest("hex");
}

function expiresAtToMs(v) {
  if (v == null) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "object" && typeof v.toMillis === "function") return v.toMillis();
  if (typeof v === "object" && typeof v.toDate === "function") return v.toDate().getTime();
  return null;
}

exports.payfastNotify = onRequest(
  {
    region: "us-central1",
    secrets: [SENDGRID_API_KEY],
  },
  async (req, res) => {
    res.status(200).send("OK");
    processPayfastPayment(req.body).catch(console.error);
  }
);

async function processPayfastPayment(body) {
  console.log("PAYFAST BODY:", body);

  if (!body || body.payment_status !== "COMPLETE") {
    console.log("IGNORED PAYMENT:", body?.payment_status);
    return;
  }

  const m_payment_id = String(body.m_payment_id || "").trim();
  if (!m_payment_id) {
    console.error("MISSING PAYMENT ID", body);
    return;
  }

  if (body.payment_status !== "COMPLETE") {
    console.log("PAYMENT NOT COMPLETE:", body.payment_status);
    return;
  }

  const isAdPayment = String(body.custom_str2 || "").toLowerCase() === "ad";

  if (isAdPayment) {
    const adRef = admin.firestore().collection("sponsoredTools").doc(m_payment_id);
    const adSnap = await adRef.get();
    if (!adSnap.exists) {
      console.error("AD NOT FOUND FOR PAYMENT", m_payment_id);
      return;
    }
    const adData = adSnap.data() || {};
    const monthsRaw = String(body.custom_str1 || "").trim();
    let months = parseInt(monthsRaw, 10);
    if (!months || months < 1) {
      months = 1;
    }
    const now = Date.now();
    const expMs = expiresAtToMs(adData.expiresAt);
    if (
      String(adData.status || "").toLowerCase() === "live" &&
      expMs != null &&
      expMs > now
    ) {
      console.log("AD ALREADY ACTIVE, IGNORING PAYMENT");
      return;
    }
    if (String(adData.status || "").toLowerCase() !== "approved") {
      console.log("PAYMENT NOT COMPLETE OR AD NOT ELIGIBLE", adData.status);
      return;
    }
    const expiry = now + months * 30 * 24 * 60 * 60 * 1000;
    await adRef.update({
      status: "live",
      paidAt: now,
      monthsPurchased: months,
      expiresAt: expiry,
    });
    console.log("AD ACTIVATED:", {
      id: m_payment_id,
      months,
      expiresAt: expiry,
    });
    return;
  }

  const candidateEmails = [
    body.email_address,
    body.email,
    body.custom_str1,
  ].map((v) => String(v || "").trim()).filter(Boolean);
  const email = candidateEmails.find((v) => v.includes("@"));

  if (!email) {
    console.error("NO EMAIL FOUND");
    return;
  }

  await admin.firestore()
    .collection("logbook_tokens")
    .doc(m_payment_id)
    .set({
      remaining: 3,
      createdAt: Date.now()
    });
  const download_url = `https://autologbooksa.co.za/logbook.html?token=${encodeURIComponent(m_payment_id)}`;
  console.log("FINAL EMAIL LINK:", download_url);

  if (!download_url || !download_url.includes("?token=") || !m_payment_id) {
    console.error("MISSING DOWNLOAD URL", { body });
  }

  console.log("EMAIL DEBUG:", {
    to: email,
    download_url,
  });

  console.log("SENDING EMAIL TO:", email);

  await sendGridEmail({
    to: email,
    templateId: LOGBOOK_TEMPLATE_ID,
    dynamicTemplateData: {
      download_url: download_url,
      year: new Date().getFullYear(),
    },
  });

  console.log("EMAIL SENT SUCCESSFULLY");
}

/** Read-only: generations remaining. Consumption happens in POST /api/generateLogbook only. */
exports.useLogbookToken = onRequest({
  region: "us-central1",
  cors: true,
  invoker: "public"
}, async (req, res) => {
  const token = String(req.query.token || "").trim();

  if (!token) {
    return res.status(400).send("Missing token");
  }

  const ref = admin.firestore().collection("logbook_tokens").doc(token);

  try {
    const doc = await ref.get();

    if (!doc.exists) {
      return res.status(403).send("Invalid token");
    }

    const data = doc.data() || {};
    const remaining =
      typeof data.remaining === "number" && Number.isFinite(data.remaining)
        ? data.remaining
        : 3;

    if (remaining <= 0) {
      return res.status(403).send("Token already used");
    }

    return res.status(200).json({ remaining });
  } catch (err) {
    console.error("useLogbookToken:", err);
    return res.status(500).send("Token error");
  }
});

exports.validateToken = onRequest({
  region: "us-central1",
  cors: true,
  invoker: "public"
}, async (req, res) => {
  const token = req.query.token;

  if (!token) {
    return res.status(400).send("Missing token");
  }

  const doc = await admin.firestore()
    .collection("logbook_tokens")
    .doc(token)
    .get();

  if (!doc.exists) {
    return res.status(403).send("Invalid token");
  }

  const data = doc.data() || {};
  const remaining =
    typeof data.remaining === "number" && Number.isFinite(data.remaining)
      ? data.remaining
      : 3;

  return res.status(200).json({ valid: true, remaining });
});

exports.checkAndConsumeToken = onCall(
  {
    region: "us-central1",
    cors: true,
    invoker: "public",
  },
  async (request) => {
    const paymentId = request?.data?.paymentId
      ? String(request.data.paymentId).trim()
      : "";
    if (!paymentId) {
      return { ok: false };
    }

    const ref = admin.firestore().collection("logbookPayments").doc(paymentId);

    await admin.firestore().runTransaction(async (tx) => {
      const doc = await tx.get(ref);
      if (!doc.exists) {
        throw new HttpsError("not-found", "Invalid payment");
      }
      const data = doc.data() || {};
      if (data.status !== "paid") {
        throw new HttpsError("failed-precondition", "Invalid payment");
      }
      const used = Number(data.used || 0);
      const tokens = Number(data.tokens || 0);
      if (used >= tokens) {
        throw new HttpsError("resource-exhausted", "NO_TOKENS");
      }
      tx.update(ref, { used: used + 1 });
    });

    return { ok: true };
  }
);

exports.expireAds = onSchedule(
  {
    schedule: "every day 01:00",
    timeZone: "Africa/Johannesburg",
    region: "us-central1",
  },
  async () => {
    const db = admin.firestore();
    const snap = await db.collection("sponsoredTools").where("status", "==", "live").get();
    const nowIso = new Date().toISOString();
    let batch = db.batch();
    let n = 0;
    for (const doc of snap.docs) {
      const d = doc.data() || {};
      const expMs = expiresAtToMs(d.expiresAt);
      if (expMs != null) {
        if (expMs > Date.now()) continue;
        batch.update(doc.ref, { status: "expired" });
        n += 1;
        if (n >= 450) {
          await batch.commit();
          batch = db.batch();
          n = 0;
        }
        continue;
      }
      const endIso = endDateValueToISOString(d.endDate);
      if (!endIso || endIso >= nowIso) continue;
      batch.update(doc.ref, { status: "expired" });
      n += 1;
      if (n >= 450) {
        await batch.commit();
        batch = db.batch();
        n = 0;
      }
    }
    if (n > 0) {
      await batch.commit();
    }
  }
);

function cleanedCanonicalPreview(input) {
  if (!input) return "";

  let str = input.toLowerCase();

  // remove everything after " -"
  str = str.split(" -")[0];

  // remove bracketed codes (e.g. (CL9))
  str = str.replace(/\(.*?\)/g, "");

  // remove standalone numbers
  str = str.replace(/\b\d+\b/g, "");

  // replace non-letters with space (keep words)
  str = str.replace(/[^a-z\s]/g, " ");

  // collapse multiple spaces
  str = str.replace(/\s+/g, " ").trim();

  return str;
}

/** Single coordinate: never trust type from API/Firestore/client; invalid → null. */
function normalizeCoord(value) {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeLatLngPair(lat, lng) {
  return { lat: normalizeCoord(lat), lng: normalizeCoord(lng) };
}

/** Ensure route.lat/lng and route.original.lat/lng are numbers or null before JSON to UI. */
function normalizeRouteCoordsDeep(route) {
  if (!route || typeof route !== "object") return route;
  const out = { ...route };
  const main = normalizeLatLngPair(out.lat, out.lng);
  out.lat = main.lat;
  out.lng = main.lng;
  if (out.original && typeof out.original === "object") {
    const o = { ...out.original };
    const op = normalizeLatLngPair(o.lat, o.lng);
    o.lat = op.lat;
    o.lng = op.lng;
    out.original = o;
  }
  return out;
}

/** Hard validation before canonicalization / resolver. */
function validateRoutesInput(routes) {
  if (!Array.isArray(routes)) {
    console.warn("invalid route input", { index: null, route: routes });
    return { ok: false, body: { error: "invalid_route", message: "routes must be an array" } };
  }
  for (let i = 0; i < routes.length; i++) {
    const route = routes[i];
    if (route == null || typeof route !== "object" || Array.isArray(route)) {
      console.warn("invalid route input", { index: i, route });
      return {
        ok: false,
        body: { error: "invalid_route", index: i, message: "route must be a non-null object" },
      };
    }
    if (typeof route.customer !== "string" || route.customer.trim().length === 0) {
      console.warn("invalid route input", { index: i, route });
      return { ok: false, body: { error: "invalid_route", index: i, message: "customer is required" } };
    }
  }
  return { ok: true };
}

function warnDuplicateCanonicalsInBatch(routes) {
  const map = new Map();
  for (let i = 0; i < routes.length; i++) {
    const k = cleanedCanonicalPreview(routes[i].customer || "");
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(i);
  }
  for (const [canonicalName, indexes] of map) {
    if (indexes.length > 1) {
      console.warn("duplicate canonicalName in batch", canonicalName, indexes);
    }
  }
}

async function getStoreFromCache(db, canonicalName) {
  if (!canonicalName) return null;

  const doc = await db.collection("storeLocations").doc(canonicalName).get();

  if (!doc.exists) return null;

  return doc.data();
}

async function findSimilarStore(db, canonicalName) {
  if (!canonicalName) return null;

  const prefix = canonicalName.split(" ")[0];

  const snapshot = await db
    .collection("storeLocations")
    .where("canonicalName", ">=", prefix)
    .where("canonicalName", "<=", prefix + "\uf8ff")
    .limit(20)
    .get();

  const target = canonicalName.trim();

  for (const doc of snapshot.docs) {
    const existing = (doc.id || "").trim();

    if (
      existing === target ||
      existing.startsWith(target) ||
      target.startsWith(existing)
    ) {
      return { id: doc.id, data: doc.data() };
    }
  }

  return null;
}

/** Shared resolver path used by resolveStores and processRoutelistUpload (writes storeLocations on success). */
async function runResolveStoresPipeline(route, db, API_KEY) {
  const raw = route.customer || "";
  const cleaned = cleanedCanonicalPreview(raw);
  const canonical = route.canonicalName || cleanedCanonicalPreview(route.customer || "");
  const cached = await getStoreFromCache(db, canonical);

  console.log("🔥 MATCH RESULT:", {
    input: canonical,
    found: !!cached,
    matchedName: cached?.canonicalName || null
  });

  if (cached && cached.lat && cached.lng) {
    console.log("CACHE HIT:", canonical);
    return normalizeRouteCoordsDeep({
      ...route,
      canonicalName: canonical,
      address: cached.address,
      suburb: cached.suburb,
      city: cached.city,
      lat: cached.lat,
      lng: cached.lng,
      province: cached.province,
      source: "cache",
    });
  }

  console.log("CACHE MISS:", canonical);

  const similarStore = await findSimilarStore(db, canonical);

  if (similarStore) {
    console.log("♻️ REUSING EXISTING STORE:", similarStore.id);

    return normalizeRouteCoordsDeep({
      ...route,
      canonicalName: similarStore.id,
      ...similarStore.data,
    });
  }

  const query = `${cleaned} south africa`;

  console.log("🔍 QUERY:", query);

  const url = `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=${encodeURIComponent(query)}&inputtype=textquery&fields=formatted_address,geometry,place_id&key=${API_KEY}`;

  const response = await fetch(url);
  const data = await response.json();

  let result;

  if (data.status === "OK" && data.candidates && data.candidates.length > 0) {
    const place = data.candidates[0];

    console.log("🔥 PLACE FOUND:", place.place_id);

    const detailsUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${place.place_id}&fields=address_components&key=${API_KEY}`;

    const detailsRes = await fetch(detailsUrl);
    const detailsData = await detailsRes.json();

    console.log("🔥 DETAILS RESPONSE:", JSON.stringify(detailsData));

    const components = detailsData.result?.address_components || [];

    console.log("🔥 COMPONENTS:", components);

    function getComponent(type) {
      const comp = components.find((c) => c.types.includes(type));
      return comp ? comp.long_name : "";
    }

    function getComponentEntry(type) {
      const comp = components.find((c) => c.types.includes(type));
      return comp || null;
    }

    let suburb = "";
    let suburbType = null;
    for (const type of ["sublocality_level_1", "sublocality", "neighborhood", "premise", "route"]) {
      const comp = getComponentEntry(type);
      if (comp) {
        suburb = comp.long_name;
        suburbType = comp.types;
        break;
      }
    }

    if (!suburb && place.formatted_address) {
      const parts = place.formatted_address.split(",");

      const firstPart = parts[0].trim();
      const tokens = firstPart.split(" ");

      if (tokens.length > 2) {
        suburb = tokens.slice(-3).join(" ");
      }
    }

    const city = getComponent("locality") || getComponent("administrative_area_level_2") || "";

    if (suburbType && suburbType.includes("route")) {
      suburb = city;
    }

    const province = getComponent("administrative_area_level_1") || "";

    console.log("🔥 EXTRACTED:", {
      suburb,
      city,
      province
    });

    const address = place.formatted_address || "";
    const rawLat = place.geometry && place.geometry.location ? place.geometry.location.lat : null;
    const rawLng = place.geometry && place.geometry.location ? place.geometry.location.lng : null;
    const { lat, lng } = normalizeLatLngPair(rawLat, rawLng);

    result = {
      customer: route.customer,
      canonicalName: cleaned,
      address,
      suburb: suburb,
      city: city,
      province: province,
      lat,
      lng,
      placeId: place.place_id,
      createdAt: Date.now()
    };

    const existingQuery = await db
      .collection("storeLocations")
      .where("canonicalName", "==", result.canonicalName)
      .limit(1)
      .get();

    const matchedStore = existingQuery.empty ? null : existingQuery.docs[0].data();
    console.log("🔥 MATCH RESULT:", {
      input: result.canonicalName,
      found: !!matchedStore,
      matchedName: matchedStore?.canonicalName || null
    });

    if (!existingQuery.empty) {
      const docId = existingQuery.docs[0].id;

      await db.collection("storeLocations").doc(docId).update(result);

      console.log("♻️ UPDATED EXISTING STORE:", result.canonicalName);
    } else {
      await db.collection("storeLocations").doc(result.canonicalName).set(result, { merge: true });

      console.log("🆕 CREATED NEW STORE:", result.canonicalName);
    }
  } else {
    result = {
      customer: route.customer,
      canonicalName: cleaned,
      address: "",
      suburb: "",
      city: "",
      province: "",
      lat: null,
      lng: null,
      createdAt: Date.now(),
      failed: true
    };
  }

  console.log("🔥 FINAL RESULT:", result);

  return normalizeRouteCoordsDeep(result);
}

exports.runResolveStoresPipeline = runResolveStoresPipeline;
exports.cleanedCanonicalPreview = cleanedCanonicalPreview;

exports.resolveStores = onRequest(
  { cors: true, region: "us-central1", invoker: "public" },
  async (req, res) => {
    try {
      if (req.method === "OPTIONS") return res.status(204).send("");
      if (req.method !== "POST") {
        return res.status(405).json({ error: "POST only" });
      }

      const routes = (req.body && req.body.routes) || [];
      const v = validateRoutesInput(routes);
      if (!v.ok) {
        return res.status(400).json(v.body);
      }
      warnDuplicateCanonicalsInBatch(routes);

      const API_KEY = process.env.GOOGLE_API_KEY;
      const db = admin.firestore();

      const results = [];

      for (let i = 0; i < routes.length; i++) {
        const result = await runResolveStoresPipeline(routes[i], db, API_KEY);
        results.push(result);
      }

      return res.status(200).json(results);

    } catch (err) {
      console.error("🔥 ERROR:", err);
      return res.status(500).json({ error: "resolver_failed" });
    }
  }
);

function mergeParserRouteWithStoreRow(route, storeRow) {
  const ll = normalizeLatLngPair(storeRow.lat, storeRow.lng);
  return {
    ...route,
    address: storeRow.address,
    suburb: storeRow.suburb != null ? storeRow.suburb : "",
    city: storeRow.city != null ? storeRow.city : "",
    province: storeRow.province != null ? storeRow.province : "",
    lat: ll.lat,
    lng: ll.lng,
    canonicalName: storeRow.canonicalName,
    placeId: storeRow.placeId,
    createdAt: storeRow.createdAt,
    failed: storeRow.failed === true,
    resolutionStatus: storeRow.failed === true ? "needs_attention" : "ok",
    _resolved: storeRow.failed !== true
  };
}

function wrapPreviewRouteForUi(merged) {
  const ll = normalizeLatLngPair(merged.lat, merged.lng);
  const original = {
    address: merged.address != null ? String(merged.address) : "",
    suburb: merged.suburb != null ? String(merged.suburb) : "",
    city: merged.city != null ? String(merged.city) : "",
    province: merged.province != null ? String(merged.province) : "",
    lat: ll.lat,
    lng: ll.lng
  };
  return {
    ...merged,
    lat: ll.lat,
    lng: ll.lng,
    original,
    edited: false,
    processed: false
  };
}

/**
 * Same per-route store resolution as processRoutelistUpload: existing canonicalName query or runResolveStoresPipeline({ customer }).
 * Returns raw storeRow objects (Firestore data or resolver output), same order as routes.
 */
async function processRoutelistUploadInternal(routes, db, API_KEY) {
  const out = [];
  for (let i = 0; i < routes.length; i++) {
    const route = routes[i];
    const cleaned = cleanedCanonicalPreview(route.customer || "");

    const existingQuery = await db
      .collection("storeLocations")
      .where("canonicalName", "==", cleaned)
      .limit(1)
      .get();

    console.log("🔥 MATCH RESULT:", {
      input: cleaned,
      found: !existingQuery.empty,
      matchedName: !existingQuery.empty ? (existingQuery.docs[0].data()?.canonicalName ?? null) : null
    });

    let storeRow;
    if (!existingQuery.empty) {
      storeRow = existingQuery.docs[0].data();
    } else {
      storeRow = await runResolveStoresPipeline({ customer: route.customer }, db, API_KEY);
    }
    out.push(storeRow);
  }
  return out;
}

exports.processRoutelistUploadInternal = processRoutelistUploadInternal;

/** Excel / parser upload: DB lookup, resolve only missing stores, return full preview rows (order preserved). */
exports.processRoutelistUpload = onRequest(
  { cors: true, region: "us-central1", invoker: "public" },
  async (req, res) => {
    try {
      if (req.method === "OPTIONS") return res.status(204).send("");
      if (req.method !== "POST") {
        return res.status(405).json({ error: "POST only" });
      }

      const routes = req.body && req.body.routes;
      const v = validateRoutesInput(routes);
      if (!v.ok) {
        return res.status(400).json(v.body);
      }
      if (routes.length === 0) {
        return res.status(400).json({ error: "routes required" });
      }

      warnDuplicateCanonicalsInBatch(routes);

      const API_KEY = process.env.GOOGLE_API_KEY;
      if (!API_KEY) {
        return res.status(500).json({ error: "missing_api_key" });
      }

      const db = admin.firestore();
      const out = [];

      for (let i = 0; i < routes.length; i++) {
        const route = routes[i];
        const cleaned = cleanedCanonicalPreview(route.customer || "");

        const existingQuery = await db
          .collection("storeLocations")
          .where("canonicalName", "==", cleaned)
          .limit(1)
          .get();

        console.log("🔥 MATCH RESULT:", {
          input: cleaned,
          found: !existingQuery.empty,
          matchedName: !existingQuery.empty ? (existingQuery.docs[0].data()?.canonicalName ?? null) : null
        });

        let storeRow;
        if (!existingQuery.empty) {
          storeRow = existingQuery.docs[0].data();
        } else {
          storeRow = await runResolveStoresPipeline({ customer: route.customer }, db, API_KEY);
        }

        const merged = mergeParserRouteWithStoreRow(route, storeRow);
        out.push(normalizeRouteCoordsDeep(wrapPreviewRouteForUi(merged)));
      }

      return res.status(200).json({ routes: out });
    } catch (err) {
      console.error("processRoutelistUpload:", err);
      return res.status(500).json({ error: "process_routelist_upload_failed" });
    }
  }
);

function computeRouteEditedPreview(r, original) {
  const o = original || {};
  return ["address", "suburb", "city", "province"].some(
    (f) => String(r[f] ?? "").trim() !== String(o[f] ?? "").trim()
  );
}

function needsReprocessServer(route) {
  const o = route.original && typeof route.original === "object" ? route.original : {};
  const edited = computeRouteEditedPreview(
    {
      address: route.address,
      suburb: route.suburb,
      city: route.city,
      province: route.province,
    },
    o
  );
  if (edited) return true;
  if (normalizeCoord(route.lat) == null || normalizeCoord(route.lng) == null) return true;
  if (!(route.address || "").toString().trim()) return true;
  return false;
}

async function geocodePreviewRoute(route, API_KEY) {
  const cleaned = route.canonicalName || cleanedCanonicalPreview(route.customer || "");
  const origLLFromRoute = normalizeLatLngPair(route.lat, route.lng);
  const original =
    route.original && typeof route.original === "object"
      ? {
          address: route.original.address != null ? String(route.original.address) : "",
          suburb: route.original.suburb != null ? String(route.original.suburb) : "",
          city: route.original.city != null ? String(route.original.city) : "",
          province: route.original.province != null ? String(route.original.province) : "",
          ...normalizeLatLngPair(route.original.lat, route.original.lng),
        }
      : {
          address: route.address != null ? String(route.address) : "",
          suburb: route.suburb != null ? String(route.suburb) : "",
          city: route.city != null ? String(route.city) : "",
          province: route.province != null ? String(route.province) : "",
          ...origLLFromRoute,
        };

  const hasCoords = origLLFromRoute.lat != null && origLLFromRoute.lng != null;
  const hasStreet = (route.address || "").toString().trim().length > 0;
  const hasCity = (route.city || "").toString().trim().length > 0;
  const editedComputed = computeRouteEditedPreview(
    { address: route.address, suburb: route.suburb, city: route.city, province: route.province },
    original
  );
  if (hasCoords && hasStreet && hasCity && !editedComputed) {
    return normalizeRouteCoordsDeep({
      ...route,
      lat: origLLFromRoute.lat,
      lng: origLLFromRoute.lng,
      canonicalName: cleaned,
      original,
      edited: false,
      processed: true,
      _resolved: true,
      resolutionStatus: route.resolutionStatus || "ok",
      failed: false,
    });
  }

  const parts = [route.address, route.suburb, route.city, route.province, "South Africa"]
    .filter((x) => x && String(x).trim())
    .join(", ");
  const queryInput = parts.trim() || `${cleaned} south africa`;

  const url = `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=${encodeURIComponent(queryInput)}&inputtype=textquery&fields=formatted_address,geometry,place_id&key=${API_KEY}`;

  const response = await fetch(url);
  const data = await response.json();

  if (data.status === "OK" && data.candidates && data.candidates.length > 0) {
    const place = data.candidates[0];

    const detailsUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${place.place_id}&fields=address_components&key=${API_KEY}`;

    const detailsRes = await fetch(detailsUrl);
    const detailsData = await detailsRes.json();

    const components = detailsData.result?.address_components || [];

    function getComponent(type) {
      const comp = components.find((c) => c.types.includes(type));
      return comp ? comp.long_name : "";
    }

    function getComponentEntry(type) {
      const comp = components.find((c) => c.types.includes(type));
      return comp || null;
    }

    let suburb = "";
    let suburbType = null;
    for (const type of ["sublocality_level_1", "sublocality", "neighborhood", "premise", "route"]) {
      const comp = getComponentEntry(type);
      if (comp) {
        suburb = comp.long_name;
        suburbType = comp.types;
        break;
      }
    }

    if (!suburb && place.formatted_address) {
      const addrParts = place.formatted_address.split(",");
      const firstPart = addrParts[0].trim();
      const tokens = firstPart.split(" ");
      if (tokens.length > 2) {
        suburb = tokens.slice(-3).join(" ");
      }
    }

    const city = getComponent("locality") || getComponent("administrative_area_level_2") || "";

    if (suburbType && suburbType.includes("route")) {
      suburb = city;
    }

    const province = getComponent("administrative_area_level_1") || "";

    const address = place.formatted_address || "";
    const rawLat = place.geometry && place.geometry.location ? place.geometry.location.lat : null;
    const rawLng = place.geometry && place.geometry.location ? place.geometry.location.lng : null;
    const { lat, lng } = normalizeLatLngPair(rawLat, rawLng);

    const merged = {
      customer: route.customer,
      canonicalName: cleaned,
      address,
      suburb,
      city,
      province,
      lat,
      lng,
      placeId: place.place_id,
      original,
      edited: computeRouteEditedPreview(
        { address, suburb, city, province, lat, lng },
        original
      ),
      processed: true,
      _resolved: true,
      resolutionStatus: "ok",
      failed: false,
    };
    return normalizeRouteCoordsDeep(merged);
  }

  const failLL = normalizeLatLngPair(route.lat, route.lng);
  return normalizeRouteCoordsDeep({
    customer: route.customer,
    canonicalName: cleaned,
    address: route.address != null ? String(route.address) : "",
    suburb: route.suburb != null ? String(route.suburb) : "",
    city: route.city != null ? String(route.city) : "",
    province: route.province != null ? String(route.province) : "",
    lat: failLL.lat,
    lng: failLL.lng,
    original,
    edited: computeRouteEditedPreview(route, original),
    processed: true,
    failed: true,
    resolutionStatus: "needs_attention",
    _resolved: false,
  });
}

exports.reprocessPreviewRoutes = onRequest(
  { cors: true, region: "us-central1", invoker: "public" },
  async (req, res) => {
    try {
      if (req.method === "OPTIONS") return res.status(204).send("");
      if (req.method !== "POST") {
        return res.status(405).json({ error: "POST only" });
      }

      const API_KEY = process.env.GOOGLE_API_KEY;
      if (!API_KEY) {
        return res.status(500).json({ error: "missing_api_key" });
      }

      const body = req.body || {};
      const fullRoutes = body.routes;
      const v = validateRoutesInput(fullRoutes);
      if (!v.ok) {
        return res.status(400).json(v.body);
      }
      if (!fullRoutes.length) {
        return res.status(400).json({ error: "routes required" });
      }

      warnDuplicateCanonicalsInBatch(fullRoutes);

      const db = admin.firestore();

      const merged = [];
      for (let i = 0; i < fullRoutes.length; i++) {
        const inputRow = fullRoutes[i];
        const base = { ...fullRoutes[i] };
        let updated;
        if (needsReprocessServer(base)) {
          updated = await geocodePreviewRoute(base, API_KEY);
        } else {
          const k = cleanedCanonicalPreview(base.customer || "");
          base.canonicalName = k;
          base.processed = true;
          base._resolved = base._resolved !== false;
          base.resolutionStatus = base.resolutionStatus || "ok";
          updated = normalizeRouteCoordsDeep(base);
        }

        const hasChanged =
          inputRow.address !== updated.address ||
          inputRow.city !== updated.city ||
          inputRow.lat !== updated.lat ||
          inputRow.lng !== updated.lng;

        if (hasChanged) {
          merged.push({
            ...updated,
            original: inputRow,
            status: "pending",
          });
        }
      }

      const mergedOut = merged.map(normalizeRouteCoordsDeep);

      const submissionRoutes = mergedOut.map((r) => {
        const o =
          r.original && typeof r.original === "object"
            ? {
                address: r.original.address != null ? String(r.original.address) : "",
                suburb: r.original.suburb != null ? String(r.original.suburb) : "",
                city: r.original.city != null ? String(r.original.city) : "",
                province: r.original.province != null ? String(r.original.province) : "",
                ...normalizeLatLngPair(r.original.lat, r.original.lng),
              }
            : {
                address: "",
                suburb: "",
                city: "",
                province: "",
                lat: null,
                lng: null,
              };
        const ll = normalizeLatLngPair(r.lat, r.lng);
        return {
          customer: r.customer,
          canonicalName: r.canonicalName || cleanedCanonicalPreview(r.customer || ""),
          address: r.address,
          suburb: r.suburb,
          city: r.city,
          province: r.province,
          lat: ll.lat,
          lng: ll.lng,
          original: o,
          edited: computeRouteEditedPreview(
            {
              address: r.address,
              suburb: r.suburb,
              city: r.city,
              province: r.province,
            },
            r.original || {}
          ),
        };
      });

      const processedRoutes = mergedOut;

      await db.collection("logbookSubmissions").add({
        routes: processedRoutes,
        status: "pending",
        createdAt: Date.now(),
      });

      console.log("🔥 SAVED SUBMISSION:", processedRoutes.length);

      return res.status(200).json({ routes: mergedOut });
    } catch (err) {
      console.error("reprocessPreviewRoutes:", err);
      return res.status(500).json({ error: "reprocess_failed" });
    }
  }
);

exports.approveLogbookSubmission = onRequest(
  { cors: true, region: "us-central1", invoker: "public" },
  async (req, res) => {
    try {
      if (req.method === "OPTIONS") return res.status(204).send("");
      if (req.method !== "POST") {
        return res.status(405).json({ error: "POST only" });
      }

      const body = req.body || {};
      const submissionId = body.submissionId;

      if (!submissionId) {
        return res.status(400).json({ error: "submissionId required" });
      }

      const db = admin.firestore();

      const docRefSubmission = db.collection("logbookSubmissions").doc(submissionId);
      const docSnap = await docRefSubmission.get();

      if (!docSnap.exists) {
        return res.status(404).json({ error: "submission not found" });
      }

      const data = docSnap.data();

      const routes = data.routes || [];

      for (const route of routes) {
        if (route.status !== "approved") continue;
        if (!route.canonicalName) continue;

        {
          const docRef = db.collection("storeLocations").doc(route.canonicalName);
          await docRef.set(
            {
              canonicalName: route.canonicalName,
              address: route.address,
              suburb: route.suburb,
              city: route.city,
              lat: route.lat,
              lng: route.lng,
              updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true }
          );
        }
      }

      const pendingCount = routes.filter(
        (r) => r && (!r.status || r.status === "pending")
      ).length;
      const approvedCount = routes.filter((r) => r && r.status === "approved").length;
      const rejectedCount = routes.filter((r) => r && r.status === "rejected").length;

      let finalStatus;
      if (pendingCount > 0) {
        finalStatus = "pending";
      } else if (approvedCount > 0 && rejectedCount === 0) {
        finalStatus = "approved";
      } else if (approvedCount === 0 && rejectedCount > 0) {
        finalStatus = "rejected";
      } else if (approvedCount > 0 && rejectedCount > 0) {
        finalStatus = "partial";
      } else {
        finalStatus = "pending";
      }

      await docRefSubmission.update({
        status: finalStatus,
        approvedAt: FieldValue.serverTimestamp(),
      });

      return res.json({ success: true });
    } catch (err) {
      console.error("approveLogbookSubmission:", err);
      return res.status(500).json({ error: "approval_failed" });
    }
  }
);

exports.updateRouteStatus = onRequest(
  { cors: true, region: "us-central1", invoker: "public" },
  async (req, res) => {
    try {
      console.log("updateRouteStatus RAW BODY:", req.body);
      console.log("updateRouteStatus HEADERS:", req.headers && typeof req.headers === "object" ? { ...req.headers } : req.headers);

      if (req.method === "OPTIONS") return res.status(204).send("");
      if (req.method !== "POST") return res.status(405).end();

      const body = req.body || {};
      const { submissionId, routeIndex, status } = body;

      console.log("updateRouteStatus PARSED INPUT:", {
        submissionId,
        routeIndex,
        status,
        routeIndexType: typeof routeIndex,
        statusOk: status === "approved" || status === "rejected",
      });

      if (!submissionId || routeIndex === undefined || !status) {
        console.log("updateRouteStatus EARLY RETURN: invalid_request (missing fields)");
        return res.status(400).json({ error: "invalid_request" });
      }

      const db = admin.firestore();

      const ref = db.collection("logbookSubmissions").doc(submissionId);
      const snap = await ref.get();

      console.log("updateRouteStatus DOC EXISTS:", snap.exists);

      if (!snap.exists) {
        console.log("updateRouteStatus EARLY RETURN: not_found");
        return res.status(404).json({ error: "not_found" });
      }

      const data = snap.data();
      console.log("updateRouteStatus DOC DATA:", JSON.stringify(data, null, 0).slice(0, 2000));
      console.log("updateRouteStatus ROUTES BEFORE:", data.routes);
      console.log("updateRouteStatus TARGET ROUTE:", data.routes != null ? data.routes[routeIndex] : "(no routes)");

      const routes = [...(data.routes || [])];

      if (!routes[routeIndex]) {
        console.log("updateRouteStatus EARLY RETURN: invalid_index", { routeIndex, routesLen: routes.length });
        return res.status(400).json({ error: "invalid_index" });
      }

      routes[routeIndex] = {
        ...routes[routeIndex],
        status,
      };

      console.log("updateRouteStatus NEW ROUTES (preview):", JSON.stringify(routes).slice(0, 2000));
      console.log(
        "updateRouteStatus routes[routeIndex].status after merge:",
        routes[routeIndex] && routes[routeIndex].status
      );

      try {
        await ref.update({ routes });
        console.log("updateRouteStatus FIRESTORE UPDATE SUCCESS");
      } catch (writeErr) {
        console.error("updateRouteStatus FIRESTORE UPDATE FAILED:", writeErr);
        throw writeErr;
      }

      const verifySnap = await ref.get();
      console.log("updateRouteStatus AFTER UPDATE (verify read):", verifySnap.data());

      console.log("UPDATED ROUTE STATUS:", submissionId, routeIndex, status);

      return res.json({ success: true });
    } catch (err) {
      console.error("updateRouteStatus:", err);
      return res.status(500).json({ error: "failed" });
    }
  }
);

// TEMPORARY: remove after one-time role assignment is complete.
exports.setAdminRole = onCall(async (req) => {
  const allowedEmail = "granvillepowell@icloud.com";

  if (!req.auth) {
    throw new Error("Not authenticated");
  }

  if (req.auth.token.email !== allowedEmail) {
    throw new Error("Not authorized");
  }

  const uid = req.auth.uid;
  await admin.auth().setCustomUserClaims(uid, { admin: true });

  return { success: true, message: "Admin role assigned" };
});
