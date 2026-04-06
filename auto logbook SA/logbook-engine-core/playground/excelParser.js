/**
 * Excel Route List Parser
 * 
 * Parses Excel files into route objects for the logbook engine.
 * Uses SheetJS (xlsx) library from CDN (loaded in index.html).
 */

// XLSX is loaded globally via script tag in index.html
const XLSX = window.XLSX;

/**
 * Finds column index by name (case-insensitive)
 * @param {Array} headerRow - Array of header cell values
 * @param {string} columnName - Column name to find
 * @returns {number|null} Column index or null if not found
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
 * Handles various checkbox representations: true, 1, "TRUE", "1", "x", "X", etc.
 * @param {*} value - Cell value
 * @returns {boolean}
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
 * Parses Excel route list file into route objects
 * @param {File|ArrayBuffer} file - Excel file
 * @returns {Promise<Array>} Array of route objects
 */
export async function parseExcelRouteList(file) {
    // Convert file to ArrayBuffer if needed
    let arrayBuffer;
    if (file instanceof File) {
        arrayBuffer = await file.arrayBuffer();
    } else if (file instanceof ArrayBuffer) {
        arrayBuffer = file;
    } else {
        throw new Error('Invalid file type. Expected File or ArrayBuffer.');
    }

    // Parse workbook
    const workbook = XLSX.read(arrayBuffer, { type: 'array' });
    
    // Get first sheet
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
        throw new Error('Could not find header row in Excel file');
    }

    // Find column indices
    const addressCol = findColumnIndex(headerRow, 'address');
    const customerCol = findColumnIndex(headerRow, 'customer') || findColumnIndex(headerRow, 'client');
    const suburbCol = findColumnIndex(headerRow, 'suburb') || findColumnIndex(headerRow, 'city');
    const monCol = findColumnIndex(headerRow, 'mon') || findColumnIndex(headerRow, 'monday');
    const tueCol = findColumnIndex(headerRow, 'tue') || findColumnIndex(headerRow, 'tuesday');
    const wedCol = findColumnIndex(headerRow, 'wed') || findColumnIndex(headerRow, 'wednesday');
    const thuCol = findColumnIndex(headerRow, 'thu') || findColumnIndex(headerRow, 'thursday');
    const friCol = findColumnIndex(headerRow, 'fri') || findColumnIndex(headerRow, 'friday');
    const satCol = findColumnIndex(headerRow, 'sat') || findColumnIndex(headerRow, 'saturday');
    const weeksCol = findColumnIndex(headerRow, 'weeks') || findColumnIndex(headerRow, 'week');

    if (addressCol === null) {
        throw new Error('Could not find "Address" column in Excel file');
    }

    // Parse data rows
    const routes = [];
    for (let rowIdx = headerRowIndex + 1; rowIdx < jsonData.length; rowIdx++) {
        const row = jsonData[rowIdx];
        if (!row || row.length === 0) {
            continue;
        }

        const address = row[addressCol] ? String(row[addressCol]).trim() : '';
        if (!address) {
            continue; // Skip rows without address
        }

        const customer = customerCol !== null && row[customerCol] ? String(row[customerCol]).trim() : address;
        const suburb = suburbCol !== null && row[suburbCol] ? String(row[suburbCol]).trim() : '';

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
            address: address,
            suburb: suburb,
            days: days,
            weeks: weeks,
            rowIndex: rowIdx - headerRowIndex // Relative to header row
        });
    }

    if (routes.length === 0) {
        throw new Error('No valid routes found in Excel file');
    }

    return routes;
}

