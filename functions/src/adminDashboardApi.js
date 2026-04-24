const admin = require("firebase-admin");
const cheerio = require("cheerio");
const { FieldValue } = require("firebase-admin/firestore");
const { isSlotAvailable } = require("./sponsoredSlotValidation");
const { endDateISOFromBookedMonths } = require("./adBookingHelpers");
const { sendGridEmail } = require("./email");

/** SendGrid dynamic template: must include {{payment_link}}, {{amount}}, {{year}} */
const AD_PAYMENT_TEMPLATE_ID = "d-3661c0aff7db4d0cb246a989b3e3585e";
const SITE_ORIGIN = "https://autologbooksa.co.za";

if (!admin.apps.length) {
  admin.initializeApp();
}

/** Firestore does not accept undefined field values. */
function stripUndefined(obj) {
  const out = {};
  if (!obj || typeof obj !== "object") return out;
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

async function verifyAdmin(req, res) {
  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.replace("Bearer ", "");
    if (!token) {
      throw new Error("No token");
    }
    const decoded = await admin.auth().verifyIdToken(token);
    if (!decoded.admin) {
      throw new Error("Not admin");
    }
    return decoded;
  } catch (err) {
    console.error("VERIFY ERROR:", err);
    res.status(403).json({ success: false, error: "Unauthorized" });
    return null;
  }
}

function currentMonthKey() {
  const d = new Date();
  const m = d.getMonth() + 1;
  return `${d.getFullYear()}-${m < 10 ? `0${m}` : m}`;
}

async function getAdminDashboardData(req, res) {
  try {
    const db = admin.firestore();
    const month = (req.query.month || currentMonthKey()).toString();
    const [
      sponsoredSnap,
      pendingSnap,
      approvedSnap,
      rejectedSnap,
      statsSnap,
      toolsPendingSnap,
      logbookSubmissionsPendingSnap,
    ] = await Promise.all([
      db.collection("sponsoredTools").get(),
      db.collection("reviews_pending").orderBy("createdAt", "desc").limit(50).get(),
      db.collection("reviews_approved").orderBy("createdAt", "desc").limit(50).get(),
      db.collection("reviews_rejected").orderBy("createdAt", "desc").limit(50).get(),
      db.collection("system").doc("reviewStats").get(),
      db.collection("tools_pending").get(),
      db.collection("logbookSubmissions").where("status", "==", "pending").get(),
    ]);

    const sponsoredTools = [];
    sponsoredSnap.forEach((d) => sponsoredTools.push({ id: d.id, ...d.data() }));
    const reviewsPending = [];
    pendingSnap.forEach((d) => reviewsPending.push({ id: d.id, ...d.data() }));
    const reviewsApproved = [];
    approvedSnap.forEach((d) => reviewsApproved.push({ id: d.id, ...d.data() }));
    const reviewsRejected = [];
    rejectedSnap.forEach((d) => reviewsRejected.push({ id: d.id, ...d.data() }));
    const tools_pending = [];
    toolsPendingSnap.forEach((d) => tools_pending.push({ id: d.id, ...d.data() }));
    const logbook_submissions_pending = [];
    logbookSubmissionsPendingSnap.forEach((d) =>
      logbook_submissions_pending.push({ id: d.id, ...d.data() })
    );

    return res.json({
      success: true,
      month,
      sponsoredTools,
      reviews_pending: reviewsPending,
      reviews_approved: reviewsApproved,
      reviews_rejected: reviewsRejected,
      tools_pending,
      logbook_submissions_pending,
      reviewStats: statsSnap.exists ? statsSnap.data() : {},
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message || "Failed to load dashboard data" });
  }
}

/** Full list for admin logbook submissions tab (Admin SDK; avoids client rules on logbookSubmissions). */
async function getLogbookSubmissionsForAdmin(_req, res) {
  try {
    const db = admin.firestore();
    const snap = await db.collection("logbookSubmissions").get();
    const submissions = [];
    snap.forEach((d) => submissions.push({ id: d.id, ...d.data() }));
    return res.json({ success: true, submissions });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message || "Failed to load logbook submissions" });
  }
}

