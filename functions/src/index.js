require("dotenv").config({ path: __dirname + "/../.env" });

/**
 * Express app for API routes. Do NOT call app.listen() — Firebase Cloud Functions
 * provides the HTTP server via functions.https.onRequest(app) in index.js.
 */
const path = require("path");
const admin = require("firebase-admin");
if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();
const { FieldValue } = require("firebase-admin/firestore");

const express = require("express");
const { generateLogbook } = require("../engineAdapter");
const { engineResolveStore } = require("./api");
const { uploadStoresFromExcel } = require("./adminUploadStores");
const { handleAdminDashboardApi } = require("./adminDashboardApi");
const {
  handleUpdateRouteStatus,
  handleApproveLogbookSubmission,
} = require("./logbookSubmissionAdminRoutes");
const {
  evaluateLogbookAccessHttp,
  getLogbookAccessTokenFromRequest,
  isAdminUser,
  isAdminRequest,
} = require("./resolveStoreGate");
const sgMail = require("@sendgrid/mail");
const { SENDGRID_API_KEY } = require("./email");

const app = express();

/** Authoritative store collection (same as production resolver / uploads). */
const STORE_LOCATIONS_COLLECTION = "storeLocations";

function storeRowNeedsCoordinateAttention(data) {
  if (!data || typeof data !== "object") return true;
  if (data.missingCoords === true || data.needsAdminReview === true) return true;
  const lat = data.lat;
  const lng = data.lng;
  if (lat == null || lng == null) return true;
  const ln = Number(lat);
  const lg = Number(lng);
  return !Number.isFinite(ln) || !Number.isFinite(lg);
}

async function listStoreLocationsMissingCoords(firestore) {
  const snap = await firestore.collection(STORE_LOCATIONS_COLLECTION).get();
  return snap.docs
    .map((doc) => {
      const data = doc.data() || {};
      return {
        ...data,
        id: doc.id,
        /** Legacy admin UIs POST this back to update-coords; always tie to Firestore doc id. */
        normalizedQuery: doc.id
      };
    })
    .filter((row) => storeRowNeedsCoordinateAttention(row));
}

async function resolveStoreLocationRefForAdminUpdate(firestore, body) {
  const col = firestore.collection(STORE_LOCATIONS_COLLECTION);
  const id = body && body.id != null ? String(body.id).trim() : "";
  const canonicalName =
    body && body.canonicalName != null ? String(body.canonicalName).trim() : "";
  const normalizedQuery =
    body && body.normalizedQuery != null ? String(body.normalizedQuery).trim() : "";

  if (id) {
    const ref = col.doc(id);
    const snap = await ref.get();
    if (snap.exists) return ref;
  }
  for (const key of [canonicalName, normalizedQuery]) {
    if (!key) continue;
    const ref = col.doc(key);
    const snap = await ref.get();
    if (snap.exists) return ref;
    const q = await col.where("canonicalName", "==", key).limit(1).get();
    if (!q.empty) return q.docs[0].ref;
  }
  return null;
}

function generatePractitionerApprovalCode(tier) {
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `PRAC-${tier}-${rand}`;
}

