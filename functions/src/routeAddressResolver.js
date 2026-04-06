/**
 * Route resolution: Places/Text Search → Place Details; geocode fallback uses customer + address parts (not suburb alone).
 */

const { buildSearchQuery } = require("./utils/buildSearchQuery");

function buildFullAddressFromParts(address, suburb, city, province) {
  const parts = [];
  if (address) parts.push(String(address).trim());
  if (suburb) parts.push(String(suburb).trim());
  if (city) parts.push(String(city).trim());
  if (province) parts.push(String(province).trim());
  return parts.length > 0 ? parts.join(", ") : null;
}

function extractAddressFieldsFromComponents(components) {
  let address = "";
  let suburb = "";
  let city = "";
  let province = "";

  (components || []).forEach(comp => {
    const types = comp.types;

    if (types.includes("street_number")) {
      address = `${comp.long_name} ${address}`;
    }

    if (types.includes("route")) {
      address += comp.long_name;
    }

    if (types.includes("sublocality") || types.includes("sublocality_level_1")) {
      suburb = comp.long_name;
    }

    if (types.includes("locality")) {
      city = comp.long_name;
    }

    if (types.includes("administrative_area_level_1")) {
      province = comp.long_name;
    }
  });

  return {
    address: address.trim(),
    suburb,
    city,
    province
  };
}

async function geocodeFallback(route, apiKey) {
  let query = route._googlePlacesInput || buildSearchQuery(route);
  query = String(query).trim();
  const withoutSa = query.replace(/,\s*South Africa$/i, "").trim();
  if (!withoutSa && String(route.address || "").trim()) {
    query = `${String(route.address).trim()}, South Africa`;
  }
  if (!query.replace(/,\s*South Africa$/i, "").trim()) return null;
  const geocodeQuery = query;
  console.log("=== GEOCODE FALLBACK ===");
  console.log("QUERY:", geocodeQuery);
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query)}&components=country:za&key=${apiKey}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.status !== "OK" || !data.results || !data.results[0]) return null;
  return data.results[0];
}

/** Single Geocoding API call (no Places). Used for manual / edited address lines. */
async function geocodeAddressOnly(addressQuery, apiKey) {
  const q = String(addressQuery || "").trim();
  if (!q || !apiKey) return null;
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(q)}&components=country:za&key=${apiKey}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.status !== "OK" || !data.results || !data.results[0]) return null;
  const r0 = data.results[0];
  const { address, suburb, city, province } = extractAddressFieldsFromComponents(r0.address_components);
  const lat = r0.geometry?.location?.lat;
  const lng = r0.geometry?.location?.lng;
  if (typeof lat !== "number" || typeof lng !== "number" || Number.isNaN(lat) || Number.isNaN(lng)) {
    return null;
  }
  return {
    address: address || "",
    suburb: suburb || "",
    city: city || "",
    province: province || "",
    fullAddress: r0.formatted_address || "",
    lat,
    lng,
    _resolved: true
  };
}

async function resolveRoute(route, apiKey) {
  const hasCoords =
    route.lat != null &&
    route.lng != null &&
    typeof route.lat === "number" &&
    typeof route.lng === "number" &&
    !Number.isNaN(route.lat) &&
    !Number.isNaN(route.lng);
  if (hasCoords) {
    const fullAddress =
      route.fullAddress ||
      buildFullAddressFromParts(route.address, route.suburb, route.city, route.province) ||
      String(route.customer || "").trim() ||
      "";
    const outCoords = { ...route, fullAddress, _resolved: true };
    console.log("=== FINAL RESOLVED RESULT ===");
    console.log(JSON.stringify(outCoords, null, 2));
    return outCoords;
  }

  console.log("RESOLVER:", route.customer);
  let query = route._googlePlacesInput || buildSearchQuery(route);
  query = String(query).trim();
  const withoutSa = query.replace(/,\s*South Africa$/i, "").trim();
  if (!withoutSa && String(route.address || "").trim()) {
    query = `${String(route.address).trim()}, South Africa`;
  }
  console.log("SEARCH QUERY:", query);

  // 1. FIND PLACE FROM TEXT
  console.log("=== GOOGLE FIND PLACE CALL ===");
  console.log("QUERY:", query);
  const findRes = await fetch(
    `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=${encodeURIComponent(query)}&inputtype=textquery&fields=place_id,name&components=country:za&key=${apiKey}`
  );
  const findData = await findRes.json();
  console.log("=== FIND PLACE RESULT ===");
  console.log(JSON.stringify(findData, null, 2));

  let placeId = null;

  if (findData.candidates && findData.candidates.length > 0) {
    placeId = findData.candidates[0].place_id;
  }

  // 2. FALLBACK → TEXT SEARCH
  if (!placeId) {
    console.log("=== TEXT SEARCH FALLBACK ===");
    console.log("QUERY:", query);
    const textRes = await fetch(
      `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&region=za&key=${apiKey}`
    );
    const textData = await textRes.json();

    if (textData.results && textData.results.length > 0) {
      placeId = textData.results[0].place_id;
    }
  }

  if (placeId) {
    const detailsRes = await fetch(
      `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(placeId)}&fields=formatted_address,address_components,geometry&key=${apiKey}`
    );
    const detailsData = await detailsRes.json();
    const result = detailsData.result;

    if (result) {
      const { address, suburb, city, province } = extractAddressFieldsFromComponents(result.address_components);

      const outPlace = {
        ...route,
        address,
        suburb,
        city,
        province,
        fullAddress: result.formatted_address,
        lat: result.geometry?.location?.lat,
        lng: result.geometry?.location?.lng,
        _resolved: true
      };
      console.log("=== FINAL RESOLVED RESULT ===");
      console.log(JSON.stringify(outPlace, null, 2));
      return outPlace;
    }
  }

  // 3. GEOCODE (customer + address + suburb + city) — not suburb-only
  const geo = await geocodeFallback(route, apiKey);
  if (!geo) {
    const outFail = { ...route, _resolved: false };
    console.log("=== FINAL RESOLVED RESULT ===");
    console.log(JSON.stringify(outFail, null, 2));
    return outFail;
  }

  const { address, suburb, city, province } = extractAddressFieldsFromComponents(geo.address_components);

  const outGeo = {
    ...route,
    address: address || route.address || "",
    suburb: suburb || route.suburb || "",
    city: city || route.city || "",
    province: province || route.province || "",
    fullAddress: geo.formatted_address,
    lat: geo.geometry?.location?.lat,
    lng: geo.geometry?.location?.lng,
    _resolved: true
  };
  console.log("=== FINAL RESOLVED RESULT ===");
  console.log(JSON.stringify(outGeo, null, 2));
  return outGeo;
}

/**
 * Resolve all routes. Applied before engine.
 */
async function resolveRouteAddresses(routes, apiKey, _options) {
  const resolvedRoutes = await Promise.all(routes.map(route => resolveRoute(route, apiKey)));
  return resolvedRoutes;
}

module.exports = {
  resolveRouteAddresses,
  resolveRoute,
  buildFullAddressFromParts,
  buildSearchQuery,
  geocodeAddressOnly
};