async function getAdminDashboardStats(_req, res) {
  try {
    const db = admin.firestore();

    const [approvedSnap, pendingSnap, rejectedSnap] = await Promise.all([
      db.collection("reviews_approved").get(),
      db.collection("reviews_pending").get(),
      db.collection("reviews_rejected").get(),
    ]);

    let revenue = 0;
    const reviewsByDay = {};
    const revenueByDay = {};
    const activityMap = {};
    const ratingMap = {};
    const ratingCount = {};

    approvedSnap.forEach((doc) => {
      const data = doc.data() || {};
      const company = data.company || "Unknown";
      activityMap[company] = (activityMap[company] || 0) + 1;
      if (data.rating != null) {
        const rating = Number(data.rating);
        if (Number.isFinite(rating)) {
          ratingMap[company] = (ratingMap[company] || 0) + rating;
          ratingCount[company] = (ratingCount[company] || 0) + 1;
        }
      }
      if (!data.createdAt) return;
      let dateObj = null;
      if (data.createdAt && typeof data.createdAt.seconds === "number") {
        dateObj = new Date(data.createdAt.seconds * 1000);
      } else {
        const maybeDate = new Date(data.createdAt);
        if (!Number.isNaN(maybeDate.getTime())) dateObj = maybeDate;
      }
      if (!dateObj) return;
      const date = dateObj.toISOString().slice(0, 10);
      reviewsByDay[date] = (reviewsByDay[date] || 0) + 1;
    });

    try {
      const paymentsSnap = await db.collection("payments").get();
      paymentsSnap.forEach((doc) => {
        const data = doc.data() || {};
        if (data.amount != null && data.amount !== "") {
          const amount = Number(data.amount);
          if (Number.isFinite(amount)) revenue += amount;
          if (data.createdAt && Number.isFinite(amount)) {
            let dateObj = null;
            if (typeof data.createdAt.seconds === "number") {
              dateObj = new Date(data.createdAt.seconds * 1000);
            } else {
              const maybeDate = new Date(data.createdAt);
              if (!Number.isNaN(maybeDate.getTime())) dateObj = maybeDate;
            }
            if (dateObj) {
              const date = dateObj.toISOString().slice(0, 10);
              revenueByDay[date] = (revenueByDay[date] || 0) + amount;
            }
          }
        }
      });
    } catch (_err) {
      revenue = 0;
    }

    const mostActive = Object.entries(activityMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, count]) => ({ name, count }));

    const topRated = Object.keys(ratingMap)
      .map((name) => ({
        name,
        avgRating: ratingMap[name] / ratingCount[name],
      }))
      .sort((a, b) => b.avgRating - a.avgRating)
      .slice(0, 5);

    const alerts = [];
    if (pendingSnap.size > 5) {
      alerts.push("⚠️ High number of pending reviews");
    }
    if (revenue === 0) {
      alerts.push("⚠️ No revenue recorded yet");
    }

    return res.json({
      success: true,
      approved: approvedSnap.size,
      pending: pendingSnap.size,
      rejected: rejectedSnap.size,
      revenue,
      reviewsByDay,
      revenueByDay,
      mostActive,
      topRated,
      alerts,
    });
  } catch (error) {
    console.error("Stats error:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to load stats",
    });
  }
}

