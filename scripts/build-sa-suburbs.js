#!/usr/bin/env node
/**
 * Build functions/src/saSuburbs.js from a filtered OSM PBF (e.g. sa_places.osm.pbf
 * from: osmium tags-filter … nwr/place=suburb,town,city).
 *
 * Requires: osmium (osmium export) on PATH.
 * No extra npm packages.
 *
 * Usage:
 *   node scripts/build-sa-suburbs.js
 *   node scripts/build-sa-suburbs.js --input data/osm/sa_places.osm.pbf --output functions/src/saSuburbs.js
 *   node scripts/build-sa-suburbs.js --dry-run
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const DEFAULT_INPUT = path.join(ROOT, "data", "osm", "sa_places.osm.pbf");
const DEFAULT_OUTPUT = path.join(ROOT, "functions", "src", "saSuburbs.js");

function parseArgs(argv) {
  const out = { dryRun: false, input: DEFAULT_INPUT, output: DEFAULT_OUTPUT };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") out.dryRun = true;
    else if (a === "--input" && argv[i + 1]) out.input = path.resolve(ROOT, argv[++i]);
    else if (a === "--output" && argv[i + 1]) out.output = path.resolve(ROOT, argv[++i]);
    else if (a === "--help" || a === "-h") {
      console.log(`Usage: node scripts/build-sa-suburbs.js [--input PBF] [--output saSuburbs.js] [--dry-run]`);
      process.exit(0);
    }
  }
  return out;
}

const PLACE_VALUES = new Set(["suburb", "town", "city"]);

function centroidFromGeometry(geom) {
  if (!geom || !geom.type) return null;
  if (geom.type === "Point") {
    const [lng, lat] = geom.coordinates;
    if (typeof lat !== "number" || typeof lng !== "number") return null;
    return { lat, lng };
  }
  if (geom.type === "LineString") {
    const pts = geom.coordinates;
    if (!pts || !pts.length) return null;
    let lat = 0;
    let lng = 0;
    for (const p of pts) {
      lng += p[0];
      lat += p[1];
    }
    const n = pts.length;
    return { lat: lat / n, lng: lng / n };
  }
  if (geom.type === "Polygon") {
    const ring = geom.coordinates[0];
    return bboxCenterFromRing(ring);
  }
  if (geom.type === "MultiPolygon") {
    let minLon = Infinity;
    let maxLon = -Infinity;
    let minLat = Infinity;
    let maxLat = -Infinity;
    for (const poly of geom.coordinates) {
      for (const ring of poly) {
        for (const [lon, lat] of ring) {
          if (lon < minLon) minLon = lon;
          if (lon > maxLon) maxLon = lon;
          if (lat < minLat) minLat = lat;
          if (lat > maxLat) maxLat = lat;
        }
      }
    }
    if (!Number.isFinite(minLon)) return null;
    return { lat: (minLat + maxLat) / 2, lng: (minLon + maxLon) / 2 };
  }
  return null;
}

function bboxCenterFromRing(ring) {
  if (!ring || !ring.length) return null;
  let minLon = Infinity;
  let maxLon = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const [lon, lat] of ring) {
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  return { lat: (minLat + maxLat) / 2, lng: (minLon + maxLon) / 2 };
}

function normalizeKey(name) {
  return String(name)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function letterCount(key) {
  return (key.match(/[a-z]/g) || []).length;
}

/** Conservative: drop unusable keys without pruning legitimate SA names. */
function shouldSkipPlaceName(rawName) {
  const k = normalizeKey(rawName);
  if (!k) return true;
  if (k.length < 3) return true;
  if (letterCount(k) < 2) return true;
  const compact = k.replace(/[^a-z0-9]/g, "");
  if (compact.length < 2) return true;
  if (/^\d+$/.test(compact)) return true;
  return false;
}

