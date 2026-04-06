/**
 * Parse Route List Excel File
 * 
 * Parses Excel route list template into routes array for the engine.
 */

import * as XLSX from 'xlsx';

/**
 * Finds column index by name (case-insensitive)
 */
function findColumnIndex(headerRow, columnName) {
    const normalizedName = columnName.toLowerCase().trim();
    for (let i = 0; i < headerRow.length; i++) {
        if (headerRow[i] && headerRow[i].toString().toLowerCase().trim() === normalizedName) {
            return i;
        }
    }
    return null;
}

/**
 * Converts Excel cell value to boolean
 */
function cellToBoolean(value) {
    if (value === null || value === undefined || value === '') {
        return false;
    }
    if (typeof value === 'boolean') {
        return value;
    }
    if (typeof value === 'number') {
        return value !== 0;
    }
    const str = String(value).toLowerCase().trim();
    return str === 'true' || str === '1' || str === 'x' || str === 'yes';
}

/**
 * Parse Excel file to routes array
 * @param {Buffer} fileBuffer - Excel file buffer
 * @returns {Array} Routes array in format expected by engine
 */
export function parseRouteListExcel(fileBuffer) {
    const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
    const firstSheetName = workbook.SheetNames[0];
    
    if (!firstSheetName) {
        throw new Error('Excel file has no sheets');
    }

    const worksheet = workbook.Sheets[firstSheetName];
    const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: null });

    if (jsonData.length === 0) {
        throw new Error('Excel sheet is empty');
    }

    // Find header row (scan first 10 rows)
    const maxRowsToScan = Math.min(10, jsonData.length);
    let headerRowIndex = 0;
    let bestMatchCount = 0;

    for (let rowIdx = 0; rowIdx < maxRowsToScan; rowIdx++) {
        const row = jsonData[rowIdx];
        if (!row || row.length === 0) {
            continue;
        }

        let matchCount = 0;
        const rowLower = row.map(cell => cell ? String(cell).toLowerCase().trim() : '');
        
        if (rowLower.includes('address')) matchCount++;
        if (rowLower.includes('mon') || rowLower.includes('monday')) matchCount++;
        if (rowLower.includes('tue') || rowLower.includes('tuesday')) matchCount++;
        if (rowLower.includes('wed') || rowLower.includes('wednesday')) matchCount++;
        if (rowLower.includes('thu') || rowLower.includes('thursday')) matchCount++;
        if (rowLower.includes('fri') || rowLower.includes('friday')) matchCount++;

        if (matchCount > bestMatchCount) {
            bestMatchCount = matchCount;
            headerRowIndex = rowIdx;
        }
    }

    const headerRow = jsonData[headerRowIndex];
    if (!headerRow || headerRow.length === 0) {
        throw new Error('Could not find header row in Excel file. Please ensure your Excel file has column headers.');
    }

    // Find column indices
    const streetAddressCol = findColumnIndex(headerRow, 'street address') || findColumnIndex(headerRow, 'address');
    const suburbCol = findColumnIndex(headerRow, 'suburb');
    const cityCol = findColumnIndex(headerRow, 'city');
    const provinceCol = findColumnIndex(headerRow, 'province');
    const customerCol = findColumnIndex(headerRow, 'customer') || findColumnIndex(headerRow, 'client');
    const monCol = findColumnIndex(headerRow, 'mon') || findColumnIndex(headerRow, 'monday');
    const tueCol = findColumnIndex(headerRow, 'tue') || findColumnIndex(headerRow, 'tuesday');
    const wedCol = findColumnIndex(headerRow, 'wed') || findColumnIndex(headerRow, 'wednesday');
    const thuCol = findColumnIndex(headerRow, 'thu') || findColumnIndex(headerRow, 'thursday');
    const friCol = findColumnIndex(headerRow, 'fri') || findColumnIndex(headerRow, 'friday');
    const satCol = findColumnIndex(headerRow, 'sat') || findColumnIndex(headerRow, 'saturday');
    const weeksCol = findColumnIndex(headerRow, 'weeks') || findColumnIndex(headerRow, 'week');

    if (streetAddressCol === null || suburbCol === null || cityCol === null || provinceCol === null) {
        throw new Error('Could not find required address columns. Required: Street Address, Suburb, City, Province');
    }

    // Parse data rows
    const routes = [];
    for (let rowIdx = headerRowIndex + 1; rowIdx < jsonData.length; rowIdx++) {
        const row = jsonData[rowIdx];
        if (!row || row.length === 0) {
            continue;
        }

        // Normalize and extract address fields (handle trailing whitespace)
        const streetAddress = (row[streetAddressCol] || '').toString().trim();
        const suburb = (row[suburbCol] || '').toString().trim();
        const city = (row[cityCol] || '').toString().trim();
        const province = (row[provinceCol] || '').toString().trim();
        
        // Skip rows with no address data entirely (tolerant behavior - ignore blank rows)
        if (!streetAddress || streetAddress === '') {
            continue;
        }
        
        // Skip rows with partial address data (tolerant behavior - ignore incomplete rows)
        if (!suburb || !city || !province) {
            continue; // skip incomplete rows silently
        }

        const fullAddress = `${streetAddress}, ${suburb}, ${city}, ${province}, South Africa`;

        const customer = customerCol !== null && row[customerCol] ? String(row[customerCol]).trim() : fullAddress;

        // Parse days
        const days = {
            mon: monCol !== null ? cellToBoolean(row[monCol]) : false,
            tue: tueCol !== null ? cellToBoolean(row[tueCol]) : false,
            wed: wedCol !== null ? cellToBoolean(row[wedCol]) : false,
            thu: thuCol !== null ? cellToBoolean(row[thuCol]) : false,
            fri: friCol !== null ? cellToBoolean(row[friCol]) : false,
            sat: satCol !== null ? cellToBoolean(row[satCol]) : false
        };

        // Parse weeks (default to all weeks if not specified)
        let weeks = [1, 2, 3, 4];
        if (weeksCol !== null && row[weeksCol]) {
            const weeksValue = String(row[weeksCol]).trim();
            if (weeksValue) {
                const parsedWeeks = weeksValue.split(',').map(w => parseInt(w.trim(), 10)).filter(w => !isNaN(w) && w >= 1 && w <= 4);
                if (parsedWeeks.length > 0) {
                    weeks = parsedWeeks;
                }
            }
        }

        routes.push({
            customer: customer,
            address: fullAddress,
            suburb: suburb,
            days: days,
            weeks: weeks,
            rowIndex: rowIdx - headerRowIndex
        });
    }

    if (routes.length === 0) {
        throw new Error('No valid routes found in Excel file. Please ensure your file has at least one row with an Address and enabled days.');
    }

    return routes;
}

