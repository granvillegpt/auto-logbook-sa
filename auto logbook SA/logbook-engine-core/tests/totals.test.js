// totals.test.js
// Deterministic engine audit for totals integrity

import { runLogbookEngine } from '../src/logbookEngine.js';

function assertEqual(label, actual, expected) {
    if (actual !== expected) {
        console.error(`❌ FAIL: ${label}`);
        console.error(`   Expected: ${expected}`);
        console.error(`   Actual:   ${actual}`);
        process.exit(1);
    } else {
        console.log(`✅ PASS: ${label}`);
    }
}

function assertApprox(label, actual, expected, tolerance = 0.01) {
    if (Math.abs(actual - expected) > tolerance) {
        console.error(`❌ FAIL: ${label}`);
        console.error(`   Expected: ${expected}`);
        console.error(`   Actual:   ${actual}`);
        process.exit(1);
    } else {
        console.log(`✅ PASS: ${label}`);
    }
}

// Minimal mock routing service
const mockRouting = {
    async getDistance(from, to) {
        return { km: 100, minutes: 60, source: 'mock' };
    },
    async getDistances(home, addresses) {
        const distanceMap = new Map();
        for (const address of addresses) {
            distanceMap.set(address, { km: 100, minutes: 60, source: 'mock' });
        }
        return distanceMap;
    }
};

// Minimal mock routes (must match engine's expected structure)
// Using Monday and Tuesday to ensure visits are generated
const mockRoutes = [
    {
        customer: 'Client A',
        address: 'Address 1',
        suburb: 'City',
        days: { mon: true, tue: false, wed: false, thu: false, fri: false, sat: false },
        weeks: [1, 2, 3, 4],
        rowIndex: 1
    },
    {
        customer: 'Client B',
        address: 'Address 2',
        suburb: 'City',
        days: { mon: false, tue: true, wed: false, thu: false, fri: false, sat: false },
        weeks: [1, 2, 3, 4],
        rowIndex: 2
    }
];

// Run all tests sequentially
async function runAllTests() {
    // ---------- TEST 1: BALANCED CASE ----------
    console.log('\n--- TEST 1: Balanced ---');

    const result1 = await runLogbookEngine({
        routes: mockRoutes,
        startDate: '2025-03-03', // Monday
        endDate: '2025-03-04',   // Tuesday
        homeAddress: 'Home',
        openingKm: 50000,
        closingKm: 50400,   // 400 total travel
        currentWeek: 1,
        leaveDays: [],
        routingService: mockRouting
    });

    const { totals: totals1, meta: meta1 } = result1;

    assertApprox("Total Travel", totals1.totalKm, 400);
    assertEqual("Private KM", totals1.totalPrivateKm, 0);
    assertEqual("Business % <= 100", totals1.businessUsePercentage <= 100, true);
    assertEqual("No warnings", meta1.warnings.length, 0);

    // ---------- TEST 2: IMBALANCE CASE ----------
    console.log('\n--- TEST 2: Imbalance ---');

    const result2 = await runLogbookEngine({
        routes: mockRoutes,
        startDate: '2025-03-03', // Monday
        endDate: '2025-03-07',  // Friday (more visits)
        homeAddress: 'Home',
        openingKm: 50000,
        closingKm: 50100,   // Too small
        currentWeek: 1,
        leaveDays: [],
        routingService: mockRouting
    });

    const { totals: totals2, meta: meta2 } = result2;

    assertEqual("Private KM clamped to 0", totals2.totalPrivateKm, 0);
    assertEqual("Warning exists", meta2.warnings.length > 0, true);
    assertEqual("Business % capped", totals2.businessUsePercentage <= 100, true);

    // ---------- TEST 3: NO CLOSING KM ----------
    console.log('\n--- TEST 3: No Closing KM ---');

    const result3 = await runLogbookEngine({
        routes: mockRoutes,
        startDate: '2025-03-03', // Monday
        endDate: '2025-03-04',  // Tuesday
        homeAddress: 'Home',
        openingKm: 50000,
        closingKm: null,
        currentWeek: 1,
        leaveDays: [],
        routingService: mockRouting
    });

    const { totals: totals3 } = result3;

    assertEqual("Private KM = 0", totals3.totalPrivateKm, 0);
    assertEqual("Travel = Business", totals3.totalKm, totals3.totalBusinessKm);
    assertEqual("Business % = 100", totals3.businessUsePercentage, 100);

    // ---------- TEST 4: NEGATIVE ODOMETER ----------
    console.log('\n--- TEST 4: Negative Odometer ---');

    const result4 = await runLogbookEngine({
        routes: mockRoutes,
        startDate: '2025-03-03', // Monday
        endDate: '2025-03-04',   // Tuesday
        homeAddress: 'Home',
        openingKm: 60000,
        closingKm: 50000,   // Invalid
        currentWeek: 1,
        leaveDays: [],
        routingService: mockRouting
    });

    const { meta: meta4 } = result4;

    assertEqual("Warning for negative odometer", meta4.warnings.length > 0, true);

    console.log('\n🎯 All engine tests completed.\n');
}

runAllTests().catch(error => {
    console.error('Test suite failed:', error);
    process.exit(1);
});