async function approveAd(req, res) {
  try {
    const adId = req.body && req.body.adId;
    if (!adId) return res.status(400).json({ success: false, error: "Missing adId" });
    const db = admin.firestore();
    const doc = await db.collection("sponsoredTools").doc(String(adId)).get();

    if (!doc.exists) {
      return res.status(404).json({ success: false, error: "Ad not found" });
    }

    const ad = doc.data() || {};

    const email =
      ad.contactEmail ||
      ad.email ||
      ad.userEmail ||
      "";

    const amount = Number(ad.amount || 0);

    const title =
      ad.title ||
      ad.toolName ||
      "Your Ad";

    const slot = ad.slot || "your selected slot";

    const status = String(ad.status || "").toLowerCase().trim();
    if (status !== "pending") {
      return res.status(400).json({ success: false, error: "Ad is not pending approval" });
    }
    const months = Array.isArray(ad.months) ? ad.months : [];
    if (!ad.slot || !months.length) {
      return res.status(400).json({ success: false, error: "Invalid ad configuration" });
    }
    const ok = await isSlotAvailable(ad.slot, months, String(adId));
    if (!ok) {
      return res.status(400).json({
        success: false,
        error: "Slot already booked for one of the selected months",
      });
    }
    const payment_id = String(adId).trim();
    if (!payment_id) {
      console.error("INVALID AD ID", adId);
      return res.status(400).json({ success: false, error: "Invalid ad id" });
    }

    const userEmail = String(email).trim();
    if (!userEmail || !userEmail.includes("@")) {
      return res.status(400).json({ success: false, error: "Ad missing contact email" });
    }

    const adPrice = amount;
    if (!Number.isFinite(adPrice) || adPrice <= 0) {
      return res.status(400).json({ success: false, error: "Invalid ad amount" });
    }

    const monthsCount = Array.isArray(months)
      ? months.length
      : parseInt(months, 10);

    const monthsSafe =
      Number.isFinite(monthsCount) && monthsCount > 0 ? monthsCount : 1;
    const payment_link =
      `${SITE_ORIGIN}/pay.html?product=ad&adId=${encodeURIComponent(payment_id)}` +
      `&amount=${encodeURIComponent(adPrice.toFixed(2))}` +
      `&email=${encodeURIComponent(userEmail)}` +
      `&item_name=${encodeURIComponent("Ad Placement")}` +
      `&months=${encodeURIComponent(String(monthsSafe))}`;

    if (email && amount > 0) {
      try {
        await sendGridEmail({
          to: userEmail,
          templateId: AD_PAYMENT_TEMPLATE_ID,
          dynamicTemplateData: {
            payment_link: payment_link,
            amount: adPrice.toFixed(2),
            year: new Date().getFullYear(),
          },
        });
      } catch (err) {
        console.error("EMAIL ERROR:", err);
      }
    }

    const year = new Date().getFullYear();
    const endDate = endDateISOFromBookedMonths(months, year);
    await db.collection("sponsoredTools").doc(String(adId)).update({
      status: "approved",
      endDate: endDate || null,
      emailSent: true,
    });
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message || "Approve failed" });
  }
}

async function rejectAd(req, res) {
  try {
    const adId = req.body && req.body.adId;
    if (!adId) return res.status(400).json({ success: false, error: "Missing adId" });
    const db = admin.firestore();
    await db.collection("sponsoredTools").doc(String(adId)).update({ status: "rejected" });
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message || "Reject failed" });
  }
}

async function deleteAd(req, res) {
  try {
    const adId = req.body && req.body.adId;
    if (!adId) return res.status(400).json({ success: false, error: "Missing adId" });
    const db = admin.firestore();
    await db.collection("sponsoredTools").doc(String(adId)).delete();
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message || "Delete failed" });
  }
}

async function approveReview(req, res) {
  try {
    const reviewId = req.body && req.body.reviewId;
    if (!reviewId) return res.status(400).json({ success: false, error: "Missing reviewId" });
    const db = admin.firestore();
    const fromRef = db.collection("reviews_pending").doc(String(reviewId));
    const toRef = db.collection("reviews_approved").doc(String(reviewId));
    const statRef = db.collection("system").doc("reviewStats");
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(fromRef);
      if (!snap.exists) throw new Error("Review not found");
      tx.set(toRef, { ...snap.data(), status: "approved" });
      tx.delete(fromRef);
      tx.set(
        statRef,
        {
          pending: FieldValue.increment(-1),
          approved: FieldValue.increment(1),
        },
        { merge: true }
      );
    });
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message || "Approve review failed" });
  }
}

