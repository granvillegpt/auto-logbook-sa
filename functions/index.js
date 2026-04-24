// resolver-query-v2 (force redeploy)
const crypto = require("crypto");
const https = require("https");
const querystring = require("querystring");
const PAYFAST_HOST = "www.payfast.co.za";
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
const cors = require("cors");
const { handlePaymentWebhook } = require("./src/paymentWebhook");
const { handleAdminDashboardApi } = require("./src/adminDashboardApi");
const { endDateValueToISOString } = require("./src/adBookingHelpers");
const { sendGridEmail, SENDGRID_API_KEY } = require("./src/email");
const {
  getLogbookAccessTokenFromRequest,
  consumeLogbookToken,
  isAdminRequest,
} = require("./src/resolveStoreGate");

if (!admin.apps.length) {
  admin.initializeApp();
}

const { assignAdminOnUserCreate, setAdminByEmail } = require("./src/authTriggers");
exports.assignAdminOnUserCreate = assignAdminOnUserCreate;
exports.setAdminByEmail = setAdminByEmail;

const payfastPassphrase = defineSecret("PAYFAST_PASSPHRASE");
const LOGBOOK_TEMPLATE_ID = "d-b4f86a57a18a4be083f9eb8700162203";

const apiCors = cors({
  origin: true,
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "X-Logbook-Token",
    "x-logbook-token",
    "x-logbook-key",
    "X-Request-Id",
    "x-request-id",
    "x-admin-key",
    "X-Admin-Dashboard",
    "x-admin-dashboard",
  ],
});

exports.api = onRequest(
  {
    region: "us-central1",
    secrets: ["SENDGRID_API_KEY"]
  },
  (req, res) => {
    return apiCors(req, res, () => app(req, res));
  }
);

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

function expiresAtToMs(v) {
  if (v == null) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "object" && typeof v.toMillis === "function") return v.toMillis();
  if (typeof v === "object" && typeof v.toDate === "function") return v.toDate().getTime();
  return null;
}

function verifyWithPayfast(body) {
  return new Promise((resolve, reject) => {
    console.log("🌐 PAYFAST VERIFY HOST:", PAYFAST_HOST);
    const postData = querystring.stringify({
      ...body,
      cmd: "_notify-validate",
    });

    const options = {
      hostname: PAYFAST_HOST,
      path: "/eng/query/validate",
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(postData),
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        resolve(data.trim() === "VALID");
      });
    });

    req.on("error", reject);

    req.write(postData);
    req.end();
  });
}

const payfastNotifyApp = express();
payfastNotifyApp.use(express.urlencoded({ extended: false }));

payfastNotifyApp.post("/", async (req, res) => {
  try {
    console.log("🔥 ITN RECEIVED");
    console.log("🔥 PAYFAST HIT");
    console.log("🔥 HEADERS:", req.headers);

    const body = req.body;

    console.log("📦 RAW BODY OBJECT:", body);

    if (!body || typeof body !== "object") {
      return res.status(400).send("Invalid payload");
    }

    const isValid = await verifyWithPayfast(body);

    if (!isValid) {
      console.error("❌ PAYFAST VALIDATION FAILED");
      return res.status(400).send("Invalid payment");
    }

    console.log("✅ PAYFAST VERIFIED");

    await processPayfastPayment(body);

    return res.status(200).send("OK");
  } catch (err) {
    console.error("🔥 PAYFAST ERROR:", err);
    return res.status(500).send("Processing failed");
  }
});

exports.payfastNotify = onRequest(
  {
    region: "us-central1",
    secrets: [SENDGRID_API_KEY],
  },
  payfastNotifyApp
);

