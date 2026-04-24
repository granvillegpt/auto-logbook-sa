/**
 * Shared handlers for logbook submission route approval (used by Express /api/* and Cloud Functions).
 */
const admin = require("firebase-admin");
const { FieldValue } = require("firebase-admin/firestore");

async function handleUpdateRouteStatus(req, res) {
  try {
    if (req.method === "OPTIONS") return res.status(204).send("");
    if (req.method !== "POST") return res.status(405).end();

    const body = req.body || {};
    const { submissionId, routeIndex, status } = body;

    if (!submissionId || routeIndex === undefined || !status) {
      return res.status(400).json({ error: "invalid_request" });
    }

    const db = admin.firestore();
    const ref = db.collection("logbookSubmissions").doc(submissionId);
    const snap = await ref.get();

    if (!snap.exists) {
      return res.status(404).json({ error: "not_found" });
    }

    const data = snap.data();
    const routes = [...(data.routes || [])];

    if (!routes[routeIndex]) {
      return res.status(400).json({ error: "invalid_index" });
    }

    routes[routeIndex] = {
      ...routes[routeIndex],
      status,
    };

    await ref.update({ routes });

    return res.json({ success: true });
  } catch (err) {
    console.error("updateRouteStatus:", err);
    return res.status(500).json({ error: "failed" });
  }
}

async function handleApproveLogbookSubmission(req, res) {
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

    const approvedForWrite = routes.filter((r) => r && r.status === "approved");
    console.log("🔥 APPROVED FINAL WRITE:", approvedForWrite);

    for (const route of routes) {
      if (route.status !== "approved") continue;
      if (!route.canonicalName) continue;

      const approvedAddr =
        route.currentAddress != null &&
        String(route.currentAddress).trim() !== ""
          ? String(route.currentAddress).trim()
          : route.address != null
            ? String(route.address)
            : "";

      const docRef = db.collection("storeLocations").doc(route.canonicalName);
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

module.exports = {
  handleUpdateRouteStatus,
  handleApproveLogbookSubmission,
};
