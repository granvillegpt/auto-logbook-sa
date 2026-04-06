/**
 * Suggest SUBURB_ALIASES entries from UNRESOLVED_SUBURBS (in-memory counts).
 * Does not modify SA_SUBURBS or apply aliases — manual approval only.
 */

const fs = require("fs");
const path = require("path");

const { SA_SUBURBS } = require("../functions/src/saSuburbs");
const { UNRESOLVED_SUBURBS } = require("../functions/src/resolveStore");

function normalize(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z\s]/g, "")
    .trim();
}

function similarity(a, b) {
  a = normalize(a);
  b = normalize(b);

  if (a === b) return 1;

  if (a.includes(b) || b.includes(a)) return 0.9;

  const aWords = a.split(/\s+/).filter(Boolean);
  const bWords = b.split(/\s+/).filter(Boolean);

  let matches = 0;

  for (const w of aWords) {
    if (bWords.includes(w)) matches++;
  }

  return matches / Math.max(aWords.length, bWords.length, 1);
}

function unresolvedEntries() {
  if (UNRESOLVED_SUBURBS instanceof Map) {
    return Array.from(UNRESOLVED_SUBURBS.entries());
  }
  return Object.entries(UNRESOLVED_SUBURBS || {});
}

const suggestions = [];

for (const [raw, count] of unresolvedEntries()) {
  if (count < 3) continue;

  let bestMatch = null;
  let bestScore = 0;

  for (const key of Object.keys(SA_SUBURBS)) {
    const score = similarity(raw, key);

    if (score > bestScore) {
      bestScore = score;
      bestMatch = key;
    }
  }

  if (bestScore >= 0.7) {
    suggestions.push({
      input: raw,
      suggested: bestMatch,
      confidence: bestScore,
      count
    });
  }
}

suggestions.sort((a, b) => b.count - a.count);

console.log("\n🔥 ALIAS SUGGESTIONS:\n");

for (const s of suggestions) {
  console.log(`${s.input} → ${s.suggested} (score: ${s.confidence}, count: ${s.count})`);
}

const outPath = path.join(__dirname, "alias-suggestions.json");
fs.writeFileSync(outPath, JSON.stringify(suggestions, null, 2));
console.log(`\nWrote ${outPath}`);