/** PayFast ITN buyer email: known fields first, then any single value that looks like an email. */
function resolvePayerEmailFromPayfastBody(body) {
  if (!body || typeof body !== "object") return "";
  const preferred = [
    body.email_address,
    body.email,
    body.from_email,
    body.buyer_email,
  ];
  for (let i = 0; i < preferred.length; i++) {
    const s = String(preferred[i] == null ? "" : preferred[i]).trim();
    if (s.includes("@")) return s;
  }
  const keys = Object.keys(body);
  for (let j = 0; j < keys.length; j++) {
    const v = String(body[keys[j]] == null ? "" : body[keys[j]]).trim();
    if (!v.includes("@") || v.length > 254) continue;
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return v;
  }
  return "";
}

async function processPayfastPayment(body) {
  console.log("💰 PAYFAST BODY:", body);

  if (!body || String(body.payment_status || "").toUpperCase() !== "COMPLETE") {
    console.log("IGNORED PAYMENT:", body?.payment_status);
    return;
  }

  const isAdPayment = String(body.custom_str2 || "").toLowerCase() === "ad";

  if (isAdPayment) {
    const adIdStr = String(body.m_payment_id || "").trim();
    if (!adIdStr) {
      console.error("NO AD ID IN PAYMENT:", body);
      return;
    }
    const adRef = admin.firestore().collection("sponsoredTools").doc(adIdStr);
    const adSnap = await adRef.get();
    if (!adSnap.exists) {
      console.error("AD NOT FOUND FOR PAYMENT", adIdStr);
      return;
    }
    const adData = adSnap.data() || {};
    const monthsRaw = String(body.custom_str1 || "").trim();
    let months = parseInt(monthsRaw, 10);
    if (!months || months < 1) months = 1;
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
    console.log("AD ACTIVATED:", { id: adIdStr, months, expiresAt: expiry });
    return;
  }

  const tokenDocId = String(
    body.m_payment_id || body.pf_payment_id || ""
  ).trim();
  if (!tokenDocId) {
    console.error("MISSING TOKEN / MERCHANT PAYMENT ID", body);
    return;
  }

  const tokenRef = admin.firestore()
    .collection("logbook_tokens")
    .doc(tokenDocId);

  const existing = await tokenRef.get();

  if (existing.exists) {
    console.log("⚠️ DUPLICATE ITN — EMAIL SKIPPED");
    return;
  }

  const email = resolvePayerEmailFromPayfastBody(body);
  if (!email) {
    console.error("NO PAYER EMAIL IN PAYFAST ITN", {
      keys: body && typeof body === "object" ? Object.keys(body) : [],
    });
    return;
  }

  const rawQty = Number(body.custom_str4);
  const quantity = Number.isFinite(rawQty) && rawQty > 0 ? rawQty : 1;
  const tokensPerLogbook = 3;
  const nTokens = quantity * tokensPerLogbook;

  await admin
    .firestore()
    .collection("logbook_tokens")
    .doc(tokenDocId)
    .set({
      remaining: nTokens,
      uploadsRemaining: quantity * 3,
      createdAt: Date.now(),
    });

  const practitionerCode = String(body.custom_str5 || "").trim().toUpperCase();
  if (practitionerCode) {
    const ledgerRef = admin
      .firestore()
      .collection("practitioner_payment_ledger")
      .doc(tokenDocId);
    const codeRef = admin
      .firestore()
      .collection("practitioner_codes")
      .doc(practitionerCode);
    const preSnap = await codeRef.get();
    if (preSnap.exists) {
      const preData = preSnap.data() || {};
      const usageLimit = Number(preData.usageLimit || 0);
      const usageCount = Number(preData.usageCount || 0);
      if (usageLimit > 0 && usageCount >= usageLimit) {
        console.log(
          "PRACTITIONER LIMIT REACHED — SKIPPING INCREMENT:",
          practitionerCode
        );
      } else {
        try {
          const didIncrement = await admin.firestore().runTransaction(
            async (tx) => {
              const ledgerSnap = await tx.get(ledgerRef);
              if (ledgerSnap.exists) {
                return false;
              }
              const codeSnap = await tx.get(codeRef);
              if (!codeSnap.exists) {
                return false;
              }
              const codeData = codeSnap.data() || {};
              if (codeData.active === false) {
                return false;
              }
              const ul = Number(codeData.usageLimit);
              const uc = Number(codeData.usageCount || 0);
              if (Number.isFinite(ul) && ul > 0 && uc >= ul) {
                return false;
              }
              tx.set(ledgerRef, {
                code: practitionerCode,
                pf_payment_id: tokenDocId,
                createdAt: FieldValue.serverTimestamp(),
              });
              tx.update(codeRef, {
                usageCount: FieldValue.increment(1),
              });
              return true;
            }
          );
          if (didIncrement) {
            console.log("PRACTITIONER USAGE INCREMENTED:", practitionerCode);
          }
        } catch (pracErr) {
          console.error("PRACTITIONER USAGE INCREMENT ERROR:", pracErr);
        }
      }
    }
  }

  const download_url = `https://autologbooksa.co.za/logbook.html?token=${encodeURIComponent(
    tokenDocId
  )}`;
  console.log("FINAL EMAIL LINK:", download_url);

  const paymentId = String(body.pf_payment_id || "").trim();
  if (paymentId) {
    await admin
      .firestore()
      .collection("payfast_payments")
      .doc(paymentId)
      .set({
        email,
        payment_status: body.payment_status,
        amount: body.amount_gross,
        type: String(body.custom_str2 || "logbook"),
        token: tokenDocId,
        createdAt: Date.now(),
      });
  }

  const year = String(new Date().getFullYear());

  await sendGridEmail({
    to: email,
    templateId: LOGBOOK_TEMPLATE_ID,
    dynamicTemplateData: {
      download_url: download_url,
      year: year,
    },
  });
  console.log("✅ EMAIL SENT");
}

