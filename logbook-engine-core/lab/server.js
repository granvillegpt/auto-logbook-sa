/**
 * Logbook Engine Lab - Express Server
 * 
 * Standalone Express backend for testing the pure logbook engine
 * with real Google routing and export capabilities.
 */

import express from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import dotenv from 'dotenv';
import { runLogbookEngine } from '../src/logbookEngine.js';
import { parseRouteListExcel } from './lib/parseRouteListExcel.js';
import { GoogleRouting } from './lib/routing/googleRouting.js';
import { CachedRouting } from './lib/routing/cachedRouting.js';
import { exportCsv } from './lib/exports/exportCsv.js';
import { exportXlsx } from './lib/exports/exportXlsx.js';
import { exportPdf } from './lib/exports/exportPdf.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// In-memory store for results (keyed by runId)
const resultsStore = new Map();

// Configure multer for file uploads
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB limit
    }
});

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Initialize routing service (simple address-based routing)
let routingService = null;
try {
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey || apiKey === 'your_api_key_here') {
        console.warn('WARNING: GOOGLE_MAPS_API_KEY not set. Routing will fail.');
    } else {
        const googleRouting = new GoogleRouting(apiKey);
        routingService = new CachedRouting(googleRouting);
        console.log('Routing service initialized with address-based Google Routes API');
    }
} catch (error) {
    console.error('Failed to initialize routing service:', error.message);
}

/**
 * GET / - Upload form
 */
app.get('/', (req, res) => {
    const indexPath = join(__dirname, 'views', 'index.html');
    res.sendFile(indexPath);
});

/**
 * POST /run - Generate logbook
 */
