/**
 * Single canonical row model for all exports
 * Ensures CSV, XLSX, and PDF all use identical row data with consistent rounding.
 */

function formatNumber(n) {
    if (n === null || n === undefined || isNaN(n)) {
        return 0;
    }
    return Number(Number(n).toFixed(2));
}

function extractShopName(purpose) {
    if (!purpose || typeof purpose !== 'string') {
        return '';
    }
    if (purpose.includes('Return to Base')) {
        return '';
    }
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

function extractPurpose(purpose) {
    if (!purpose || typeof purpose !== 'string') {
        return '';
    }
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
 */
export function buildRows(entries) {
    if (!entries || !Array.isArray(entries)) {
        throw new Error('Entries array is required');
    }

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

    const rows = entries.map((entry) => {
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

    let totalBusinessKm = 0;
    let totalPrivateKm = 0;
    let totalKm = 0;
    let finalClosingKm = 0;

    for (const entry of entries) {
        const entryBusinessKm = entry.businessKm || 0;
        const entryPrivateKm = entry.privateKm || 0;
        totalBusinessKm += entryBusinessKm;
        totalPrivateKm += entryPrivateKm;
        totalKm += entryBusinessKm;
        if (entry.closingKm) {
            finalClosingKm = entry.closingKm;
        }
    }

    const totalsRow = [
        'TOTALS',
        '',
        '',
        '',
        '',
        '',
        '', // Opening KM (not summed)
        formatNumber(finalClosingKm),
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
