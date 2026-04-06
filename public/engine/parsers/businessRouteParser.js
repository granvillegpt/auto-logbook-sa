/**
 * Business Travel routelist parser.
 * Converts Business Travel Excel rows (Location, Purpose, Monday–Sunday columns, Frequency, Start Date, End Date)
 * into the same internal route format used by the routelist resolver and preview.
 * Does not modify Sales Rep parser or routing engine.
 */
(function (global) {
  'use strict';

  function getVal(row, key) {
    if (!row || typeof row !== 'object') return '';
    var k = key.toLowerCase().trim();
    for (var rk in row) {
      if (row.hasOwnProperty(rk) && (rk || '').toString().toLowerCase().trim() === k) {
        var v = row[rk];
        return v != null ? String(v).trim() : '';
      }
    }
    return '';
  }

  function getValRaw(row, key) {
    if (!row || typeof row !== 'object') return null;
    var k = key.toLowerCase().trim();
    for (var rk in row) {
      if (row.hasOwnProperty(rk) && (rk || '').toString().toLowerCase().trim() === k) {
        return row[rk];
      }
    }
    return null;
  }

  function isChecked(val) {
    return val === true ||
           val === 'TRUE' ||
           val === 'true' ||
           val === 1 ||
           val === '1' ||
           val === 'x' ||
           val === 'X';
  }

  function parseDaysFromWeekdayColumns(row) {
    return {
      mon: isChecked(getValRaw(row, 'Monday')),
      tue: isChecked(getValRaw(row, 'Tuesday')),
      wed: isChecked(getValRaw(row, 'Wednesday')),
      thu: isChecked(getValRaw(row, 'Thursday')),
      fri: isChecked(getValRaw(row, 'Friday')),
      sat: isChecked(getValRaw(row, 'Saturday'))
    };
  }

  function frequencyToWeeks(freqStr) {
    var weeks = [1, 2, 3, 4];
    var freq = String(freqStr || '').trim().toLowerCase();
    if (freq === 'monthly') weeks = [1];
    if (freq === 'once-off' || freq === 'once off') weeks = [1];
    return weeks;
  }

  function toDateStr(val) {
    if (val == null || val === '') return '';
    var num = typeof val === 'number' ? val : parseFloat(String(val).trim(), 10);
    if (typeof num === 'number' && !isNaN(num) && num > 25569) {
      var d = new Date((num - 25569) * 86400 * 1000);
      if (!isNaN(d.getTime())) {
        var y = d.getFullYear();
        var m = String(d.getMonth() + 1).padStart(2, '0');
        var day = String(d.getDate()).padStart(2, '0');
        return y + '-' + m + '-' + day;
      }
    }
    var str = String(val).trim();
    return str;
  }

  /**
   * Parse Business Travel rows into internal route objects.
   * @param {Array<Object>} rows - Array of row objects with keys Location, Purpose, Day, Frequency, Start Date, End Date (case-insensitive)
   * @returns {Array<Object>} Route objects compatible with routelist resolver and preview
   */
  function parseBusinessRoutes(rows) {
    var routes = [];
    if (!Array.isArray(rows)) return routes;
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var location = getVal(row, 'Location');
      if (!location) continue;
      var purpose = getVal(row, 'Purpose');
      var frequency = getVal(row, 'Frequency');
      var startDateRaw = getVal(row, 'Start Date') || getVal(row, 'StartDate');
      var endDateRaw = getVal(row, 'End Date') || getVal(row, 'EndDate');
      var startDate = toDateStr(startDateRaw);
      var endDate = toDateStr(endDateRaw);
      var route = {
        mode: 'date',
        customer: location,
        location: location,
        purpose: purpose,
        frequency: frequency,
        startDate: startDate,
        endDate: endDate,
        sourceRow: i + 1,
        rowIndex: i + 1,
        address: null,
        suburb: null,
        city: null,
        province: null,
        fullAddress: null
      };
      routes.push(route);
    }
    if (typeof console !== 'undefined' && console.log) {
      console.log('[BUSINESS_PARSER] rows parsed:', routes.length);
      if (routes.length > 0) console.log('[BUSINESS_PARSER] sample route:', routes[0]);
    }
    return routes;
  }

  global.parseBusinessRoutes = parseBusinessRoutes;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { parseBusinessRoutes: parseBusinessRoutes };
  }
})(typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : this);