app.post('/run', upload.single('file'), async (req, res) => {
    try {
        // Validate file upload
        if (!req.file) {
            const resultHtml = readFileSync(join(__dirname, 'views', 'result.html'), 'utf8');
            const html = resultHtml
                .replace(/\{\{runId\}\}/g, '')
                .replace(/\{\{totals\}\}/g, '{}')
                .replace(/\{\{meta\}\}/g, '{}')
                .replace(/\{\{totalEntries\}\}/g, '0')
                .replace(/\{\{displayCount\}\}/g, '0')
                .replace(/\{\{entriesTable\}\}/g, '')
                .replace(/\{\{error\}\}/g, 'Excel file is required')
                .replace(/\{\{hasError\}\}/g, 'true');
            return res.status(400).send(html);
        }

        // Validate required fields
        const { 
            firstName, 
            surname, 
            idNumber,
            vehicleMake,
            vehicleModel,
            vehicleRegistration,
            vehicleYear,
            taxYear,
            homeAddress, 
            openingKm, 
            closingKm, 
            currentWeek, 
            leaveDays,
            workSaturdays,
            manualEntries
        } = req.body;

        // Extract dates and employer with proper trimming
        const rawStartDate = (req.body.startDate || '').trim();
        const rawEndDate = (req.body.endDate || '').trim();
        const employerName = (req.body.employerName || '').trim();

        // Validate and parse tax year
        if (!taxYear || typeof taxYear !== 'string' || !taxYear.match(/^\d{4}\/\d{4}$/)) {
            const resultHtml = readFileSync(join(__dirname, 'views', 'result.html'), 'utf8');
            const html = resultHtml
                .replace(/\{\{runId\}\}/g, '')
                .replace(/\{\{totals\}\}/g, '{}')
                .replace(/\{\{meta\}\}/g, '{}')
                .replace(/\{\{totalEntries\}\}/g, '0')
                .replace(/\{\{displayCount\}\}/g, '0')
                .replace(/\{\{entriesTable\}\}/g, '')
                .replace(/\{\{error\}\}/g, 'Tax Year is required and must be in format YYYY/YYYY (e.g. 2024/2025)')
                .replace(/\{\{hasError\}\}/g, 'true');
            return res.status(400).send(html);
        }

        // Parse tax year and derive date range
        const taxYearParts = taxYear.split('/');
        const startYear = parseInt(taxYearParts[0], 10);
        const endYear = parseInt(taxYearParts[1], 10);

        // Validate endYear = startYear + 1
        if (isNaN(startYear) || isNaN(endYear) || endYear !== startYear + 1) {
            const resultHtml = readFileSync(join(__dirname, 'views', 'result.html'), 'utf8');
            const html = resultHtml
                .replace(/\{\{runId\}\}/g, '')
                .replace(/\{\{totals\}\}/g, '{}')
                .replace(/\{\{meta\}\}/g, '{}')
                .replace(/\{\{totalEntries\}\}/g, '0')
                .replace(/\{\{displayCount\}\}/g, '0')
                .replace(/\{\{entriesTable\}\}/g, '')
                .replace(/\{\{error\}\}/g, 'Invalid tax year format. End year must be start year + 1 (e.g. 2024/2025)')
                .replace(/\{\{hasError\}\}/g, 'true');
            return res.status(400).send(html);
        }

        // Derive start and end dates from tax year
        // Tax year: 1 March (startYear) to 28 February (endYear)
        const derivedStartDate = `${startYear}-03-01`;
        const derivedEndDate = `${endYear}-02-28`;

        // Check if manual dates are provided
        const hasManualDates = rawStartDate !== '' && rawEndDate !== '';

        // Use manual dates if provided, otherwise use derived dates
        const finalStartDate = hasManualDates ? rawStartDate : derivedStartDate;
        const finalEndDate = hasManualDates ? rawEndDate : derivedEndDate;

        // Temporary debug log
        console.log("GENERATING FROM:", finalStartDate, "TO:", finalEndDate);

        // Validate taxpayer fields
        if (!firstName || typeof firstName !== 'string' || firstName.trim() === '') {
            const resultHtml = readFileSync(join(__dirname, 'views', 'result.html'), 'utf8');
            const html = resultHtml
                .replace(/\{\{runId\}\}/g, '')
                .replace(/\{\{totals\}\}/g, '{}')
                .replace(/\{\{meta\}\}/g, '{}')
                .replace(/\{\{totalEntries\}\}/g, '0')
                .replace(/\{\{displayCount\}\}/g, '0')
                .replace(/\{\{entriesTable\}\}/g, '')
                .replace(/\{\{error\}\}/g, 'First Name is required')
                .replace(/\{\{hasError\}\}/g, 'true');
            return res.status(400).send(html);
        }

        if (!surname || typeof surname !== 'string' || surname.trim() === '') {
            const resultHtml = readFileSync(join(__dirname, 'views', 'result.html'), 'utf8');
            const html = resultHtml
                .replace(/\{\{runId\}\}/g, '')
                .replace(/\{\{totals\}\}/g, '{}')
                .replace(/\{\{meta\}\}/g, '{}')
                .replace(/\{\{totalEntries\}\}/g, '0')
                .replace(/\{\{displayCount\}\}/g, '0')
                .replace(/\{\{entriesTable\}\}/g, '')
                .replace(/\{\{error\}\}/g, 'Surname is required')
                .replace(/\{\{hasError\}\}/g, 'true');
            return res.status(400).send(html);
        }

        // Validate vehicle fields
        if (!vehicleMake || typeof vehicleMake !== 'string' || vehicleMake.trim() === '') {
            const resultHtml = readFileSync(join(__dirname, 'views', 'result.html'), 'utf8');
            const html = resultHtml
                .replace(/\{\{runId\}\}/g, '')
                .replace(/\{\{totals\}\}/g, '{}')
                .replace(/\{\{meta\}\}/g, '{}')
                .replace(/\{\{totalEntries\}\}/g, '0')
                .replace(/\{\{displayCount\}\}/g, '0')
                .replace(/\{\{entriesTable\}\}/g, '')
                .replace(/\{\{error\}\}/g, 'Vehicle Make is required')
                .replace(/\{\{hasError\}\}/g, 'true');
            return res.status(400).send(html);
        }

        if (!vehicleModel || typeof vehicleModel !== 'string' || vehicleModel.trim() === '') {
            const resultHtml = readFileSync(join(__dirname, 'views', 'result.html'), 'utf8');
            const html = resultHtml
                .replace(/\{\{runId\}\}/g, '')
                .replace(/\{\{totals\}\}/g, '{}')
                .replace(/\{\{meta\}\}/g, '{}')
                .replace(/\{\{totalEntries\}\}/g, '0')
                .replace(/\{\{displayCount\}\}/g, '0')
                .replace(/\{\{entriesTable\}\}/g, '')
                .replace(/\{\{error\}\}/g, 'Vehicle Model is required')
                .replace(/\{\{hasError\}\}/g, 'true');
            return res.status(400).send(html);
        }

        if (!vehicleRegistration || typeof vehicleRegistration !== 'string' || vehicleRegistration.trim() === '') {
            const resultHtml = readFileSync(join(__dirname, 'views', 'result.html'), 'utf8');
            const html = resultHtml
                .replace(/\{\{runId\}\}/g, '')
                .replace(/\{\{totals\}\}/g, '{}')
                .replace(/\{\{meta\}\}/g, '{}')
                .replace(/\{\{totalEntries\}\}/g, '0')
                .replace(/\{\{displayCount\}\}/g, '0')
                .replace(/\{\{entriesTable\}\}/g, '')
                .replace(/\{\{error\}\}/g, 'Vehicle Registration Number is required')
                .replace(/\{\{hasError\}\}/g, 'true');
            return res.status(400).send(html);
        }

        if (!homeAddress || typeof homeAddress !== 'string') {
            const resultHtml = readFileSync(join(__dirname, 'views', 'result.html'), 'utf8');
            const html = resultHtml
                .replace(/\{\{runId\}\}/g, '')
                .replace(/\{\{totals\}\}/g, '{}')
                .replace(/\{\{meta\}\}/g, '{}')
                .replace(/\{\{totalEntries\}\}/g, '0')
                .replace(/\{\{displayCount\}\}/g, '0')
                .replace(/\{\{entriesTable\}\}/g, '')
                .replace(/\{\{error\}\}/g, 'homeAddress is required and must be a string')
                .replace(/\{\{hasError\}\}/g, 'true');
            return res.status(400).send(html);
        }

        const openingKmNum = parseFloat(openingKm);
        if (isNaN(openingKmNum) || openingKmNum < 0) {
            const resultHtml = readFileSync(join(__dirname, 'views', 'result.html'), 'utf8');
            const html = resultHtml
                .replace(/\{\{runId\}\}/g, '')
                .replace(/\{\{totals\}\}/g, '{}')
                .replace(/\{\{meta\}\}/g, '{}')
                .replace(/\{\{totalEntries\}\}/g, '0')
                .replace(/\{\{displayCount\}\}/g, '0')
                .replace(/\{\{entriesTable\}\}/g, '')
                .replace(/\{\{error\}\}/g, 'openingKm is required and must be a non-negative number')
                .replace(/\{\{hasError\}\}/g, 'true');
            return res.status(400).send(html);
        }

        // Start and end dates are now derived from tax year, no need to validate manual inputs

        const currentWeekNum = parseInt(currentWeek, 10);
        if (isNaN(currentWeekNum) || currentWeekNum < 1 || currentWeekNum > 4) {
            const resultHtml = readFileSync(join(__dirname, 'views', 'result.html'), 'utf8');
            const html = resultHtml
                .replace(/\{\{runId\}\}/g, '')
                .replace(/\{\{totals\}\}/g, '{}')
                .replace(/\{\{meta\}\}/g, '{}')
                .replace(/\{\{totalEntries\}\}/g, '0')
                .replace(/\{\{displayCount\}\}/g, '0')
                .replace(/\{\{entriesTable\}\}/g, '')
                .replace(/\{\{error\}\}/g, 'currentWeek is required and must be 1, 2, 3, or 4')
                .replace(/\{\{hasError\}\}/g, 'true');
            return res.status(400).send(html);
        }

        // Parse leaveDays if provided
        let leaveDaysArray = [];
        if (leaveDays) {
            try {
                leaveDaysArray = JSON.parse(leaveDays);
                if (!Array.isArray(leaveDaysArray)) {
                    leaveDaysArray = [];
                }
            } catch (e) {
                leaveDaysArray = [];
            }
        }

        // Check routing service
        if (!routingService) {
            const resultHtml = readFileSync(join(__dirname, 'views', 'result.html'), 'utf8');
            const html = resultHtml
                .replace(/\{\{runId\}\}/g, '')
                .replace(/\{\{totals\}\}/g, '{}')
                .replace(/\{\{meta\}\}/g, '{}')
                .replace(/\{\{totalEntries\}\}/g, '0')
                .replace(/\{\{displayCount\}\}/g, '0')
                .replace(/\{\{entriesTable\}\}/g, '')
                .replace(/\{\{error\}\}/g, 'Routing service not initialized. Please set GOOGLE_MAPS_API_KEY in .env file.')
                .replace(/\{\{hasError\}\}/g, 'true');
            return res.status(500).send(html);
        }

        // Parse Excel file
        let routes;
        try {
            routes = parseRouteListExcel(req.file.buffer);
        } catch (error) {
            const resultHtml = readFileSync(join(__dirname, 'views', 'result.html'), 'utf8');
            const html = resultHtml
                .replace(/\{\{runId\}\}/g, '')
                .replace(/\{\{totals\}\}/g, '{}')
                .replace(/\{\{meta\}\}/g, '{}')
                .replace(/\{\{totalEntries\}\}/g, '0')
                .replace(/\{\{displayCount\}\}/g, '0')
                .replace(/\{\{entriesTable\}\}/g, '')
                .replace(/\{\{error\}\}/g, `Failed to parse Excel file: ${error.message}`)
                .replace(/\{\{hasError\}\}/g, 'true');
            return res.status(400).send(html);
        }

        // Parse and validate closingKm (required)
        if (!closingKm || closingKm.trim() === '') {
            const resultHtml = readFileSync(join(__dirname, 'views', 'result.html'), 'utf8');
            const html = resultHtml
                .replace(/\{\{runId\}\}/g, '')
                .replace(/\{\{totals\}\}/g, '{}')
                .replace(/\{\{meta\}\}/g, '{}')
                .replace(/\{\{totalEntries\}\}/g, '0')
                .replace(/\{\{displayCount\}\}/g, '0')
                .replace(/\{\{entriesTable\}\}/g, '')
                .replace(/\{\{error\}\}/g, 'Closing KM is required for private mileage calculation')
                .replace(/\{\{hasError\}\}/g, 'true');
            return res.status(400).send(html);
        }

        const closingKmNum = parseFloat(closingKm);
        if (isNaN(closingKmNum) || closingKmNum < 0) {
            const resultHtml = readFileSync(join(__dirname, 'views', 'result.html'), 'utf8');
            const html = resultHtml
                .replace(/\{\{runId\}\}/g, '')
                .replace(/\{\{totals\}\}/g, '{}')
                .replace(/\{\{meta\}\}/g, '{}')
                .replace(/\{\{totalEntries\}\}/g, '0')
                .replace(/\{\{displayCount\}\}/g, '0')
                .replace(/\{\{entriesTable\}\}/g, '')
                .replace(/\{\{error\}\}/g, 'Closing KM must be a valid number')
                .replace(/\{\{hasError\}\}/g, 'true');
            return res.status(400).send(html);
        }

        if (closingKmNum <= openingKmNum) {
            const resultHtml = readFileSync(join(__dirname, 'views', 'result.html'), 'utf8');
            const html = resultHtml
                .replace(/\{\{runId\}\}/g, '')
                .replace(/\{\{totals\}\}/g, '{}')
                .replace(/\{\{meta\}\}/g, '{}')
                .replace(/\{\{totalEntries\}\}/g, '0')
                .replace(/\{\{displayCount\}\}/g, '0')
                .replace(/\{\{entriesTable\}\}/g, '')
                .replace(/\{\{error\}\}/g, 'Closing KM must be greater than Opening KM')
                .replace(/\{\{hasError\}\}/g, 'true');
            return res.status(400).send(html);
        }

        // Parse workSaturdays checkbox (true if checked, false otherwise)
        const workSaturdaysBool = workSaturdays === 'on' || workSaturdays === true;

        // Parse manualEntries if provided
        let manualEntriesArray = [];
        if (manualEntries) {
            try {
                manualEntriesArray = JSON.parse(manualEntries);
                if (!Array.isArray(manualEntriesArray)) {
                    manualEntriesArray = [];
                }
            } catch (e) {
                manualEntriesArray = [];
            }
        }

        // Build engine input
        const engineInput = {
            routes,
            startDate: finalStartDate,
            endDate: finalEndDate,
            homeAddress: homeAddress.trim(),
            openingKm: openingKmNum,
            closingKm: closingKmNum,
            currentWeek: currentWeekNum,
            leaveDays: leaveDaysArray,
            routingService,
            employerName: employerName || null,
            workSaturdays: workSaturdaysBool,
            manualEntries: manualEntriesArray.length > 0 ? manualEntriesArray : null
        };

        // Run engine
        let result;
        try {
            result = await runLogbookEngine(engineInput);
        } catch (error) {
            console.error('Engine error:', error);
            const resultHtml = readFileSync(join(__dirname, 'views', 'result.html'), 'utf8');
            const errorMessage = error.message || 'Unknown error occurred';
            const html = resultHtml
                .replace(/\{\{runId\}\}/g, '')
                .replace(/\{\{totals\}\}/g, '{}')
                .replace(/\{\{meta\}\}/g, '{}')
                .replace(/\{\{totalEntries\}\}/g, '0')
                .replace(/\{\{displayCount\}\}/g, '0')
                .replace(/\{\{entriesTable\}\}/g, '')
                .replace(/\{\{error\}\}/g, `<strong>Error:</strong> ${errorMessage}`)
                .replace(/\{\{hasError\}\}/g, 'true')
                .replace(/\{\{taxpayerName\}\}/g, '')
                .replace(/\{\{vehicleInfo\}\}/g, '')
                .replace(/\{\{taxYearDisplay\}\}/g, '')
                .replace(/\{\{periodDisplay\}\}/g, '');
            return res.status(500).send(html);
        }

        // Extract shop names from purpose field
        // Format: "Sales Visit – Spar" -> shopName = "Spar"
        for (const entry of result.entries) {
            if (entry.purpose && entry.purpose.includes('–')) {
                const parts = entry.purpose.split('–').map(p => p.trim());
                entry.shopName = parts.length > 1 ? parts[1] : '';
                entry.purposeType = parts[0];
            } else {
                entry.shopName = '';
                entry.purposeType = entry.purpose || '';
            }
        }

        // Use totals from engine (engine already handles closingKm calculation)
        const totalBusinessKm = result.totals.totalBusinessKm;
        const totalPrivateKm = result.totals.totalPrivateKm;
        const totalKm = result.totals.totalKm;
        
        // Calculate totalTravel for display (closingKm - openingKm)
        const totalTravel = closingKmNum - openingKmNum;

        // Validate private mileage is non-negative
        if (totalPrivateKm < 0) {
            const resultHtml = readFileSync(join(__dirname, 'views', 'result.html'), 'utf8');
            const html = resultHtml
                .replace(/\{\{runId\}\}/g, '')
                .replace(/\{\{totals\}\}/g, '{}')
                .replace(/\{\{meta\}\}/g, '{}')
                .replace(/\{\{totalEntries\}\}/g, '0')
                .replace(/\{\{displayCount\}\}/g, '0')
                .replace(/\{\{entriesTable\}\}/g, '')
                .replace(/\{\{error\}\}/g, 'Invalid calculation: Total Business KM exceeds total travel distance')
                .replace(/\{\{hasError\}\}/g, 'true');
            return res.status(400).send(html);
        }

        // Round numeric values to 2 decimals
        const roundTo2Decimals = (num) => Math.round(num * 100) / 100;

        // Restructure response object for SARS-ready format
        const structuredResult = {
            taxpayer: {
                firstName: firstName.trim(),
                surname: surname.trim(),
                idNumber: idNumber ? idNumber.trim() : null
            },
            vehicle: {
                make: vehicleMake.trim(),
                model: vehicleModel.trim(),
                registration: vehicleRegistration.trim(),
                year: vehicleYear ? vehicleYear.trim() : null
            },
            period: {
                startDate: finalStartDate,
                endDate: finalEndDate
            },
            taxYear: taxYear,
            odometer: {
                openingKm: roundTo2Decimals(openingKmNum),
                closingKm: roundTo2Decimals(closingKmNum),
                totalTravel: roundTo2Decimals(totalTravel), // closingKm - openingKm
                totalBusinessKm: roundTo2Decimals(totalBusinessKm),
                totalPrivateKm: roundTo2Decimals(totalPrivateKm),
                totalKm: roundTo2Decimals(totalKm), // From engine (may differ from totalTravel if no closingKm)
                method: 'ODOMETER_RECONCILIATION'
            },
            entries: result.entries.map(entry => ({
                ...entry,
                businessKm: roundTo2Decimals(entry.businessKm || 0),
                privateKm: roundTo2Decimals(entry.privateKm || 0),
                openingKm: roundTo2Decimals(entry.openingKm || 0),
                closingKm: roundTo2Decimals(entry.closingKm || 0)
            })),
            meta: {
                startDate: finalStartDate,
                endDate: finalEndDate,
                taxYear: taxYear,
                employerName: result.meta.employerName || employerName || null,
                generatedAt: result.meta.generatedAt,
                closingKm: roundTo2Decimals(closingKmNum),
                warnings: result.meta?.warnings || [],
                taxpayer: {
                    firstName: firstName.trim(),
                    surname: surname.trim(),
                    idNumber: idNumber ? idNumber.trim() : null
                },
                vehicle: {
                    make: vehicleMake.trim(),
                    model: vehicleModel.trim(),
                    registration: vehicleRegistration.trim()
                }
            }
        };

        // Store structured result with runId
        const runId = uuidv4();
        resultsStore.set(runId, structuredResult);

        // TEMP TRACE: Server meta inspection
        console.log("[SERVER] structuredResult.meta:", structuredResult?.meta);
        console.log("[SERVER] structuredResult.meta.warnings:", structuredResult?.meta?.warnings);

        // Render result page (first 50 entries)
        const displayEntries = structuredResult.entries.slice(0, 50);
        const resultHtml = readFileSync(join(__dirname, 'views', 'result.html'), 'utf8');
        
        // Extract warnings from engine result
        const warnings = structuredResult.meta?.warnings || [];
        
        // Prepare totals for display
        const displayTotals = {
            totalBusinessKm: structuredResult.odometer.totalBusinessKm,
            totalPrivateKm: structuredResult.odometer.totalPrivateKm,
            totalKm: structuredResult.odometer.totalTravel
        };
        
        // Prepare taxpayer and vehicle info for display
        const taxpayerName = `${structuredResult.meta.taxpayer.firstName} ${structuredResult.meta.taxpayer.surname}`;
        const vehicleInfo = `${structuredResult.meta.vehicle.make} ${structuredResult.meta.vehicle.model} (${structuredResult.meta.vehicle.registration})`;
        
        // Simple template replacement
        const html = resultHtml
            .replace(/\{\{runId\}\}/g, runId)
            .replace(/\{\{warnings\}\}/g, warnings.length
                ? `<div class="warning-box">⚠ ${warnings.join('<br>')}</div>`
                : '')
            .replace(/\{\{totals\}\}/g, JSON.stringify(displayTotals, null, 2))
            .replace(/\{\{meta\}\}/g, JSON.stringify(structuredResult.meta, null, 2))
            .replace(/\{\{totalEntries\}\}/g, structuredResult.entries.length.toString())
            .replace(/\{\{displayCount\}\}/g, displayEntries.length.toString())
            .replace(/\{\{entriesTable\}\}/g, generateEntriesTable(displayEntries))
            .replace(/\{\{error\}\}/g, '')
            .replace(/\{\{hasError\}\}/g, 'false')
            .replace(/id="taxpayerName"><\/span>/g, `id="taxpayerName">${taxpayerName}</span>`)
            .replace(/id="vehicleInfo"><\/span>/g, `id="vehicleInfo">${vehicleInfo}</span>`);

        // TEMP TRACE: HTML inspection
        console.log("[SERVER] HTML HAS WARNINGS PLACEHOLDER LEFT?:", html.includes("{{warnings}}"));
        console.log("[SERVER] HTML HAS WARNING-BOX CLASS?:", html.includes("warning-box"));
        console.log("[SERVER] HTML CONTAINS ⚠ :", html.includes("⚠"));

        res.send(html);

    } catch (error) {
        console.error('Error in /run:', error);
        const resultHtml = readFileSync(join(__dirname, 'views', 'result.html'), 'utf8');
        const html = resultHtml
            .replace(/\{\{runId\}\}/g, '')
            .replace(/\{\{totals\}\}/g, '{}')
            .replace(/\{\{meta\}\}/g, '{}')
            .replace(/\{\{totalEntries\}\}/g, '0')
            .replace(/\{\{displayCount\}\}/g, '0')
            .replace(/\{\{entriesTable\}\}/g, '')
            .replace(/\{\{error\}\}/g, `Error: ${error.message}`)
            .replace(/\{\{hasError\}\}/g, 'true');
        res.status(500).send(html);
    }
});

