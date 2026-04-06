/**
 * Single canonical row model for all exports
 * 
 * Ensures CSV, XLSX, and PDF all use identical row data with consistent rounding.
 */

/**
 * Format number to 2 decimal places (canonical rounding)
 * @param {number|null|undefined} n - Number to format
 * @returns {number} Formatted number (not string) with 2 decimals
 */
function formatNumber(n) {
    if (n === null || n === undefined || isNaN(n)) {
        return 0;
    }
    return Number(Number(n).toFixed(2));
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
    
    // If "Return to Base", no shop name
    if (purpose.includes('Return to Base')) {
        return '';
    }
    
    // If contains dash/hyphen with "Sales Visit", extract shop name
    if (purpose.includes('Sales Visit')) {
        const dashIndex = purpose.indexOf('–');
        if (dashIndex !== -1) {
            return purpose.substring(dashIndex + 1).trim();
        }
        const hyphenIndex = purpose.indexOf('-');
        if (hyphenIndex !== -1) {
            return purpose.substring(hyphenIndex + 1).trim();
        }
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
 * Get 3-letter weekday name from date string
 * @param {string} dateStr - Date string (YYYY-MM-DD)
 * @returns {string} 3-letter weekday (Mon, Tue, Wed, etc.)
 */
function getDay(dateStr) {
    if (!dateStr) return '';
    try {
        const dateObj = new Date(dateStr);
        return dateObj.toLocaleDateString('en-ZA', { weekday: 'short' });
    } catch (e) {
        return '';
    }
}

/**
 * Build canonical export rows from logbook entries
 * 
 * Returns rows with consistent formatting:
 * - All numeric KM fields rounded to 2 decimals
 * - Day column derived from Date
 * - Shop Name extracted from Purpose
 * - Clean Purpose (without shop name)
 * 
 * @param {Array} entries - Logbook entries from engine
 * @returns {Object} { header: [labels], rows: [[...]], totalsRow: [...] }
 */
export function buildRows(entries) {
    if (!entries || !Array.isArray(entries)) {
        throw new Error('Entries array is required');
    }

    // Column headers in exact order
    const header = [
        'Date',
        'Day',
        'From',
        'To',
        'Shop Name',
        'Purpose',
        'Opening KM',
        'Closing KM',
        'Business KM',
        'Distance KM'
    ];
    
    // Build rows from entries
    const rows = entries.map((entry, idx) => {
        const shopName = extractShopName(entry.purpose || '');
        const purpose = extractPurpose(entry.purpose || '');
        const day = entry.day || getDay(entry.date || '');
        const rawBusinessKm = entry.businessKm || 0;
        const distanceKm = formatNumber(rawBusinessKm);
        
        return [
            entry.date || '',
            day,
            entry.from || '',
            entry.to || '',
            shopName,
            purpose,
            formatNumber(entry.openingKm),
            formatNumber(entry.closingKm),
            formatNumber(rawBusinessKm),
            distanceKm
        ];
    });
    
    // Calculate totals
    let totalBusinessKm = 0;
    let totalPrivateKm = 0;
    let totalKm = 0;
    let finalClosingKm = 0;
    
    for (const entry of entries) {
        const entryBusinessKm = entry.businessKm || 0;
        const entryPrivateKm = entry.privateKm || 0;
        totalBusinessKm += entryBusinessKm;
        totalPrivateKm += entryPrivateKm;
        totalKm += entryBusinessKm; // Use businessKm only for totalKm (per-row private removed)
        if (entry.closingKm) {
            finalClosingKm = entry.closingKm;
        }
    }
    
    // Build totals row (all numeric fields rounded to 2 decimals)
    const totalsRow = [
        'TOTALS',
        '',
        '',
        '',
        '',
        '',
        '', // Opening KM (not summed)
        formatNumber(finalClosingKm), // Final closing KM
        formatNumber(totalBusinessKm),
        formatNumber(totalKm)
    ];
    
    return {
        header,
        rows,
        totalsRow,
        totals: {
            totalBusinessKm: formatNumber(totalBusinessKm),
            totalPrivateKm: formatNumber(totalPrivateKm),
            totalKm: formatNumber(totalKm),
            finalClosingKm: formatNumber(finalClosingKm)
        }
    };
}

