/**
 * Migrate ClearTrack apiCache_storeResolution → store_locations with OSM lat/lng.
 *
 * Requires: Firebase credentials (GOOGLE_APPLICATION_CREDENTIALS or gcloud auth).
 * Run: node scripts/migrateStores.js
 */

const admin = require("firebase-admin");
const fetch = require("node-fetch");
const { normalizeStoreQuery } = require("../functions/src/resolveStore");

admin.initializeApp();

const db = admin.firestore();

async function geocode(address) {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(String(address || ""))}&format=json&limit=1`;

  const res = await fetch(url, {
    headers: { "User-Agent": "autologbook" }
  });

  const data = await res.json();

  if (!data.length) return null;

  return {
    lat: parseFloat(data[0].lat),
    lng: parseFloat(data[0].lon)
  };
}

async function run() {
  const snapshot = await db.collection("apiCache_storeResolution").get();

  for (const doc of snapshot.docs) {
    const d = doc.data();

    const storeName = d.customer;
    const address = d.formattedAddress || d.address;

    if (!storeName || !address) continue;

    const key = normalizeStoreQuery(storeName);
    if (!key) continue;

    const exists = await db.collection("store_locations").doc(key).get();
    if (exists.exists) continue;

    const geo = await geocode(address);
    if (!geo) continue;

    await db.collection("store_locations").doc(key).set({
      storeName,
      address,
      lat: geo.lat,
      lng: geo.lng,
      createdAt: Date.now()
    });

    console.log("Saved:", storeName);
  }

  console.log("DONE");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