/**
 * Generate HTML table for entries
 */
function generateEntriesTable(entries) {
    if (!entries || entries.length === 0) {
        return '<p>No entries to display</p>';
    }

    let html = '<table><thead><tr><th>Date</th><th>From</th><th>To</th><th>Shop Name</th><th>Purpose</th><th>Opening KM</th><th>Closing KM</th><th>Business KM</th><th>Private KM</th></tr></thead><tbody>';
    
    for (const entry of entries) {
        let rowClass = '';
        if (entry.purpose === "Leave Day") {
            rowClass = ' class="leave-row"';
        }
        else if (entry.purpose === "Public Holiday") {
            rowClass = ' class="holiday-row"';
        }
        else if (entry.purpose === "Non-Work Day") {
            rowClass = ' class="nonwork-row"';
        }
        else if (entry.purpose === "Office Day") {
            rowClass = ' class="office-row"';
        }
        else if (entry.purpose === "Drove with Colleague") {
            rowClass = ' class="colleague-row"';
        }
        html += `<tr${rowClass}>
            <td>${entry.date || ''}</td>
            <td>${(entry.from || '').substring(0, 30)}</td>
            <td>${(entry.to || '').substring(0, 30)}</td>
            <td>${entry.shopName || ''}</td>
            <td>${(entry.purpose || '').substring(0, 30)}</td>
            <td>${(entry.openingKm || 0).toFixed(2)}</td>
            <td>${(entry.closingKm || 0).toFixed(2)}</td>
            <td>${(entry.businessKm || 0).toFixed(2)}</td>
            <td>${(entry.privateKm || 0).toFixed(2)}</td>
        </tr>`;
    }
    
    html += '</tbody></table>';
    return html;
}