function formatObjectKey(key) {
  if (/^[a-z_$][a-z0-9_$]*$/i.test(key) && key !== "default") return key;
  return JSON.stringify(key);
}

function round6(n) {
  return Math.round(n * 1e6) / 1e6;
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

function buildSaSuburbs(geojsonPath) {
  const raw = fs.readFileSync(geojsonPath, "utf8");
  const gj = JSON.parse(raw);
  const features = gj.features || [];
  const map = new Map();
  let skippedNoGeom = 0;
  let skippedNoName = 0;
  let skippedPlace = 0;
  let skippedCleanup = 0;
  let dup = 0;

  for (const f of features) {
    const p = f.properties || {};
    const name = p.name;
    if (!name || typeof name !== "string") {
      skippedNoName++;
      continue;
    }
    if (!PLACE_VALUES.has(p.place)) {
      skippedPlace++;
      continue;
    }
    const c = centroidFromGeometry(f.geometry);
    if (!c) {
      skippedNoGeom++;
      continue;
    }
    const k = normalizeKey(name);
    if (!k) {
      skippedCleanup++;
      continue;
    }
    if (shouldSkipPlaceName(name)) {
      skippedCleanup++;
      continue;
    }
    if (map.has(k)) dup++;
    map.set(k, { lat: round6(c.lat), lng: round6(c.lng) });
  }

  const keys = [...map.keys()].sort((a, b) => a.localeCompare(b));
  return {
    map,
    keys,
    stats: {
      features: features.length,
      written: keys.length,
      skippedNoName,
      skippedPlace,
      skippedNoGeom,
      skippedCleanup,
      duplicateName: dup
    }
  };
}

function renderSaSuburbsJs(keys, map, aliasesBlock) {
  const lines = keys.map((k) => {
    const { lat, lng } = map.get(k);
    const fk = formatObjectKey(k);
    return `  ${fk}: { lat: ${lat}, lng: ${lng} }`;
  });
  const body = lines.join(",\n");

  return `/**
 * Canonical offline suburb / town / retail-node centroids for South Africa.
 * Keys are lowercase; expand SA_SUBURBS over time without changing resolver logic.
 *
 * SA_SUBURBS was generated by scripts/build-sa-suburbs.js — do not hand-edit the block below
 * unless you know merges will be overwritten on the next build.
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

function main() {
  const opts = parseArgs(process.argv);

  if (!fs.existsSync(opts.input)) {
    console.error("Input PBF not found:", opts.input);
    process.exit(1);
  }

  const tmpGeo = path.join(os.tmpdir(), `sa-places-build-${process.pid}-${Date.now()}.geojson`);
  try {
    execFileSync(
      "osmium",
      ["export", "-f", "geojson", "-o", tmpGeo, "-O", opts.input],
      { stdio: "inherit" }
    );
  } catch (e) {
    console.error('Failed running "osmium export". Is osmium installed and on PATH?');
    process.exit(1);
  }

  let aliasesBlock = extractSuburbAliasesBlock(opts.output);
  if (!aliasesBlock) {
    aliasesBlock = defaultAliasesBlock();
  }

  const { map, keys, stats } = buildSaSuburbs(tmpGeo);
  try {
    fs.unlinkSync(tmpGeo);
  } catch (_e) {
    /* ignore */
  }

  console.error(
    `[build-sa-suburbs] features=${stats.features} written=${stats.written} ` +
      `skip(name=${stats.skippedNoName} place=${stats.skippedPlace} geom=${stats.skippedNoGeom} cleanup=${stats.skippedCleanup}) dupKeys=${stats.duplicateName}`
  );

  if (opts.dryRun) {
    console.log("Dry run — not writing", opts.output);
    process.exit(0);
  }

  const outDir = path.dirname(opts.output);
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const js = renderSaSuburbsJs(keys, map, aliasesBlock);
  fs.writeFileSync(opts.output, js, "utf8");
  console.error("Wrote", opts.output);
}

main();
