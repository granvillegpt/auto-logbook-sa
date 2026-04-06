/**
 * Logbook Engine Playground
 * 
 * Standalone test harness for the pure logbook engine.
 * No Firebase, no lifecycle logic, no versioning.
 */

import { runLogbookEngine } from '../src/logbookEngine.js';
import { parseExcelRouteList } from './excelParser.js';
import { mockRoutingService } from './mockRouting.js';

// Get form elements
const form = document.getElementById('logbookForm');
const excelFileInput = document.getElementById('excelFile');
const homeAddressInput = document.getElementById('homeAddress');
const openingKmInput = document.getElementById('openingKm');
const startDateInput = document.getElementById('startDate');
const endDateInput = document.getElementById('endDate');
const currentWeekInput = document.getElementById('currentWeek');
const runButton = document.getElementById('runButton');
const errorDiv = document.getElementById('error');
const totalsDiv = document.getElementById('totals');
const totalsOutput = document.getElementById('totalsOutput');
const entriesContainer = document.getElementById('entriesContainer');
const entriesTable = document.getElementById('entriesTable');
const entriesBody = document.getElementById('entriesBody');

// Set default dates (current tax year)
const today = new Date();
const currentYear = today.getFullYear();
const taxYearStart = new Date(currentYear, 2, 1); // March 1
const taxYearEnd = new Date(currentYear + 1, 1, 28); // February 28

if (today < taxYearStart) {
    // If before March 1, use previous tax year
    startDateInput.value = new Date(currentYear - 1, 2, 1).toISOString().split('T')[0];
    endDateInput.value = new Date(currentYear, 1, 28).toISOString().split('T')[0];
} else {
    startDateInput.value = taxYearStart.toISOString().split('T')[0];
    endDateInput.value = taxYearEnd.toISOString().split('T')[0];
}

// Handle form submission
form.addEventListener('submit', async (e) => {
    e.preventDefault();

    // Hide previous results
    errorDiv.style.display = 'none';
    totalsDiv.style.display = 'none';
    entriesContainer.style.display = 'none';
    runButton.disabled = true;
    runButton.textContent = 'Running...';

    try {
        // Get form values
        const excelFile = excelFileInput.files[0];
        if (!excelFile) {
            throw new Error('Please select an Excel file');
        }

        const homeAddress = homeAddressInput.value.trim();
        if (!homeAddress) {
            throw new Error('Home address is required');
        }

        const openingKm = parseFloat(openingKmInput.value);
        if (isNaN(openingKm) || openingKm < 0) {
            throw new Error('Opening KM must be a non-negative number');
        }

        const startDate = startDateInput.value;
        if (!startDate) {
            throw new Error('Start date is required');
        }

        const endDate = endDateInput.value;
        if (!endDate) {
            throw new Error('End date is required');
        }

        const currentWeek = parseInt(currentWeekInput.value, 10);
        if (isNaN(currentWeek) || currentWeek < 1 || currentWeek > 4) {
            throw new Error('Current week must be 1, 2, 3, or 4');
        }

        // Parse Excel file
        const routes = await parseExcelRouteList(excelFile);

        // Build engine input
        const engineInput = {
            routes: routes,
            startDate: startDate,
            endDate: endDate,
            homeAddress: homeAddress,
            openingKm: openingKm,
            currentWeek: currentWeek,
            leaveDays: [], // Optional, empty for now
            routingService: mockRoutingService
        };

        // Run engine
        const result = await runLogbookEngine(engineInput);

        // Display totals
        totalsOutput.textContent = JSON.stringify(result.totals, null, 2);
        totalsDiv.style.display = 'block';

        // Display entries in table
        entriesBody.innerHTML = '';
        result.entries.forEach(entry => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${entry.date}</td>
                <td>${entry.from}</td>
                <td>${entry.to}</td>
                <td>${entry.openingKm}</td>
                <td>${entry.closingKm}</td>
                <td>${entry.businessKm}</td>
            `;
            entriesBody.appendChild(row);
        });
        entriesContainer.style.display = 'block';

    } catch (error) {
        errorDiv.textContent = `Error: ${error.message}`;
        errorDiv.style.display = 'block';
        console.error('Error:', error);
    } finally {
        runButton.disabled = false;
        runButton.textContent = 'Run Logbook Engine';
    }
});