/**
 * GET /download/:runId.csv
 */
app.get('/download/:runId.csv', (req, res) => {
    const { runId } = req.params;
    const result = resultsStore.get(runId);

    if (!result) {
        return res.status(404).json({ error: 'Result not found' });
    }

    try {
        const csv = exportCsv(result);
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="logbook-${runId}.csv"`);
        res.send(csv);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /download/:runId.xlsx
 */
app.get('/download/:runId.xlsx', (req, res) => {
    const { runId } = req.params;
    const result = resultsStore.get(runId);

    if (!result) {
        return res.status(404).json({ error: 'Result not found' });
    }

    try {
        const buffer = exportXlsx(result);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="logbook-${runId}.xlsx"`);
        res.send(buffer);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /download/:runId.pdf
 */
app.get('/download/:runId.pdf', async (req, res) => {
    const { runId } = req.params;
    const result = resultsStore.get(runId);

    if (!result) {
        return res.status(404).json({ error: 'Result not found' });
    }

    try {
        const buffer = await exportPdf(result);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="logbook-${runId}.pdf"`);
        res.send(buffer);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Start server
app.listen(PORT, () => {
    console.log(`Logbook Engine Lab server running on http://localhost:${PORT}`);
    if (!routingService) {
        console.warn('WARNING: Routing service not initialized. Set GOOGLE_MAPS_API_KEY in .env file.');
    }
});