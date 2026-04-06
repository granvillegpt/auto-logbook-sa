const { SA_SUBURBS, SUBURB_ALIASES } = require("./saSuburbs");

const BRAND_WORDS = [
  "checkers",
  "shoprite",
  "pnp",
  "pick",
  "pay",
  "spar",
  "ok",
  "minimark",
  "foods",
  "corp",
  "local"
];

function isValidSuburb(candidate, rawStoreName) {
  if (!candidate) return false;

  const c = candidate.toLowerCase();
  const raw = rawStoreName.toLowerCase();

  for (const word of BRAND_WORDS) {
    const wordRegex = new RegExp(`\\b${word}\\b`, "i");
    if (wordRegex.test(c)) return false;
  }

  if (c.length < 3) return false;

  if (/\d/.test(c)) return false;

  const rawNorm = raw.replace(/\s+/g, " ").trim();
  if (c === rawNorm) return false;

  return true;
}

/**
 * Lowercase, trim, dash/apostrophe cleanup, collapse spaces — safe plain string.
 */
function normalizeStoreName(input) {
  if (input == null || input === undefined) return "";
  let s = String(input)
    .trim()
    .toLowerCase();
  s = s.replace(/[\u2013\u2014\u2212]/g, " ");
  s = s.replace(/[''`´]/g, "'");
  s = s.replace(/[^a-z0-9\s'-]/g, " ");
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

/**
 * Strip business-noise words, region codes, and punctuation before tail-based suburb extraction.
 */
function hardCleanStoreNameForExtraction(input) {
  if (input == null || input === undefined) return "";
  let s = String(input).trim().toLowerCase();
  s = s.replace(/[()[\],.:;]/g, " ");
  s = s.replace(/[\u2013\u2014\u2212\-]/g, " ");
  const noiseRe = /\b(corp|pty|ltd|inc|store|shop|supermarket|hyper|express|market)\b/gi;
  s = s.replace(noiseRe, " ");
  s = s.replace(/\bwc\d+\b/gi, " ");
  s = s.replace(/\b\d{2,}\b/g, " ");
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

/**
 * Remove trailing / parenthetical code-like suffixes without stripping location words.
 */
function stripTrailingCodes(input) {
  if (!input || typeof input !== "string") return "";
  let s = input.trim().replace(/\s+/g, " ");

  s = s.replace(/\s*\([a-z]{1,3}\d+\)\s*/gi, " ");
  s = s.replace(/\s*\(\s*cl\s*\d+\s*\)\s*/gi, " ");

  let prev = "";
  while (prev !== s) {
    prev = s;
    s = s.replace(/\s*-\s*[a-z]{1,3}\d+\s*$/i, "");
    s = s.replace(/\s*-\s*\d{3,}\s*$/, "");
    s = s.replace(/\s*-\s*[a-z]{2}\d{2,}\s*$/i, "");
    s = s.replace(/-\s*[a-z]{1,3}\d+\s*$/i, "");
  }

  s = s.replace(/\s*\([^)]{0,30}\)\s*$/i, " ");
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

function escapeRegChars(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Additional retail-node fillers (merged with saSuburbs SUBURB_ALIASES; no extra files). */
const RETAIL_NODE_FILLER_ALIASES = {
  "shopping centre": "",
  "shopping center": "",
  "lifestyle centre": "",
  "lifestyle center": "",
  "retail park": "",
  centre: "",
  center: "",
  shopping: "",
  plaza: "",
  square: "",
  lifestyle: "",
  retail: ""
};

const MALL_OF_THE_NORTH_TOKEN = "__motn__";

function mergeFillerAliasMaps() {
  return Object.assign({}, SUBURB_ALIASES, RETAIL_NODE_FILLER_ALIASES);
}

/**
 * Drop chain/filler tokens; expand compact aliases to canonical multi-word forms.
 */
function removeFillerTokens(input) {
  if (!input || typeof input !== "string") return "";
  let s = input.trim().replace(/\s+/g, " ");

  s = s.replace(/\bmall\s+of\s+the\s+north\b/gi, MALL_OF_THE_NORTH_TOKEN);

  const merged = mergeFillerAliasMaps();
  const multiKeys = Object.keys(merged)
    .filter((k) => k.includes(" "))
    .sort((a, b) => b.length - a.length);

  for (const key of multiKeys) {
    const val = merged[key];
    const parts = key.split(/\s+/).map(escapeRegChars).join("\\s+");
    const re = new RegExp(`(^|\\s)${parts}(?=\\s|$)`, "i");
    if (val === "") {
      s = s.replace(re, " ").replace(/\s+/g, " ").trim();
    } else {
      s = s.replace(re, ` ${val} `).replace(/\s+/g, " ").trim();
    }
  }

  s = s.replace(/\bmall\b(?!\s+of\b)/gi, " ").replace(/\s+/g, " ").trim();

  const words = s.split(/\s+/).filter(Boolean);
  const out = [];
  for (const w of words) {
    if (w === MALL_OF_THE_NORTH_TOKEN) {
      out.push("mall", "of", "the", "north");
      continue;
    }
    const lw = w.toLowerCase();
    if (Object.prototype.hasOwnProperty.call(merged, lw)) {
      const v = merged[lw];
      if (v === "") continue;
      v.split(/\s+/).forEach((x) => {
        if (x) out.push(x);
      });
    } else {
      out.push(w);
    }
  }
  return out.join(" ").replace(/\s+/g, " ").trim();
}

/**
 * Compact for matching: lowercase, no spaces/apostrophes/non-alphanumeric.
 */
function compactKey(str) {
  return String(str || "")
    .toLowerCase()
    .replace(/'/g, "")
    .replace(/[^a-z0-9]/g, "");
}

/** Suburb key form: trim, lowercase, single spaces (for SA_SUBURBS direct lookup). */
function normalizeKey(candidate) {
  return String(candidate || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function levenshtein(a, b) {
  const s = a || "";
  const t = b || "";
  const m = s.length;
  const n = t.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = [];
  for (let i = 0; i <= m; i++) {
    dp[i] = new Array(n + 1);
    dp[i][0] = i;
  }
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = s.charCodeAt(i - 1) === t.charCodeAt(j - 1) ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

/**
 * Best suburb key by Levenshtein on compact forms, or "" if no safe match.
 */
function findClosestSuburb(input, suburbs) {
  const cand = compactKey(input);
  if (cand.length < 3) return "";
  let bestKey = "";
  let bestDist = Infinity;
  const keys = Object.keys(suburbs);
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const kc = compactKey(key);
    if (!kc) continue;
    const d = levenshtein(cand, kc);
    const maxLen = Math.max(cand.length, kc.length);
    const maxAllow = maxLen <= 4 ? 2 : 3;
    if (d > maxAllow) continue;
    if (d < bestDist || (d === bestDist && key.localeCompare(bestKey) < 0)) {
      bestDist = d;
      bestKey = key;
    }
  }
  return bestKey;
}

function cleanStoreName(input) {
  if (!input) return "";

  const NOISE_WORDS = [
    "pnp",
    "pick",
    "pay",
    "shoprite",
    "checkers",
    "spar",
    "ok",
    "foods",
    "food",
    "minimark",
    "market",
    "store",
    "supermarket",
    "express",
    "liquor",
    "tops",
    "hyper",
    "kwikspar",
    "centre",
    "mall"
  ];

  let str = input.toLowerCase();

  str = str.replace(/[-_]/g, " ");

  NOISE_WORDS.forEach((word) => {
    const regex = new RegExp(`\\b${escapeRegChars(word)}\\b`, "g");
    str = str.replace(regex, " ");
  });

  str = str.replace(/\b[a-z]{1,3}\d{1,4}\b/g, " ");

  str = str.replace(/\b\d+\b/g, " ");

  str = str.replace(/\s+/g, " ").trim();

  return str;
}

function filterWordsForSuburbExtraction(words) {
  const NOISE_WORDS = [
    "pnp",
    "pick",
    "pay",
    "shoprite",
    "checkers",
    "spar",
    "ok",
    "foods",
    "food",
    "minimark",
    "market",
    "store",
    "supermarket",
    "express",
    "liquor",
    "tops",
    "hyper",
    "kwikspar",
    "centre",
    "mall"
  ];

  return words.filter((word) => {
    if (!word) return false;

    const w = word.toLowerCase();

    if (NOISE_WORDS.includes(w)) return false;

    if (/^[a-z]{1,3}\d{1,4}$/i.test(w)) return false;

    if (/^\d+$/.test(w)) return false;

    if (w.length < 3) return false;

    return true;
  });
}

function safeExtractedSuburb(value) {
  const s = String(value || "").trim();
  if (s.length < 3) return "";
  if (/\d/.test(s)) return "";
  return s;
}

/**
 * Strong clean before extraction: region codes, major brands, symbols (keeps digits for e.g. "n1 city").
 */
function preExtractClean(raw) {
  return String(raw || "")
    .toLowerCase()
    .replace(/\b(wc\d+|gp\d+|kzn\d+|ec\d+)\b/gi, "")
    .replace(/\b(pnp|checkers|shoprite|spar|corp|pty|ltd)\b/gi, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Scan cleaned tokens for any SA_SUBURBS key (longer phrases first, left to right).
 */
function extractSuburbFromStoreName(storeName) {
  const original = storeName != null ? String(storeName) : "";
  const preCleaned = preExtractClean(original);

  const aliasKeys = Object.keys(SUBURB_ALIASES).sort((a, b) => b.length - a.length);
  for (const aliasKey of aliasKeys) {
    const mapped = SUBURB_ALIASES[aliasKey];
    if (mapped === "" || mapped == null) continue;
    if (!preCleaned.includes(aliasKey)) continue;
    let canon = normalizeKey(mapped);
    if (SUBURB_ALIASES[canon]) {
      canon = normalizeKey(SUBURB_ALIASES[canon]);
    }
    if (canon && SA_SUBURBS[canon] && isValidSuburb(canon, original)) {
      return canon;
    }
  }

  const datasetKeys = Object.keys(SA_SUBURBS).sort((a, b) => b.length - a.length);
  for (const key of datasetKeys) {
    if (preCleaned.includes(key) && isValidSuburb(key, original)) {
      return key;
    }
  }

  const raw = cleanStoreName(storeName);
  const hard = hardCleanStoreNameForExtraction(raw);
  const n = normalizeStoreName(hard);
  const stripped = stripTrailingCodes(n);
  const cleaned = removeFillerTokens(stripped);
  const words = cleaned.split(/\s+/).filter(Boolean);
  const cleanedWords = filterWordsForSuburbExtraction(words);
  if (!cleanedWords.length) return "";

  for (let size = 3; size >= 1; size--) {
    if (size > cleanedWords.length) continue;
    for (let i = 0; i <= cleanedWords.length - size; i++) {
      const phrase = cleanedWords.slice(i, i + size).join(" ");
      let key = normalizeKey(phrase);

      if (SUBURB_ALIASES[key]) {
        key = normalizeKey(SUBURB_ALIASES[key]);
      }
      if (!key) continue;

      if (SA_SUBURBS[key] && isValidSuburb(key, storeName)) {
        return key;
      }
    }
  }

  return "";
}

/**
 * Offline centroid resolution from tail-anchored suburb/town extraction.
 */
function resolveOfflineStore(storeName) {
  try {
    const original = storeName != null ? String(storeName) : "";
    const suburb = extractSuburbFromStoreName(original);
    if (suburb && SA_SUBURBS[suburb]) {
      const { lat, lng } = SA_SUBURBS[suburb];
      return {
        ok: true,
        storeName: original,
        suburb,
        lat,
        lng,
        source: "offline-suburb"
      };
    }
    return {
      ok: false,
      storeName: original,
      suburb: suburb || "",
      lat: null,
      lng: null,
      source: "offline-unresolved"
    };
  } catch (_e) {
    return {
      ok: false,
      storeName: storeName != null ? String(storeName) : "",
      suburb: "",
      lat: null,
      lng: null,
      source: "offline-unresolved"
    };
  }
}

module.exports = {
  normalizeStoreName,
  stripTrailingCodes,
  removeFillerTokens,
  extractSuburbFromStoreName,
  resolveOfflineStore,
  isValidSuburb
};

// Self-test examples (multiple provinces) — not executed:
// "Checkers Willowbridge - 48385" => "willowbridge"
// "Shoprite Polokwane - LP12" => "polokwane"
// "Superspar Umhlanga - KZN04" => "umhlanga"
// "Checkers Westville - DBN22" => "westville"
// "Makro Silver Lakes - PTA09" => "silver lakes"
// "PnP Mall of the North - LP01" => "mall of the north"
// "Checkers Hyper FX Brackenfell - 2701" => "brackenfell"
// "Makro Cape Gate - M19" => "cape gate"
// "Checkers Brakenfell - 2701" => "brackenfell"   // fuzzy typo vs brackenfell
// "Checkers Willowbridge Mall - 48385" => "willowbridge"   // retail filler
