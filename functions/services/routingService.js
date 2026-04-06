/**
 * Geocoding helper (address → lat/lng). Distance routing APIs are disabled.
 */

const GOOGLE_BASE = "https://maps.googleapis.com/maps/api";

async function geocodeAddress(trimmed, apiKey) {
  if (!trimmed || !apiKey) return null;
  const url = `${GOOGLE_BASE}/geocode/json?address=${encodeURIComponent(trimmed)}&key=${apiKey}`;
  const r = await fetch(url);
  const data = await r.json();
  const first = data.results && data.results[0];
  const loc = first && first.geometry && first.geometry.location;
  if (loc != null && typeof loc.lat === "number" && typeof loc.lng === "number") {
    return { lat: loc.lat, lng: loc.lng };
  }
  return null;
}

/**
 * Legacy hook: engine does not use routing for distances (haversine-only).
 * Retained for compatibility; distance methods reject.
 */
async function createRoutingServiceForInput() {
  return {
    getDistance() {
      return Promise.reject(new Error("Routing disabled"));
    },
    getDistances() {
      return Promise.reject(new Error("Routing disabled"));
    }
  };
}

module.exports = {
  geocodeAddress,
  createRoutingServiceForInput
};