/** Read-only: generations remaining. Consumption on download: POST consumeLogbookDownload. */
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

exports.getLogbookTokenStatus = onRequest(
  {
    region: "us-central1",
    cors: true,
    invoker: "public",
  },
  async (req, res) => {
    try {
      if (req.method === "OPTIONS") {
        return res.status(204).send("");
      }
      const token = String(req.headers["x-logbook-token"] || "").trim();

      if (!token) {
        return res.status(400).json({ success: false, error: "Missing token" });
      }

      const doc = await admin
        .firestore()
        .collection("logbook_tokens")
        .doc(token)
        .get();

      if (!doc.exists) {
        return res.status(404).json({ success: false, error: "Token not found" });
      }

      const data = doc.data() || {};

      return res.json({
        success: true,
        remaining: Number(data.remaining || 0),
      });
    } catch (err) {
      return res.status(500).json({
        success: false,
        error: err && err.message ? String(err.message) : "error",
      });
    }
  }
);

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

/**
 * Admin-only: create a logbook access URL identical to the post-payment link.
 * Writes `logbook_tokens/{token}` (consumed by existing validation) and mirrors
 * metadata to `accessTokens/{token}` for admin records.
 */
exports.createManualAccessLink = onCall(
  {
    region: "us-central1",
    cors: true,
    invoker: "public",
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Authentication required.");
    }
    const claims = request.auth.token || {};
    if (claims.admin !== true && claims.role !== "admin") {
      throw new HttpsError("permission-denied", "Admin only.");
    }
    const emailRaw = String(request.data?.email || "").trim();
    const email = emailRaw.toLowerCase();
    if (!email || !email.includes("@")) {
      throw new HttpsError("invalid-argument", "Valid email required.");
    }
    const token = crypto.randomUUID();
    const db = admin.firestore();
    const logbookRef = db.collection("logbook_tokens").doc(token);
    const accessRef = db.collection("accessTokens").doc(token);
    const createdAt = FieldValue.serverTimestamp();
    const batch = db.batch();
    batch.set(logbookRef, {
      remaining: 3,
      uploadsRemaining: 3,
      createdAt,
      email,
      source: "admin",
    });
    batch.set(accessRef, {
      token,
      email,
      remainingUses: 3,
      createdAt,
      source: "admin",
    });
    await batch.commit();
    const link = `https://autologbooksa.co.za/logbook.html?token=${encodeURIComponent(token)}`;
    return { success: true, link };
  }
);

