/**
 * Date Range Utilities
 * 
 * Helper functions for tax year date range conversion.
 */

/**
 * Convert tax year string (e.g., "2024/2025") to date range
 * @param {string} taxYear - Tax year in format "YYYY/YYYY"
 * @returns {{startDate: string, endDate: string}} Date range in YYYY-MM-DD format
 */
export function taxYearToDateRange(taxYear) {
    const parts = taxYear.split('/');
    if (parts.length !== 2) {
        throw new Error(`Invalid tax year format: ${taxYear}. Expected format: YYYY/YYYY`);
    }

    const startYear = parseInt(parts[0], 10);
    const endYear = parseInt(parts[1], 10);

    if (isNaN(startYear) || isNaN(endYear)) {
        throw new Error(`Invalid tax year format: ${taxYear}. Years must be numeric.`);
    }

    if (endYear !== startYear + 1) {
        throw new Error(`Invalid tax year format: ${taxYear}. Second year must be first year + 1.`);
    }

    const startDate = `${startYear}-03-01`;
    const endDate = `${endYear}-02-28`;

    // Handle leap year
    if (endYear % 4 === 0 && (endYear % 100 !== 0 || endYear % 400 === 0)) {
        return {
            startDate: startDate,
            endDate: `${endYear}-02-29`
        };
    }

    return {
        startDate: startDate,
        endDate: endDate
    };
}


