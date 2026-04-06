/**
 * Workflow 2: Business Travel Template parser and trip generator.
 * Parses Excel with columns: Client/Location, Visit Type, Day, Frequency, Start Date, End Date.
 * Expands rows into concrete trip dates. Output feeds into the same logbook engine as Workflow 1.
 *
 * Do not modify routing, export, or holiday logic.
 */
(function (global) {
  'use strict';

  var DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var DAY_TO_WEEKDAY = { Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6 };
  var FREQUENCY_VALUES = ['Weekly', 'Monthly', '2x Weekly', '3x Weekly', 'Once-Off'];

  var COLUMN_ALIASES = {
    customer: ['Customer', 'Client', 'Location', 'Site', 'Store', 'Client / Location', 'Client/Location'],
    purpose: ['Purpose', 'Reason', 'Visit Type', 'VisitType', 'Type', 'Activity'],
    day: ['Day', 'Weekday'],
    frequency: ['Frequency', 'Repeat'],
    startDate: ['Start Date', 'StartDate', 'Start', 'From'],
    endDate: ['End Date', 'EndDate', 'End', 'To']
  };

  function findColumnIndex(headerRow, aliases) {
    for (var a = 0; a < aliases.length; a++) {
      var alias = aliases[a];
      var key = (alias != null ? String(alias) : '').trim().toLowerCase();
      if (!key) continue;
      for (var i = 0; i < (headerRow || []).length; i++) {
        var h = headerRow[i];
        var cell = (h != null ? h.toString() : '').trim().toLowerCase();
        if (cell === key) return i;
      }
    }
    return -1;
  }

  function toISODate(d) {
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  function parseExcelDate(val) {
    if (val == null || val === '') return null;
    if (val instanceof Date) return isNaN(val.getTime()) ? null : val;
    if (typeof val === 'number' && !isNaN(val)) {
      var d = XLSXDateToJS(val);
      return d ? new Date(d) : null;
    }
    var str = String(val).trim();
    if (!str) return null;
    var d = new Date(str);
    return isNaN(d.getTime()) ? null : d;
  }

  function XLSXDateToJS(serial) {
    if (serial < 1 || isNaN(serial)) return null;
    var ms = (serial - 25569) * 86400 * 1000;
    var date = new Date(ms);
    if (isNaN(date.getTime())) return null;
    var y = date.getFullYear();
    var m = String(date.getMonth() + 1).padStart(2, '0');
    var d = String(date.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + d;
  }

  /**
   * Parse Workflow 2 Business Travel Template Excel.
   * @param {ArrayBuffer} arrayBuffer
   * @returns {{ rows: Array<{ client: string, visitType: string, day: string, frequency: string, startDate: Date, endDate: Date|null, rowIndex: number }>, columnMap: Object, errors: string[] }}
   */
  function parseWorkflow2Excel(arrayBuffer) {
    var XLSX = global.XLSX;
    if (!XLSX) throw new Error('XLSX not loaded. Include SheetJS script before this file.');

    var readOpts = (typeof Buffer !== 'undefined' && Buffer.isBuffer && Buffer.isBuffer(arrayBuffer))
      ? { type: 'buffer' }
      : { type: 'array' };
    var workbook = XLSX.read(arrayBuffer, readOpts);
    var firstSheet = workbook.SheetNames[0];
    if (!firstSheet) throw new Error('Excel file has no sheets');
    var sheet = workbook.Sheets[firstSheet];
    var jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
    if (jsonData.length < 2) throw new Error('Sheet is empty or has no data rows');

    var headerRow = jsonData[0] || [];
    var headers = headerRow.map(function (h) { return h != null ? h.toString().trim() : ''; });
    var columnMap = {
      customer: findColumnIndex(headers, COLUMN_ALIASES.customer),
      purpose: findColumnIndex(headers, COLUMN_ALIASES.purpose),
      day: findColumnIndex(headers, COLUMN_ALIASES.day),
      frequency: findColumnIndex(headers, COLUMN_ALIASES.frequency),
      startDate: findColumnIndex(headers, COLUMN_ALIASES.startDate),
      endDate: findColumnIndex(headers, COLUMN_ALIASES.endDate)
    };

    var errors = [];
    if (columnMap.customer < 0) errors.push('Missing column: Customer / Client / Location');
    if (columnMap.frequency < 0) errors.push('Missing column: Frequency');
    if (columnMap.startDate < 0) errors.push('Missing column: Start Date');
    if (errors.length > 0) {
      return { rows: [], columnMap: columnMap, errors: errors };
    }

    var rows = [];
    for (var ri = 1; ri < jsonData.length; ri++) {
      var r = jsonData[ri] || [];
      var customer = (columnMap.customer >= 0 && r[columnMap.customer] != null)
        ? String(r[columnMap.customer]).trim() : '';
      var purpose = (columnMap.purpose >= 0 && r[columnMap.purpose] != null)
        ? String(r[columnMap.purpose]).trim() : 'Visit';
      var dayVal = (columnMap.day >= 0 && r[columnMap.day] != null)
        ? String(r[columnMap.day]).trim() : '';
      var frequency = (columnMap.frequency >= 0 && r[columnMap.frequency] != null)
        ? String(r[columnMap.frequency]).trim() : '';
      var startDate = parseExcelDate(columnMap.startDate >= 0 ? r[columnMap.startDate] : null);
      var endDate = parseExcelDate(columnMap.endDate >= 0 ? r[columnMap.endDate] : null);

      if (!customer) continue;
      if (!frequency) {
        errors.push('Row ' + (ri + 1) + ': Frequency is required');
        continue;
      }
      if (!startDate) {
        errors.push('Row ' + (ri + 1) + ': Start Date is required');
        continue;
      }
      var freqNorm = frequency.toLowerCase().replace(/\s+/g, ' ').trim();
      var isOnceOff = freqNorm === 'once-off' || freqNorm === 'once off';
      if (!isOnceOff && !endDate) {
        errors.push('Row ' + (ri + 1) + ': End Date is required when Frequency is not Once-Off');
        continue;
      }

      rows.push({
        client: customer,
        visitType: purpose || 'Visit',
        day: dayVal,
        frequency: frequency,
        startDate: startDate,
        endDate: isOnceOff ? null : endDate,
        rowIndex: ri + 1
      });
    }

    return { rows: rows, columnMap: columnMap, errors: errors };
  }

  /**
   * Expand a single row into trip dates (ISO date strings).
   */
  function expandRowTrips(row) {
    var trips = [];
    var start = new Date(row.startDate.getTime());
    var end = row.endDate ? new Date(row.endDate.getTime()) : new Date(row.startDate.getTime());
    if (start > end) return trips;

    var freq = String(row.frequency).toLowerCase().replace(/\s+/g, ' ').trim();
    var dayStr = String(row.day).toLowerCase().trim();

    if (freq === 'once-off' || freq === 'once off') {
      trips.push({ date: toISODate(start), customer: row.client, reason: row.visitType, rowIndex: row.rowIndex });
      return trips;
    }

    if (freq === 'weekly') {
      var dayCapital = dayStr ? (dayStr.charAt(0).toUpperCase() + dayStr.slice(1)) : '';
      var targetWeekday = dayCapital && DAY_TO_WEEKDAY[dayCapital] !== undefined ? DAY_TO_WEEKDAY[dayCapital] : start.getDay();
      var cur = new Date(start.getTime());
      while (cur <= end) {
        if (cur.getDay() === targetWeekday) {
          trips.push({ date: toISODate(cur), customer: row.client, reason: row.visitType, rowIndex: row.rowIndex });
        }
        cur.setDate(cur.getDate() + 1);
      }
      return trips;
    }

    if (freq === 'monthly') {
      var refWeekday = start.getDay();
      var curMonth = new Date(start.getTime());
      var endMonth = new Date(end.getTime());
      while (curMonth <= endMonth) {
        var firstOfMonth = new Date(curMonth.getFullYear(), curMonth.getMonth(), 1);
        var cand = new Date(firstOfMonth.getTime());
        while (cand.getMonth() === firstOfMonth.getMonth()) {
          if (cand.getDay() === refWeekday && cand >= start && cand <= end) {
            trips.push({ date: toISODate(cand), customer: row.client, reason: row.visitType, rowIndex: row.rowIndex });
            break;
          }
          cand.setDate(cand.getDate() + 1);
        }
        curMonth.setMonth(curMonth.getMonth() + 1);
      }
      return trips;
    }

    if (freq === '2x weekly') {
      var days2 = [2, 4];
      var cur2 = new Date(start.getTime());
      while (cur2 <= end) {
        if (days2.indexOf(cur2.getDay()) !== -1) {
          trips.push({ date: toISODate(cur2), customer: row.client, reason: row.visitType, rowIndex: row.rowIndex });
        }
        cur2.setDate(cur2.getDate() + 1);
      }
      return trips;
    }

    if (freq === '3x weekly') {
      var days3 = [1, 3, 5];
      var cur3 = new Date(start.getTime());
      while (cur3 <= end) {
        if (days3.indexOf(cur3.getDay()) !== -1) {
          trips.push({ date: toISODate(cur3), customer: row.client, reason: row.visitType, rowIndex: row.rowIndex });
        }
        cur3.setDate(cur3.getDate() + 1);
      }
      return trips;
    }

    return trips;
  }

  /**
   * Expand all parsed rows into trips.
   * @param {Array} rows - from parseWorkflow2Excel().rows
   * @returns {Array<{ date: string, customer: string, reason: string, rowIndex: number }>}
   */
  function expandWorkflow2Trips(rows) {
    var all = [];
    for (var i = 0; i < rows.length; i++) {
      var t = expandRowTrips(rows[i]);
      for (var j = 0; j < t.length; j++) all.push(t[j]);
    }
    all.sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      return (a.rowIndex || 0) - (b.rowIndex || 0);
    });
    return all;
  }

  /**
   * Convert resolved route map (customer -> { fullAddress, address, suburb, city, province }) and trips into engine visits.
   * @param {Array<{ date: string, customer: string, reason: string, rowIndex: number }>} trips
   * @param {Object} resolvedByCustomer - customer string -> { fullAddress, address, suburb, city, province }
   * @returns {Array<{ date: string, customer: string, reason: string, rowIndex: number, fullAddress: string, address: string|null, suburb: string|null, city: string, province: string }>}
   */
  function tripsToVisits(trips, resolvedByCustomer) {
    var visits = [];
    for (var i = 0; i < trips.length; i++) {
      var t = trips[i];
      var res = resolvedByCustomer && resolvedByCustomer[t.customer];
      var fullAddress = (res && res.fullAddress) ? res.fullAddress : (t.customer || '');
      visits.push({
        date: t.date,
        customer: t.customer,
        reason: t.reason,
        rowIndex: t.rowIndex,
        fullAddress: fullAddress,
        address: (res && res.address) || null,
        suburb: (res && res.suburb) || null,
        city: (res && res.city) || '',
        province: (res && res.province) || ''
      });
    }
    return visits;
  }

  /**
   * Build resolvedByCustomer map from resolved route array (after resolveRouteAddresses).
   * @param {Array<{ customer: string, fullAddress: string, address: string, suburb: string, city: string, province: string }>} routes
   * @returns {Object} customer -> { fullAddress, address, suburb, city, province }
   */
  function buildResolvedMapFromRoutes(routes) {
    var map = {};
    if (!routes || !routes.length) return map;
    for (var i = 0; i < routes.length; i++) {
      var r = routes[i];
      var c = (r && r.customer) != null ? String(r.customer).trim() : '';
      if (c) {
        map[c] = {
          fullAddress: (r.fullAddress != null && r.fullAddress !== '') ? String(r.fullAddress) : c,
          address: r.address != null ? r.address : null,
          suburb: r.suburb != null ? r.suburb : null,
          city: r.city != null ? r.city : '',
          province: r.province != null ? r.province : ''
        };
      }
    }
    return map;
  }

  /**
   * Build synthetic routes from unique customers (for resolver). One route per unique customer; address empty so resolver uses Places.
   */
  function uniqueCustomersToRoutes(trips) {
    var seen = {};
    var routes = [];
    for (var i = 0; i < trips.length; i++) {
      var c = trips[i].customer;
      if (c && !seen[c]) {
        seen[c] = true;
        routes.push({
          customer: c,
          address: null,
          suburb: null,
          city: null,
          province: null,
          rowIndex: trips[i].rowIndex
        });
      }
    }
    return routes;
  }

  global.parseWorkflow2Excel = parseWorkflow2Excel;
  global.expandWorkflow2Trips = expandWorkflow2Trips;
  global.tripsToVisits = tripsToVisits;
  global.uniqueCustomersToRoutes = uniqueCustomersToRoutes;
  global.buildResolvedMapFromRoutes = buildResolvedMapFromRoutes;
  global.WORKFLOW2_DAY_NAMES = DAY_NAMES;
  global.WORKFLOW2_FREQUENCY_VALUES = FREQUENCY_VALUES;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      parseWorkflow2Excel: parseWorkflow2Excel,
      expandWorkflow2Trips: expandWorkflow2Trips,
      tripsToVisits: tripsToVisits,
      uniqueCustomersToRoutes: uniqueCustomersToRoutes,
      buildResolvedMapFromRoutes: buildResolvedMapFromRoutes,
      WORKFLOW2_DAY_NAMES: DAY_NAMES,
      WORKFLOW2_FREQUENCY_VALUES: FREQUENCY_VALUES
    };
  }
})(typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : this);
