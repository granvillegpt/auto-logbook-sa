import * as XLSX from 'xlsx';
import fs from 'fs';

const path = '/Users/granville/Desktop/auto log Route List Template GP.xlsx';
const buf = fs.readFileSync(path);
const workbook = XLSX.read(buf, { type: 'buffer' });
const jsonData = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1, defval: null });

console.log('First 4 rows:', JSON.stringify(jsonData.slice(0, 4), null, 2));

function findColumnIndex(headerRow, columnName) {
    const normalizedName = columnName.toLowerCase().trim();
    for (let i = 0; i < headerRow.length; i++) {
        const cell = headerRow[i];
        const cellStr = cell ? String(cell).toLowerCase().trim() : '';
        if (cellStr === normalizedName) return i;
    }
    return null;
}

let headerRowIndex = 0, bestMatchCount = 0;
for (let rowIdx = 0; rowIdx < Math.min(10, jsonData.length); rowIdx++) {
    const row = jsonData[rowIdx];
    if (!row || row.length === 0) continue;
    const rowLower = row.map(cell => cell ? String(cell).toLowerCase().trim().replace(/\s+/g, ' ') : '');
    let matchCount = 0;
    if (rowLower.includes('address') || rowLower.includes('street address')) matchCount++;
    if (rowLower.includes('customer') || rowLower.includes('client')) matchCount++;
    if (rowLower.includes('mon') || rowLower.includes('monday')) matchCount++;
    if (rowLower.includes('tue') || rowLower.includes('tuesday')) matchCount++;
    if (rowLower.includes('wed') || rowLower.includes('wednesday')) matchCount++;
    if (rowLower.includes('thu') || rowLower.includes('thursday')) matchCount++;
    if (rowLower.includes('fri') || rowLower.includes('friday')) matchCount++;
    if (matchCount > bestMatchCount) { bestMatchCount = matchCount; headerRowIndex = rowIdx; }
}

const headerRow = jsonData[headerRowIndex];
console.log('Header row index', headerRowIndex, 'bestMatchCount', bestMatchCount);
console.log('headerRow', headerRow);
console.log('customerCol', findColumnIndex(headerRow, 'customer'));
console.log('streetAddressCol', findColumnIndex(headerRow, 'street address'));

const hasAddressColumns = [findColumnIndex(headerRow, 'street address') || findColumnIndex(headerRow, 'address'), findColumnIndex(headerRow, 'suburb'), findColumnIndex(headerRow, 'city'), findColumnIndex(headerRow, 'province')].every(x => x !== null);
const customerCol = findColumnIndex(headerRow, 'customer') || findColumnIndex(headerRow, 'client');
const customerOnlyMode = !hasAddressColumns && customerCol !== null;
console.log('hasAddressColumns', hasAddressColumns, 'customerCol', customerCol, 'customerOnlyMode', customerOnlyMode);
