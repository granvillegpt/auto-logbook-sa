/**
 * CLEARTRACK LOGBOOK ENGINE
 * Audit-Stable Version
 *
 * Totals are calculated in a single authoritative block.
 * Imbalances are non-blocking and flagged via meta.warnings.
 * No rounding inside engine. Formatting handled in export layer.
 *
 * Do not modify totals logic without reconciliation review.
 * 
 * @module logbook-engine-core
 */

const SA_PUBLIC_HOLIDAYS_2026 = {
  "2026-01-01": "New Year's Day",
  "2026-03-21": "Human Rights Day",
  "2026-04-03": "Good Friday",
  "2026-04-06": "Family Day",
  "2026-04-27": "Freedom Day",
  "2026-05-01": "Workers' Day",
  "2026-06-16": "Youth Day",
  "2026-08-09": "National Women's Day",
  "2026-09-24": "Heritage Day",
  "2026-12-16": "Day of Reconciliation",
  "2026-12-25": "Christmas Day",
  "2026-12-26": "Day of Goodwill"
};

function applySundayShift(holidayMap) {
  const shifted = { ...holidayMap };

  Object.keys(holidayMap).forEach(dateStr => {
    const dateObj = new Date(dateStr);
    if (dateObj.getDay() === 0) {
      const monday = new Date(dateObj);
      monday.setDate(monday.getDate() + 1);
      const mondayStr = monday.toISOString().split("T")[0];
      shifted[mondayStr] = holidayMap[dateStr] + " (Observed)";
    }
  });

  return shifted;
}

const HOLIDAYS = applySundayShift(SA_PUBLIC_HOLIDAYS_2026);

/**
 * Builds a clean address string with deduplicated parts
 * Splits all parts by comma first, then deduplicates at component level
 */
function buildCleanAddress(parts) {
    const seen = new Set();
    const result = [];

    // Split all parts by comma, trim, and flatten
    const components = parts
        .filter(Boolean)
        .flatMap(p => p.split(','))
        .map(p => p.trim())
        .filter(p => p.length > 0);

    // Deduplicate case-insensitively while preserving original casing
    for (const component of components) {
        const key = component.toLowerCase();
        if (!seen.has(key)) {
            seen.add(key);
            result.push(component);
        }
    }

    return result.join(", ");
}

/**
 * Gets weekday number (0=Sunday, 1=Monday, ..., 6=Saturday)
 */
function getWeekday(date) {
    return date.getDay();
}

/**
 * Calculates the current week cycle (1-4) based on a rolling 4-week cycle
 */
function getCurrentWeekCycle(startDate, currentDate, initialWeek) {
    const daysElapsed = Math.floor((currentDate - startDate) / (1000 * 60 * 60 * 24));
    const weekPeriod = Math.floor(daysElapsed / 7);
    const weekCycle = ((initialWeek - 1 + weekPeriod) % 4) + 1;
    return weekCycle;
}

/**
 * Converts weekday number to day key
 */
function weekdayToDayKey(weekday) {
    const mapping = {
        1: 'mon',
        2: 'tue',
        3: 'wed',
        4: 'thu',
        5: 'fri',
        6: 'sat'
    };
    return mapping[weekday] || null;
}

/**
 * Formats date as ISO string (YYYY-MM-DD)
 */
function formatISODate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

/**
 * Checks if a date is in the leave days array
 */
function isLeaveDay(date, leaveDays) {
    if (!leaveDays || leaveDays.length === 0) {
        return false;
    }
    const dateStr = formatISODate(date);
    return leaveDays.includes(dateStr);
}

/**
 * Expands routes into actual calendar visit dates using a deterministic 4-week rolling cycle
 */
