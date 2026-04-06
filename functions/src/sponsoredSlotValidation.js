/**
 * Sponsored slot overlap checks and schedule date helpers (shared by payfastNotify, webhooks, admin API).
 */
const admin = require("firebase-admin");

function monthToNumber(m) {
  const map = {
    jan: 1,
    january: 1,
    feb: 2,
    february: 2,
    mar: 3,
    march: 3,
    apr: 4,
    april: 4,
    may: 5,
    jun: 6,
    june: 6,
    jul: 7,
    july: 7,
    aug: 8,
    august: 8,
    sep: 9,
    sept: 9,
    september: 9,
    oct: 10,
    october: 10,
    nov: 11,
    november: 11,
    dec: 12,
    december: 12,
  };
  const s = String(m ?? "").trim().toLowerCase();
  if (map[s] != null) return map[s];
  const key = s.slice(0, 3);
  return map[key];
}

/** featured | slot1 | slot2 | slot3 | '' */
function canonicalAdSlot(slot) {
  const s = String(slot ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
  if (s === "top" || s === "featured") return "featured";
  if (s === "mid" || s === "slot1") return "slot1";
  if (s === "bottom" || s === "slot2") return "slot2";
  if (s === "slot3") return "slot3";
  return "";
}

/** Firestore `slot` values that belong to the same canonical placement */
const CANONICAL_TO_DB_SLOT_VALUES = {
  featured: ["featured", "top"],
  slot1: ["slot1", "mid"],
  slot2: ["slot2", "bottom"],
  slot3: ["slot3"],
};

/**
 * Non-breaking: derives startDate / endDate from months[] (same calendar year).
 * @returns {Record<string, string>}
 */
function scheduleDatesFromBookedMonths(monthsRaw, year) {
  const monthsSorted = (monthsRaw || [])
    .map(monthToNumber)
    .filter((n) => n >= 1 && n <= 12)
    .sort((a, b) => a - b);
  if (!monthsSorted.length) return {};
  const startMonth = monthsSorted[0];
  const endMonth = monthsSorted[monthsSorted.length - 1];
  const y =
    typeof year === "number" && Number.isFinite(year)
      ? year
      : new Date().getFullYear();
  return {
    startDate: `${y}-${String(startMonth).padStart(2, "0")}-01`,
    endDate: `${y}-${String(endMonth).padStart(2, "0")}-28`,
  };
}

async function isSlotAvailable(slot, months, excludeId = null) {
  const canon = canonicalAdSlot(slot);
  if (!canon) return false;

  const dbSlotValues = CANONICAL_TO_DB_SLOT_VALUES[canon];
  if (!dbSlotValues || !dbSlotValues.length) return false;

  const requested = [
    ...new Set(
      (months || [])
        .map(monthToNumber)
        .filter((n) => n >= 1 && n <= 12)
    ),
  ];
  if (requested.length === 0) return false;

  if (!admin.apps.length) {
    admin.initializeApp();
  }

  const db = admin.firestore();
  const seen = new Map();

  for (const slotVal of dbSlotValues) {
    const snapshot = await db
      .collection("sponsoredTools")
      .where("slot", "==", slotVal)
      .where("status", "in", ["approved", "live"])
      .get();

    snapshot.docs.forEach((d) => {
      if (!seen.has(d.id)) seen.set(d.id, d);
    });
  }

  for (const doc of seen.values()) {
    if (excludeId && doc.id === excludeId) continue;

    const data = doc.data();
    const existing = (data.months || [])
      .map(monthToNumber)
      .filter((n) => n >= 1 && n <= 12);

    const overlap = requested.some((m) => existing.includes(m));
    if (overlap) return false;
  }

  return true;
}

module.exports = {
  monthToNumber,
  canonicalAdSlot,
  isSlotAvailable,
  scheduleDatesFromBookedMonths,
};
