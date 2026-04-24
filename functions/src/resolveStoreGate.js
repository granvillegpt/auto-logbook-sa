/**
 * Authoritative access control for store resolution (resolveStore).
 * Allows Firebase-authenticated admins OR a valid logbook payment token (Firestore logbook_tokens).
 * Gate bypass for token checks: development only (see isGateDisabled).
 */

const admin = require("firebase-admin");
const { HttpsError } = require("firebase-functions/v2/https");

function ensureAdminApp() {
  if (!admin.apps.length) {
    admin.initializeApp();
  }
}

function isGateDisabled() {
  return process.env.NODE_ENV === "development";
}

/**
 * @param {import("firebase-admin/auth").DecodedIdToken | null | undefined} decoded
 */
function isAdminUser(decoded) {
  if (!decoded || typeof decoded !== "object") return false;
  if (decoded.admin === true) return true;
  if (decoded.role === "admin") return true;
  return false;
}

function remainingFromDocData(data) {
  const d = data && typeof data === "object" ? data : {};
  return typeof d.remaining === "number" && Number.isFinite(d.remaining)
    ? d.remaining
    : 3;
}

/** Doc exists and has at least one generation remaining (read-only; no decrement). */
async function isValidLogbookToken(token) {
  const t = String(token || "").trim();
  if (!t) return false;
  ensureAdminApp();
  const doc = await admin.firestore().collection("logbook_tokens").doc(t).get();
  if (!doc.exists) return false;
  const remaining = remainingFromDocData(doc.data());
  return remaining > 0;
}

/**
 * Atomically decrement remaining by 1 once per requestId. Admin path must not call this.
 * @param {string|null|undefined} requestId Client X-Request-Id (e.g. crypto.randomUUID); repeats are no-ops.
 * @throws {Error} Invalid token | No tokens remaining | Invalid token state
 */
async function consumeLogbookToken(token, requestId) {
  console.log("🔥 CONSUME CALLED WITH TOKEN:", token, "REQUEST ID:", requestId);
  const t = String(token || "").trim();
  if (!t) {
    throw new Error("Invalid token");
  }
  const rid = requestId != null ? String(requestId).trim() : "";
  if (rid.length > 200) {
    throw new Error("Invalid token state");
  }

  ensureAdminApp();
  const db = admin.firestore();
  const ref = db.collection("logbook_tokens").doc(t);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);

    if (!snap.exists) {
      throw new Error("Invalid token");
    }

    const data = snap.data() || {};
    const remaining = Number(data.remaining || 0);
    console.log("🔥 TOKEN DOC:", data);
    console.log("🔥 REMAINING BEFORE:", remaining);

    if (remaining <= 0) {
      throw new Error("No tokens remaining");
    }

    const rawUr =
      data.usedRequests && typeof data.usedRequests === "object" && !Array.isArray(data.usedRequests)
        ? data.usedRequests
        : {};
    const usedRequests = { ...rawUr };

    if (rid && usedRequests[rid]) {
      return;
    }

    const nextUsed = rid ? Object.assign({}, usedRequests, { [rid]: true }) : usedRequests;
    const trimmedUsed = Object.fromEntries(Object.entries(nextUsed).slice(-20));

    tx.update(ref, {
      remaining: remaining - 1,
      lastUsedAt: Date.now(),
      usedRequests: trimmedUsed,
    });
    console.log("🔥 REMAINING AFTER:", remaining - 1);
  });
}

async function getDecodedIdTokenFromRequest(req) {
  const raw = req.headers.authorization || req.headers.Authorization || "";
  const m = String(raw).match(/^Bearer\s+(\S+)/i);
  if (!m) return null;
  ensureAdminApp();
  try {
    return await admin.auth().verifyIdToken(m[1]);
  } catch {
    return null;
  }
}

