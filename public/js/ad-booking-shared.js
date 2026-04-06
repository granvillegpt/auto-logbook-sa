/**
 * Shared ad slot / month helpers (client). Locks: approved + live only.
 * Slots: featured, slot1, slot2, slot3 (legacy: top→featured, mid→slot1, bottom→slot2).
 */
(function (global) {
  'use strict';

  var ABBR = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

  function monthKey(m) {
    var s = String(m || '').trim().toLowerCase();
    if (!s) return '';
    var full = {
      january: 'jan', february: 'feb', march: 'mar', april: 'apr', june: 'jun',
      july: 'jul', august: 'aug', september: 'sep', october: 'oct', november: 'nov', december: 'dec',
      jan: 'jan', feb: 'feb', mar: 'mar', apr: 'apr', may: 'may', jun: 'jun',
      jul: 'jul', aug: 'aug', sep: 'sep', sept: 'sep', oct: 'oct', nov: 'nov', dec: 'dec'
    };
    if (full[s]) return full[s];
    return s.slice(0, 3);
  }

  function monthToIndex(m) {
    var k = monthKey(m);
    var i = ABBR.indexOf(k);
    return i >= 0 ? i : -1;
  }

  /** @param {string[]} months */
  function computeEndDateISO(months, year) {
    var y = typeof year === 'number' ? year : new Date().getFullYear();
    var indices = (months || []).map(monthToIndex).filter(function (i) { return i >= 0; });
    if (!indices.length) return null;
    var maxIdx = Math.max.apply(null, indices);
    var maxM = maxIdx + 1;
    var lastDay = new Date(Date.UTC(y, maxM, 0)).getUTCDate();
    return new Date(Date.UTC(y, maxM - 1, lastDay, 23, 59, 59, 999)).toISOString();
  }

  function slotLockedStatuses() {
    return ['approved', 'live'];
  }

  function normalizeSlot(slot) {
    return String(slot || '').trim().toLowerCase().replace(/\s+/g, '');
  }

  /**
   * Map stored or UI slot to canonical key: featured | slot1 | slot2 | slot3 | ''.
   */
  function canonicalSlotKey(slot) {
    var s = normalizeSlot(slot);
    if (s === 'top' || s === 'featured') return 'featured';
    if (s === 'mid' || s === 'slot1') return 'slot1';
    if (s === 'bottom' || s === 'slot2') return 'slot2';
    if (s === 'slot3') return 'slot3';
    return '';
  }

  /**
   * @param {{ slot: string, months: string[] }} a
   * @param {{ slot: string, months: string[] }} b
   */
  function monthsOverlapSameSlot(a, b) {
    if (canonicalSlotKey(a.slot) !== canonicalSlotKey(b.slot)) return false;
    if (!canonicalSlotKey(a.slot)) return false;
    var keysA = (a.months || []).map(monthKey).filter(Boolean);
    var keysB = (b.months || []).map(monthKey).filter(Boolean);
    return keysA.some(function (k) { return keysB.indexOf(k) >= 0; });
  }

  global.AdBooking = {
    monthKey: monthKey,
    monthToIndex: monthToIndex,
    computeEndDateISO: computeEndDateISO,
    slotLockedStatuses: slotLockedStatuses,
    normalizeSlot: normalizeSlot,
    canonicalSlotKey: canonicalSlotKey,
    monthsOverlapSameSlot: monthsOverlapSameSlot
  };
})(typeof window !== 'undefined' ? window : this);
