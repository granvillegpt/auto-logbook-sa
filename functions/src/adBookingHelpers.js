/**
 * Ad booking: end date from booked month labels (calendar year).
 */
const { monthToNumber } = require("./sponsoredSlotValidation");

/**
 * @param {unknown[]} monthsRaw
 * @param {number} [year]
 * @returns {string|null} ISO-8601 end of last day of latest month (UTC)
 */
function endDateISOFromBookedMonths(monthsRaw, year) {
  const nums = (monthsRaw || [])
    .map(monthToNumber)
    .filter((n) => n >= 1 && n <= 12);
  if (!nums.length) return null;
  const maxM = Math.max(...nums);
  const y =
    typeof year === "number" && Number.isFinite(year)
      ? year
      : new Date().getUTCFullYear();
  const lastDay = new Date(Date.UTC(y, maxM, 0)).getUTCDate();
  return new Date(Date.UTC(y, maxM - 1, lastDay, 23, 59, 59, 999)).toISOString();
}

function endDateValueToISOString(endDate) {
  if (endDate == null) return null;
  if (typeof endDate === "string") return endDate;
  if (typeof endDate.toDate === "function") {
    try {
      return endDate.toDate().toISOString();
    } catch (_e) {
      return null;
    }
  }
  return null;
}

module.exports = {
  endDateISOFromBookedMonths,
  endDateValueToISOString,
  monthToNumber,
};
