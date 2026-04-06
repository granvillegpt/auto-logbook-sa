/**
 * Cached Routing Wrapper
 * 
 * Wraps a routing provider with file-based caching.
 * Cache is stored in .cache/distances.json
 */

import { promises as fs } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CACHE_FILE = join(__dirname, '../../.cache/distances.json');

// Simple in-memory mutex for concurrency safety
let cacheLock = Promise.resolve();

export class CachedRouting {
    constructor(routingProvider, cacheFilePath = CACHE_FILE) {
        this.provider = routingProvider;
        this.cacheFilePath = cacheFilePath;
        this.cache = new Map();
        this._loadCache();
    }

    /**
     * Load cache from file
     */
    async _loadCache() {
        try {
            const data = await fs.readFile(this.cacheFilePath, 'utf8');
            const cacheData = JSON.parse(data);
            this.cache = new Map(Object.entries(cacheData));
        } catch (error) {
            // Cache file doesn't exist or is invalid - start with empty cache
            this.cache = new Map();
        }
    }

    /**
     * Save cache to file
     */
    async _saveCache() {
        // Ensure cache directory exists
        const cacheDir = dirname(this.cacheFilePath);
        await fs.mkdir(cacheDir, { recursive: true });

        // Convert Map to object for JSON serialization
        const cacheObject = Object.fromEntries(this.cache);
        await fs.writeFile(this.cacheFilePath, JSON.stringify(cacheObject, null, 2), 'utf8');
    }

    /**
     * Generate cache key from addresses
     */
    _cacheKey(originAddress, destinationAddress) {
        return `${originAddress}|${destinationAddress}`;
    }

    /**
     * Get distance with caching (address-based)
     */
    async getDistance(originAddress, destinationAddress) {
        const ROUTING_CACHE_BYPASS = process.env.ROUTING_CACHE_BYPASS === '1';
        const key = this._cacheKey(originAddress, destinationAddress);
        
        // Check cache (unless bypassed)
        if (!ROUTING_CACHE_BYPASS && this.cache.has(key)) {
            const cached = this.cache.get(key);
            return {
                km: cached.km,
                minutes: cached.minutes,
                source: `cached:${cached.source}`
            };
        }

        // Acquire lock
        await (cacheLock = cacheLock.then(async () => {
            // Double-check cache after acquiring lock (unless bypassed)
            if (!ROUTING_CACHE_BYPASS && this.cache.has(key)) {
                const cached = this.cache.get(key);
                return {
                    km: cached.km,
                    minutes: cached.minutes,
                    source: `cached:${cached.source}`
                };
            }

            // Fetch from provider
            const result = await this.provider.getDistance(originAddress, destinationAddress);
            
            // Store in cache (unless bypassed)
            if (!ROUTING_CACHE_BYPASS) {
                this.cache.set(key, {
                    km: result.km,
                    minutes: result.minutes,
                    source: result.source
                });
                
                // Save cache to file
                await this._saveCache();
            }
            
            return result;
        }));

        // Return cached result
        const cached = this.cache.get(key);
        return {
            km: cached.km,
            minutes: cached.minutes,
            source: `cached:${cached.source}`
        };
    }

    /**
     * Get distances with caching (address-based)
     */
    async getDistances(originAddress, destinationAddresses) {
        const results = new Map();
        const uncachedDestinations = [];
        
        const ROUTING_CACHE_BYPASS = process.env.ROUTING_CACHE_BYPASS === '1';
        
        // Check cache for each destination (unless bypassed)
        for (const destAddress of destinationAddresses) {
            const key = this._cacheKey(originAddress, destAddress);
            
            if (!ROUTING_CACHE_BYPASS && this.cache.has(key)) {
                const cached = this.cache.get(key);
                results.set(destAddress, {
                    km: cached.km,
                    minutes: cached.minutes,
                    source: `cached:${cached.source}`
                });
            } else {
                uncachedDestinations.push(destAddress);
            }
        }

        // Fetch uncached destinations
        if (uncachedDestinations.length > 0) {
            // Acquire lock
            await (cacheLock = cacheLock.then(async () => {
                // Fetch from provider
                const providerResults = await this.provider.getDistances(originAddress, uncachedDestinations);
                
                // Store in cache and results (unless bypassed)
                for (const [destAddress, result] of providerResults.entries()) {
                    const key = this._cacheKey(originAddress, destAddress);
                    if (!ROUTING_CACHE_BYPASS) {
                        this.cache.set(key, {
                            km: result.km,
                            minutes: result.minutes,
                            source: result.source
                        });
                    }
                    results.set(destAddress, result);
                }
                
                // Save cache to file (unless bypassed)
                if (!ROUTING_CACHE_BYPASS) {
                    await this._saveCache();
                }
            }));

            // Get results that were just cached
            for (const destAddress of uncachedDestinations) {
                if (!results.has(destAddress)) {
                    const key = this._cacheKey(originAddress, destAddress);
                    const cached = this.cache.get(key);
                    if (cached) {
                        results.set(destAddress, {
                            km: cached.km,
                            minutes: cached.minutes,
                            source: `cached:${cached.source}`
                        });
                    }
                }
            }
        }

        return results;
    }

    /**
     * Clear cache (for testing/debugging)
     */
    async clearCache() {
        this.cache.clear();
        try {
            await fs.unlink(this.cacheFilePath);
        } catch (error) {
            // File doesn't exist - that's fine
        }
    }
}
