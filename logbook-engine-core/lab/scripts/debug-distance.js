/**
 * Debug script to test routing distance for specific route
 * 
 * Usage:
 *   DEBUG_ROUTING=1 ROUTING_CACHE_BYPASS=1 node scripts/debug-distance.js
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Load environment variables
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const labDir = join(__dirname, '..');
dotenv.config({ path: join(labDir, '.env') });

import { GoogleRouting } from '../lib/routing/googleRouting.js';
import { CachedRouting } from '../lib/routing/cachedRouting.js';

const origin = "Unit 3, Station Square, Claremont";
const destination = "Montague Gardens, Montague Dr, Milnerton";

async function testDistance() {
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey || apiKey === 'your_api_key_here') {
        console.error('ERROR: GOOGLE_MAPS_API_KEY not set in .env');
        process.exit(1);
    }

    console.log('Testing route distance:');
    console.log(`  Origin: ${origin}`);
    console.log(`  Destination: ${destination}`);
    console.log('');

    try {
        const googleRouting = new GoogleRouting(apiKey);
        const routingService = new CachedRouting(googleRouting);
        
        const result = await routingService.getDistance(origin, destination);
        
        console.log('Result:');
        console.log(`  km: ${result.km}`);
        console.log(`  minutes: ${result.minutes}`);
        console.log(`  source: ${result.source}`);
        console.log('');
        
        // Assert: km must be < 200 for Cape Town metro
        if (result.km >= 200) {
            console.error(`FAIL: Distance ${result.km}km exceeds 200km threshold`);
            process.exit(1);
        }
        
        if (result.km <= 0) {
            console.error(`FAIL: Distance ${result.km}km is invalid`);
            process.exit(1);
        }
        
        console.log(`✅ PASS: Distance ${result.km}km is within expected range (< 200km)`);
        process.exit(0);
    } catch (error) {
        console.error('ERROR:', error.message);
        process.exit(1);
    }
}

testDistance();