function expandRoutes(routes, startDate, endDate, currentWeek, leaveDays) {
    if (!routes || routes.length === 0) {
        throw new Error('No routes provided');
    }

    if (currentWeek === undefined || currentWeek === null) {
        throw new Error('currentWeek is required and must be 1, 2, 3, or 4');
    }

    const weekNum = Number(currentWeek);
    if (!Number.isInteger(weekNum) || weekNum < 1 || weekNum > 4) {
        throw new Error(`currentWeek must be 1, 2, 3, or 4. Received: ${currentWeek}`);
    }

    const leaveDaysArray = leaveDays || [];

    const start = new Date(startDate);
    const end = new Date(endDate);

    if (isNaN(start.getTime())) {
        throw new Error(`Invalid start date: ${startDate}`);
    }
    if (isNaN(end.getTime())) {
        throw new Error(`Invalid end date: ${endDate}`);
    }

    if (start > end) {
        throw new Error('Start date must be before end date');
    }

    const visits = [];
    const currentDate = new Date(start);

    while (currentDate <= end) {
        const weekCycle = getCurrentWeekCycle(start, currentDate, weekNum);
        const weekday = getWeekday(currentDate);
        const dayKey = weekdayToDayKey(weekday);
        const dateStr = formatISODate(currentDate);

        if (isLeaveDay(currentDate, leaveDaysArray)) {
            currentDate.setDate(currentDate.getDate() + 1);
            continue;
        }

        for (const route of routes) {
            if (!dayKey || !route.days[dayKey]) {
                continue;
            }

            if (!route.weeks.includes(weekCycle)) {
                continue;
            }
            
            visits.push({
                date: dateStr,
                customer: route.customer,
                address: route.address,
                suburb: route.suburb,
                rowIndex: route.rowIndex || 999999
            });
        }

        currentDate.setDate(currentDate.getDate() + 1);
    }

    visits.sort((a, b) => {
        if (a.date < b.date) return -1;
        if (a.date > b.date) return 1;
        return 0;
    });

    const uniqueVisits = [];
    const seen = new Set();
    for (const visit of visits) {
        const key = `${visit.date}_${visit.customer}`;
        if (!seen.has(key)) {
            seen.add(key);
            uniqueVisits.push(visit);
        }
    }

    if (uniqueVisits.length === 0) {
        throw new Error('No visits generated for provided routes and date range.');
    }

    return uniqueVisits;
}

/**
 * Generates SARS-compliant logbook entries from visits and distances
 */
