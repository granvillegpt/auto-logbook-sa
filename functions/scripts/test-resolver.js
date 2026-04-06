/**
 * One-off test: run the route resolver with a sample business name and print result.
 * Usage (from repo root): node functions/scripts/test-resolver.js
 * Requires .env with GOOGLE_API_KEY or GOOGLE_PLACES_API_KEY (etc.).
 */
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../../.env") });
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const { getGoogleApiKey } = require("../src/googleApiKey");
const { resolveRouteAddresses } = require("../src/routeAddressResolver");

const apiKey = getGoogleApiKey();
if (!apiKey) {
  console.error(
    "No API key. Set GOOGLE_API_KEY or GOOGLE_PLACES_API_KEY in repo root or functions/.env"
  );
  process.exit(1);
}

const testRoute = {
  customer: "BELMONT BLUE BOTTLE LIQUORS (PTY) LTD",
  address: null,
  suburb: null,
  city: null,
  province: null,
  days: { mon: true, thu: true },
  weeks: [1, 2, 3, 4]
};

console.log("Calling resolveRouteAddresses with 1 route (customer only)...\n");

resolveRouteAddresses([testRoute], apiKey, { debug: true })
  .then((routes) => {
    const r = routes[0];
    console.log("\n--- Result ---");
    console.log("customer:", r.customer);
    console.log("lat:", r.lat);
    console.log("lng:", r.lng);
    console.log("fullAddress:", r.fullAddress || "(empty)");
    if (r.lat != null && r.lng != null) {
      console.log("Status: RESOLVED");
    } else {
      console.log("Status: UNRESOLVED (no coordinates)");
    }
  })
  .catch((err) => {
    console.error("Error:", err.message);
    process.exit(1);
  });
