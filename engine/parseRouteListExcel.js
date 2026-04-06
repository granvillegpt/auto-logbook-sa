/**
 * Route list parsing: raw ingest + enrichment (browser).
 * Uses global XLSX from CDN. Load after: <script src="https://cdn.sheetjs.com/xlsx-0.20.2/package/dist/xlsx.full.min.js"></script>
 *
 * Two-stage flow:
 * 1. parseRawRouteListExcel(buffer) – tolerant raw reader; does not require enriched columns.
 * 2. enrichRouteRows(rawResult) – normalizes raw rows into route contract with fullAddress.
 *
 * parseRouteListExcel(buffer) = enrichRouteRows(parseRawRouteListExcel(buffer)) for backward compatibility.
 */
(function (global) {
  'use strict';

  function findColumnIndex(headerRow, columnName) {
    var normalizedName = columnName.toLowerCase().trim();
    for (var i = 0; i < headerRow.length; i++) {
      if (headerRow[i] && headerRow[i].toString().toLowerCase().trim() === normalizedName) {
        return i;
      }
    }
    return null;
  }

  /**
   * Find column index by partial alias match: case-insensitive, trimmed.
   * Header cell matches if it contains the alias or the alias contains the header cell.
   * Aliases are tried longest-first so e.g. "Street Address" wins over "Address".
   */
  function findColumnIndexByPartialAliases(headerRow, aliases) {
    var aliasList = aliases.slice().map(function (a) { return String(a).toLowerCase().trim(); }).filter(Boolean);
    aliasList.sort(function (a, b) { return b.length - a.length; });
    for (var i = 0; i < headerRow.length; i++) {
      var cell = headerRow[i] != null ? headerRow[i].toString().toLowerCase().trim() : '';
      if (!cell) continue;
      for (var a = 0; a < aliasList.length; a++) {
        var alias = aliasList[a];
        if (cell.indexOf(alias) !== -1 || alias.indexOf(cell) !== -1) {
          return i;
        }
      }
    }
    return null;
  }

  function findColumnIndexWithAliases(headerRow, aliases) {
    for (var a = 0; a < aliases.length; a++) {
      var col = findColumnIndex(headerRow, aliases[a]);
      if (col !== null) return col;
    }
    return null;
  }

  /**
   * Fallback for weekday columns only: find first header whose normalized text contains the substring.
   * Used when exact match fails (e.g. " Monday ", "Visit Monday", extra spaces).
   */
  function findWeekdayColumnByPartialMatch(headerRow, substring) {
    var sub = String(substring).toLowerCase().trim();
    if (!sub) return null;
    for (var i = 0; i < headerRow.length; i++) {
      var cell = headerRow[i] != null ? headerRow[i].toString().toLowerCase().trim() : '';
      if (cell && cell.indexOf(sub) !== -1) return i;
    }
    return null;
  }

  var ADDRESS_ALIASES = ['street address', 'address', 'street', 'location', 'outlet address', 'delivery address', 'site address', 'place'];
  var CUSTOMER_ALIASES = ['customer', 'client', 'location', 'site', 'store', 'outlet', 'outlet name', 'account', 'customer name'];
  var SUBURB_ALIASES = ['suburb', 'town', 'area', 'district'];
  var CITY_ALIASES = ['city', 'municipality', 'metro'];
  var PROVINCE_ALIASES = ['province', 'region', 'state'];

  /**
   * Detect header row by counting how many known column names appear (broad match).
   * Does not require any specific columns; picks best-matching row.
   */
  function detectHeaderRow(jsonData, maxRowsToScan) {
    var headerRowIndex = 0;
    var bestMatchCount = 0;
    var keywords = ['customer', 'client', 'address', 'street', 'location', 'place', 'suburb', 'city', 'province', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'week'];
    for (var rowIdx = 0; rowIdx < maxRowsToScan; rowIdx++) {
      var row = jsonData[rowIdx];
      if (!row || row.length === 0) continue;
      var rowLower = row.map(function (cell) { return cell ? String(cell).toLowerCase().trim() : ''; });
      var matchCount = 0;
      for (var k = 0; k < keywords.length; k++) {
        if (rowLower.some(function (cell) { return cell && cell.indexOf(keywords[k]) !== -1; })) matchCount++;
      }
      if (matchCount > bestMatchCount) {
        bestMatchCount = matchCount;
        headerRowIndex = rowIdx;
      }
    }
    return headerRowIndex;
  }

  /**
   * Stage 1: Raw routelist ingest.
   * Reads the uploaded Excel, detects header row, extracts rows. Does NOT require Address/Suburb/City/Province.
   * @param {ArrayBuffer} arrayBuffer - Excel file buffer
   * @returns {{ headerRowIndex: number, headerRow: Array, columnMap: Object, rows: Array }}
   */
  function parseRawRouteListExcel(arrayBuffer) {
    var XLSX = global.XLSX;
    if (!XLSX) throw new Error('XLSX not loaded. Include SheetJS script before this file.');

    var readOpts = (typeof Buffer !== 'undefined' && Buffer.isBuffer && Buffer.isBuffer(arrayBuffer))
      ? { type: 'buffer' }
      : { type: 'array' };
    var workbook = XLSX.read(arrayBuffer, readOpts);
    var firstSheetName = workbook.SheetNames[0];
    if (!firstSheetName) throw new Error('Excel file has no sheets');

    var worksheet = workbook.Sheets[firstSheetName];
    var jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: null });
    if (jsonData.length === 0) throw new Error('Excel sheet is empty');

    var maxRowsToScan = Math.min(10, jsonData.length);
    var headerRowIndex = detectHeaderRow(jsonData, maxRowsToScan);
    var headerRow = jsonData[headerRowIndex];
    if (!headerRow || headerRow.length === 0) {
      headerRow = [];
    }

    var columnMap = {
      addressCol: findColumnIndexByPartialAliases(headerRow, ADDRESS_ALIASES),
      suburbCol: findColumnIndexByPartialAliases(headerRow, SUBURB_ALIASES),
      cityCol: findColumnIndexByPartialAliases(headerRow, CITY_ALIASES),
      provinceCol: findColumnIndexByPartialAliases(headerRow, PROVINCE_ALIASES),
      customerCol: findColumnIndexByPartialAliases(headerRow, CUSTOMER_ALIASES),
      monCol: findColumnIndexWithAliases(headerRow, ['monday', 'mon']) || findWeekdayColumnByPartialMatch(headerRow, 'monday'),
      tueCol: findColumnIndexWithAliases(headerRow, ['tuesday', 'tue']) || findWeekdayColumnByPartialMatch(headerRow, 'tuesday'),
      wedCol: findColumnIndexWithAliases(headerRow, ['wednesday', 'wed']) || findWeekdayColumnByPartialMatch(headerRow, 'wednesday'),
      thuCol: findColumnIndexWithAliases(headerRow, ['thursday', 'thu']) || findWeekdayColumnByPartialMatch(headerRow, 'thursday'),
      friCol: findColumnIndexWithAliases(headerRow, ['friday', 'fri']) || findWeekdayColumnByPartialMatch(headerRow, 'friday'),
      satCol: findColumnIndexWithAliases(headerRow, ['saturday', 'sat']) || findWeekdayColumnByPartialMatch(headerRow, 'saturday'),
      weeksCol: findColumnIndexWithAliases(headerRow, ['weeks', 'week']),
      frequencyCol: findColumnIndexWithAliases(headerRow, ['frequency', 'repeat']),
      startDateCol: findColumnIndexWithAliases(headerRow, ['start date', 'startdate', 'start']),
      endDateCol: findColumnIndexWithAliases(headerRow, ['end date', 'enddate', 'end'])
    };

    function getHeaderLabel(colIndex) {
      return colIndex != null && headerRow[colIndex] != null ? String(headerRow[colIndex]).trim() : null;
    }
    var detectedColumnNames = {
      address: getHeaderLabel(columnMap.addressCol),
      suburb: getHeaderLabel(columnMap.suburbCol),
      city: getHeaderLabel(columnMap.cityCol),
      province: getHeaderLabel(columnMap.provinceCol),
      customer: getHeaderLabel(columnMap.customerCol)
    };

    var rows = [];
    for (var ri = headerRowIndex + 1; ri < jsonData.length; ri++) {
      rows.push(jsonData[ri] || []);
    }

    return { headerRowIndex: headerRowIndex, headerRow: headerRow, columnMap: columnMap, detectedColumnNames: detectedColumnNames, rows: rows };
  }

  function cellToBoolean(value) {
    if (value === null || value === undefined || value === '') return false;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    var str = String(value).toLowerCase().trim();
    return str === 'true' || str === '1' || str === 'x' || str === 'yes';
  }

  /**
   * Parse Excel date (serial number or string) to ISO date string YYYY-MM-DD.
   * Returns null if value is empty or invalid.
   */
  function parseExcelDateToISOString(value) {
    if (value == null || value === '') return null;
    var d = null;
    if (typeof value === 'number' && !isNaN(value)) {
      var ms = (value - 25569) * 86400 * 1000;
      d = new Date(ms);
    } else {
      var str = String(value).trim();
      if (!str) return null;
      d = new Date(str);
    }
    if (!d || isNaN(d.getTime())) return null;
    var y = d.getFullYear();
    var m = d.getMonth() + 1;
    m = m < 10 ? '0' + m : String(m);
    var day = d.getDate();
    var dd = day < 10 ? '0' + day : String(day);
    return y + '-' + m + '-' + dd;
  }

  /**
   * Build fullAddress from non-null parts (address, suburb, city, province). No "South Africa" appended.
   */
  function buildFullAddressFromParts(address, suburb, city, province) {
    var parts = [];
    if (address) parts.push(String(address).trim());
    if (suburb) parts.push(String(suburb).trim());
    if (city) parts.push(String(city).trim());
    if (province) parts.push(String(province).trim());
    return parts.length > 0 ? parts.join(', ') : null;
  }

  /**
   * True if row has at least one weekday (enriched `days` object, legacy flat flags, or singular `day`).
   */
  function routeRowHasAnyWeekday(row) {
    if (!row || typeof row !== 'object') return false;
    if (row.days && typeof row.days === 'object') {
      return !!(row.days.mon || row.days.tue || row.days.wed || row.days.thu || row.days.fri || row.days.sat);
    }
    if (row.mon || row.tue || row.wed || row.thu || row.fri || row.sat) return true;
    if (row.day != null && String(row.day).trim() !== '') return true;
    return false;
  }

  /**
   * Strict routelist row: non-empty customer, ≥1 day, non-empty weeks array (cycle / engine contract).
   */
  function isValidRouteRow(row) {
    if (!row || typeof row !== 'object') return false;
    var c = row.customer != null ? String(row.customer).trim() : '';
    var hasCustomer = c.length > 0;
    var hasAnyDay = routeRowHasAnyWeekday(row);
    var w = row.weeks;
    var hasWeeks = Array.isArray(w) && w.length > 0;
    return hasCustomer && hasAnyDay && hasWeeks;
  }

  /**
   * Stage 2: Enrich raw rows into the route contract.
   * If columns are absent, values are null. fullAddress built from available parts.
   * @param {{ headerRowIndex: number, headerRow: Array, columnMap: Object, rows: Array }} rawResult
   * @returns {Array<{ mode: string, customer, address, suburb, city, province, days, weeks, rowIndex, fullAddress }>}
   */
  function enrichRouteRows(rawResult) {
    var columnMap = rawResult.columnMap;
    var rows = rawResult.rows;
    var enriched = [];

    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (!r || r.length === 0) {
        continue;
      }

      var address = (columnMap.addressCol != null && r[columnMap.addressCol] != null && r[columnMap.addressCol] !== '')
        ? (r[columnMap.addressCol] || '').toString().trim()
        : null;
      var suburb = (columnMap.suburbCol != null && r[columnMap.suburbCol] != null && r[columnMap.suburbCol] !== '')
        ? (r[columnMap.suburbCol] || '').toString().trim()
        : null;
      var city = (columnMap.cityCol != null && r[columnMap.cityCol] != null && r[columnMap.cityCol] !== '')
        ? (r[columnMap.cityCol] || '').toString().trim()
        : null;
      var province = (columnMap.provinceCol != null && r[columnMap.provinceCol] != null && r[columnMap.provinceCol] !== '')
        ? (r[columnMap.provinceCol] || '').toString().trim()
        : null;

      if (city == null && suburb != null) {
        city = suburb;
      }

      // Business/store name: taken from customer column (or address fallback). No cleaning—only trim; legal suffixes and messy names pass through to address lookup.
      var customer = (columnMap.customerCol != null && r[columnMap.customerCol] != null && (r[columnMap.customerCol] + '').trim() !== '')
        ? String(r[columnMap.customerCol]).trim()
        : (address != null ? address : null);
      if (customer && typeof console !== 'undefined' && console.log) {
        console.log('RAW NAME:', customer);
      }

      // Cycle weeks: default [1,2,3,4] when Week/Weeks missing or empty; column overrides when valid.
      var weeks = [1, 2, 3, 4];
      if (columnMap.weeksCol != null && r[columnMap.weeksCol] != null && r[columnMap.weeksCol] !== '') {
        var weeksValue = String(r[columnMap.weeksCol]).trim();
        if (weeksValue) {
          var parsed = weeksValue.split(',').map(function (w) { return parseInt(w.trim(), 10); }).filter(function (w) { return !isNaN(w) && w >= 1 && w <= 4; });
          if (parsed.length > 0) weeks = parsed;
        }
      }

      var frequency = null;
      if (columnMap.frequencyCol != null && r[columnMap.frequencyCol] != null && r[columnMap.frequencyCol] !== '') {
        frequency = String(r[columnMap.frequencyCol]).trim();
      }
      var startDate = (columnMap.startDateCol != null && r[columnMap.startDateCol] != null && r[columnMap.startDateCol] !== '')
        ? parseExcelDateToISOString(r[columnMap.startDateCol])
        : null;
      var endDate = (columnMap.endDateCol != null && r[columnMap.endDateCol] != null && r[columnMap.endDateCol] !== '')
        ? parseExcelDateToISOString(r[columnMap.endDateCol])
        : null;

      var days = {
        mon: columnMap.monCol != null ? cellToBoolean(r[columnMap.monCol]) : false,
        tue: columnMap.tueCol != null ? cellToBoolean(r[columnMap.tueCol]) : false,
        wed: columnMap.wedCol != null ? cellToBoolean(r[columnMap.wedCol]) : false,
        thu: columnMap.thuCol != null ? cellToBoolean(r[columnMap.thuCol]) : false,
        fri: columnMap.friCol != null ? cellToBoolean(r[columnMap.friCol]) : false,
        sat: columnMap.satCol != null ? cellToBoolean(r[columnMap.satCol]) : false
      };

      var fullAddress = buildFullAddressFromParts(address, suburb, city, province);

      var customerName = (customer || '').toString().trim();
      var hasActiveDay = Object.keys(days).some(function (k) {
        return days[k] === true;
      });
      if (
        !customerName ||
        customerName.length < 3 ||
        /^\d+$/.test(customerName) ||
        customerName === '<TEMP>' ||
        customerName === '0' ||
        customerName === '-' ||
        !hasActiveDay
      ) {
        continue;
      }

      var route = {
        mode: 'cycle',
        customer: customer,
        address: address,
        suburb: suburb,
        city: city,
        province: province,
        days: days,
        weeks: weeks,
        rowIndex: i + 1,
        fullAddress: fullAddress
      };
      if (frequency != null) route.frequency = frequency;
      if (startDate != null) route.startDate = startDate;
      if (endDate != null) route.endDate = endDate;
      if (typeof console !== 'undefined' && console.log) {
        console.log('[WEEKDAY_ROUTE_FREQUENCY]', route.customer || route.location, route.frequency, route.startDate, route.endDate, route.weeks);
      }
      enriched.push(route);
    }

    return enriched;
  }

  /**
   * One-shot: raw parse + enrich. Backward-compatible entry point.
   * Use this when you need the final route list from a raw file (e.g. logbook step without prior Generate Routelist).
   */
  function parseRouteListExcel(arrayBuffer) {
    var raw = parseRawRouteListExcel(arrayBuffer);
    return enrichRouteRows(raw);
  }

  global.parseRawRouteListExcel = parseRawRouteListExcel;
  global.enrichRouteRows = enrichRouteRows;
  global.parseRouteListExcel = parseRouteListExcel;
  global.isValidRouteRow = isValidRouteRow;
  global.routeRowHasAnyWeekday = routeRowHasAnyWeekday;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      parseRawRouteListExcel: parseRawRouteListExcel,
      enrichRouteRows: enrichRouteRows,
      parseRouteListExcel: parseRouteListExcel,
      isValidRouteRow: isValidRouteRow,
      routeRowHasAnyWeekday: routeRowHasAnyWeekday
    };
  }
})(typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : this);
