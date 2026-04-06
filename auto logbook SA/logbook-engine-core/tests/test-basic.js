/**
 * Basic test for pure logbook engine
 * 
 * Run with: node logbook-engine-core/tests/test-basic.js
 */

const { runLogbookEngine } = require('../src/logbookEngine');

// Mock routes
const mockRoutes = [
    {
        customer: 'ABC Corp',
        address: '123 Main Street',
        suburb: 'Cape Town',
        days: {
            mon: true,
            tue: false,
            wed: true,
            thu: false,
            fri: true,
            sat: false
        },
        weeks: [1, 2, 3, 4],
        rowIndex: 1
    },
    {
        customer: 'XYZ Ltd',
        address: '456 Business Road',
        suburb: 'Johannesburg',
        days: {
            mon: false,
            tue: true,
            wed: false,
            thu: true,
            fri: false,
            sat: false
        },
        weeks: [1, 2, 3, 4],
        rowIndex: 2
    }
];

// Fake routing service
const fakeRoutingService = {
    /**
     * Get distance between two addresses
     * @param {string} from - From address
     * @param {string} to - To address
     * @returns {Promise<number>} Distance in km
     */
    getDistance: async (from, to) => {
        // Simple mock: return 10 km for any trip
        return Promise.resolve(10);
    },

    /**
     * Get distances from home to multiple addresses
     * @param {string} home - Home address
     * @param {string[]} addresses - Array of destination addresses
     * @returns {Promise<Map<string, number>>} Map of address -> distance in km
     */
    getDistances: async (home, addresses) => {
        const distanceMap = new Map();
        for (const address of addresses) {
            // Simple mock: return 10 km for any trip
            distanceMap.set(address, 10);
        }
        return Promise.resolve(distanceMap);
    }
};

// Test input
const testInput = {
    routes: mockRoutes,
    startDate: '2024-03-01',
    endDate: '2024-03-07', // One week for quick test
    homeAddress: '789 Home Avenue, Cape Town',
    openingKm: 50000,
    currentWeek: 1,
    leaveDays: [],
    routingService: fakeRoutingService
};

// Run the engine
async function runTest() {
    try {
        console.log('Running logbook engine test...');
        console.log('Input:', JSON.stringify(testInput, null, 2));
        console.log('');

        const result = await runLogbookEngine(testInput);

        console.log('Result:');
        console.log(JSON.stringify(result, null, 2));
        console.log('');
        console.log(`Total entries: ${result.entries.length}`);
        console.log(`Total business KM: ${result.totals.totalBusinessKm}`);
        console.log(`Total private KM: ${result.totals.totalPrivateKm}`);
        console.log(`Total KM: ${result.totals.totalKm}`);
        console.log('');
        console.log('Test completed successfully!');
    } catch (error) {
        console.error('Test failed:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
}

runTest();