async function sendPractitionerApprovalEmail(email, code, tier, price) {
  sgMail.setApiKey(SENDGRID_API_KEY.value());
  const html = `
  <div style="font-family: Arial, sans-serif; background:#f4f6f8; padding:30px;">
    <div style="max-width:600px; margin:0 auto; background:#ffffff; border-radius:12px; padding:30px; text-align:center;">

      <div style="margin-bottom:20px;">
        <strong style="font-size:18px; color:#0f766e;">Auto Logbook SA</strong>
      </div>

      <h2 style="color:#0f766e; margin-bottom:10px;">
        You're Approved 🎉
      </h2>

      <p style="color:#555; font-size:14px; margin-bottom:25px;">
        Your practitioner account has been approved. You can now start generating logbooks at your discounted rate.
      </p>

      <div style="background:#f1f5f9; padding:15px; border-radius:8px; margin-bottom:20px;">
        <p style="margin:0; font-size:14px; color:#333;">Your Code</p>
        <strong style="font-size:20px; color:#0f766e;">${code}</strong>
      </div>

      <p style="font-size:14px; color:#333;">
        Valid for <strong>${tier}</strong> logbooks
      </p>

      <p style="font-size:14px; color:#333; margin-bottom:25px;">
        Your pricing: <strong>R${price}</strong> per logbook
      </p>

      <a href="https://autologbooksa.co.za"
         style="display:inline-block; padding:12px 20px; background:#0f766e; color:#ffffff; text-decoration:none; border-radius:6px; font-size:14px;">
         Start Generating Logbooks
      </a>

      <hr style="margin:30px 0; border:none; border-top:1px solid #eee;" />

      <p style="font-size:12px; color:#888;">
        Auto Logbook SA<br/>
        Cape Town, South Africa
      </p>

    </div>
  </div>
`;
  await sgMail.send({
    to: email,
    from: {
      email: "hello@autologbooksa.co.za",
      name: "Auto Logbook SA",
    },
    subject: "You're Approved 🎉",
    html,
  });
}

