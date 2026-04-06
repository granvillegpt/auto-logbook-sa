/**
 * Export Logbook to PDF (SARS-ready format - Landscape)
 */

import PDFDocument from 'pdfkit';
import { buildRows } from './buildRows.js';

export function exportPdf(data) {
    if (!data || !data.entries || !Array.isArray(data.entries) || data.entries.length === 0) {
        throw new Error('Logbook data with entries is required');
    }

    const { meta, period, odometer, taxYear } = data;
    const { taxpayer, vehicle } = meta;
    
    // Format period dates for display
    const formatDateForDisplay = (dateStr) => {
        const date = new Date(dateStr + 'T00:00:00');
        const day = String(date.getDate()).padStart(2, '0');
        const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
        const month = monthNames[date.getMonth()];
        const year = date.getFullYear();
        return `${day} ${month} ${year}`;
    };

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
    
    // Force landscape A4 orientation (842 x 595 points) with 30pt margins
    const doc = new PDFDocument({ 
        size: [842, 595], // A4 landscape: width x height in points
        margin: 30,
        autoFirstPage: true
    });
    
    const buffers = [];

    doc.on('data', buffers.push.bind(buffers));
    doc.on('end', () => {});

    // Build canonical rows (get totals early for header)
    const { header, rows, totalsRow, totals } = buildRows(data.entries);

    // Page dimensions (use document properties or fallback to known values)
    const pageWidth = doc.page?.width || 842;
    const pageHeight = 595;
    const margin = doc.page?.margins?.left || 30;
    const usableWidth = pageWidth - (margin * 2);
    const usableHeight = pageHeight - (margin * 2);

    // Define fixed widths for small columns
    const fixedWidths = {
        date: 65,
        day: 35,
        shop: 80,
        purpose: 80,
        opening: 60,
        closing: 60,
        business: 60,
        distance: 60
    };

    const fixedTotal =
        fixedWidths.date +
        fixedWidths.day +
        fixedWidths.shop +
        fixedWidths.purpose +
        fixedWidths.opening +
        fixedWidths.closing +
        fixedWidths.business +
        fixedWidths.distance;

    // Dynamic width for From / To columns
    const remainingWidth = usableWidth - fixedTotal;

    // Split remaining width evenly between From and To
    const fromWidth = remainingWidth / 2;
    const toWidth = remainingWidth / 2;

    // Build column width array
    const colWidths = [
        fixedWidths.date,
        fixedWidths.day,
        fromWidth,
        toWidth,
        fixedWidths.shop,
        fixedWidths.purpose,
        fixedWidths.opening,
        fixedWidths.closing,
        fixedWidths.business,
        fixedWidths.distance
    ];

    // Numeric column indices (for right alignment)
    const numericCols = [6, 7, 8, 9]; // Opening KM, Closing KM, Business KM, Distance KM

    // Header Block (first page only, or smaller on subsequent pages)
    const drawHeader = (isFirstPage) => {
        const headerY = margin;
        let currentY = headerY;
        
        if (isFirstPage) {
            // Line 1: LOGBOOK – {Tax Year} in 14pt bold
            doc.fontSize(14).font('Helvetica-Bold').text(`LOGBOOK – ${taxYear || 'N/A'}`, margin, currentY);
            currentY += 20;
            
            // 10pt regular text below
            doc.fontSize(10).font('Helvetica');
            
            // Taxpayer
            doc.text(`Taxpayer: ${taxpayer.firstName || ''} ${taxpayer.surname || ''}`.trim() || 'Taxpayer: N/A', margin, currentY);
            currentY += 12;
            
            // Employer
            if (meta.employerName) {
                doc.text(`Employer: ${meta.employerName}`, margin, currentY);
                currentY += 12;
            }
            
            // Vehicle
            const vehicleInfo = `${vehicle.make || ''} ${vehicle.model || ''} ${vehicle.registration || ''}`.trim();
            doc.text(`Vehicle: ${vehicleInfo || 'N/A'}`, margin, currentY);
            currentY += 12;
            
            // Tax Year
            doc.text(`Tax Year: ${taxYear || 'N/A'}`, margin, currentY);
            currentY += 12;
            
            // Period
            if (meta.periodStart && meta.periodEnd) {
                const periodStartFormatted = formatDateForDisplay(meta.periodStart);
                const periodEndFormatted = formatDateForDisplay(meta.periodEnd);
                doc.text(`Period: ${periodStartFormatted} – ${periodEndFormatted}`, margin, currentY);
            } else {
                const periodStartFormatted = formatDateForDisplay(period.startDate);
                const periodEndFormatted = formatDateForDisplay(period.endDate);
                doc.text(`Period: ${periodStartFormatted} – ${periodEndFormatted}`, margin, currentY);
            }
            currentY += 15;
            
            // Blank line
            currentY += 5;
            
            // Odometer and totals
            doc.text(`Opening Odometer: ${odometer.openingKm?.toFixed(2) || '0.00'}`, margin, currentY);
            currentY += 12;
            doc.text(`Closing Odometer: ${totals.finalClosingKm}`, margin, currentY);
            currentY += 12;
            doc.text(`Total Travel: ${totals.totalKm}`, margin, currentY);
            currentY += 12;
            doc.text(`Business Travel: ${totals.totalBusinessKm}`, margin, currentY);
            currentY += 12;
            doc.text(`Private Travel: ${Number(data.odometer.totalPrivateKm).toFixed(2)}`, margin, currentY);
            currentY += 15;
            
            // Draw thin horizontal divider line
            doc.moveTo(margin, currentY).lineTo(pageWidth - margin, currentY).stroke();
            currentY += 10;
        } else {
            // Smaller header on subsequent pages
            doc.fontSize(10).font('Helvetica-Bold').text('LOGBOOK (continued)', margin, currentY);
            currentY += 15;
        }
        
        return currentY;
    };

    // Draw first page header
    let currentY = drawHeader(true);
    const tableStartY = currentY;
    const rowHeight = 16;
    const startX = margin;

    // Draw table header with light grey background
    const headerY = currentY;
    doc.rect(startX, headerY, colWidths.reduce((a, b) => a + b, 0), rowHeight)
        .fillColor('#f2f2f2')
        .fill()
        .fillColor('black');
    
    doc.fontSize(8.5).font('Helvetica-Bold');
    let x = startX;
    header.forEach((headerText, i) => {
        const align = numericCols.includes(i) ? 'right' : 'left';
        doc.text(headerText, x, currentY, { width: colWidths[i], align: align });
        x += colWidths[i];
    });

    // Draw header underline
    const headerBottom = currentY + rowHeight;
    doc.moveTo(startX, headerBottom).lineTo(startX + colWidths.reduce((a, b) => a + b, 0), headerBottom).stroke();
    
    currentY = headerBottom + 3;

    // Table rows
    doc.font('Helvetica').fontSize(8);
    const maxTableY = pageHeight - margin - 30; // Leave space for totals
    let rowIndex = 0;

    for (const row of rows) {
        // Check if we need a new page (use base rowHeight for estimation)
        if (currentY + rowHeight > maxTableY) {
            doc.addPage();
            currentY = drawHeader(false) + 10;
            
            // Redraw headers on new page with light grey background
            const headerY = currentY;
            doc.rect(startX, headerY, colWidths.reduce((a, b) => a + b, 0), rowHeight)
                .fillColor('#f2f2f2')
                .fill()
                .fillColor('black');
            
            doc.fontSize(8.5).font('Helvetica-Bold');
            x = startX;
            header.forEach((headerText, i) => {
                const align = numericCols.includes(i) ? 'right' : 'left';
                doc.text(headerText, x, currentY, { width: colWidths[i], align: align });
                x += colWidths[i];
            });
            doc.moveTo(startX, currentY + rowHeight).lineTo(startX + colWidths.reduce((a, b) => a + b, 0), currentY + rowHeight).stroke();
            currentY += rowHeight + 3;
            doc.font('Helvetica').fontSize(8);
        }

        // Draw row cells (wrap text for From/To, but keep numbers single-line)
        x = startX;
        let dynamicRowHeight = rowHeight;
        
        // Calculate dynamic row height first (before drawing)
        row.forEach((cell, i) => {
            if (i === 2 || i === 3) {
                const cellText = formatDisplayAddress(String(cell || ''));
                const textHeight = doc.heightOfString(cellText, { width: colWidths[i] });
                dynamicRowHeight = Math.max(dynamicRowHeight, textHeight + 4);
            }
        });

        // Zebra stripe (very subtle grey background for even rows)
        if (rowIndex % 2 === 1) {
            doc.rect(startX, currentY - 1, colWidths.reduce((a, b) => a + b, 0), dynamicRowHeight)
                .fillColor('#FAFAFA')
                .fill()
                .fillColor('black');
        }
        
        row.forEach((cell, i) => {
            const align = numericCols.includes(i) ? 'right' : 'left';
            let cellText = String(cell || '');
            
            // Format addresses for From/To columns
            if (i === 2 || i === 3) {
                cellText = formatDisplayAddress(cellText);
            }
            
            // For text columns (From, To), allow wrapping
            if (i === 2 || i === 3) {
                doc.text(cellText, x, currentY, { 
                    width: colWidths[i], 
                    align: align
                });
            } else {
                // For other columns, single line
                doc.text(cellText, x, currentY, { 
                    width: colWidths[i], 
                    align: align 
                });
            }
            x += colWidths[i];
        });

        // Draw row border (thin 0.3pt line) using dynamic row height
        doc.lineWidth(0.3);
        doc.moveTo(startX, currentY + dynamicRowHeight).lineTo(startX + colWidths.reduce((a, b) => a + b, 0), currentY + dynamicRowHeight).stroke();
        doc.lineWidth(1); // Reset to default

        currentY += dynamicRowHeight;
        rowIndex++;
    }

    // Totals section at bottom
    currentY += 8;
    
    // Draw horizontal line before totals (1pt solid top border)
    doc.lineWidth(1);
    doc.moveTo(startX, currentY).lineTo(startX + colWidths.reduce((a, b) => a + b, 0), currentY).stroke();
    doc.lineWidth(1); // Keep at 1pt for totals
    currentY += 8;

    // Totals row (bold, no zebra striping)
    doc.fontSize(8).font('Helvetica-Bold');
    x = startX;
    totalsRow.forEach((cell, i) => {
        const align = numericCols.includes(i) ? 'right' : 'left';
        doc.text(String(cell || ''), x, currentY, { width: colWidths[i], align: align });
        x += colWidths[i];
    });

    doc.end();

    return new Promise((resolve) => {
        doc.on('end', () => {
            resolve(Buffer.concat(buffers));
        });
    });
}
