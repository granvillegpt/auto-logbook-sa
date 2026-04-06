/**
 * Date Range Utilities (browser)
 */
(function (global) {
  'use strict';

  /**
   * Convert tax year string (e.g. "2024/2025") to date range.
   * @param {string} taxYear - Format "YYYY/YYYY"
   * @returns {{ startDate: string, endDate: string }} YYYY-MM-DD
   */
  function taxYearToDateRange(taxYear) {
    var parts = taxYear.split('/');
    if (parts.length !== 2) {
      throw new Error('Invalid tax year format: ' + taxYear + '. Expected YYYY/YYYY');
    }
    var startYear = parseInt(parts[0], 10);
    var endYear = parseInt(parts[1], 10);
    if (isNaN(startYear) || isNaN(endYear)) {
      throw new Error('Invalid tax year: years must be numeric.');
    }
    if (endYear !== startYear + 1) {
      throw new Error('Invalid tax year: second year must be first year + 1.');
    }
    var startDate = startYear + '-03-01';
    var endDate = endYear + '-02-28';
    if (endYear % 4 === 0 && (endYear % 100 !== 0 || endYear % 400 === 0)) {
      endDate = endYear + '-02-29';
    }
    return { startDate: startDate, endDate: endDate };
  }

  /**
   * Returns true if the given date is a weekday (Monday–Friday), false for Saturday/Sunday.
   * @param {Date|string|number} date - Date to check
   * @returns {boolean}
   */
  function isWorkDay(date) {
    var d = new Date(date);
    var day = d.getDay();
    return day !== 0 && day !== 6;
  }

  global.dateRange = { taxYearToDateRange: taxYearToDateRange, isWorkDay: isWorkDay };
  global.isWorkDay = isWorkDay;
})(typeof window !== 'undefined' ? window : this);
