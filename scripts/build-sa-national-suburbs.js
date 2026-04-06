#!/usr/bin/env node
/**
 * Build / merge SA_SUBURBS from OpenStreetMap via Overpass API (national coverage).
 * Merges into functions/src/saSuburbs.js — preserves existing keys; fills missing fields only.
 *
 * Usage:
 *   node scripts/build-sa-national-suburbs.js
 *   node scripts/build-sa-national-suburbs.js --dry-run
 *   node scripts/build-sa-national-suburbs.js --input overpass-cache.json
 *
 * Requires: Node 18+ (global fetch). Network access for Overpass unless --input is used.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const DEFAULT_OUTPUT = path.join(ROOT, "functions", "src", "saSuburbs.js");
const OVERPASS_URL = "https://overpass-api.de/api/interpreter";

const OVERPASS_QUERY = `[out:json][timeout:300];
area["ISO3166-1"="ZA"]->.searchArea;
(
  node["place"~"suburb|town|city"](area.searchArea);
);
out body;`;

/** Rough SA province boxes (first match wins; order = more specific / smaller areas first). */
const PROVINCE_BBOXES = [
  { province: "gauteng", minLat: -26.65, maxLat: -25.35, minLon: 27.35, maxLon: 29.05 },
  { province: "western cape", minLat: -34.45, maxLat: -32.65, minLon: 17.95, maxLon: 21.05 },
  { province: "kwazulu-natal", minLat: -31.05, maxLat: -26.45, minLon: 28.45, maxLon: 33.05 },
  { province: "eastern cape", minLat: -34.05, maxLat: -30.55, minLon: 22.05, maxLon: 29.55 },
  { province: "free state", minLat: -30.55, maxLat: -26.65, minLon: 24.05, maxLon: 29.55 },
  { province: "mpumalanga", minLat: -27.05, maxLat: -24.45, minLon: 28.55, maxLon: 31.65 },
  { province: "limpopo", minLat: -25.55, maxLat: -22.35, minLon: 26.05, maxLon: 31.65 },
  { province: "north west", minLat: -28.05, maxLat: -24.45, minLon: 22.05, maxLon: 28.45 },
  { province: "northern cape", minLat: -32.05, maxLat: -24.45, minLon: 16.45, maxLon: 25.05 }
];

function parseArgs(argv) {
  const out = { dryRun: false, input: null, output: DEFAULT_OUTPUT };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") out.dryRun = true;
    else if (a === "--input" && argv[i + 1]) out.input = path.resolve(ROOT, argv[++i]);
    else if (a === "--output" && argv[i + 1]) out.output = path.resolve(ROOT, argv[++i]);
    else if (a === "--help" || a === "-h") {
      console.log(
        "Usage: node scripts/build-sa-national-suburbs.js [--input overpass.json] [--output saSuburbs.js] [--dry-run]"
      );
      process.exit(0);
    }
  }
  return out;
}

