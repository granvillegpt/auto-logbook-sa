/**
 * Server-side Google Maps / Places / Geocode key.
 * Set any one of these in .env or Firebase config (same key is fine for all).
 */
function getGoogleApiKey() {
  const k =
    process.env.GOOGLE_API_KEY ||
    process.env.GOOGLE_PLACES_API_KEY ||
    process.env.GOOGLE_MAPS_API_KEY ||
    process.env.GOOGLE_GEOCODE_API_KEY ||
    "";
  return String(k).trim();
}

module.exports = { getGoogleApiKey };
