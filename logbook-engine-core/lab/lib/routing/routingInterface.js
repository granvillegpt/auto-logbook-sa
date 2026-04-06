/**
 * Routing Service Interface
 * 
 * All routing providers must implement:
 * - getDistance(origin, destination) -> Promise<{ km: number, minutes: number, source: string }>
 * - getDistances(origin, destinations[]) -> Promise<Map<string, { km: number, minutes: number, source: string }>>
 */

export class RoutingInterface {
    /**
     * Get distance between two addresses
     * @param {string} origin - Origin address
     * @param {string} destination - Destination address
     * @returns {Promise<{ km: number, minutes: number, source: string }>}
     */
    async getDistance(origin, destination) {
        throw new Error('getDistance must be implemented');
    }

    /**
     * Get distances from origin to multiple destinations
     * @param {string} origin - Origin address
     * @param {string[]} destinations - Array of destination addresses
     * @returns {Promise<Map<string, { km: number, minutes: number, source: string }>>}
     *   Map key is the destination address, value is the distance result
     */
    async getDistances(origin, destinations) {
        throw new Error('getDistances must be implemented');
    }
}


