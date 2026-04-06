require("dotenv").config({ path: __dirname + "/../.env" });

/**
 * Express app for API routes. Do NOT call app.listen() — Firebase Cloud Functions
 * provides the HTTP server via functions.https.onRequest(app) in index.js.
 */
const path = require("path");
const crypto = require("crypto");
const admin = require("firebase-admin");

const express = require("express");
const { generateLogbook } = require("../engineAdapter");
const { resolveRouteAddresses } = require("./routeAddressResolver");
const { API_CACHE_STORE_RESOLUTION } = require("./resolveStore");
const { engineResolveStore } = require("./api");
const { uploadStoresFromExcel } = require("./adminUploadStores");
const {
  evaluateLogbookAccessHttp,
  consumeLogbookToken,
  getLogbookAccessTokenFromRequest,
  isGateDisabled,
} = require("./resolveStoreGate");

const app = express();

app.use((req, res, next) => {
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, X-Logbook-Token, x-logbook-token, x-logbook-key, X-Request-Id, x-request-id, x-admin-key'
  );
  if (req.method === 'OPTIONS') {
    return res.status(204).send('');
  }
  next();
});

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ limit: "10mb", extended: true }));

const processRoutelistUpload = (req, res) =>
  require("../index").processRoutelistUpload(req, res);
app.post("/processRoutelistUpload", processRoutelistUpload);

const { getGoogleApiKey } = require("./googleApiKey");
const GOOGLE_API_KEY = getGoogleApiKey();
const GOOGLE_BASE = "https://maps.googleapis.com/maps/api";
const LOGBOOK_KEY = process.env.LOGBOOK_KEY;
const ADMIN_KEY = process.env.ADMIN_KEY || "your-secret-key";

const ALLOWED_ORIGINS = [
  "http://localhost:3000",
  "https://autologbook.co.za",
  "https://www.autologbook.co.za",
  "https://autologbook-sa.web.app",
  "https://autologbook-sa.firebaseapp.com"
];

/** CORS: run before routes so preflight (OPTIONS) and all responses get headers. */
function setCors(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.set("Access-Control-Allow-Origin", origin);
  } else {
    res.set("Access-Control-Allow-Origin", "*");
  }
  res.set(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Logbook-Token, x-logbook-token, x-logbook-key, X-Request-Id, x-request-id, x-admin-key, x-admin"
  );
  res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
}