const RESEND_ACCESS_SUBJECT = "Your Auto Logbook SA Access Link";

function buildResendAccessEmailBodies(link) {
  const text =
    "Hello,\n\n" +
    "You can access the Auto Logbook SA tool using the link below:\n\n" +
    link +
    "\n\n" +
    "You have 3 logbook generations available.\n\n" +
    "If you experience any issues, feel free to reply to this email.";
  const href = encodeURI(String(link));
  const label = String(link)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/"/g, "&quot;");
  const html =
    "<p>Hello,</p>" +
    "<p>You can access the Auto Logbook SA tool using the link below:</p>" +
    '<p><a href="' +
    href.replace(/"/g, "%22") +
    '">' +
    label +
    "</a></p>" +
    "<p>You have 3 logbook generations available.</p>" +
    "<p>If you experience any issues, feel free to reply to this email.</p>";
  return { text, html };
}

/**
 * Admin-only: reuse or create access token metadata, ensure logbook_tokens exists, email link to user.
 */
exports.resendAccessLink = onCall(
  {
    region: "us-central1",
    cors: true,
    invoker: "public",
    secrets: [SENDGRID_API_KEY],
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Authentication required.");
    }
    const claims = request.auth.token || {};
    if (claims.admin !== true && claims.role !== "admin") {
      throw new HttpsError("permission-denied", "Admin only.");
    }
    const emailRaw = String(request.data?.email || "").trim();
    const emailNormalized = emailRaw.toLowerCase();
    if (!emailNormalized || !emailNormalized.includes("@")) {
      throw new HttpsError("invalid-argument", "Valid email required.");
    }
    const db = admin.firestore();
    const emailQueries = [emailNormalized];
    if (emailRaw !== emailNormalized) {
      emailQueries.push(emailRaw);
    }

    let tokenToUse = null;
    outer: for (const em of emailQueries) {
      const accessSnap = await db
        .collection("accessTokens")
        .where("email", "==", em)
        .orderBy("createdAt", "desc")
        .limit(10)
        .get();
      for (const doc of accessSnap.docs) {
        const d = doc.data() || {};
        const ru = Number(d.remainingUses);
        if (!Number.isFinite(ru) || ru <= 0) {
          continue;
        }
        const t = String(d.token || doc.id).trim();
        if (!t) continue;
        const lb = await db.collection("logbook_tokens").doc(t).get();
        if (!lb.exists) continue;
        const remaining = Number((lb.data() || {}).remaining ?? 0);
        if (remaining > 0) {
          tokenToUse = t;
          break outer;
        }
      }
    }

    if (!tokenToUse) {
      tokenToUse = crypto.randomUUID();
      const createdAt = FieldValue.serverTimestamp();
      const logbookRef = db.collection("logbook_tokens").doc(tokenToUse);
      const accessRef = db.collection("accessTokens").doc(tokenToUse);
      const batch = db.batch();
      batch.set(logbookRef, {
        remaining: 3,
        uploadsRemaining: 3,
        createdAt,
        email: emailNormalized,
        source: "admin-resend",
      });
      batch.set(accessRef, {
        token: tokenToUse,
        email: emailNormalized,
        remainingUses: 3,
        createdAt,
        source: "admin-resend",
      });
      await batch.commit();
    }

    const link = `https://autologbooksa.co.za/logbook.html?token=${encodeURIComponent(tokenToUse)}`;
    const { text, html } = buildResendAccessEmailBodies(link);
    await sendGridEmail({
      to: emailRaw,
      subject: RESEND_ACCESS_SUBJECT,
      text,
      html,
    });

    return { success: true };
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

  console.log("TRACE: CHECKING DB FOR", canonicalName);
  const doc = await db.collection("storeLocations").doc(canonicalName).get();

  if (!doc.exists) return null;

  console.log("TRACE: DB HIT", canonicalName);
  return doc.data();
}

async function findSimilarStore(db, canonicalName) {
  if (!canonicalName) return null;

  console.log("TRACE: CHECKING SIMILAR STORE", canonicalName);
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
      console.log("TRACE: SIMILAR HIT", canonicalName);
      return { id: doc.id, data: doc.data() };
    }
  }

  return null;
}