function normalizeKey(name) {
  return String(name)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function formatObjectKey(key) {
  if (/^[a-z_$][a-z0-9_$]*$/i.test(key) && key !== "default") return key;
  return JSON.stringify(key);
}

function round6(n) {
  return Math.round(n * 1e6) / 1e6;
}

function letterCount(key) {
  return (key.match(/[a-z]/g) || []).length;
}

function shouldSkipPlaceName(rawName) {
  const k = normalizeKey(rawName);
  if (!k || k.length < 3) return true;
  if (letterCount(k) < 2) return true;
  if (/\d/.test(k)) return true;
  const compact = k.replace(/[^a-z0-9]/g, "");
  if (compact.length < 2) return true;
  if (/^\d+$/.test(compact)) return true;
  return false;
}

function inferProvinceFromCoords(lat, lng) {
  for (const b of PROVINCE_BBOXES) {
    if (lat >= b.minLat && lat <= b.maxLat && lng >= b.minLon && lng <= b.maxLon) {
      return b.province;
    }
  }
  return null;
}

function inferRegion(province, lat, lng) {
  if (!province) return null;
  const p = province.toLowerCase();
  if (p === "gauteng") {
    if (lat > -25.95 && lng < 28.25) return "gauteng_north";
    return "gauteng_central";
  }
  if (p === "western cape") {
    if (lat > -33.95 && lng > 18.35 && lng < 18.55) return "blouberg_coast";
    if (lat > -33.95 && lat < -33.85 && lng > 18.5 && lng < 18.65) return "northern_suburbs_wc";
    if (lat < -33.95 && lat > -34.05 && lng > 18.45 && lng < 18.5) return "southern_suburbs_wc";
  }
  if (p === "kwazulu-natal") {
    if (lat > -29.95 && lng > 30.85) return "kzn_coastal";
  }
  return null;
}

function cityFromTags(tags) {
  const t = tags || {};
  if (t["addr:city"]) return normalizeKey(t["addr:city"]);
  if (t["is_in:city"]) return normalizeKey(t["is_in:city"]);
  const isIn = t.is_in || t["is_in:country"];
  if (typeof isIn === "string" && isIn.includes(",")) {
    const first = isIn.split(",")[0].trim();
    if (first.length >= 3 && !/south africa/i.test(first)) return normalizeKey(first);
  }
  return null;
}

function provinceFromTags(tags) {
  const t = tags || {};
  const raw =
    t["addr:province"] ||
    t["is_in:province"] ||
    t.province ||
    t["is_in:state"] ||
    null;
  if (!raw || typeof raw !== "string") return null;
  let s = raw.toLowerCase().trim();
  s = s.replace(/^province\s+of\s+/i, "");
  if (s.includes("gauteng")) return "gauteng";
  if (s.includes("western cape")) return "western cape";
  if (s.includes("eastern cape")) return "eastern cape";
  if (s.includes("kwazulu") || s === "kzn") return "kwazulu-natal";
  if (s.includes("free state")) return "free state";
  if (s.includes("mpumalanga")) return "mpumalanga";
  if (s.includes("limpopo")) return "limpopo";
  if (s.includes("north west")) return "north west";
  if (s.includes("northern cape")) return "northern cape";
  return normalizeKey(s);
}

async function fetchOverpassJson() {
  const res = await fetch(OVERPASS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "data=" + encodeURIComponent(OVERPASS_QUERY)
  });
  if (!res.ok) {
    throw new Error(`Overpass HTTP ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

function elementsToOsmMap(data) {
  const map = new Map();
  const elements = data.elements || [];
  let skipped = 0;
  for (const el of elements) {
    if (el.type !== "node" || el.lat == null || el.lon == null) continue;
    const tags = el.tags || {};
    const place = tags.place;
    if (!place || !/^(suburb|town|city)$/.test(place)) continue;
    const name = tags.name;
    if (!name || typeof name !== "string") {
      skipped++;
      continue;
    }
    if (shouldSkipPlaceName(name)) {
      skipped++;
      continue;
    }
    const k = normalizeKey(name);
    if (!k) continue;
    const lat = round6(el.lat);
    const lng = round6(el.lon);
    let province = provinceFromTags(tags) || inferProvinceFromCoords(lat, lng);
    const city = cityFromTags(tags);
    let region = null;
    if (province) region = inferRegion(province, lat, lng);

    const entry = { lat, lng };
    if (province) entry.province = province;
    if (city) entry.city = city;
    if (region) entry.region = region;

    if (!map.has(k)) map.set(k, entry);
    else skipped++;
  }
  return { map, skipped, totalElements: elements.length };
}

function extractSuburbAliasesBlock(existingPath) {
  if (!fs.existsSync(existingPath)) return null;
  const raw = fs.readFileSync(existingPath, "utf8");
  const m = raw.match(/\nconst SUBURB_ALIASES = \{[\s\S]*?\n\};\s*\n/);
  if (!m) return null;
  return m[0].replace(/^\n/, "");
}

function defaultAliasesBlock() {
  return `const SUBURB_ALIASES = {
  tygervalley: "tyger valley",
  "willow bridge": "willowbridge",
  capegate: "cape gate",
  "pick n pay": "",
  picknpay: "",
  pnp: "",
  spar: "",
  superspar: "",
  "super spar": "",
  checkers: "",
  shoprite: "",
  makro: "",
  corp: "",
  fam: "",
  family: "",
  local: "",
  hyper: "",
  fx: ""
};
`;
}

function mergeEntry(existing, incoming) {
  if (!existing) return { ...incoming };
  const out = { ...existing };
  if (out.lat == null && incoming.lat != null) out.lat = incoming.lat;
  if (out.lng == null && incoming.lng != null) out.lng = incoming.lng;
  if (out.province == null && incoming.province != null) out.province = incoming.province;
  if (out.city == null && incoming.city != null) out.city = incoming.city;
  if (out.region == null && incoming.region != null) out.region = incoming.region;
  return out;
}

function loadExistingSaSuburbs(saSuburbsPath) {
  delete require.cache[require.resolve(saSuburbsPath)];
  return require(saSuburbsPath).SA_SUBURBS;
}

function mergeMaps(existingObj, osmMap) {
  const merged = {};
  let added = 0;
  let updatedFields = 0;

  for (const k of Object.keys(existingObj)) {
    merged[k] = { ...existingObj[k] };
  }

  for (const [k, incoming] of osmMap.entries()) {
    if (!merged[k]) {
      merged[k] = { ...incoming };
      added++;
    } else {
      const before = JSON.stringify(merged[k]);
      merged[k] = mergeEntry(merged[k], incoming);
      if (JSON.stringify(merged[k]) !== before) updatedFields++;
    }
  }

  return { merged, added, updatedFields };
}

function formatSaSuburbsEntry(key, v) {
  const fk = formatObjectKey(key);
  const parts = [`lat: ${v.lat}`, `lng: ${v.lng}`];
  if (v.province != null) parts.push(`province: ${JSON.stringify(v.province)}`);
  if (v.city != null) parts.push(`city: ${JSON.stringify(v.city)}`);
  if (v.region != null) parts.push(`region: ${JSON.stringify(v.region)}`);
  return `  ${fk}: { ${parts.join(", ")} }`;
}

function renderSaSuburbsJs(mergedObj, aliasesBlock) {
  const keys = Object.keys(mergedObj).sort((a, b) => a.localeCompare(b));
  const body = keys.map((k) => formatSaSuburbsEntry(k, mergedObj[k])).join(",\n");

  return `/**
 * Canonical offline suburb / town / retail-node centroids for South Africa.
 * Keys are lowercase; expand SA_SUBURBS over time without changing resolver logic.
 *
 * National entries merged from OSM (Overpass) via scripts/build-sa-national-suburbs.js.
 * Existing entries are preserved; new OSM data fills missing lat/lng/province/city/region only.
 */

const SA_SUBURBS = {
${body}
};

/**
 * Compact/variant → canonical suburb phrase, or "" to drop filler tokens/phrases.
 */
${aliasesBlock}
module.exports = { SA_SUBURBS, SUBURB_ALIASES };
`;
}

async function main() {
  const opts = parseArgs(process.argv);
  let data;
  if (opts.input) {
    data = JSON.parse(fs.readFileSync(opts.input, "utf8"));
    console.error("Loaded Overpass JSON from", opts.input);
  } else {
    console.error("Fetching Overpass (South Africa place nodes)…");
    data = await fetchOverpassJson();
  }

  const { map: osmMap, skipped, totalElements } = elementsToOsmMap(data);
  console.error(`Overpass elements=${totalElements} uniquePlaces=${osmMap.size} skipped=${skipped}`);

  const saPath = opts.output;
  let existing;
  try {
    existing = loadExistingSaSuburbs(saPath);
  } catch (e) {
    console.error("Failed to load existing saSuburbs.js:", e.message);
    process.exit(1);
  }

  const beforeKeys = Object.keys(existing).length;
  const { merged, added, updatedFields } = mergeMaps(existing, osmMap);
  const afterKeys = Object.keys(merged).length;

  let aliasesBlock = extractSuburbAliasesBlock(saPath);
  if (!aliasesBlock) aliasesBlock = defaultAliasesBlock();

  console.error(
    `Merge: existingKeys=${beforeKeys} osmUnique=${osmMap.size} mergedKeys=${afterKeys} added=${added} keysUpdatedFromOsmFill=${updatedFields}`
  );

  const sampleKeys = Object.keys(merged)
    .filter((k) => !existing[k])
    .slice(0, 5);
  const sample = sampleKeys.map((k) => ({ key: k, ...merged[k] }));

  console.log("TOTAL_SUBURBS_ADDED", added);
  console.log("SAMPLE_NEW_ENTRIES", JSON.stringify(sample, null, 2));

  if (opts.dryRun) {
    console.error("Dry run — not writing", saPath);
    process.exit(0);
  }

  const outDir = path.dirname(saPath);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(saPath, renderSaSuburbsJs(merged, aliasesBlock), "utf8");
  console.error("Wrote", saPath);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