function proxyToGoogle(path, req, res) {
  if (!GOOGLE_API_KEY) {
    return res.status(500).json({ error: "Server missing Google API key. Set GOOGLE_API_KEY." });
  }
  const params = new URLSearchParams(req.query);
  params.set("key", GOOGLE_API_KEY);
  const url = `${GOOGLE_BASE}${path}?${params.toString()}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 20000);
  fetch(url, { signal: controller.signal })
    .then((r) => r.json())
    .then((data) => {
      clearTimeout(timeoutId);
      res.json(data);
    })
    .catch((err) => {
      clearTimeout(timeoutId);
      if (err.name === "AbortError") {
        return res.status(504).json({ error: "Google API request timed out after 20 seconds. Please try again." });
      }
      res.status(502).json({ error: String(err.message) });
    });
}

app.get("/api/geocode", (req, res) => {
  setCors(req, res);
  proxyToGoogle("/geocode/json", req, res);
});

/** Geocode one or more address strings to lat/lng. Used for manual trip from/to resolution. */
app.post("/api/geocodeAddresses", async (req, res) => {
  setCors(req, res);
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed. Use POST." });
  if (!GOOGLE_API_KEY) return res.status(500).json({ error: "Server missing Google API key." });
  try {
    const addresses = Array.isArray(req.body?.addresses) ? req.body.addresses : [];
    if (addresses.length === 0) return res.status(400).json({ error: "Missing or empty addresses array." });
    const results = [];
    for (const addr of addresses) {
      const trimmed = typeof addr === "string" ? addr.trim() : "";
      if (!trimmed) {
        results.push({ address: trimmed, lat: null, lng: null, formatted_address: null, resolved: false });
        continue;
      }
      const url = `${GOOGLE_BASE}/geocode/json?address=${encodeURIComponent(trimmed)}&key=${GOOGLE_API_KEY}`;
      const r = await fetch(url);
      const data = await r.json();
      const first = data.results && data.results[0];
      const loc = first && first.geometry && first.geometry.location;
      if (loc != null && typeof loc.lat === "number" && typeof loc.lng === "number") {
        results.push({ address: trimmed, lat: loc.lat, lng: loc.lng, formatted_address: first.formatted_address || trimmed, resolved: true });
      } else {
        results.push({ address: trimmed, lat: null, lng: null, formatted_address: null, resolved: false });
      }
    }
    res.status(200).json(results);
  } catch (err) {
    console.error("geocodeAddresses error:", err);
    res.status(500).json({ error: err.message || "Geocode failed." });
  }
});

const NOMINATIM_BASE = "https://nominatim.openstreetmap.org";
const NOMINATIM_USER_AGENT =
  "AutoLogbookSA/1.0 (admin store geocode; https://autologbook.co.za)";

/** Admin-only geocode via OSM Nominatim (no Google). */
app.post("/api/geocode-nominatim", async (req, res) => {
  setCors(req, res);
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed. Use POST." });
  const key = req.headers["x-admin-key"];
  if (key !== ADMIN_KEY) {
    return res.status(403).json({ error: "Unauthorized", lat: null, lng: null });
  }
  try {
    const address = req.body?.address;
    const trimmed = typeof address === "string" ? address.trim() : "";
    if (!trimmed) {
      return res.status(400).json({ error: "Missing address", lat: null, lng: null });
    }
    const url = `${NOMINATIM_BASE}/search?q=${encodeURIComponent(trimmed)}&format=json&limit=1`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20000);
    const r = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": NOMINATIM_USER_AGENT,
        Accept: "application/json",
      },
    });
    clearTimeout(timeoutId);
    if (!r.ok) {
      return res.status(502).json({ error: "Nominatim request failed", lat: null, lng: null });
    }
    const results = await r.json();
    const first = Array.isArray(results) && results[0];
    if (!first) {
      return res.status(404).json({ error: "No results", lat: null, lng: null });
    }
    const lat = parseFloat(first.lat);
    const lng = parseFloat(first.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(502).json({ error: "Invalid Nominatim response", lat: null, lng: null });
    }
    res.status(200).json({ lat, lng, display_name: first.display_name || null });
  } catch (err) {
    console.error("geocode-nominatim error:", err);
    const msg =
      err && err.name === "AbortError" ? "Nominatim request timed out" : err.message || "Geocode failed.";
    res.status(500).json({ error: msg, lat: null, lng: null });
  }
});

app.get("/api/findPlace", (req, res) => {
  setCors(req, res);
  proxyToGoogle("/place/findplacefromtext/json", req, res);
});

app.get("/api/textSearch", (req, res) => {
  setCors(req, res);
  proxyToGoogle("/place/textsearch/json", req, res);
});

app.get("/api/route", (req, res) => {
  setCors(req, res);
  proxyToGoogle("/directions/json", req, res);
});

app.get("/api/placeDetails", (req, res) => {
  setCors(req, res);
  proxyToGoogle("/place/details/json", req, res);
});

/** Legacy resolver — NOT used by logbook page. Kept for backwards compatibility only. */
app.all("/api/resolveRouteAddresses", (req, res) => {
  setCors(req, res);
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed. Use POST." });
  if (!GOOGLE_API_KEY) return res.status(500).json({ error: "Server missing Google API key." });
  const body = req.body && (req.body.routes != null ? req.body : { routes: req.body });
  const routes = Array.isArray(body.routes) ? body.routes : [];
  if (routes.length === 0) return res.status(400).json({ error: "Missing or empty routes array." });
  resolveRouteAddresses(routes, GOOGLE_API_KEY, {})
    .then((resolved) => res.status(200).json(resolved))
    .catch((err) => {
      console.error("resolveRouteAddresses failed:", err);
      res.status(500).json({ error: err.message || "Address resolution failed." });
    });
});

const logbookAccessState = async (req, res) => {
  setCors(req, res);
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed. Use POST." });
  try {
    const state = await evaluateLogbookAccessHttp(req);
    return res.status(200).json(state);
  } catch (err) {
    console.error("logbookAccessState error:", err);
    return res.status(500).json({
      canGenerate: false,
      isAdmin: false,
      reason: "Server error",
    });
  }
};

app.post("/api/logbookAccessState", logbookAccessState);
app.post('/logbookAccessState', logbookAccessState);

app.post(["/api/admin/upload-stores", "/admin/upload-stores"], async (req, res) => {
  console.log("🔥 UPLOAD STORES HIT");
  setCors(req, res);
  console.log("[admin/upload-stores] request", {
    method: req.method,
    path: req.path,
    url: req.url,
    contentType: req.headers["content-type"]
  });
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed. Use POST." });
  }

  const key = req.headers["x-admin-key"];

  if (key !== ADMIN_KEY) {
    return res.status(403).json({ success: false, error: "Unauthorized" });
  }

  try {
    const rows = req.body.rows;

    if (!Array.isArray(rows)) {
      return res.status(400).json({ success: false, error: "Invalid rows" });
    }

    const result = await uploadStoresFromExcel(rows);

    res.setHeader("Content-Type", "application/json; charset=utf-8");
    console.log("🔥 UPLOAD COMPLETE");
    return res.status(200).json(result);
  } catch (err) {
    console.error("[admin/upload-stores] error", err);
    return res.status(500).json({ success: false, error: err.message || "Upload failed" });
  }
});

app.get("/api/admin/get-stores", async (req, res) => {
  try {
    const db = admin.firestore();
    const snapshot = await db.collection("storeLocations").get();

    const stores = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data()
    }));

    console.log("🔥 GET STORES:", stores.length);

    res.status(200).json({ success: true, stores });
  } catch (err) {
    console.error("❌ GET STORES ERROR:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get("/admin/get-stores", async (req, res) => {
  setCors(req, res);
  const key = req.headers["x-admin-key"];
  if (key !== ADMIN_KEY) {
    return res.status(403).json({ error: "Unauthorized" });
  }

  try {
    const snapshot = await admin
      .firestore()
      .collection(API_CACHE_STORE_RESOLUTION)
      .get();

    const data = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data()
    }));

    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get(["/api/admin/missing-coords", "/admin/missing-coords"], async (req, res) => {
  setCors(req, res);
  const key = req.headers["x-admin-key"];
  if (key !== ADMIN_KEY) {
    return res.status(403).json({ error: "Unauthorized" });
  }

  try {
    const snapshot = await admin
      .firestore()
      .collection(API_CACHE_STORE_RESOLUTION)
      .where("missingCoords", "==", true)
      .get();

    const results = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data()
    }));

    res.json(results);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/admin/update-coords", async (req, res) => {
  setCors(req, res);
  const key = req.headers["x-admin-key"];
  if (key !== ADMIN_KEY) {
    return res.status(403).json({ error: "Unauthorized" });
  }

  const { normalizedQuery, lat, lng } = req.body;

  if (!normalizedQuery) {
    return res.status(400).json({ error: "Missing normalizedQuery" });
  }

  const docId = crypto.createHash("sha256").update(String(normalizedQuery), "utf8").digest("hex");

  try {
    console.log("[CACHE WRITE]", normalizedQuery, docId);
    await admin
      .firestore()
      .collection(API_CACHE_STORE_RESOLUTION)
      .doc(docId)
      .set(
        {
          lat,
          lng,
          missingCoords: false,
          updatedAt: Date.now()
        },
        { merge: true }
      );

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/engine/resolve-store", async (req, res) => {
  setCors(req, res);
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed. Use POST." });
  try {
    await engineResolveStore(req, res);
  } catch (err) {
    console.error("🚨 RESOLVER FULL ERROR:", err);

    res.status(500).json({
      error: "Resolver failed",
      message: err && err.message,
      stack: err && err.stack
    });
  }
});

app.post("/engine/test", (req, res) => {
  setCors(req, res);
  res.json({ ok: true, route: "engine/test working" });
});

app.all("/api/generateLogbook", async (req, res) => {
  setCors(req, res);
  console.log("🚨 API RECEIVED ROUTES:", JSON.stringify(req.body && req.body.routes, null, 2));
  const __pipelineRoutesJsonAtReceipt = req.body ? JSON.stringify(req.body.routes) : null;
  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: "Method not allowed. Use POST."
    });
  }

  if (!req.body) {
    return res.status(400).json({
      success: false,
      error: "Missing request body."
    });
  }

  const requestSize = JSON.stringify(req.body).length;
  if (requestSize > 1000000) {
    return res.status(413).json({
      success: false,
      error: "Request body too large."
    });
  }

  const { routes, startDate, endDate, homeAddress, openingKm } = req.body;

  console.log("🚨 SERVER INPUT ROUTES COUNT:", routes && Array.isArray(routes) ? routes.length : 0);
  console.log("🚨 SERVER INPUT SAMPLE:", Array.isArray(routes) ? routes.slice(0, 5) : routes);

  console.log("🚨 BEFORE ANY PROCESSING:", routes && Array.isArray(routes) ? routes.length : 0);

  const isAdmin = req.headers["x-admin"] === "true";

  let access;
  try {
    access = isAdmin
      ? { isAdmin: true, canGenerate: true, reason: null }
      : await evaluateLogbookAccessHttp(req);
  } catch (accessErr) {
    console.error("Access evaluation failed:", accessErr);
    return res.status(500).json({
      success: false,
      error: "Access evaluation failed",
    });
  }

  if (!access.canGenerate) {
    return res.status(403).json({
      success: false,
      error: access.reason || "Forbidden",
    });
  }

  if (!routes || !startDate || !endDate || !homeAddress || openingKm === undefined) {
    return res.status(400).json({
      success: false,
      error: "Missing required fields: routes, startDate, endDate, homeAddress, openingKm."
    });
  }

  if (!isGateDisabled() && !access.isAdmin) {
    const token = getLogbookAccessTokenFromRequest(req);
    if (!token) {
      return res.status(403).json({
        success: false,
        error: "Invalid or missing token",
      });
    }
    try {
      const requestId = req.headers["x-request-id"];
      await consumeLogbookToken(token, requestId);
    } catch (consumeErr) {
      const msg =
        consumeErr && consumeErr.message ? String(consumeErr.message) : "Token error";
      if (
        msg === "Invalid token" ||
        msg === "Token already used" ||
        msg === "Invalid token state"
      ) {
        return res.status(403).json({ success: false, error: msg });
      }
      console.error("consumeLogbookToken:", consumeErr);
      return res.status(500).json({ success: false, error: "Token error" });
    }
  }

  try {
    if (
      __pipelineRoutesJsonAtReceipt !== null &&
      JSON.stringify(req.body.routes) !== __pipelineRoutesJsonAtReceipt
    ) {
      throw new Error("PIPELINE MUTATION DETECTED");
    }
    const result = await generateLogbook(req.body);
    const entries = result.entries || [];
    const meta = result.meta || {};
    res.json({
      success: true,
      data: {
        ...result,
        audit: {
          engineVersion: result.engineVersion,
          generatedAt: meta.generatedAt,
          entryCount: entries.length,
          warnings: meta.warnings || []
        }
      }
    });
  } catch (err) {
    console.error("Logbook generation failed:", err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

/** Never return Express default HTML error pages (e.g. JSON body parse failures). */
app.use((req, res) => {
  res.status(404).json({ success: false, error: "Not found", path: req.path });
});

app.use((err, req, res, next) => {
  if (res.headersSent) {
    return next(err);
  }
  console.error("[api express error]", err && err.stack ? err.stack : err);
  const statusRaw = err && (err.status || err.statusCode);
  const status = Number(statusRaw);
  const safeStatus = Number.isFinite(status) && status >= 400 && status < 600 ? status : 500;
  const message =
    err && typeof err.message === "string" && err.message ? err.message : "Server error";
  res.status(safeStatus).json({ success: false, error: message });
});

module.exports = app;
