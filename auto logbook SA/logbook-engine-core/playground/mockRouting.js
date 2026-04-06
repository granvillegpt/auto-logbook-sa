/**
 * Mock Routing Service
 * 
 * Provides fixed 10km distances for all routes.
 * No external API calls.
 */

export const mockRoutingService = {
    /**
     * Get distance between two addresses
     * @param {string} from - From address
     * @param {string} to - To address
     * @returns {Promise<number>} Distance in km (fixed 10km)
     */
    async getDistance(from, to) {
        return 10; // Fixed 10km for testing
    },

    /**
     * Get distances from home to multiple addresses
     * @param {string} home - Home address
     * @param {string[]} addresses - Array of destination addresses
     * @returns {Promise<Map<string, number>>} Map of address -> distance in km
     */
    async getDistances(home, addresses) {
        const map = new Map();
        addresses.forEach(addr => {
            map.set(addr, 10); // Fixed 10km for testing
        });
        return map;
    }
};