async function approveToolSubmission(req, res) {
  try {
    const toolId = req.body && req.body.toolId;
    if (!toolId) return res.status(400).json({ success: false, error: "Missing toolId" });
    const db = admin.firestore();
    const fromRef = db.collection("tools_pending").doc(String(toolId));
    const toRef = db.collection("sponsoredTools").doc(String(toolId));
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(fromRef);
      if (!snap.exists) throw new Error("Tool submission not found");
      const data = snap.data() || {};
      const merged = {
        ...data,
        status: "approved",
        approvedAt: Date.now(),
        toolName: data.toolName || data.title,
        website: data.website || data.url,
        logo: data.logo != null ? data.logo : data.image,
        description: data.description,
        clicks: Number(data.clicks) || 0,
        views: Number(data.views) || 0,
      };
      tx.set(toRef, stripUndefined(merged));
      tx.delete(fromRef);
    });
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message || "Approve tool failed" });
  }
}

async function rejectToolSubmission(req, res) {
  try {
    const toolId = req.body && req.body.toolId;
    if (!toolId) return res.status(400).json({ success: false, error: "Missing toolId" });
    const db = admin.firestore();
    const fromRef = db.collection("tools_pending").doc(String(toolId));
    const toRef = db.collection("tools_rejected").doc(String(toolId));
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(fromRef);
      if (!snap.exists) throw new Error("Tool submission not found");
      const data = snap.data() || {};
      tx.set(toRef, stripUndefined({ ...data, status: "rejected", rejectedAt: Date.now() }));
      tx.delete(fromRef);
    });
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message || "Reject tool failed" });
  }
}

async function rejectReview(req, res) {
  try {
    const reviewId = req.body && req.body.reviewId;
    if (!reviewId) return res.status(400).json({ success: false, error: "Missing reviewId" });
    const db = admin.firestore();
    const fromRef = db.collection("reviews_pending").doc(String(reviewId));
    const toRef = db.collection("reviews_rejected").doc(String(reviewId));
    const statRef = db.collection("system").doc("reviewStats");
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(fromRef);
      if (!snap.exists) throw new Error("Review not found");
      tx.set(toRef, { ...snap.data(), status: "rejected" });
      tx.delete(fromRef);
      tx.set(
        statRef,
        {
          pending: FieldValue.increment(-1),
          rejected: FieldValue.increment(1),
        },
        { merge: true }
      );
    });
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message || "Reject review failed" });
  }
}

async function deleteReview(req, res) {
  try {
    const reviewId = req.body && req.body.reviewId;
    const sourceCollection = req.body && req.body.sourceCollection;
    if (!reviewId || !sourceCollection) {
      return res.status(400).json({ success: false, error: "Missing reviewId or sourceCollection" });
    }
    const allowed = ["reviews_pending", "reviews_approved", "reviews_rejected"];
    if (!allowed.includes(sourceCollection)) {
      return res.status(400).json({ success: false, error: "Invalid sourceCollection" });
    }
    const db = admin.firestore();
    const field =
      sourceCollection === "reviews_pending"
        ? "pending"
        : sourceCollection === "reviews_approved"
          ? "approved"
          : "rejected";
    await db.collection(sourceCollection).doc(String(reviewId)).delete();
    await db.collection("system").doc("reviewStats").set(
      { [field]: FieldValue.increment(-1) },
      { merge: true }
    );
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message || "Delete review failed" });
  }
}

async function unassignPlacement(req, res) {
  try {
    const placementId = req.body && req.body.placementId;
    if (!placementId) return res.status(400).json({ success: false, error: "Missing placementId" });
    const db = admin.firestore();
    await db.collection("adPlacements").doc(String(placementId)).delete();
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message || "Unassign failed" });
  }
}

const ARTICLE_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Page-level / site chrome selectors — must not appear inside article body HTML. */
const ARTICLE_BODY_BANNED_LAYOUT_TAGS = ["header", "footer", "nav", "main", "body", "html", "head"];
const ARTICLE_BODY_BANNED_LAYOUT_CLASSES = [
  "site-header",
  "site-header-landing",
  "site-nav",
  "site-footer",
  "footer-content",
  "nav-links",
];