app.use((req, res, next) => {
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, X-Logbook-Token, x-logbook-token, x-logbook-key, X-Request-Id, x-request-id, x-admin-key, X-Admin-Dashboard, x-admin-dashboard'
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
    "Content-Type, Authorization, X-Logbook-Token, x-logbook-token, x-logbook-key, X-Request-Id, x-request-id, x-admin-key, x-admin, X-Admin-Dashboard, x-admin-dashboard"
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

/** Legacy resolver — disabled; use Cloud Functions upload / reprocess flows instead. */
app.all("/api/resolveRouteAddresses", (req, res) => {
  console.warn("LEGACY RESOLVER HIT:", {
    path: req.path,
    method: req.method,
    ip: req.ip,
    time: new Date().toISOString()
  });

  res.status(410).json({
    error: "LEGACY RESOLVER DISABLED"
  });

  return;
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

/** Read-only: download tokens remaining for logbook payment token (Firestore logbook_tokens). */
app.get("/api/getDownloadStatus", async (req, res) => {
  try {
    let token = getLogbookAccessTokenFromRequest(req);
    if (!token && req.query && req.query.token) {
      token = String(req.query.token).trim();
    }
    if (!token) {
      return res.status(400).json({ error: "Missing token", downloadsRemaining: 0 });
    }
    const doc = await db.collection("logbook_tokens").doc(token).get();
    if (!doc.exists) {
      return res.status(404).json({ error: "Invalid token", downloadsRemaining: 0 });
    }
    const data = doc.data() || {};
    const downloadsRemaining =
      typeof data.remaining === "number" && Number.isFinite(data.remaining)
        ? data.remaining
        : Number(data.remaining || 0);
    if (downloadsRemaining <= 0) {
      return res.status(200).json({
        downloadsRemaining: 0,
        error: "No downloads remaining",
      });
    }
    return res.status(200).json({ downloadsRemaining });
  } catch (err) {
    console.error("getDownloadStatus error:", err);
    return res.status(500).json({ error: "Server error", downloadsRemaining: 0 });
  }
});

app.post("/api/submit-review", async (req, res) => {
  try {
    const { name, company, rating, comment } = req.body;

    if (!rating || !comment) {
      return res.status(400).json({ success: false, error: "Missing required fields" });
    }

    await admin.firestore().collection("reviews_pending").add({
      name: name || "",
      company: company || "",
      rating: Number(rating),
      comment: String(comment).trim(),
      status: "pending",
      createdAt: new Date()
    });

    // TEMP: remove increment (avoid FieldValue crash)

    res.json({ success: true });

  } catch (err) {
    console.error("Submit review error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get("/api/getPractitionerApplications", async (req, res) => {
  console.log("GET PRACTITIONER APPLICATIONS HIT");
  try {
    const isAdmin = await isAdminRequest(req);

    console.log("IS ADMIN:", isAdmin);

    if (!isAdmin) {
      return res.status(403).json({ error: "Unauthorized" });
    }

    console.log("QUERYING FIRESTORE...");

    const snap = await db
      .collection("practitioner_applications")
      .where("status", "==", "pending")
      .get();

    console.log("QUERY SUCCESS, DOC COUNT:", snap.size);

    const applications = snap.docs.map((doc) => {
      const data = doc.data() || {};

      return {
        id: doc.id,
        name: data.name || "",
        email: data.email || "",
        business: data.business || "",
        estimatedVolume: data.estimatedVolume || "",
        status: data.status || "pending",
      };
    });

    console.log("RETURNING APPLICATIONS");

    return res.json({ applications });
  } catch (err) {
    console.error("GET PRACTITIONER APPLICATIONS ERROR:", err);
    console.error("STACK:", err.stack);
    return res.status(500).json({
      error: "Internal error",
      message: err.message,
    });
  }
});

app.get("/api/getPractitionerCodeDetails", async (req, res) => {
  try {
    const code = (req.query.code || "").trim().toUpperCase();
    if (!code) {
      return res.status(400).json({ error: "Missing code" });
    }

    const doc = await db.collection("practitioner_codes").doc(code).get();
    if (!doc.exists) {
      return res.json({ exists: false });
    }

    const data = doc.data() || {};
    const usageCount = Number(data.usageCount || 0);
    const usageLimit = Number(data.usageLimit || 0);
    const remaining =
      usageLimit > 0 ? Math.max(usageLimit - usageCount, 0) : null;

    return res.json({
      exists: true,
      active: data.active !== false,
      usageLimit: usageLimit > 0 ? usageLimit : null,
      usageCount,
      remaining,
      price: data.price,
    });
  } catch (err) {
    console.error("GET PRACTITIONER DETAILS ERROR", err);
    return res.status(500).json({ error: "Internal error" });
  }
});

app.get("/api/getPractitionerCodes", async (req, res) => {
  try {
    const isAdmin = await isAdminRequest(req);
    if (!isAdmin) {
      return res.status(403).json({ error: "Unauthorized" });
    }

    const snap = await db.collection("practitioner_codes").get();
    const codes = snap.docs.map((doc) => {
      const data = doc.data() || {};
      return {
        id: doc.id,
        code: data.code != null ? String(data.code) : doc.id,
        email: data.email != null ? String(data.email) : "",
        price: data.price,
        usageCount: data.usageCount,
        usageLimit: data.usageLimit,
        active: data.active !== false,
        tier: data.tier != null ? String(data.tier) : "",
      };
    });

    return res.json({ codes });
  } catch (err) {
    console.error("GET PRACTITIONER CODES ERROR:", err);
    return res.status(500).json({ error: "Internal error" });
  }
});

app.post("/api/togglePractitionerCode", async (req, res) => {
  try {
    const isAdmin = await isAdminRequest(req);
    if (!isAdmin) {
      return res.status(403).json({ error: "Unauthorized" });
    }

    const body = req.body && typeof req.body === "object" ? req.body : {};
    const id = body.id != null ? String(body.id).trim() : "";
    if (!id) {
      return res.status(400).json({ error: "Missing id" });
    }

    const active = Boolean(body.active);

    await db.collection("practitioner_codes").doc(id).update({ active });

    return res.json({ success: true });
  } catch (err) {
    console.error("TOGGLE PRACTITIONER CODE ERROR:", err);
    return res.status(500).json({ error: "Internal error" });
  }
});

app.post("/api/submitPractitionerApplication", async (req, res) => {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const { name, email, business, volume } = req.body || {};

    const nameClean = String(name || "").trim();
    const emailClean = String(email || "").trim().toLowerCase();
    const businessClean = String(business || "").trim();
    const volumeClean = String(volume || "").trim();

    if (!nameClean || !emailClean) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    if (!emailClean.includes("@")) {
      return res.status(400).json({ error: "Invalid email" });
    }

    const existing = await db
      .collection("practitioner_applications")
      .where("email", "==", emailClean)
      .where("status", "==", "pending")
      .limit(1)
      .get();

    if (!existing.empty) {
      return res.status(400).json({ error: "Application already submitted" });
    }

    await db.collection("practitioner_applications").add({
      name: nameClean,
      email: emailClean,
      business: businessClean,
      estimatedVolume: volumeClean,
      status: "pending",
      createdAt: FieldValue.serverTimestamp(),
    });

    return res.json({ success: true });
  } catch (err) {
    console.error("SUBMIT PRACTITIONER ERROR", err);
    return res.status(500).json({ error: "Internal error" });
  }
});

app.post("/api/approvePractitionerApplication", async (req, res) => {
  try {
    const isAdmin = await isAdminRequest(req);
    if (!isAdmin) {
      return res.status(403).json({ error: "Unauthorized" });
    }

    const { applicationId, tier, price } = req.body || {};
    if (!applicationId || !tier || !price) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const appRef = db.collection("practitioner_applications").doc(String(applicationId));
    const appSnap = await appRef.get();

    if (!appSnap.exists) {
      return res.status(404).json({ error: "Application not found" });
    }

    const appData = appSnap.data() || {};

    if (appData.status !== "pending") {
      return res.status(400).json({ error: "Already processed" });
    }

    const tierStr = String(tier);
    const priceNum = Number(price);
    const code = generatePractitionerApprovalCode(tierStr);

    await db
      .collection("practitioner_codes")
      .doc(code)
      .set({
        code,
        email: appData.email,
        tier: tierStr,
        price: priceNum,
        usageLimit: Number(tierStr),
        usageCount: 0,
        active: true,
        createdAt: FieldValue.serverTimestamp(),
      });

    await appRef.update({
      status: "approved",
      approvedTier: tierStr,
      approvedPrice: priceNum,
      code,
      approvedAt: FieldValue.serverTimestamp(),
    });

    try {
      await sendPractitionerApprovalEmail(appData.email, code, tierStr, priceNum);
    } catch (err) {
      console.error("EMAIL FAILED", err);
    }

    return res.json({ success: true, code });
  } catch (err) {
    console.error("APPROVE PRACTITIONER APPLICATION ERROR", err);
    return res.status(500).json({ error: "Internal error" });
  }
});

app.post("/api/submit-ad", async (req, res) => {
  try {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const title =
      (body.title != null && String(body.title).trim() !== "")
        ? String(body.title).trim()
        : (body.toolName != null && String(body.toolName).trim() !== "")
          ? String(body.toolName).trim()
          : "";
    const image = typeof body.image === "string" ? body.image.trim() : "";
    const slot = body.slot != null && String(body.slot).trim() !== "" ? String(body.slot).trim() : "";

    if (!title) {
      return res.status(400).json({ success: false, error: "Missing title" });
    }
    if (!image) {
      return res.status(400).json({ success: false, error: "Missing image" });
    }
    if (!slot) {
      return res.status(400).json({ success: false, error: "Missing slot" });
    }

    await db.collection("sponsoredTools").add({
      ...body,
      status: "pending",
      createdAt: FieldValue.serverTimestamp(),
    });

    res.json({ success: true });
  } catch (err) {
    console.error("Submit ad error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/update-pricing", async (req, res) => {
  try {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    await db
      .collection("pricing")
      .doc("default")
      .set(
        {
          ...body,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    res.json({ success: true });
  } catch (err) {
    console.error("Update pricing error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.all("/api/admin-dashboard", (req, res) => handleAdminDashboardApi(req, res));

app.post("/api/updateRouteStatus", handleUpdateRouteStatus);
app.post("/api/approveLogbookSubmission", handleApproveLogbookSubmission);

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
      .collection(STORE_LOCATIONS_COLLECTION)
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
    const fs = admin.firestore();
    const results = await listStoreLocationsMissingCoords(fs);
    res.json(results);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post(["/api/admin/update-coords", "/admin/update-coords"], async (req, res) => {
  setCors(req, res);
  const key = req.headers["x-admin-key"];
  if (key !== ADMIN_KEY) {
    return res.status(403).json({ error: "Unauthorized" });
  }

  const { lat, lng } = req.body || {};

  const latN = lat != null ? Number(lat) : NaN;
  const lngN = lng != null ? Number(lng) : NaN;
  if (!Number.isFinite(latN) || !Number.isFinite(lngN)) {
    return res.status(400).json({ error: "Invalid or missing lat/lng" });
  }

  try {
    const fs = admin.firestore();
    const ref = await resolveStoreLocationRefForAdminUpdate(fs, req.body || {});
    if (!ref) {
      return res.status(404).json({ error: "Store document not found in storeLocations" });
    }

    await ref.set(
      {
        lat: latN,
        lng: lngN,
        missingCoords: false,
        needsAdminReview: false,
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

async function handleGenerateLogbookRequest(req, res) {
  console.log("🔥 GENERATE REQUEST START");
  console.log("🔥 HEADERS:", req.headers);
  console.log("🔥 BODY TOKEN:", req.body && req.body.logbookAccessToken);
  setCors(req, res);
  res.set("Access-Control-Allow-Origin", "*");
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

  const isAdmin = await isAdminRequest(req);

  let access;

  if (isAdmin) {
    console.log("ADMIN BYPASS ACTIVE");
    access = { canGenerate: true, isAdmin: true, reason: null };
  } else {
    console.log("🚨 SERVER INPUT ROUTES COUNT:", routes && Array.isArray(routes) ? routes.length : 0);
    console.log("🚨 SERVER INPUT SAMPLE:", Array.isArray(routes) ? routes.slice(0, 5) : routes);

    console.log("🚨 BEFORE ANY PROCESSING:", routes && Array.isArray(routes) ? routes.length : 0);

    let isFirebaseAdmin = false;
    try {
      const authHeader = String(req.headers.authorization || req.headers.Authorization || "");
      const m = authHeader.match(/^Bearer\s+(\S+)/i);
      const token = m ? m[1] : null;
      if (token) {
        const decoded = await admin.auth().verifyIdToken(token);
        isFirebaseAdmin = isAdminUser(decoded);
      }
    } catch (err) {
      console.warn("🔥 ADMIN CHECK FAILED:", err && err.message ? String(err.message) : err);
    }

    try {
      if (isFirebaseAdmin) {
        console.log("🔥 ADMIN BYPASS ENABLED");
        access = { isAdmin: true, canGenerate: true, reason: null };
      } else {
        access = await evaluateLogbookAccessHttp(req);
      }
    } catch (accessErr) {
      console.error("Access evaluation failed:", accessErr);
      return res.status(500).json({
        success: false,
        error: "Access evaluation failed",
      });
    }

    console.log("🔥 ACCESS RESULT:", access);
  }

  if (!access.canGenerate) {
    return res.status(403).json({
      success: false,
      error: access.reason || "Forbidden",
    });
  }

  const logbookToken = getLogbookAccessTokenFromRequest(req);
  if (!isAdmin && !logbookToken) {
    return res.status(403).json({
      success: false,
      error: "Missing token",
    });
  }

  if (!routes || !startDate || !endDate || !homeAddress || openingKm === undefined) {
    return res.status(400).json({
      success: false,
      error: "Missing required fields: routes, startDate, endDate, homeAddress, openingKm."
    });
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
}

app.all("/api/generateLogbook", handleGenerateLogbookRequest);
app.all("/generateLogbook", handleGenerateLogbookRequest);

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
