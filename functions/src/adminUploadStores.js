/**
 * Admin bulk store upload → storeLocations via processRoutelistUpload HTTP API (same as frontend).
 */

const admin = require("firebase-admin");

function db() {
  return admin.firestore();
}

async function uploadStoresFromExcel(rows) {
  const { cleanedCanonicalPreview } = require("../index");
  const FUNCTIONS_BASE = "http://127.0.0.1:5007/autologbook-sa/us-central1";
  const processRoutelistUploadUrl = FUNCTIONS_BASE + "/processRoutelistUpload";
  const dbRef = db();

  let total = 0;

  for (const row of rows) {
    const storeName = String(row.Customer || "").trim();

    if (!storeName) continue;

    const canonical = cleanedCanonicalPreview(storeName);

    // skip existing
    const existingDoc = await dbRef
      .collection("storeLocations")
      .doc(canonical)
      .get();

    if (existingDoc.exists) {
      continue;
    }

    console.log("🔥 FETCH CALL:", processRoutelistUploadUrl);
    let response;
    let responseText;
    try {
      response = await fetch(processRoutelistUploadUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          routes: [{ customer: storeName }]
        })
      });
      responseText = await response.text();
      console.log("🔥 FETCH SUCCESS:", responseText);
    } catch (err) {
      console.error("❌ FETCH FAILED:", err);
      throw err;
    }

    let data = {};
    try {
      data = responseText ? JSON.parse(responseText) : {};
    } catch (_parseErr) {
      data = {};
    }
    const resolved = data && data[0];

    if (!resolved) continue;

    const firestoreWriteData = {
      ...resolved,
      source: "admin",
      updatedAt: Date.now()
    };
    console.log("🔥 WRITING TO FIRESTORE:", firestoreWriteData);

    await dbRef
      .collection("storeLocations")
      .doc(resolved.canonicalName)
      .set(firestoreWriteData, { merge: true });

    total++;
  }

  return {
    success: true,
    total
  };
}

module.exports = { uploadStoresFromExcel };