function generateLogbookEntries(visits, distanceMap, vehicleOpeningKm, homeAddress, startDate, endDate, routes, manualEntries, workSaturdays, leaveDays) {
    if (!Array.isArray(visits)) {
        throw new Error('Visits array is required');
    }

    if (!distanceMap) {
        throw new Error('Distance map is required');
    }

    if (typeof vehicleOpeningKm !== 'number' || vehicleOpeningKm < 0 || isNaN(vehicleOpeningKm)) {
        throw new Error(`Invalid vehicle opening KM: ${vehicleOpeningKm}. Must be a non-negative number.`);
    }

    if (!homeAddress || typeof homeAddress !== 'string') {
        throw new Error('Home address is required and must be a string');
    }

    const distances = distanceMap instanceof Map 
        ? distanceMap 
        : new Map(Object.entries(distanceMap));

    // Derive workDays from routes
    const workDays = [];
    if (routes && Array.isArray(routes)) {
        const dayMap = { mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 0 };
        const enabledDays = new Set();
        routes.forEach(route => {
            if (route.days) {
                Object.keys(route.days).forEach(dayKey => {
                    if (route.days[dayKey]) {
                        enabledDays.add(dayMap[dayKey]);
                    }
                });
            }
        });
        workDays.push(...Array.from(enabledDays));
    } else {
        // Default to Monday-Friday if no routes provided
        workDays.push(1, 2, 3, 4, 5);
    }

    // Add Saturday (day 6) if workSaturdays is enabled
    if (workSaturdays && !workDays.includes(6)) {
        workDays.push(6);
    }

    const sortedVisits = [...visits].sort((a, b) => {
        if (a.date < b.date) return -1;
        if (a.date > b.date) return 1;
        const aIndex = a.rowIndex || 999999;
        const bIndex = b.rowIndex || 999999;
        return aIndex - bIndex;
    });

    const visitsByDate = new Map();
    for (const visit of sortedVisits) {
        if (!visitsByDate.has(visit.date)) {
            visitsByDate.set(visit.date, []);
        }
        visitsByDate.get(visit.date).push(visit);
    }

    const generatedDays = [];
    let currentOdometer = vehicleOpeningKm;

    // Generate entries for all dates in range
    if (startDate && endDate) {
        const start = new Date(startDate);
        const end = new Date(endDate);
        const currentDate = new Date(start);

        while (currentDate <= end) {
            const dateStr = formatISODate(currentDate);
            const dayOfWeek = currentDate.getDay();

            const isLeave = leaveDays && leaveDays.includes(dateStr);
            const isHoliday = Boolean(HOLIDAYS[dateStr]);
            const isWorkDay = workDays.includes(dayOfWeek);

            if (isLeave) {
                generatedDays.push({
                    date: dateStr,
                    day: currentDate.toLocaleDateString('en-ZA', { weekday: 'short' }),
                    openingKm: currentOdometer,
                    closingKm: currentOdometer,
                    businessKm: 0,
                    privateKm: 0,
                    purpose: "Leave Day",
                    from: homeAddress,
                    to: homeAddress
                });
            } else if (isHoliday) {
                generatedDays.push({
                    date: dateStr,
                    day: currentDate.toLocaleDateString('en-ZA', { weekday: 'short' }),
                    openingKm: currentOdometer,
                    closingKm: currentOdometer,
                    businessKm: 0,
                    privateKm: 0,
                    purpose: "Public Holiday",
                    from: homeAddress,
                    to: homeAddress
                });
            } else if (!isWorkDay) {
                generatedDays.push({
                    date: dateStr,
                    day: currentDate.toLocaleDateString('en-ZA', { weekday: 'short' }),
                    openingKm: currentOdometer,
                    closingKm: currentOdometer,
                    businessKm: 0,
                    privateKm: 0,
                    purpose: "Non-Work Day",
                    from: homeAddress,
                    to: homeAddress
                });
            } else if (visitsByDate.has(dateStr)) {
                // Generate trips for work days with visits
                const dayVisits = visitsByDate.get(dateStr);
                dayVisits.sort((a, b) => {
                    const aIndex = a.rowIndex || 999999;
                    const bIndex = b.rowIndex || 999999;
                    return aIndex - bIndex;
                });

                if (dayVisits.length > 0) {
                    const day = currentDate.toLocaleDateString('en-ZA', { weekday: 'short' });

                    // Trip 1: Home → First Visit
                    const firstVisit = dayVisits[0];
                    const firstVisitAddress = buildCleanAddress([firstVisit.address]);
                    
                    const homeToFirstKey = `HOME→${firstVisit.address}`;
                    const homeToFirstDistance = distances.get(homeToFirstKey);
                    
                    if (homeToFirstDistance === undefined || homeToFirstDistance === null) {
                        throw new Error(`Missing distance for trip: ${homeToFirstKey}`);
                    }

                    if (typeof homeToFirstDistance !== 'number' || homeToFirstDistance < 0 || isNaN(homeToFirstDistance)) {
                        throw new Error(`Invalid distance for trip "${homeToFirstKey}": ${homeToFirstDistance}`);
                    }

                    const firstTripOpeningKm = currentOdometer;
                    const segmentKm = homeToFirstDistance;
                    
                    if (!Number.isFinite(segmentKm) || segmentKm > 1000) {
                        throw new Error(`ENGINE_SEGMENT_KM_INVALID: segmentKm ${segmentKm} is not finite or exceeds 1000km. Date: ${dateStr}, From: ${homeAddress}, To: ${firstVisitAddress}`);
                    }
                    
                    const firstTripClosingKm = firstTripOpeningKm + segmentKm;
                    
                    if (firstTripClosingKm < firstTripOpeningKm) {
                        throw new Error(`ENGINE_ODOMETER_DECREASED: closingKm ${firstTripClosingKm} < openingKm ${firstTripOpeningKm}. Date: ${dateStr}, From: ${homeAddress}, To: ${firstVisitAddress}`);
                    }
                    
                    const firstPurpose = `${firstVisit.reason || 'Sales Visit'} – ${firstVisit.customer || ''}`;
                    
                    generatedDays.push({
                        date: dateStr,
                        day,
                        openingKm: firstTripOpeningKm,
                        closingKm: firstTripClosingKm,
                        businessKm: segmentKm,
                        privateKm: 0,
                        purpose: firstPurpose,
                        from: homeAddress,
                        to: firstVisitAddress
                    });

                    currentOdometer = firstTripClosingKm;

                    // Trips 2 to N: Visit(i) → Visit(i+1)
                    for (let i = 0; i < dayVisits.length - 1; i++) {
                        const fromVisit = dayVisits[i];
                        const toVisit = dayVisits[i + 1];
                        
                        const fromAddress = buildCleanAddress([fromVisit.address]);
                        const toAddress = buildCleanAddress([toVisit.address]);
                        
                        const tripKey = `${fromVisit.address}→${toVisit.address}`;
                        const tripDistance = distances.get(tripKey);
                        
                        if (tripDistance === undefined || tripDistance === null) {
                            throw new Error(`Missing distance for trip: ${tripKey}`);
                        }

                        if (typeof tripDistance !== 'number' || tripDistance < 0 || isNaN(tripDistance)) {
                            throw new Error(`Invalid distance for trip "${tripKey}": ${tripDistance}`);
                        }

                        const tripOpeningKm = currentOdometer;
                        const tripSegmentKm = tripDistance;
                        
                        if (!Number.isFinite(tripSegmentKm) || tripSegmentKm > 1000) {
                            throw new Error(`ENGINE_SEGMENT_KM_INVALID: segmentKm ${tripSegmentKm} is not finite or exceeds 1000km. Date: ${dateStr}, From: ${fromAddress}, To: ${toAddress}`);
                        }
                        
                        const tripClosingKm = tripOpeningKm + tripSegmentKm;
                        
                        if (tripClosingKm < tripOpeningKm) {
                            throw new Error(`ENGINE_ODOMETER_DECREASED: closingKm ${tripClosingKm} < openingKm ${tripOpeningKm}. Date: ${dateStr}, From: ${fromAddress}, To: ${toAddress}`);
                        }
                        
                        const visitPurpose = `${toVisit.reason || 'Sales Visit'} – ${toVisit.customer || ''}`;
                        
                        generatedDays.push({
                            date: dateStr,
                            day,
                            openingKm: tripOpeningKm,
                            closingKm: tripClosingKm,
                            businessKm: tripSegmentKm,
                            privateKm: 0,
                            purpose: visitPurpose,
                            from: fromAddress,
                            to: toAddress
                        });

                        currentOdometer = tripClosingKm;
                    }

                    // Final trip: Last Visit → Home
                    const lastVisit = dayVisits[dayVisits.length - 1];
                    const lastVisitAddress = buildCleanAddress([lastVisit.address]);
                    
                    const lastToHomeKey = `${lastVisit.address}→HOME`;
                    const lastToHomeDistance = distances.get(lastToHomeKey);
                    
                    if (lastToHomeDistance === undefined || lastToHomeDistance === null) {
                        throw new Error(`Missing distance for return trip: ${lastToHomeKey}`);
                    }

                    if (typeof lastToHomeDistance !== 'number' || lastToHomeDistance < 0 || isNaN(lastToHomeDistance)) {
                        throw new Error(`Invalid distance for return trip "${lastToHomeKey}": ${lastToHomeDistance}`);
                    }

                    const returnTripOpeningKm = currentOdometer;
                    const returnSegmentKm = lastToHomeDistance;
                    
                    if (!Number.isFinite(returnSegmentKm) || returnSegmentKm > 1000) {
                        throw new Error(`ENGINE_SEGMENT_KM_INVALID: segmentKm ${returnSegmentKm} is not finite or exceeds 1000km. Date: ${dateStr}, From: ${lastVisitAddress}, To: ${homeAddress}`);
                    }
                    
                    const returnTripClosingKm = returnTripOpeningKm + returnSegmentKm;
                    
                    if (returnTripClosingKm < returnTripOpeningKm) {
                        throw new Error(`ENGINE_ODOMETER_DECREASED: closingKm ${returnTripClosingKm} < openingKm ${returnTripOpeningKm}. Date: ${dateStr}, From: ${lastVisitAddress}, To: ${homeAddress}`);
                    }
                    
                    const returnPurpose = 'Return Home';
                    
                    generatedDays.push({
                        date: dateStr,
                        day,
                        openingKm: returnTripOpeningKm,
                        closingKm: returnTripClosingKm,
                        businessKm: returnSegmentKm,
                        privateKm: 0,
                        purpose: returnPurpose,
                        from: lastVisitAddress,
                        to: homeAddress
                    });

                    currentOdometer = returnTripClosingKm;
                }
            }

            currentDate.setDate(currentDate.getDate() + 1);
        }
    } else {
        // Fallback to original logic if no date range provided
        const logbook = [];
        let currentKm = vehicleOpeningKm;

        for (const [date, dayVisits] of visitsByDate.entries()) {
            dayVisits.sort((a, b) => {
                const aIndex = a.rowIndex || 999999;
                const bIndex = b.rowIndex || 999999;
                return aIndex - bIndex;
            });

            if (dayVisits.length === 0) {
                continue;
            }

            const dateObj = new Date(date);
            const day = dateObj.toLocaleDateString('en-ZA', { weekday: 'short' });

            const firstVisit = dayVisits[0];
            const firstVisitAddress = buildCleanAddress([firstVisit.address]);
            
            const homeToFirstKey = `HOME→${firstVisit.address}`;
            const homeToFirstDistance = distances.get(homeToFirstKey);
            
            if (homeToFirstDistance === undefined || homeToFirstDistance === null) {
                throw new Error(`Missing distance for trip: ${homeToFirstKey}`);
            }

            if (typeof homeToFirstDistance !== 'number' || homeToFirstDistance < 0 || isNaN(homeToFirstDistance)) {
                throw new Error(`Invalid distance for trip "${homeToFirstKey}": ${homeToFirstDistance}`);
            }

            const firstTripOpeningKm = currentKm;
            const segmentKm = homeToFirstDistance;
            
            if (!Number.isFinite(segmentKm) || segmentKm > 1000) {
                throw new Error(`ENGINE_SEGMENT_KM_INVALID: segmentKm ${segmentKm} is not finite or exceeds 1000km. Date: ${date}, From: ${homeAddress}, To: ${firstVisitAddress}`);
            }
            
            const firstTripClosingKm = firstTripOpeningKm + segmentKm;
            
            if (firstTripClosingKm < firstTripOpeningKm) {
                throw new Error(`ENGINE_ODOMETER_DECREASED: closingKm ${firstTripClosingKm} < openingKm ${firstTripOpeningKm}. Date: ${date}, From: ${homeAddress}, To: ${firstVisitAddress}`);
            }
            
            const firstPurpose = `${firstVisit.reason || 'Sales Visit'} – ${firstVisit.customer || ''}`;
            
            logbook.push({
                date,
                day,
                openingKm: firstTripOpeningKm,
                closingKm: firstTripClosingKm,
                businessKm: segmentKm,
                privateKm: 0,
                purpose: firstPurpose,
                from: homeAddress,
                to: firstVisitAddress
            });

            currentKm = firstTripClosingKm;

            for (let i = 0; i < dayVisits.length - 1; i++) {
                const fromVisit = dayVisits[i];
                const toVisit = dayVisits[i + 1];
                
                const fromAddress = buildCleanAddress([fromVisit.address]);
                const toAddress = buildCleanAddress([toVisit.address]);
                
                const tripKey = `${fromVisit.address}→${toVisit.address}`;
                const tripDistance = distances.get(tripKey);
                
                if (tripDistance === undefined || tripDistance === null) {
                    throw new Error(`Missing distance for trip: ${tripKey}`);
                }

                if (typeof tripDistance !== 'number' || tripDistance < 0 || isNaN(tripDistance)) {
                    throw new Error(`Invalid distance for trip "${tripKey}": ${tripDistance}`);
                }

                const tripOpeningKm = currentKm;
                const tripSegmentKm = tripDistance;
                
                if (!Number.isFinite(tripSegmentKm) || tripSegmentKm > 1000) {
                    throw new Error(`ENGINE_SEGMENT_KM_INVALID: segmentKm ${tripSegmentKm} is not finite or exceeds 1000km. Date: ${date}, From: ${fromAddress}, To: ${toAddress}`);
                }
                
                const tripClosingKm = tripOpeningKm + tripSegmentKm;
                
                if (tripClosingKm < tripOpeningKm) {
                    throw new Error(`ENGINE_ODOMETER_DECREASED: closingKm ${tripClosingKm} < openingKm ${tripOpeningKm}. Date: ${date}, From: ${fromAddress}, To: ${toAddress}`);
                }
                
                const visitPurpose = `${toVisit.reason || 'Sales Visit'} – ${toVisit.customer || ''}`;
                
                logbook.push({
                    date,
                    day,
                    openingKm: tripOpeningKm,
                    closingKm: tripClosingKm,
                    businessKm: tripSegmentKm,
                    privateKm: 0,
                    purpose: visitPurpose,
                    from: fromAddress,
                    to: toAddress
                });

                currentKm = tripClosingKm;
            }

            const lastVisit = dayVisits[dayVisits.length - 1];
            const lastVisitAddress = buildCleanAddress([lastVisit.address]);
            
            const lastToHomeKey = `${lastVisit.address}→HOME`;
            const lastToHomeDistance = distances.get(lastToHomeKey);
            
            if (lastToHomeDistance === undefined || lastToHomeDistance === null) {
                throw new Error(`Missing distance for return trip: ${lastToHomeKey}`);
            }

            if (typeof lastToHomeDistance !== 'number' || lastToHomeDistance < 0 || isNaN(lastToHomeDistance)) {
                throw new Error(`Invalid distance for return trip "${lastToHomeKey}": ${lastToHomeDistance}`);
            }

            const returnTripOpeningKm = currentKm;
            const returnSegmentKm = lastToHomeDistance;
            
            if (!Number.isFinite(returnSegmentKm) || returnSegmentKm > 1000) {
                throw new Error(`ENGINE_SEGMENT_KM_INVALID: segmentKm ${returnSegmentKm} is not finite or exceeds 1000km. Date: ${date}, From: ${lastVisitAddress}, To: ${homeAddress}`);
            }
            
            const returnTripClosingKm = returnTripOpeningKm + returnSegmentKm;
            
            if (returnTripClosingKm < returnTripOpeningKm) {
                throw new Error(`ENGINE_ODOMETER_DECREASED: closingKm ${returnTripClosingKm} < openingKm ${returnTripOpeningKm}. Date: ${date}, From: ${lastVisitAddress}, To: ${homeAddress}`);
            }
            
            const returnPurpose = 'Return Home';
            
            logbook.push({
                date,
                day,
                openingKm: returnTripOpeningKm,
                closingKm: returnTripClosingKm,
                businessKm: returnSegmentKm,
                privateKm: 0,
                purpose: returnPurpose,
                from: lastVisitAddress,
                to: homeAddress
            });

            currentKm = returnTripClosingKm;
        }

        generatedDays.push(...logbook);
    }

    // Manual entry override
    if (manualEntries && Array.isArray(manualEntries) && manualEntries.length > 0) {
        manualEntries.forEach(manual => {
            const manualDateStr = typeof manual.date === 'string' ? manual.date : formatISODate(new Date(manual.date));
            const index = generatedDays.findIndex(
                d => d.date === manualDateStr
            );

            if (index !== -1) {
                generatedDays[index] = manual;
            } else {
                generatedDays.push(manual);
            }
        });
        
        // Re-sort by date after manual overrides
        generatedDays.sort((a, b) => {
            if (a.date < b.date) return -1;
            if (a.date > b.date) return 1;
            return 0;
        });
    }

    // Recalculate odometer continuity from vehicleOpeningKm forward
    // This ensures manual entries don't break odometer progression
    let runningOdometer = vehicleOpeningKm;
    for (let i = 0; i < generatedDays.length; i++) {
        const entry = generatedDays[i];
        entry.openingKm = runningOdometer;
        const businessKm = Number(entry.businessKm) || 0;
        const privateKm = Number(entry.privateKm) || 0;
        entry.closingKm = runningOdometer + businessKm + privateKm;
        runningOdometer = entry.closingKm;
    }

    return generatedDays;
}

