/**
 * Export Logbook to CSV (SARS-ready format)
 */

import { buildRows } from './buildRows.js';

export function exportCsv(data) {
    if (!data || !data.entries || !Array.isArray(data.entries) || data.entries.length === 0) {
        throw new Error('Logbook data with entries is required');
    }

    const { meta, period, odometer, taxYear } = data;
    const { taxpayer, vehicle } = meta;
    const csvRows = [];

    // Format period dates for display
    const formatDateForDisplay = (dateStr) => {
        const date = new Date(dateStr + 'T00:00:00');
        const day = String(date.getDate()).padStart(2, '0');
        const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
        const month = monthNames[date.getMonth()];
        const year = date.getFullYear();
        return `${day} ${month} ${year}`;
    };

    // Header section
    csvRows.push('CLEARTRACK LOGBOOK');
    csvRows.push('TAXPAYER:');
    csvRows.push(`Full Name: ${taxpayer.firstName} ${taxpayer.surname}`);
    if (taxpayer.idNumber) {
        csvRows.push(`Tax Number: ${taxpayer.idNumber}`);
    }
    csvRows.push('');
    if (meta.employerName) {
        csvRows.push(`Employer: ${meta.employerName}`);
        csvRows.push('');
    }
    csvRows.push('VEHICLE:');
    csvRows.push(`Make: ${vehicle.make}`);
    csvRows.push(`Model: ${vehicle.model}`);
    csvRows.push(`Registration: ${vehicle.registration}`);
    csvRows.push('');
    csvRows.push(`Tax Year: ${taxYear}`);
    if (meta.periodStart && meta.periodEnd) {
        csvRows.push(`Period: ${formatDateForDisplay(meta.periodStart)} – ${formatDateForDisplay(meta.periodEnd)}`);
    } else {
        csvRows.push(`Period: ${formatDateForDisplay(period.startDate)} – ${formatDateForDisplay(period.endDate)}`);
    }
    csvRows.push('');
    const { totals } = buildRows(data.entries);
    csvRows.push(`Opening KM: ${odometer.openingKm?.toFixed(2) || '0.00'}`);
    csvRows.push(`Closing KM: ${totals.finalClosingKm}`);
    csvRows.push(`Total Travel KM: ${totals.totalKm}`);
    csvRows.push(`Total Business KM: ${totals.totalBusinessKm}`);
    csvRows.push(`Total Private KM: ${Number(data.odometer.totalPrivateKm).toFixed(2)}`);
    csvRows.push(`Method: Odometer Reconciliation`);
    csvRows.push(''); // Empty row

    // Build export rows using canonical row model
    const { header, rows, totalsRow } = buildRows(data.entries);

    // Table headers
    csvRows.push(header.map(h => `"${h}"`).join(','));

    // CSV rows (escape quotes in text fields)
    for (const row of rows) {
        const csvRow = row.map(cell => {
            if (typeof cell === 'string' && cell.includes(',')) {
                return `"${cell.replace(/"/g, '""')}"`;
            }
            return cell;
        });
        csvRows.push(csvRow.join(','));
    }

    // Totals row
    csvRows.push(totalsRow.map(cell => {
        if (typeof cell === 'string' && cell.includes(',')) {
            return `"${cell.replace(/"/g, '""')}"`;
        }
        return cell;
    }).join(','));

    return csvRows.join('\n');
}