function getLogbookAccessTokenFromRequest(req) {
  const h = req.headers["x-logbook-token"] || req.headers["X-Logbook-Token"];
  if (h && String(h).trim()) return String(h).trim();
  const body = req.body || {};
  const fromBody =
    body.logbookAccessToken != null ? String(body.logbookAccessToken).trim() : "";
  if (fromBody) return fromBody;
  return "";
}

/** For /api/generateLogbook and logbookAccessState: doc must exist and remaining > 0. */
async function logbookTokenAllowsGenerateHttp(req, token) {
  const t = String(token || "").trim();
  if (!t) return false;
  ensureAdminApp();
  const doc = await admin.firestore().collection("logbook_tokens").doc(t).get();
  if (!doc.exists) return false;
  const data = doc.data() || {};
  const remaining = Number(data.remaining || 0);

  if (remaining <= 0) {
    return false; // 🚨 HARD LOCK
  }

  return true;
}

async function assertResolveStoreAllowedHttp(req, adminKeySecret) {
  if (isGateDisabled()) return;

  const secret = adminKeySecret != null ? String(adminKeySecret).trim() : "";
  if (secret && String(req.headers["x-admin-key"] || "") === secret) {
    return;
  }

  const decoded = await getDecodedIdTokenFromRequest(req);
  if (isAdminUser(decoded)) return;

  const logbookToken = getLogbookAccessTokenFromRequest(req);
  if (await isValidLogbookToken(logbookToken)) return;

  const err = new Error("Invalid token");
  err.statusCode = 403;
  throw err;
}

async function assertResolveStoreAllowedCallable(request) {
  if (isGateDisabled()) return;

  const tokenClaims = request.auth && request.auth.token;
  if (isAdminUser(tokenClaims)) return;

  const data = request.data || {};
  const logbookToken = String(
    data.logbookAccessToken != null ? data.logbookAccessToken : data.token || ""
  ).trim();
  if (await isValidLogbookToken(logbookToken)) return;

  throw new HttpsError("permission-denied", "Invalid token");
}

/**
 * Single source of truth for logbook generation access (UI + optional generate enforcement).
 */
async function evaluateLogbookAccessHttp(req) {
  if (isGateDisabled()) {
    return { canGenerate: true, isAdmin: false, reason: null };
  }

  const decoded = await getDecodedIdTokenFromRequest(req);
  if (isAdminUser(decoded)) {
    return { canGenerate: true, isAdmin: true, reason: null };
  }

  const logbookToken = getLogbookAccessTokenFromRequest(req);
  if (!(await logbookTokenAllowsGenerateHttp(req, logbookToken))) {
    return {
      canGenerate: false,
      isAdmin: false,
      reason: "Invalid or missing token",
    };
  }

  return { canGenerate: true, isAdmin: false, reason: null };
}

function isAdminDashboardRequest(req) {
  return req.headers["x-admin-dashboard"] === "true";
}

async function isAdminRequest(req) {
  try {
    const raw = req.headers.authorization || req.headers.Authorization || "";
    const m = String(raw).match(/^Bearer\s+(\S+)/i);
    if (!m) {
      return false;
    }

    const idToken = m[1];
    ensureAdminApp();
    const decoded = await admin.auth().verifyIdToken(idToken);
    console.log("ADMIN CHECK EMAIL:", decoded.email);

    const adminEmails = ["granvillepowell@icloud.com"];

    return adminEmails.includes(decoded.email);
  } catch (err) {
    console.error("ADMIN CHECK FAILED:", err && err.message ? String(err.message) : err);
    return false;
  }
}

module.exports = {
  isAdminUser,
  isValidLogbookToken,
  isGateDisabled,
  assertResolveStoreAllowedHttp,
  assertResolveStoreAllowedCallable,
  getDecodedIdTokenFromRequest,
  getLogbookAccessTokenFromRequest,
  evaluateLogbookAccessHttp,
  logbookTokenAllowsGenerateHttp,
  consumeLogbookToken,
  isAdminRequest,
  isAdminDashboardRequest,
};
