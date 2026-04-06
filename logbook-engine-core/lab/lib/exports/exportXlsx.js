/**
 * Export Logbook to XLSX (SARS-ready format)
 */

import * as XLSX from 'xlsx';
import { buildRows } from './buildRows.js';

/**
 * Safe number conversion that prevents NaN/Infinity
 * @param {any} v - Value to convert
 * @param {number} fallback - Fallback value if conversion fails
 * @returns {number} Finite number or fallback
 */
function safeNumber(v, fallback = 0) {
    const n = typeof v === 'number' ? v : parseFloat(String(v).trim());
    return Number.isFinite(n) ? n : fallback;
}

// Format display address (remove South Africa and Western Cape)
function formatDisplayAddress(address) {
    if (!address || typeof address !== 'string') return '';

    const parts = address
        .split(',')
        .map(p => p.trim())
        .filter(Boolean);

    const filtered = parts.filter(p =>
        !/south africa/i.test(p) &&
        !/western cape/i.test(p)
    );

    // IMPORTANT: do NOT slice — keep meaningful locality
    return filtered.join(', ');
}

export function exportXlsx(data) {
    if (!data || !data.entries || !Array.isArray(data.entries) || data.entries.length === 0) {
        throw new Error('Logbook data with entries is required');
    }

    const { meta, period, odometer, taxYear } = data;
    const { taxpayer, vehicle } = meta;
    const worksheetData = [];

    // Format period dates for display
    const formatDateForDisplay = (dateStr) => {
        const date = new Date(dateStr + 'T00:00:00');
        const day = String(date.getDate()).padStart(2, '0');
        const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
        const month = monthNames[date.getMonth()];
        const year = date.getFullYear();
        return `${day} ${month} ${year}`;
    };

    // Title row (bold, larger font)
    worksheetData.push(['CLEARTRACK LOGBOOK']);
    worksheetData.push([]); // Empty row

    // Taxpayer Details section
    worksheetData.push(['TAXPAYER:']);
    worksheetData.push(['Full Name:', `${taxpayer.firstName} ${taxpayer.surname}`]);
    if (taxpayer.idNumber) {
        worksheetData.push(['Tax Number:', taxpayer.idNumber]);
    }
    worksheetData.push([]); // Empty row

    // Employer section
    if (meta.employerName) {
        worksheetData.push(['Employer:', meta.employerName]);
        worksheetData.push([]); // Empty row
    }

    // Vehicle Details section
    worksheetData.push(['VEHICLE:']);
    worksheetData.push(['Make:', vehicle.make]);
    worksheetData.push(['Model:', vehicle.model]);
    worksheetData.push(['Registration:', vehicle.registration]);
    worksheetData.push([]); // Empty row

    // Tax Year and Period
    worksheetData.push(['Tax Year:', taxYear]);
    if (meta.periodStart && meta.periodEnd) {
        worksheetData.push(['Period:', `${formatDateForDisplay(meta.periodStart)} – ${formatDateForDisplay(meta.periodEnd)}`]);
    } else {
        worksheetData.push(['Period:', `${formatDateForDisplay(period.startDate)} – ${formatDateForDisplay(period.endDate)}`]);
    }
    worksheetData.push([]); // Empty row

    // Build canonical rows first to get totals
    const { header, rows, totalsRow, totals } = buildRows(data.entries);
    
    // Odometer Summary section
    worksheetData.push(['Odometer Summary']);
    worksheetData.push(['Opening KM:', safeNumber(odometer.openingKm, 0).toFixed(2)]);
    worksheetData.push(['Closing KM:', safeNumber(totals.finalClosingKm, 0)]);
    worksheetData.push(['Total Travel KM:', safeNumber(totals.totalKm, 0)]);
    worksheetData.push(['Total Business KM:', safeNumber(totals.totalBusinessKm, 0)]);
    worksheetData.push(['Total Private KM:', Number.isFinite(data.odometer.totalPrivateKm)
        ? Number(data.odometer.totalPrivateKm)
        : 0]);
    worksheetData.push(['Method:', 'Odometer Reconciliation']);
    worksheetData.push([]); // Empty row

    // Table headers
    worksheetData.push(header);

    // Add entries (convert string numbers to numbers for proper formatting)
    const numericCols = new Set([6, 7, 8, 9]); // Opening KM, Closing KM, Business KM, Distance KM
    for (const row of rows) {
        const xlsxRow = row.map((cell, idx) => {
            // Format addresses for From/To columns (2 and 3)
            if (idx === 2 || idx === 3) {
                const formatted = formatDisplayAddress(cell);
                return formatted;
            }
            
            if (!numericCols.has(idx)) {
                // Ensure it's a valid string, handle NaN/Infinity
                if (cell === null || cell === undefined) {
                    return '';
                }
                if (typeof cell === 'number' && !Number.isFinite(cell)) {
                    return ''; // Convert NaN/Infinity to empty string
                }
                return String(cell); // Preserve the original string value
            }
            if (cell === '' || cell === null || cell === undefined) {
                return null;
            }
            const num = typeof cell === 'number' ? cell : parseFloat(String(cell).trim());
            const result = Number.isFinite(num) ? num : null;
            return result === null ? '' : result;
        });
        worksheetData.push(xlsxRow);
    }

    // Add totals row
    const xlsxTotalsRow = totalsRow.map((cell, idx) => {
        if (!numericCols.has(idx)) {
            // Ensure it's a valid string, handle NaN/Infinity
            if (cell === null || cell === undefined) {
                return '';
            }
            if (typeof cell === 'number' && !Number.isFinite(cell)) {
                return ''; // Convert NaN/Infinity to empty string
            }
            return String(cell); // Preserve the original string value
        }
        if (cell === '' || cell === null || cell === undefined) {
            return null;
        }
        const num = typeof cell === 'number' ? cell : parseFloat(String(cell).trim());
        const result = Number.isFinite(num) ? num : null;
        return result === null ? '' : result;
    });
    worksheetData.push(xlsxTotalsRow);

    // Create workbook
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);

    // Set column widths (10 columns now)
    worksheet['!cols'] = [
        { wch: 12 }, // Date
        { wch: 8 },  // Day
        { wch: 30 }, // From
        { wch: 30 }, // To
        { wch: 20 }, // Shop Name
        { wch: 20 }, // Purpose
        { wch: 12 }, // Opening KM
        { wch: 12 }, // Closing KM
        { wch: 12 }, // Business KM
        { wch: 12 }  // Distance KM
    ];

    // Merge title across columns
    if (!worksheet['!merges']) worksheet['!merges'] = [];
    worksheet['!merges'].push({ s: { r: 0, c: 0 }, e: { r: 0, c: 9 } });

    XLSX.utils.book_append_sheet(workbook, worksheet, 'Logbook');

    // Generate buffer
    return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}