/** Shared resolver path used by resolveStores and processRoutelistUpload (writes storeLocations on success). */
function failedStoreRow(route, cleaned, extra) {
  return normalizeRouteCoordsDeep({
    customer: route.customer,
    canonicalName: cleaned || "",
    address: "",
    suburb: "",
    city: "",
    province: "",
    lat: null,
    lng: null,
    createdAt: Date.now(),
    failed: true,
    ...(extra || {}),
  });
}

async function runResolveStoresPipeline(route, db, API_KEY) {
  const raw = route.customer || "";
  const cleaned = cleanedCanonicalPreview(raw);
  if (!cleaned) {
    console.warn("runResolveStoresPipeline: empty cleaned canonical", { raw: raw.slice(0, 120) });
    return failedStoreRow(route, "");
  }
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

  console.log("TRACE: CALLING GOOGLE API", canonical);
  const url = `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=${encodeURIComponent(query)}&inputtype=textquery&fields=formatted_address,geometry,place_id&key=${API_KEY}`;

  let data;
  try {
    const response = await fetch(url);
    const text = await response.text();
    try {
      data = text ? JSON.parse(text) : {};
    } catch (parseErr) {
      console.error("findplacefromtext: invalid JSON", parseErr && parseErr.message, text && text.slice(0, 200));
      return failedStoreRow(route, cleaned);
    }
  } catch (fetchErr) {
    console.error("findplacefromtext fetch failed:", fetchErr && fetchErr.message);
    return failedStoreRow(route, cleaned);
  }

  let result;

  if (data.status === "OK" && data.candidates && data.candidates.length > 0) {
    const place = data.candidates[0];

    console.log("🔥 PLACE FOUND:", place.place_id);

    const detailsUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${place.place_id}&fields=address_components&key=${API_KEY}`;

    let detailsData;
    try {
      const detailsRes = await fetch(detailsUrl);
      const dtext = await detailsRes.text();
      try {
        detailsData = dtext ? JSON.parse(dtext) : {};
      } catch (parseErr) {
        console.error("placedetails: invalid JSON", parseErr && parseErr.message, dtext && dtext.slice(0, 200));
        return failedStoreRow(route, cleaned);
      }
    } catch (fetchErr) {
      console.error("placedetails fetch failed:", fetchErr && fetchErr.message);
      return failedStoreRow(route, cleaned);
    }

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

    console.log("TRACE: GOOGLE RESULT USED", canonical);

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

    try {
      if (!existingQuery.empty) {
        const docId = existingQuery.docs[0].id;

        await db.collection("storeLocations").doc(docId).update(result);

        console.log("♻️ UPDATED EXISTING STORE:", result.canonicalName);
      } else {
        await db.collection("storeLocations").doc(result.canonicalName).set(result, { merge: true });

        console.log("🆕 CREATED NEW STORE:", result.canonicalName);
      }
    } catch (fireErr) {
      console.error("storeLocations write failed:", fireErr && fireErr.message);
      return failedStoreRow(route, cleaned);
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
  if (!storeRow || typeof storeRow !== "object") {
    return {
      ...route,
      address: "",
      suburb: "",
      city: "",
      province: "",
      lat: null,
      lng: null,
      canonicalName: cleanedCanonicalPreview(route.customer || ""),
      failed: true,
      resolutionStatus: "needs_attention",
      _resolved: false,
    };
  }
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

/** Parse JSON body when the runtime did not populate req.body (some proxies / raw handlers). */
function httpJsonBody(req) {
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) {
    return req.body;
  }
  const raw = req.rawBody;
  if (raw && Buffer.isBuffer(raw)) {
    try {
      const s = raw.toString("utf8");
      return s ? JSON.parse(s) : {};
    } catch (e) {
      return null;
    }
  }
  if (typeof req.body === "string" && req.body.length) {
    try {
      return JSON.parse(req.body);
    } catch (e) {
      return null;
    }
  }
  return req.body || {};
}

exports.consumeLogbookDownload = onRequest(
  {
    region: "us-central1",
    cors: true,
    invoker: "public",
  },
  async (req, res) => {
    try {
      if (req.method === "OPTIONS") {
        return res.status(204).send("");
      }
      if (req.method !== "POST") {
        return res.status(405).json({ success: false, error: "Method not allowed" });
      }
      const parsed = httpJsonBody(req);
      if (parsed === null) {
        return res.status(400).json({ success: false, error: "Invalid JSON" });
      }
      req.body = parsed;

      const isAdmin = await isAdminRequest(req);
      const token = getLogbookAccessTokenFromRequest(req);
      const requestId = req.headers["x-request-id"];

      if (!isAdmin && !token) {
        return res.status(403).json({ success: false, error: "Missing token" });
      }

      if (isAdmin) {
        console.log("ADMIN BYPASS ACTIVE");
      } else {
        if (!requestId) {
          return res.status(400).json({ success: false, error: "Missing request id" });
        }

        await consumeLogbookToken(token, requestId);
      }

      return res.json({ success: true });
    } catch (err) {
      return res.status(403).json({
        success: false,
        error: err && err.message ? String(err.message) : "Forbidden",
      });
    }
  }
);

/** Excel / parser upload: DB lookup, resolve only missing stores, return full preview rows (order preserved). */
exports.processRoutelistUpload = onRequest(
  { cors: true, region: "us-central1", invoker: "public" },
  async (req, res) => {
    try {
      if (req.method === "OPTIONS") return res.status(204).send("");
      if (req.method !== "POST") {
        return res.status(405).json({ error: "POST only" });
      }

      const parsed = httpJsonBody(req);
      if (parsed === null) {
        return res.status(400).json({ error: "invalid_json" });
      }
      req.body = parsed;

      const isAdmin = await isAdminRequest(req);

      if (isAdmin) {
        console.log("ADMIN BYPASS ACTIVE");
      } else {
        const tokenFromHeader = String(
          req.headers["x-logbook-token"] ||
            req.headers["X-Logbook-Token"] ||
            ""
        ).trim();
        const tokenFromBody =
          parsed &&
          parsed.logbookAccessToken != null &&
          String(parsed.logbookAccessToken).trim() !== ""
            ? String(parsed.logbookAccessToken).trim()
            : "";
        const token = tokenFromHeader || tokenFromBody;

        if (!token) {
          return res.status(401).json({ error: "Missing token" });
        }

        const tokenDoc = await admin
          .firestore()
          .collection("logbook_tokens")
          .doc(token)
          .get();

        if (!tokenDoc.exists) {
          return res.status(401).json({ error: "Invalid token" });
        }

        console.log("UPLOAD ALLOWED — TOKEN VALID");
      }

      const routes = parsed && parsed.routes;
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

        console.log("TRACE: CHECKING DB FOR", cleaned);
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
          console.log("TRACE: DB HIT", cleaned);
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
      return res.status(500).json({
        error: "process_routelist_upload_failed",
        message: err && err.message ? String(err.message) : "unknown",
      });
    }
  }
);

function computeRouteEditedPreview(r, original) {
  const o = original || {};
  return ["address", "suburb", "city", "province"].some(
    (f) => String(r[f] ?? "").trim() !== String(o[f] ?? "").trim()
  );
}

/** Pre-edit address line from client (never replaced by geocoded formatted_address). */
function pickOriginalAddressFromClientRoute(row) {
  if (!row || typeof row !== "object") return "";
  const trim = (v) =>
    v != null && String(v).trim() !== "" ? String(v).trim() : "";
  let s = trim(row.originalAddress);
  if (s) return s;
  s = trim(row.address_original);
  if (s) return s;
  s = trim(row.rawAddress);
  if (s) return s;
  if (row.original && typeof row.original === "object") {
    s = trim(row.original.address);
    if (s) return s;
  }
  return "";
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

      const API_KEY = process.env.GOOGLE_API_KEY || "";

      const body = httpJsonBody(req);
      if (body === null) {
        return res.status(400).json({ error: "invalid_json" });
      }
      const fullRoutes = body.routes;
      const v = validateRoutesInput(fullRoutes);
      if (!v.ok) {
        return res.status(400).json(v.body);
      }
      if (!fullRoutes.length) {
        return res.status(400).json({ error: "routes required" });
      }

      console.log("🔥 BACKEND RECEIVED ROUTES:", fullRoutes);

      warnDuplicateCanonicalsInBatch(fullRoutes);

      const db = admin.firestore();

      const merged = [];
      for (let i = 0; i < fullRoutes.length; i++) {
        const inputRow = fullRoutes[i];
        const base = { ...fullRoutes[i] };
        let updated;
        if (API_KEY && needsReprocessServer(base)) {
          updated = await geocodePreviewRoute(base, API_KEY);
        } else {
          const k = cleanedCanonicalPreview(base.customer || "");
          base.canonicalName = k;
          base.processed = true;
          base._resolved = base._resolved !== false;
          base.resolutionStatus = base.resolutionStatus || "ok";
          updated = normalizeRouteCoordsDeep(base);
        }

        const editedLine =
          inputRow.address != null ? String(inputRow.address).trim() : "";
        const origLine = pickOriginalAddressFromClientRoute(inputRow);
        const oSnap =
          updated.original && typeof updated.original === "object"
            ? updated.original
            : {};
        const originalAddressFinal =
          origLine ||
          (oSnap.address != null ? String(oSnap.address).trim() : "");
        const currentAddr =
          editedLine ||
          (updated.address != null ? String(updated.address).trim() : "");
        const addressForUi =
          editedLine ||
          (updated.address != null ? String(updated.address) : "");

        const outRow = {
          ...inputRow,
          ...updated,
          status: "pending",
          address: addressForUi,
          originalAddress: originalAddressFinal,
          currentAddress: currentAddr,
        };
        if (inputRow.addressEdited === true || inputRow.isEdited === true) {
          if (inputRow.province !== undefined && inputRow.province !== null) {
            outRow.province = String(inputRow.province).trim();
          }
        }
        console.log("🔥 BACKEND ROUTE:", {
          originalAddress: originalAddressFinal,
          currentAddress: currentAddr,
          address: addressForUi,
        });
        merged.push(outRow);
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

      console.log("🔥 PENDING SUBMISSION WRITE:", {
        routes: processedRoutes,
        status: "pending",
        routeCount: processedRoutes.length
      });

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

      console.log(
        "🔥 APPROVED FINAL WRITE:",
        routes.filter((r) => r && r.status === "approved")
      );

      for (const route of routes) {
        if (route.status !== "approved") continue;
        if (!route.canonicalName) continue;

        {
          const docRef = db.collection("storeLocations").doc(route.canonicalName);
          const approvedAddr =
            route.currentAddress != null &&
            String(route.currentAddress).trim() !== ""
              ? String(route.currentAddress).trim()
              : route.address != null
                ? String(route.address)
                : "";
          await docRef.set(
            {
              canonicalName: route.canonicalName,
              address: approvedAddr,
              suburb: route.suburb,
              city: route.city,
              province: route.province,
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

