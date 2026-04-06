const { normalizeStoreQuery } = require("../resolveStore");

const BRAND_MAP = {
  pnp: "Pick n Pay",
  "pick n pay": "Pick n Pay",
  checkers: "Checkers",
  shoprite: "Shoprite",
  spar: "Spar",
  "ok minimark": "OK Minimark",
  "ok foods": "OK Foods",
};

function extractBrandAndLocation(name) {
  for (const key in BRAND_MAP) {
    if (name.includes(key)) {
      const brand = BRAND_MAP[key];

      const location = name.replace(key, "").trim();

      return {
        brand,
        location
      };
    }
  }

  return {
    brand: name,
    location: ""
  };
}

function titleCase(str) {
  return str.replace(/\w\S*/g, w =>
    w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
  );
}

function buildSearchQuery(route) {
  const raw = route.customer || "";

  const cleaned = normalizeStoreQuery(raw) || "";

  const { brand, location } = extractBrandAndLocation(cleaned);

  const mainName = titleCase(`${brand} ${location}`.trim());

  const suburb = (route.suburb || "").toLowerCase();
  const city = route.city;

  const parts = [];

  parts.push(mainName);

  // avoid duplicate suburb
  if (suburb && !mainName.toLowerCase().includes(suburb)) {
    parts.push(route.suburb);
  }

  if (city) parts.push(city);

  parts.push("South Africa");

  const finalQuery = parts
    .filter(v => v && String(v).trim())
    .join(", ");

  console.log("SEARCH QUERY:", raw, "→", finalQuery);

  return finalQuery;
}

module.exports = { buildSearchQuery };
