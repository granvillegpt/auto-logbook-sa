/**
 * Export Logbook to XLSX (SARS-ready format)
 * Browser-safe: returns Uint8Array when Buffer is not available.
 */

import * as XLSX from 'xlsx';
import { buildRows } from './buildRows.js';

function safeNumber(v, fallback = 0) {
    const n = typeof v === 'number' ? v : parseFloat(String(v).trim());
    return Number.isFinite(n) ? n : fallback;
}

function formatDisplayAddress(address) {
    if (!address || typeof address !== 'string') return '';
    const parts = address.split(',').map(p => p.trim()).filter(Boolean);
    const filtered = parts.filter(p =>
        !/south africa/i.test(p) && !/western cape/i.test(p)
    );
    return filtered.join(', ');
}

export function exportXlsx(data) {
    if (!data || !data.entries || !Array.isArray(data.entries) || data.entries.length === 0) {
        throw new Error('Logbook data with entries is required');
    }

    const { meta = {}, period, odometer = {}, taxYear } = data;
    const taxpayer = meta.taxpayer || { firstName: '', surname: '', idNumber: '' };
    const vehicle = meta.vehicle || { make: '', model: '', registration: '' };
    const worksheetData = [];

    const formatDateForDisplay = (dateStr) => {
        const date = new Date(dateStr + 'T00:00:00');
        const day = String(date.getDate()).padStart(2, '0');
        const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
        const month = monthNames[date.getMonth()];
        const year = date.getFullYear();
        return `${day} ${month} ${year}`;
    };

    worksheetData.push(['CLEARTRACK LOGBOOK']);
    worksheetData.push([]);

    worksheetData.push(['TAXPAYER:']);
    worksheetData.push(['Full Name:', `${taxpayer.firstName || ''} ${taxpayer.surname || ''}`.trim() || '—']);
    if (taxpayer.idNumber) {
        worksheetData.push(['Tax Number:', taxpayer.idNumber]);
    }
    worksheetData.push([]);

    if (meta.employerName) {
        worksheetData.push(['Employer:', meta.employerName]);
        worksheetData.push([]);
    }

    worksheetData.push(['VEHICLE:']);
    worksheetData.push(['Make:', vehicle.make || '—']);
    worksheetData.push(['Model:', vehicle.model || '—']);
    worksheetData.push(['Registration:', vehicle.registration || '—']);
    worksheetData.push([]);

    worksheetData.push(['Tax Year:', taxYear || '—']);
    if (meta.periodStart && meta.periodEnd) {
        worksheetData.push(['Period:', `${formatDateForDisplay(meta.periodStart)} – ${formatDateForDisplay(meta.periodEnd)}`]);
    } else if (period && period.startDate && period.endDate) {
        worksheetData.push(['Period:', `${formatDateForDisplay(period.startDate)} – ${formatDateForDisplay(period.endDate)}`]);
    } else {
        worksheetData.push(['Period:', '—']);
    }
    worksheetData.push([]);

    const { header, rows, totalsRow, totals } = buildRows(data.entries);

    worksheetData.push(['Odometer Summary']);
    worksheetData.push(['Opening KM:', safeNumber(odometer.openingKm, 0).toFixed(2)]);
    worksheetData.push(['Closing KM:', safeNumber(totals.finalClosingKm, 0)]);
    worksheetData.push(['Total Travel KM:', safeNumber(totals.totalKm, 0)]);
    worksheetData.push(['Total Business KM:', safeNumber(totals.totalBusinessKm, 0)]);
    worksheetData.push(['Total Private KM:', Number.isFinite(data.odometer && data.odometer.totalPrivateKm) ? Number(data.odometer.totalPrivateKm) : 0]);
    worksheetData.push(['Method:', 'Odometer Reconciliation']);
    worksheetData.push([]);

    worksheetData.push(header);

    const numericCols = new Set([6, 7, 8, 9]);
    for (const row of rows) {
        const xlsxRow = row.map((cell, idx) => {
            if (idx === 2 || idx === 3) {
                return formatDisplayAddress(cell);
            }
            if (!numericCols.has(idx)) {
                if (cell === null || cell === undefined) return '';
                if (typeof cell === 'number' && !Number.isFinite(cell)) return '';
                return String(cell);
            }
            if (cell === '' || cell === null || cell === undefined) return null;
            const num = typeof cell === 'number' ? cell : parseFloat(String(cell).trim());
            const result = Number.isFinite(num) ? num : null;
            return result === null ? '' : result;
        });
        worksheetData.push(xlsxRow);
    }

    const xlsxTotalsRow = totalsRow.map((cell, idx) => {
        if (!numericCols.has(idx)) {
            if (cell === null || cell === undefined) return '';
            if (typeof cell === 'number' && !Number.isFinite(cell)) return '';
            return String(cell);
        }
        if (cell === '' || cell === null || cell === undefined) return null;
        const num = typeof cell === 'number' ? cell : parseFloat(String(cell).trim());
        const result = Number.isFinite(num) ? num : null;
        return result === null ? '' : result;
    });
    worksheetData.push(xlsxTotalsRow);

    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);

    worksheet['!cols'] = [
        { wch: 12 }, { wch: 8 }, { wch: 30 }, { wch: 30 }, { wch: 20 }, { wch: 20 },
        { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }
    ];

    if (!worksheet['!merges']) worksheet['!merges'] = [];
    worksheet['!merges'].push({ s: { r: 0, c: 0 }, e: { r: 0, c: 9 } });

    XLSX.utils.book_append_sheet(workbook, worksheet, 'Logbook');

    const isBrowser = typeof Buffer === 'undefined';
    if (isBrowser) {
        const array = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
        return new Uint8Array(array);
    }
    return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}
