// === ROUTE RESOLUTION AUDIT ===
// Run in browser console on the logbook page after routes are loaded (e.g. after uploading a routelist).
// Paste this file contents into the console, or load via: (function(){ var s=document.createElement('script'); s.src='/scripts/route-audit-console.js'; document.head.appendChild(s); })();

(function runRouteAudit() {
  console.log("========== ROUTE AUDIT START ==========");

  if (!window.currentRoutes || !window.currentRoutes.length) {
    console.warn("No routes found on window.currentRoutes");
    return;
  }

  window.currentRoutes.forEach((route, index) => {
    const queryParts = [
      route.customer,
      route.address,
      route.suburb,
      route.city,
      route.province,
      "South Africa"
    ].filter(Boolean);

    const builtQuery = queryParts.join(", ");

    console.log(`\n--- ROUTE ${index + 1} ---`);

    console.log("INPUT:", {
      customer: route.customer,
      address: route.address,
      suburb: route.suburb,
      city: route.city,
      province: route.province
    });

    console.log("BUILT QUERY:", builtQuery);

    console.log("FLAGS:", {
      hasLatLng: !!(route.lat && route.lng),
      source: route._source || "unknown",
      confidence: route._confidence || "n/a",
      resolved: route._resolved,
      verified: route._verified
    });

    console.log("COORDS:", {
      lat: route.lat,
      lng: route.lng
    });

    console.log("FULL ADDRESS:", route.fullAddress || "n/a");

    // Optional: check for weak queries
    const weakQuery =
      !route.address || !route.city;

    console.log("QUALITY CHECK:", {
      weakQuery,
      hasNumber: /\d/.test(route.address || "")
    });
  });

  console.log("========== ROUTE AUDIT END ==========");
})();