function stripScriptStyleIframeAndInlineHandlers(html) {
  let s = html
    .replace(/<\/(?:script|style|iframe)[^>]*>/gi, "")
    .replace(/<(?:script|style|iframe)[^>]*>[\s\S]*?<\/(?:script|style|iframe)>/gi, "")
    .replace(/<(?:script|style|iframe)[^>]*\/?>/gi, "");
  s = s.replace(/\s+on\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  s = s.replace(/javascript:/gi, "");
  return s;
}

/**
 * Article body: allow typical rich text (p, headings, lists, emphasis, links, images,
 * blockquotes, div/section, tables, etc.) but strip site-level layout tags and known
 * Auto Logbook SA layout classnames from pasted full pages.
 */
function sanitizeArticleBody(html) {
  if (typeof html !== "string") return "";
  let s = stripScriptStyleIframeAndInlineHandlers(html);
  if (!s.trim()) return "";

  const wrapId = "__sanitize_article_body_root__";
  const wrapped = `<div id="${wrapId}">${s}</div>`;
  let $;
  try {
    $ = cheerio.load(wrapped, { decodeEntities: false });
  } catch (e) {
    console.warn("sanitizeArticleBody cheerio.load failed, returning stripped string only", e);
    return s.slice(0, 500000);
  }

  const root = $(`#${wrapId}`);
  if (!root.length) {
    return stripScriptStyleIframeAndInlineHandlers(s).slice(0, 500000);
  }

  for (const tag of ARTICLE_BODY_BANNED_LAYOUT_TAGS) {
    root.find(tag).remove();
  }
  for (const cls of ARTICLE_BODY_BANNED_LAYOUT_CLASSES) {
    root.find(`.${cls}`).remove();
  }

  let out = root.html() || "";
  out = stripScriptStyleIframeAndInlineHandlers(out);
  return out.slice(0, 500000);
}

async function resanitizeAllArticleBodies(req, res) {
  try {
    const db = admin.firestore();
    const snap = await db.collection("articles").get();
    const updatedSlugs = [];
    for (const doc of snap.docs) {
      const data = doc.data() || {};
      const raw = String(data.body || "");
      const cleaned = sanitizeArticleBody(raw);
      if (cleaned !== raw) {
        await doc.ref.update({
          body: cleaned,
          updatedAt: FieldValue.serverTimestamp(),
        });
        updatedSlugs.push(doc.id);
      }
    }
    return res.json({
      success: true,
      updatedSlugs,
      updatedCount: updatedSlugs.length,
    });
  } catch (err) {
    console.error("resanitizeAllArticleBodies", err);
    return res.status(500).json({ success: false, error: err.message || "Resanitize failed" });
  }
}

function articleDocToJSON(doc) {
  const data = doc.data() || {};
  const out = { id: doc.id, slug: doc.id, ...data };
  for (const key of ["createdAt", "updatedAt", "publishedAt"]) {
    const v = out[key];
    if (v && typeof v.toDate === "function") {
      out[key] = v.toDate().toISOString();
    }
  }
  return out;
}

async function getArticlesAdmin(req, res) {
  try {
    const db = admin.firestore();
    const snap = await db.collection("articles").get();
    const articles = snap.docs
      .map((d) => articleDocToJSON(d))
      .sort((a, b) => {
        const ta = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
        const tb = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
        return tb - ta;
      });
    return res.json({ success: true, articles });
  } catch (err) {
    console.error("getArticlesAdmin", err);
    return res.status(500).json({ success: false, error: err.message || "Failed to list articles" });
  }
}

async function upsertArticle(req, res, user) {
  try {
    const body = req.body || {};
    const title = String(body.title || "").trim();
    const slug = String(body.slug || "")
      .trim()
      .toLowerCase();
    const originalSlug =
      body.originalSlug != null ? String(body.originalSlug).trim().toLowerCase() : "";

    if (!title || title.length > 300) {
      return res.status(400).json({ success: false, error: "Title is required (max 300 chars)" });
    }
    if (!slug || !ARTICLE_SLUG_RE.test(slug) || slug.length > 200) {
      return res
        .status(400)
        .json({ success: false, error: "Invalid slug (lowercase letters, numbers, hyphens only)" });
    }

    const featuredImageUrl = String(body.featuredImageUrl || "").trim().slice(0, 2000);
    const excerpt = String(body.excerpt || "").trim().slice(0, 2000);
    const bodyHtml = sanitizeArticleBody(String(body.body || ""));
    const metaTitle = String(body.metaTitle || "").trim().slice(0, 200);
    const metaDescription = String(body.metaDescription || "").trim().slice(0, 500);
    const published = Boolean(body.published);
    const authorName = String(body.authorName || user.email || "Admin").trim().slice(0, 200);

    const db = admin.firestore();
    const now = FieldValue.serverTimestamp();
    const ref = db.collection("articles").doc(slug);

    if (originalSlug && originalSlug !== slug) {
      const oldRef = db.collection("articles").doc(originalSlug);
      const oldSnap = await oldRef.get();
      if (!oldSnap.exists) {
        return res.status(404).json({ success: false, error: "Original article not found" });
      }
      const oldData = oldSnap.data() || {};
      const createdAt = oldData.createdAt || now;
      let publishedAt = oldData.publishedAt || null;
      if (published && !oldData.published) {
        publishedAt = now;
      }
      if (!published) {
        publishedAt = null;
      }
      await db.runTransaction(async (tx) => {
        tx.delete(oldRef);
        tx.set(ref, {
          title,
          slug,
          featuredImageUrl,
          excerpt,
          body: bodyHtml,
          metaTitle,
          metaDescription,
          published,
          publishedAt,
          authorName,
          createdAt,
          updatedAt: now,
        });
      });
      return res.json({ success: true, slug });
    }

    const snap = await ref.get();
    const isCreate = !snap.exists;
    const prev = snap.exists ? snap.data() || {} : {};

    let publishedAt = prev.publishedAt || null;
    if (published && !prev.published) {
      publishedAt = now;
    }
    if (!published) {
      publishedAt = null;
    }

    const payload = {
      title,
      slug,
      featuredImageUrl,
      excerpt,
      body: bodyHtml,
      metaTitle,
      metaDescription,
      published,
      publishedAt,
      authorName,
      updatedAt: now,
    };

    if (isCreate) {
      payload.createdAt = now;
    } else {
      payload.createdAt = prev.createdAt || now;
    }

    await ref.set(payload, { merge: true });
    return res.json({ success: true, slug });
  } catch (err) {
    console.error("upsertArticle", err);
    return res.status(500).json({ success: false, error: err.message || "Save failed" });
  }
}

async function handleAdminDashboardApi(req, res) {
  // DEBUG START
  console.log("AUTH HEADERS:", req.headers.authorization);
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.split("Bearer ")[1] : null;
  console.log("TOKEN EXISTS:", !!token);
  // DEBUG END

  const user = await verifyAdmin(req, res);
  if (!user) return;
  if (req.method === "GET") {
    const action = req.query && req.query.action;
    if (action === "stats") return getAdminDashboardStats(req, res);
    if (action === "logbookSubmissions") return getLogbookSubmissionsForAdmin(req, res);
    if (action === "articlesAdmin") return getArticlesAdmin(req, res);
    return getAdminDashboardData(req, res);
  }
  if (req.method !== "POST") return res.status(405).json({ success: false, error: "Method not allowed" });
  const action = req.body && req.body.action;
  if (!action) return res.status(400).json({ success: false, error: "Missing action" });
  if (action === "upsertArticle") return upsertArticle(req, res, user);
  if (action === "resanitizeArticleBodies") return resanitizeAllArticleBodies(req, res);
  if (action === "approveAd") return approveAd(req, res);
  if (action === "rejectAd") return rejectAd(req, res);
  if (action === "deleteAd") return deleteAd(req, res);
  if (action === "approveReview") return approveReview(req, res);
  if (action === "approveToolSubmission") return approveToolSubmission(req, res);
  if (action === "rejectToolSubmission") return rejectToolSubmission(req, res);
  if (action === "rejectReview") return rejectReview(req, res);
  if (action === "deleteReview") return deleteReview(req, res);
  if (action === "unassignPlacement") return unassignPlacement(req, res);
  return res.status(400).json({ success: false, error: "Unknown action" });
}

module.exports = { handleAdminDashboardApi };
