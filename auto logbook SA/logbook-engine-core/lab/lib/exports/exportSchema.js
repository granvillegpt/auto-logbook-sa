/**
 * Shared Export Schema
 * 
 * Ensures all export formats (CSV, XLSX, PDF) use identical columns, ordering, and formatting.
 */

/**
 * Get export column definitions in exact order
 * @returns {Array<{key: string, label: string}>}
 */
export function getExportColumns() {
    return [
        { key: 'date', label: 'Date' },
        { key: 'day', label: 'Day' },
        { key: 'from', label: 'From' },
        { key: 'to', label: 'To' },
        { key: 'shopName', label: 'Shop Name' },
        { key: 'purpose', label: 'Purpose' },
        { key: 'openingKm', label: 'Opening KM' },
        { key: 'closingKm', label: 'Closing KM' },
        { key: 'businessKm', label: 'Business KM' },
        { key: 'privateKm', label: 'Private KM' },
        { key: 'distanceKm', label: 'Distance KM' }
    ];
}

/**
 * Format number to 2 decimal places
 * @param {number|null|undefined} n - Number to format
 * @returns {string} Formatted number or empty string
 */
export function formatNumber(n) {
    if (n === null || n === undefined || isNaN(n)) {
        return '';
    }
    return Number(n).toFixed(2);
}

/**
 * Extract shop name from purpose field
 * @param {string} purpose - Purpose string (e.g. "Sales Visit – Spar")
 * @returns {string} Shop name or empty string
 */
function extractShopName(purpose) {
    if (!purpose || typeof purpose !== 'string') {
        return '';
    }
    
    // If purpose contains "–" or "-" with "Sales Visit", extract shop name
    if (purpose.includes('Sales Visit')) {
        const dashIndex = purpose.indexOf('–');
        if (dashIndex === -1) {
            const hyphenIndex = purpose.indexOf('-');
            if (hyphenIndex !== -1) {
                return purpose.substring(hyphenIndex + 1).trim();
            }
        } else {
            return purpose.substring(dashIndex + 1).trim();
        }
    }
    
    // If "Return to Base", no shop name
    if (purpose.includes('Return to Base')) {
        return '';
    }
    
    return '';
}

/**
 * Extract clean purpose (without shop name)
 * @param {string} purpose - Purpose string (e.g. "Sales Visit – Spar")
 * @returns {string} Clean purpose (e.g. "Sales Visit")
 */
function extractPurpose(purpose) {
    if (!purpose || typeof purpose !== 'string') {
        return '';
    }
    
    // If contains dash/hyphen, take left side
    const dashIndex = purpose.indexOf('–');
    if (dashIndex !== -1) {
        return purpose.substring(0, dashIndex).trim();
    }
    
    const hyphenIndex = purpose.indexOf('-');
    if (hyphenIndex !== -1 && purpose.includes('Sales Visit')) {
        return purpose.substring(0, hyphenIndex).trim();
    }
    
    return purpose.trim();
}

/**
 * Build export rows from logbook data
 * @param {Object} data - Logbook data with entries, odometer, etc.
 * @returns {Object} { header: [labels], rows: [[...]], totalsRow: [...] }
 */
export function buildExportRows(data) {
    if (!data || !data.entries || !Array.isArray(data.entries)) {
        throw new Error('Logbook data with entries is required');
    }

    const columns = getExportColumns();
    const header = columns.map(col => col.label);
    
    const rows = data.entries.map(entry => {
        // Extract shop name (prefer entry.shopName, otherwise derive from purpose)
        let shopName = entry.shopName || '';
        if (!shopName && entry.purpose) {
            shopName = extractShopName(entry.purpose);
        }
        
        // Extract clean purpose
        const purpose = extractPurpose(entry.purpose || '');
        
        // Calculate distance KM (business + private)
        const distanceKm = (entry.businessKm || 0) + (entry.privateKm || 0);
        
        return [
            entry.date || '',
            entry.day || '',
            entry.from || '',
            entry.to || '',
            shopName,
            purpose,
            formatNumber(entry.openingKm),
            formatNumber(entry.closingKm),
            formatNumber(entry.businessKm),
            formatNumber(entry.privateKm),
            formatNumber(distanceKm)
        ];
    });
    
    // Build totals row
    const odometer = data.odometer || {};
    const totalsRow = [
        'TOTALS',
        '',
        '',
        '',
        '',
        '',
        '', // Opening KM (not summed)
        formatNumber(odometer.closingKm), // Final closing KM
        formatNumber(odometer.totalBusinessKm),
        formatNumber(odometer.totalPrivateKm),
        formatNumber(odometer.totalTravel || odometer.totalKm) // Total distance
    ];
    
    return {
        header,
        rows,
        totalsRow
    };
}