/**
 * Main logbook engine function
 * 
 * @param {Object} input - Engine input parameters
 * @param {Array} input.routes - Array of route objects with {customer, address, suburb, days: {mon, tue, ...}, weeks: [1,2,3,4], rowIndex}
 * @param {string} input.startDate - Start date in YYYY-MM-DD format
 * @param {string} input.endDate - End date in YYYY-MM-DD format
 * @param {string} input.homeAddress - Home/base address
 * @param {number} input.openingKm - Starting odometer reading
 * @param {number} input.currentWeek - Current week cycle (1, 2, 3, or 4)
 * @param {string[]} [input.leaveDays] - Optional array of ISO date strings to exclude
 * @param {Object} input.routingService - Routing service with getDistance(from, to) and getDistances(home, addresses) methods
 * @param {number} [input.closingKm] - Optional closing odometer reading. If provided, private mileage will be calculated as (closingKm - openingKm) - totalBusinessKm
 * @returns {Promise<Object>} Logbook result with entries, totals, and meta
 */
async function runLogbookEngine(input) {
    const {
        routes,
        startDate,
        endDate,
        homeAddress,
        openingKm,
        currentWeek,
        leaveDays,
        routingService,
        closingKm,
        employerName
    } = input;

    // Validate inputs
    if (!routes || !Array.isArray(routes) || routes.length === 0) {
        throw new Error('routes is required and must be a non-empty array');
    }

    if (!startDate || typeof startDate !== 'string') {
        throw new Error('startDate is required and must be a string in YYYY-MM-DD format');
    }

    if (!endDate || typeof endDate !== 'string') {
        throw new Error('endDate is required and must be a string in YYYY-MM-DD format');
    }

    if (!homeAddress || typeof homeAddress !== 'string') {
        throw new Error('homeAddress is required and must be a string');
    }

    if (typeof openingKm !== 'number' || openingKm < 0 || isNaN(openingKm)) {
        throw new Error('openingKm is required and must be a non-negative number');
    }

    if (typeof currentWeek !== 'number' || currentWeek < 1 || currentWeek > 4) {
        throw new Error('currentWeek is required and must be 1, 2, 3, or 4');
    }

    if (!routingService || typeof routingService.getDistance !== 'function' || typeof routingService.getDistances !== 'function') {
        throw new Error('routingService is required and must have getDistance and getDistances methods');
    }

    // Step 1: Expand routes into visits
    const visits = expandRoutes(routes, startDate, endDate, currentWeek, leaveDays || []);

    // Step 2: Calculate distances from home to each unique visit address
    const uniqueAddresses = [...new Set(visits.map(v => v.address))];
    const homeToVisitsRaw = await routingService.getDistances(homeAddress, uniqueAddresses);
    // Convert to Map with km values if routing service returns objects
    const homeToVisits = new Map();
    for (const [address, distanceResult] of homeToVisitsRaw.entries()) {
        const distance = typeof distanceResult === 'object' && distanceResult.km !== undefined ? distanceResult.km : distanceResult;
        homeToVisits.set(address, distance);
    }

    // Step 3: Group visits by date and calculate sequential distances
    const visitsByDate = new Map();
    for (const visit of visits) {
        if (!visitsByDate.has(visit.date)) {
            visitsByDate.set(visit.date, []);
        }
        visitsByDate.get(visit.date).push(visit);
    }

    const sequentialDistances = new Map();

    for (const [date, dayVisits] of visitsByDate.entries()) {
        dayVisits.sort((a, b) => (a.rowIndex || 999999) - (b.rowIndex || 999999));

        // Calculate distances between sequential visits
        for (let i = 0; i < dayVisits.length - 1; i++) {
            const fromVisit = dayVisits[i];
            const toVisit = dayVisits[i + 1];
            const fromAddress = buildCleanAddress([fromVisit.address]);
            const toAddress = buildCleanAddress([toVisit.address]);

            const tripKey = `${fromVisit.address}→${toVisit.address}`;

            if (!sequentialDistances.has(tripKey)) {
                const distanceResult = await routingService.getDistance(fromAddress, toAddress);
                const distance = typeof distanceResult === 'object' && distanceResult.km !== undefined ? distanceResult.km : distanceResult;
                sequentialDistances.set(tripKey, distance);
            }
        }

        // Calculate distance from last visit back to home
        if (dayVisits.length > 0) {
            const lastVisit = dayVisits[dayVisits.length - 1];
            const lastAddress = buildCleanAddress([lastVisit.address]);
            const returnKey = `${lastVisit.address}→HOME`;

            if (!sequentialDistances.has(returnKey)) {
                const distanceResult = await routingService.getDistance(lastAddress, homeAddress);
                const distance = typeof distanceResult === 'object' && distanceResult.km !== undefined ? distanceResult.km : distanceResult;
                sequentialDistances.set(returnKey, distance);
            }
        }
    }

    // Step 4: Combine all distances into a single map
    const allDistances = new Map();

    // Add Home → visit distances
    for (const [address, distanceResult] of homeToVisits.entries()) {
        const distance = typeof distanceResult === 'object' && distanceResult.km !== undefined ? distanceResult.km : distanceResult;
        allDistances.set(`HOME→${address}`, distance);
    }

    // Add sequential visit distances
    for (const [key, distance] of sequentialDistances.entries()) {
        allDistances.set(key, distance);
    }

    // Step 5: Generate logbook entries
    const manualEntries = input.manualEntries || null;
    const workSaturdays = input.workSaturdays || false;
    const entries = generateLogbookEntries(visits, allDistances, openingKm, homeAddress, startDate, endDate, routes, manualEntries, workSaturdays, leaveDays);

    // Step 5.5: Verify odometer integrity
    if (entries.length > 0) {
        // Verify first openingKm matches input
        if (entries[0].openingKm !== openingKm) {
            throw new Error(`Odometer mismatch: First entry openingKm ${entries[0].openingKm} does not match input openingKm ${openingKm}`);
        }
        
        // Verify sequential odometer progression
        for (let i = 0; i < entries.length - 1; i++) {
            const currentEntry = entries[i];
            const nextEntry = entries[i + 1];
            if (currentEntry.closingKm !== nextEntry.openingKm) {
                throw new Error(`Odometer mismatch: Entry ${i} closingKm ${currentEntry.closingKm} does not match entry ${i + 1} openingKm ${nextEntry.openingKm}`);
            }
        }
    }

    // ===============================
    // SINGLE SOURCE TOTALS AUTHORITY
    // ===============================

    const warnings = [];

    const opening = Number(openingKm) || 0;
    const closing = Number(closingKm) || 0;

    const hasClosingKm =
        closingKm !== undefined &&
        closingKm !== null &&
        closingKm !== '';

    let odometerDelta = 0;
    let totalBusinessKm = 0;
    let totalPrivateKm = 0;
    let totalTravelKm = 0;
    let businessUsePercentage = 0;

    // Always calculate business from entries
    totalBusinessKm = entries.reduce((sum, entry) => {
        return sum + (Number(entry.businessKm) || 0);
    }, 0);

    if (hasClosingKm) {
        odometerDelta = closing - opening;

        if (odometerDelta < 0) {
            warnings.push(
                'Closing odometer is less than opening odometer. Travel set to 0.'
            );
            odometerDelta = 0;
        }

        totalTravelKm = odometerDelta;

        totalPrivateKm = odometerDelta - totalBusinessKm;

        if (totalPrivateKm < 0) {
            warnings.push(
                'Odometer imbalance detected: Business KM exceeds total travel. Private KM has been set to 0.'
            );
            totalPrivateKm = 0;
        }

        businessUsePercentage =
            totalTravelKm > 0
                ? (totalBusinessKm / totalTravelKm) * 100
                : 0;

        if (businessUsePercentage > 100) {
            businessUsePercentage = 100;
        }

        // Update final entry closingKm to match user-provided closingKm
        if (entries.length > 0) {
            entries[entries.length - 1].closingKm = closingKm;
        }

    } else {
        // No closing KM provided — business only logbook
        totalTravelKm = totalBusinessKm;
        totalPrivateKm = 0;
        businessUsePercentage = 100;
    }

    // Round safely to 2 decimals
    totalTravelKm = Number(totalTravelKm.toFixed(2));
    totalBusinessKm = Number(totalBusinessKm.toFixed(2));
    totalPrivateKm = Number(totalPrivateKm.toFixed(2));
    businessUsePercentage = Number(businessUsePercentage.toFixed(2));

    return {
        entries,
        totals: {
            totalKm: totalTravelKm,
            totalBusinessKm,
            totalPrivateKm,
            businessUsePercentage
        },
        meta: {
            startDate,
            endDate,
            employerName: employerName || null,
            generatedAt: new Date().toISOString(),
            closingKm: hasClosingKm ? Number(closingKm) : null,
            warnings
        }
    };
}

// ES6 export (for ES modules)
export { runLogbookEngine };

// CommonJS export (for Node.js CommonJS - conditional)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { runLogbookEngine };
}

