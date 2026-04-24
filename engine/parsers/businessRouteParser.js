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
      var rawStartDate =
        row["Start Date"] ||
        row["StartDate"] ||
        row.startDate ||
        null;
      var parsedStartDate = toDateStr(rawStartDate);
      if (!parsedStartDate) {
        if (typeof console !== "undefined" && console.warn) {
          console.warn("Missing startDate from row:", row);
        }
      }
      var endDateRaw = getVal(row, 'End Date') || getVal(row, 'EndDate');
      var endDate = toDateStr(endDateRaw);
      var freqForMode =
        row["Frequency"] != null && String(row["Frequency"]).trim() !== ""
          ? String(row["Frequency"])
          : String(frequency || "");
      var lowerFreq = freqForMode.toLowerCase();
      var isRecurring =
        lowerFreq.indexOf("recurring") !== -1 && lowerFreq.indexOf("non-recurring") === -1;
      var routeMode = isRecurring ? "cycle" : "date";
      var route = {
        mode: routeMode,
        customer: location,
        location: location,
        purpose: purpose,
        frequency: frequency,
        startDate: parsedStartDate,
        endDate: endDate,
        sourceRow: i + 1,
        rowIndex: i + 1,
        address: null,
        suburb: null,
        city: null,
        province: null,
        fullAddress: null
      };
      var freqValue = String(row["Frequency"] != null ? row["Frequency"] : (frequency || "")).toLowerCase();
      var isOnceOff =
        freqValue.indexOf("once") !== -1 ||
        freqValue.indexOf("once-off") !== -1 ||
        freqValue.indexOf("once off") !== -1;
      if (isOnceOff && route.startDate) {
        route.endDate = route.startDate;
      }
      if (route.mode === "date" && route.startDate) {
        route.date = route.startDate;
      }
      if (typeof console !== "undefined" && console.log && route.mode === "date") {
        console.log("DATE MODE ROUTE:", {
          mode: route.mode,
          startDate: route.startDate,
          date: route.date
        });
      }
      if (typeof console !== "undefined" && console.log) {
        console.log("ONCE-OFF CHECK:", {
          freq: row["Frequency"],
          start: route.startDate,
          end: route.endDate
        });
      }
      if (routeMode === "cycle") {
        route.weeks = frequencyToWeeks(frequency);
        route.days = parseDaysFromWeekdayColumns(row);
      }
      if (typeof console !== "undefined" && console.log) {
        console.log("ROUTE MODE:", route.mode, "FREQ:", row["Frequency"]);
      }
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
