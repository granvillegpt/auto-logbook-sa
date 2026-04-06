/*
AUTO LOGBOOK SA – CORE ENGINE
Engine Version: 1.0.0

WARNING:
This file is part of the protected logbook calculation engine.
Do not modify calculation logic without explicit approval and version update.
*/

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

const ENGINE_VERSION = "1.2.0";
const DEBUG_HOLIDAYS = typeof global !== 'undefined' && global.DEBUG_HOLIDAYS;

function round2(num) {
    const value = Number(num);
    if (!value || !Number.isFinite(value)) return 0;
    return Math.round(value * 100) / 100;
}

function haversineDistance(lat1, lng1, lat2, lng2) {
    const R = 6371; // km
    const toRad = d => d * Math.PI / 180;

    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);

    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
        Math.sin(dLng / 2) * Math.sin(dLng / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c * 1.45; // multiplier
}

function assertValidCoords(route) {}

/** Haversine segment km; never throws — returns 0 on error or non-finite result. */
function logbookTripKmHaversine(fromLat, fromLng, toLat, toLng, fromLabel, toLabel) {
    try {
        const km = haversineDistance(fromLat, fromLng, toLat, toLng);
        if (!Number.isFinite(km)) {
            if (typeof console !== 'undefined' && console.warn) {
                console.warn('[HAVERSINE] non-finite distance', fromLabel, '→', toLabel);
            }
            return 0;
        }
        return km;
    } catch (err) {
        if (typeof console !== 'undefined' && console.warn) {
            console.warn('[HAVERSINE]', err && err.message ? err.message : err, fromLabel, '→', toLabel);
        }
        return 0;
    }
}

function normalizeTripProvince(p) {
    return (p || '')
        .toString()
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * SARS-oriented validation: mark trips that are implausible or need human review (mutates entries).
 */
function applySarsTripValidationFlags(entries) {
    if (!Array.isArray(entries)) return;
    for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        if (!entry || typeof entry !== 'object') continue;
        if (Object.prototype.hasOwnProperty.call(entry, 'flag')) {
            delete entry.flag;
        }
        const fromLocation = String(entry.from || '').trim();
        const toLocation = String(entry.to || '').trim();
        if (!fromLocation && !toLocation) continue;
        const fromProvince = normalizeTripProvince(entry.fromProvince);
        const toProvince = normalizeTripProvince(entry.toProvince);
        if (fromProvince && toProvince && fromProvince !== toProvince) {
            entry.flag = 'INVALID_REGION';
        }
    }
}

function getEasterDate(year) {
  const f = Math.floor;
  const G = year % 19;
  const C = f(year / 100);
  const H = (C - f(C / 4) - f((8 * C + 13) / 25) + 19 * G + 15) % 30;
  const I = H - f(H / 28) * (1 - f(29 / (H + 1)) * f((21 - G) / 11));
  const J = (year + f(year / 4) + I + 2 - C + f(C / 4)) % 7;
  const L = I - J;
  const month = 3 + f((L + 40) / 44);
  const day = L + 28 - 31 * f(month / 4);
  return new Date(year, month - 1, day);
}

function toISODate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + d;
}

function cloneDate(date) {
  return new Date(date.getTime());
}

function addHolidayWithObservedRule(holidays, date, name) {
  const base = cloneDate(date);
  holidays[toISODate(base)] = name;

  if (base.getDay() === 0) {
    const observed = cloneDate(base);
    observed.setDate(observed.getDate() + 1);
    holidays[toISODate(observed)] = name + " (Observed)";
  }
}

function generateSAHolidays(year) {
  const holidays = Object.create(null);

  addHolidayWithObservedRule(holidays, new Date(year, 0, 1), "New Year's Day");
  addHolidayWithObservedRule(holidays, new Date(year, 2, 21), "Human Rights Day");
  addHolidayWithObservedRule(holidays, new Date(year, 3, 27), "Freedom Day");
  addHolidayWithObservedRule(holidays, new Date(year, 4, 1), "Workers Day");
  addHolidayWithObservedRule(holidays, new Date(year, 5, 16), "Youth Day");
  addHolidayWithObservedRule(holidays, new Date(year, 7, 9), "National Women's Day");
  addHolidayWithObservedRule(holidays, new Date(year, 8, 24), "Heritage Day");
  addHolidayWithObservedRule(holidays, new Date(year, 11, 16), "Day of Reconciliation");
  addHolidayWithObservedRule(holidays, new Date(year, 11, 25), "Christmas Day");
  addHolidayWithObservedRule(holidays, new Date(year, 11, 26), "Day of Goodwill");

  const easter = getEasterDate(year);
  const goodFriday = cloneDate(easter);
  goodFriday.setDate(goodFriday.getDate() - 2);
  const familyDay = cloneDate(easter);
  familyDay.setDate(familyDay.getDate() + 1);

  holidays[toISODate(goodFriday)] = "Good Friday";
  holidays[toISODate(familyDay)] = "Family Day";

  if (DEBUG_HOLIDAYS && typeof console !== 'undefined' && console.log) {
    console.log('[DEBUG_HOLIDAYS] generated holidays for year ' + year);
  }
  return holidays;
}

const holidayYearCache = new Map();

function getHolidayMapForYear(year) {
  if (!holidayYearCache.has(year)) {
    holidayYearCache.set(year, generateSAHolidays(year));
  }
  return holidayYearCache.get(year);
}

function normalizeKey(key) {
  return typeof key === 'string'
    ? key.trim().toLowerCase()
    : key;
}

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
 * Builds fullAddress from route/visit parts: address, suburb, city (if present), province (if present).
 * Minimum: address + ", " + suburb. No "South Africa" appended.
 */
function buildFullAddress(routeOrVisit) {
    const parts = [];
    if (routeOrVisit.address) parts.push(String(routeOrVisit.address).trim());
    if (routeOrVisit.suburb) parts.push(String(routeOrVisit.suburb).trim());
    if (routeOrVisit.city) parts.push(String(routeOrVisit.city).trim());
    if (routeOrVisit.province) parts.push(String(routeOrVisit.province).trim());
    return buildCleanAddress(parts);
}

/**
 * Gets weekday number (0=Sunday, 1=Monday, ..., 6=Saturday)
 */
function getWeekday(date) {
    return date.getDay();
}

/**
 * Parses a weeks field from CSV/Excel (e.g. "1,3") into cycle week numbers.
 * Returns empty array when absent (no implicit default in engine).
 */
function parseWeeksField(str) {
    if (str == null || str === '') return [];
    return String(str)
        .split(',')
        .map(s => parseInt(s.trim(), 10))
        .filter(n => !isNaN(n) && n >= 1 && n <= 4);
}

/**
 * Strict route mode: only "date" | "cycle" from route.mode. No inference.
 * @returns {"date"|"cycle"|null}
 */
function resolveRouteMode(route) {
    const mode = (route && route.mode != null)
        ? String(route.mode).toLowerCase().trim()
        : '';
    if (mode === 'date') return 'date';
    if (mode === 'cycle') return 'cycle';
    return null;
}

/** Singular weekday label → dayKey (DATE / CYCLE day matching) */
const DATE_MODE_SINGULAR_TO_DAYKEY = {
    mon: 'mon', monday: 'mon',
    tue: 'tue', tues: 'tue', tuesday: 'tue',
    wed: 'wed', wednesday: 'wed',
    thu: 'thu', thur: 'thu', thurs: 'thu', thursday: 'thu',
    fri: 'fri', friday: 'fri',
    sat: 'sat', saturday: 'sat'
};

function normalizeDayName(day) {
    return (day || '').toString().toLowerCase().trim();
}

/** DATE MODE (and cycle day column): plural route.days[dayKey] OR singular route.day */
function dayMatchesRoute(route, dayKey) {
    if (!dayKey || !route) return false;
    const pluralMatch = !!(route.days && route.days[dayKey]);
    const singularNorm = normalizeDayName(route.day).replace(/[^a-z]/g, '');
    const mapped = singularNorm ? DATE_MODE_SINGULAR_TO_DAYKEY[singularNorm] : null;
    const singularMatch = mapped === dayKey;
    return pluralMatch || singularMatch;
}

function dateModeRouteHasWeekdayInfo(route) {
    if (!route) return false;
    for (let ki = 0; ki < 6; ki++) {
        const k = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'][ki];
        if (dayMatchesRoute(route, k)) return true;
    }
    return false;
}

/** True if route row explicitly specified week / weeks (not engine default) */
function cycleRouteHasExplicitWeekInfo(route) {
    if (!route) return false;
    if (route.week != null && route.week !== '') {
        const w = Number(route.week);
        if (Number.isInteger(w) && w >= 1 && w <= 4) return true;
    }
    if (Array.isArray(route.weeks) && route.weeks.length > 0) return true;
    if (typeof route.weeks === 'string' && route.weeks.trim()) return true;
    return false;
}

/** Coerce range start to YYYY-MM-DD for stable noon-based cycle math */
function normalizeISOStartDateForCycle(rangeStart) {
    if (rangeStart == null || rangeStart === '') {
        throw new Error('Invalid start date for 4-week cycle (empty)');
    }
    if (typeof rangeStart === 'string') {
        const t = rangeStart.trim();
        if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
    }
    if (rangeStart instanceof Date && !isNaN(rangeStart.getTime())) {
        return formatISODate(rangeStart);
    }
    const t = String(rangeStart).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
    throw new Error(`Invalid start date for 4-week cycle: ${rangeStart}`);
}

/**
 * ClearTrack-style anchor: which cycle week (1–4) falls on range start (weekIndex === 0).
 */
function normalizeCycleAnchorWeek(currentWeek) {
    const n = Number(currentWeek);
    if (!Number.isInteger(n) || n < 1 || n > 4) {
        return 1;
    }
    return n;
}

/**
 * 4-week cycle position for a calendar date within the tax range.
 * weekIndex = floor(daysElapsed / 7) from normalized range start (local noon).
 * Anchored: cycleWeek = ((weekIndex + (anchorWeek - 1)) % 4) + 1, anchorWeek = real week on start date (1–4).
 * currentDate normalized to local noon (DST-safe).
 */
function getFourWeekCycleWeek(isoRangeStart, currentDate, currentWeek) {
    const iso = normalizeISOStartDateForCycle(isoRangeStart);
    const msPerDay = 86400000;
    const start = new Date(iso + 'T12:00:00');
    if (isNaN(start.getTime())) {
        throw new Error(`Invalid start date for 4-week cycle: ${iso}`);
    }
    const current = new Date(
        currentDate.getFullYear(),
        currentDate.getMonth(),
        currentDate.getDate(),
        12, 0, 0
    );
    const daysElapsed = Math.floor((current - start) / msPerDay);
    const weekIndex = Math.floor(daysElapsed / 7);
    const anchor = normalizeCycleAnchorWeek(currentWeek);
    return ((weekIndex + (anchor - 1)) % 4) + 1;
}

/**
 * weekIndex + cycleWeek for audits (same math as getFourWeekCycleWeek).
 */
function computeFourWeekCycleContext(isoRangeStart, currentDate, currentWeek) {
    const iso = normalizeISOStartDateForCycle(isoRangeStart);
    const msPerDay = 86400000;
    const start = new Date(iso + 'T12:00:00');
    const current = new Date(
        currentDate.getFullYear(),
        currentDate.getMonth(),
        currentDate.getDate(),
        12, 0, 0
    );
    const daysElapsed = Math.floor((current - start) / msPerDay);
    const weekIndex = Math.floor(daysElapsed / 7);
    const anchor = normalizeCycleAnchorWeek(currentWeek);
    const cycleWeek = ((weekIndex + (anchor - 1)) % 4) + 1;
    return { daysElapsed, weekIndex, cycleWeek, cycleAnchorWeek: anchor };
}

/**
 * @deprecated use getFourWeekCycleWeek(iso, date, initialWeek); initialWeek is the anchor (1–4).
 */
function getCurrentWeekCycle(startDateInput, currentDate, initialWeek) {
    const iso = typeof startDateInput === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(String(startDateInput).trim())
        ? String(startDateInput).trim()
        : (startDateInput instanceof Date && !isNaN(startDateInput.getTime()))
            ? formatISODate(startDateInput)
            : normalizeISOStartDateForCycle(startDateInput);
    return getFourWeekCycleWeek(iso, currentDate, initialWeek);
}

/** Argument order: (currentDate, startDateInput, currentWeek) — currentWeek is cycle anchor on start date */
function getWeekCycle(currentDate, startDateInput, currentWeek) {
    const iso = startDateInput instanceof Date
        ? formatISODate(startDateInput)
        : String(startDateInput).trim();
    return getFourWeekCycleWeek(iso, currentDate, currentWeek);
}

/**
 * Allowed 4-week cycle indices for a CYCLE route row — explicit week/weeks only.
 * Engine never invents weeks: empty [] if missing/invalid (route must be rejected in expandRoutes).
 * Returns a NEW sorted, de-duplicated array; does not mutate route.
 */
function normalizeRouteCycleWeeks(route) {
    if (route.week != null && route.week !== '') {
        const w = Number(route.week);
        if (Number.isInteger(w) && w >= 1 && w <= 4) {
            return [w];
        }
    }
    let arr = [];
    if (Array.isArray(route.weeks)) {
        arr = route.weeks
            .map(n => parseInt(String(n), 10))
            .filter(n => !isNaN(n) && n >= 1 && n <= 4);
    } else {
        arr = parseWeeksField(route.weeks);
    }
    return [...new Set(arr)].sort((a, b) => a - b);
}

/** ~weeks spanned by inclusive ISO range; used for audit expectations */
function countApproxCalendarWeeksInclusive(isoStart, isoEnd) {
    const a = new Date(isoStart + 'T12:00:00');
    const b = new Date(isoEnd + 'T12:00:00');
    if (isNaN(a.getTime()) || isNaN(b.getTime())) return 0;
    const days = Math.floor((b - a) / 86400000) + 1;
    return Math.max(1, Math.ceil(days / 7));
}

/** CYCLE MODE weekday match (same rules as DATE MODE plural + singular day) */
function legacyRouteMatchesDay(route, dayKey) {
    return dayMatchesRoute(route, dayKey);
}

function legacyRouteMatchesCycleWeek(route, cycleWeek) {
    const allowed = normalizeRouteCycleWeeks(route);
    return allowed.length > 0 && allowed.indexOf(cycleWeek) !== -1;
}

/** Guard: skip duplicate trip for same calendar date + route row */
function registerLegacyTripIfNew(dateStr, routeId, legacyTripKeys) {
    const tripKey = `${dateStr}|${routeId}`;
    if (legacyTripKeys.has(tripKey)) return false;
    legacyTripKeys.add(tripKey);
    return true;
}

function logRouteRepetitionAudit(visits, label, isoStart, isoEnd, taxYearStartWeek) {
    if (typeof console === 'undefined' || !console.log || !visits || visits.length === 0) return;
    const counts = Object.create(null);
    for (let i = 0; i < visits.length; i++) {
        const v = visits[i];
        const id = v.rowIndex != null ? `row:${v.rowIndex}` : String(v.customer || 'unknown');
        counts[id] = (counts[id] || 0) + 1;
    }
    console.log('AUDIT: route repetition count per year' + (label ? ` [${label}]` : ''), counts);
    if (isoStart && isoEnd && typeof console !== 'undefined' && console.log) {
        const approxWeeks = countApproxCalendarWeeksInclusive(isoStart, isoEnd);
        const approxPerSlot = Math.floor(approxWeeks / 4);
        console.log('AUDIT: 4-week cycle expectation (~13/year per Mon×single cycle when 52 weeks)', {
            approxWeeksInRange: approxWeeks,
            approxVisitsPerWeekdayPerSingleCycleWeek: approxPerSlot,
            taxYearStartCycleWeek: taxYearStartWeek != null ? taxYearStartWeek : '(fixed cycle, no anchor)',
            note: 'Reduced by leave days, unticked weekdays, or routes allowed in multiple cycle weeks.'
        });
    }
}

/**
 * POST-FIX AUDIT: log each day in range with engine-identical cycleWeek (getFourWeekCycleWeek) and route matches.
 * For meaningful counts, pass cycle-mode routes (or rows with week/weeks + weekday).
 * @param {string} startDate - YYYY-MM-DD
 * @param {string} endDate - YYYY-MM-DD
 * @param {Array} routes - route rows to test
 * @param {number} [currentWeek] - Cycle week (1–4) on range start date (ClearTrack anchor)
 * @returns {Array<{ date: string, day: string, cycleWeek: number, routeCount: number }>}
 */
function runCycleAudit(startDate, endDate, routes, currentWeek) {
    if (typeof console !== 'undefined' && console.log) {
        console.log('=== CYCLE AUDIT START ===');
    }

    const anchor = normalizeCycleAnchorWeek(currentWeek);
    const list = Array.isArray(routes) ? routes : [];
    const isoStartNorm = normalizeISOStartDateForCycle(startDate);
    const rangeStartNoon = new Date(String(startDate).trim() + 'T12:00:00');
    const rangeEndNoon = new Date(String(endDate).trim() + 'T12:00:00');
    if (isNaN(rangeStartNoon.getTime()) || isNaN(rangeEndNoon.getTime())) {
        throw new Error('runCycleAudit: invalid startDate or endDate');
    }

    const results = [];
    const cursor = new Date(rangeStartNoon.getTime());
    while (cursor.getTime() <= rangeEndNoon.getTime()) {
        const iso = formatISODate(cursor);
        const dayKey = weekdayToDayKey(getWeekday(cursor)) || 'sun';
        const cycleWeek = getFourWeekCycleWeek(isoStartNorm, cursor, anchor);

        const matchedRoutes = list.filter((route) => {
            const matchesDay = dayMatchesRoute(route, dayKey);
            const weeks = normalizeRouteCycleWeeks(route);
            const matchesWeek = weeks.includes(cycleWeek);
            return matchesDay && matchesWeek;
        });

        results.push({
            date: iso,
            day: dayKey,
            cycleWeek,
            routeCount: matchedRoutes.length
        });

        if (typeof console !== 'undefined' && console.log) {
            console.log(
                `[AUDIT] ${iso} | ${dayKey.toUpperCase()} | Week ${cycleWeek} | Routes: ${matchedRoutes.length}`
            );
        }

        cursor.setDate(cursor.getDate() + 1);
    }

    if (typeof console !== 'undefined' && console.log) {
        console.log('=== CYCLE AUDIT END ===');
    }

    return results;
}

/**
 * Console audit: first 35 calendar days — proves inline anchor formula matches getFourWeekCycleWeek
 * and cycle advances 1→2→3→4→1 each weekIndex step (local noon / setDate stepping, same as expansion).
 * @param {string} startDate - YYYY-MM-DD
 * @param {number} [currentWeek] - Anchor 1–4 on startDate
 * @returns {{ ok: boolean, mismatches: number, anchor: number }}
 */
function auditCycleFormula(startDate, currentWeek) {
    if (typeof console === 'undefined' || !console.log) {
        return { ok: false, mismatches: -1, anchor: normalizeCycleAnchorWeek(currentWeek) };
    }
    console.log('=== CYCLE FORMULA AUDIT ===');

    const isoStartNorm = normalizeISOStartDateForCycle(startDate);
    const anchor = normalizeCycleAnchorWeek(currentWeek);
    const startNoon = new Date(String(startDate).trim() + 'T12:00:00');
    if (isNaN(startNoon.getTime())) {
        throw new Error('auditCycleFormula: invalid startDate');
    }

    let mismatches = 0;
    let prevWeekIndex = null;
    let prevCycle = null;
    const cursor = new Date(startNoon.getTime());

    for (let i = 0; i < 35; i++) {
        const ctx = computeFourWeekCycleContext(isoStartNorm, cursor, anchor);
        const engineWeek = getFourWeekCycleWeek(isoStartNorm, cursor, anchor);
        const refCycle = ((ctx.weekIndex + (anchor - 1)) % 4) + 1;

        if (engineWeek !== refCycle || engineWeek !== ctx.cycleWeek) {
            mismatches += 1;
            if (typeof console !== 'undefined' && console.warn) {
                console.warn('❌ MISMATCH day', i, { engineWeek, refCycle, ctx });
            }
        }

        if (prevWeekIndex !== null) {
            if (ctx.weekIndex === prevWeekIndex && engineWeek !== prevCycle) {
                mismatches += 1;
                if (typeof console !== 'undefined' && console.warn) {
                    console.warn('❌ Cycle changed inside same weekIndex slot', { day: i, prevWeekIndex, prevCycle, engineWeek });
                }
            }
            if (ctx.weekIndex === prevWeekIndex + 1) {
                const expectNext = (prevCycle % 4) + 1;
                if (engineWeek !== expectNext) {
                    mismatches += 1;
                    if (typeof console !== 'undefined' && console.warn) {
                        console.warn('❌ Cycle did not advance 1→2→3→4 at weekIndex boundary', {
                            day: i,
                            prevWeekIndex,
                            prevCycle,
                            engineWeek,
                            expectNext
                        });
                    }
                }
            }
        }

        console.log(`Day ${i} → weekIndex ${ctx.weekIndex} → Cycle ${engineWeek} (ref ${refCycle})`);

        prevWeekIndex = ctx.weekIndex;
        prevCycle = engineWeek;
        cursor.setDate(cursor.getDate() + 1);
    }

    console.log('=== CYCLE FORMULA AUDIT END ===', { mismatches, anchor });
    return { ok: mismatches === 0, mismatches, anchor };
}

/**
 * Full anchored audit: same cycleWeek + dayKey → same route count; engine cycle from getFourWeekCycleWeek;
 * matched routes must list cycleWeek in normalizeRouteCycleWeeks (no leakage).
 * @param {string} startDate - YYYY-MM-DD
 * @param {string} endDate - YYYY-MM-DD
 * @param {Array} routes - route rows (cycle-style day + weeks is enough for filter)
 * @param {number} [currentWeek] - Anchor on startDate
 * @returns {{ inconsistencies: number, leakageIssues: Array, weeklyMap: Object }}
 */
function auditAnchoredCycle(startDate, endDate, routes, currentWeek) {
    if (typeof console === 'undefined' || !console.log) {
        return { inconsistencies: -1, leakageIssues: [], weeklyMap: {} };
    }
    console.log('=== ANCHORED CYCLE AUDIT START ===');

    const anchor = normalizeCycleAnchorWeek(currentWeek);
    const isoStartNorm = normalizeISOStartDateForCycle(startDate);
    const list = Array.isArray(routes) ? routes : [];
    const rangeStartNoon = new Date(String(startDate).trim() + 'T12:00:00');
    const rangeEndNoon = new Date(String(endDate).trim() + 'T12:00:00');
    if (isNaN(rangeStartNoon.getTime()) || isNaN(rangeEndNoon.getTime())) {
        throw new Error('auditAnchoredCycle: invalid startDate or endDate');
    }

    const weeklyMap = Object.create(null);
    let inconsistencies = 0;
    const leakageIssues = [];

    const cursor = new Date(rangeStartNoon.getTime());
    while (cursor.getTime() <= rangeEndNoon.getTime()) {
        const iso = formatISODate(cursor);
        const dayKey = weekdayToDayKey(getWeekday(cursor)) || 'sun';
        const cycleWeek = getFourWeekCycleWeek(isoStartNorm, cursor, anchor);

        const matchedRoutes = list.filter((route) => {
            const dayMatch = dayMatchesRoute(route, dayKey);
            const weeks = normalizeRouteCycleWeeks(route);
            const weekMatch = weeks.includes(cycleWeek);
            return dayMatch && weekMatch;
        });

        for (let r = 0; r < matchedRoutes.length; r++) {
            const route = matchedRoutes[r];
            const allowed = normalizeRouteCycleWeeks(route);
            if (!allowed.includes(cycleWeek)) {
                leakageIssues.push({ iso, route: route.customer || route.rowIndex, cycleWeek, allowed });
            }
        }

        const key = `${dayKey}_W${cycleWeek}`;
        if (weeklyMap[key] === undefined) {
            weeklyMap[key] = matchedRoutes.length;
        } else if (weeklyMap[key] !== matchedRoutes.length) {
            inconsistencies += 1;
            if (typeof console !== 'undefined' && console.warn) {
                console.warn(
                    `❌ INCONSISTENT: ${key} expected ${weeklyMap[key]} but got ${matchedRoutes.length}`
                );
            }
        }

        console.log(
            `[AUDIT] ${iso} | ${dayKey.toUpperCase()} | Cycle ${cycleWeek} | Routes: ${matchedRoutes.length}`
        );

        cursor.setDate(cursor.getDate() + 1);
    }

    console.log('=== ANCHORED CYCLE AUDIT END ===', {
        inconsistencies,
        leakageCount: leakageIssues.length
    });
    return { inconsistencies, leakageIssues, weeklyMap };
}

/**
 * Control routes: mon + weeks [1], [1,3], [1..4] — run over Mar–Apr 2025 with chosen anchor.
 * @param {number} [currentWeek] - Anchor 1–4 on range start
 */
function testControlRoutes(currentWeek) {
    const cw = normalizeCycleAnchorWeek(currentWeek);
    const routes = [
        { mode: 'cycle', day: 'mon', weeks: [1], customer: 'ctrl-A-week1-only' },
        { mode: 'cycle', day: 'mon', weeks: [1, 3], customer: 'ctrl-B-week1-3' },
        { mode: 'cycle', day: 'mon', weeks: [1, 2, 3, 4], customer: 'ctrl-C-all-weeks' }
    ];
    auditAnchoredCycle('2025-03-01', '2025-04-30', routes, cw);
}

/**
 * Shows how many calendar days (per weekday) fall in each cycleWeek for the range — explains count variance
 * between repeated "Week 1" phases when the tax range truncates 7-day slots at the end (or start overlap).
 * @param {string} startDate - YYYY-MM-DD
 * @param {string} endDate - YYYY-MM-DD
 * @param {Array} [leaveDays] - same shape as expandRoutes leaveDays (excluded from counts)
 * @param {number} [currentWeek] - Cycle week (1–4) on range start (ClearTrack anchor)
 * @returns {{ rangeStart: string, rangeEnd: string, countsByCycleWeekAndDay: Object, slotBoundaries: Array }}
 */
function auditCycleWeekDistribution(startDate, endDate, leaveDays, currentWeek) {
    const isoStartNorm = normalizeISOStartDateForCycle(startDate);
    const rangeStartNoon = new Date(String(startDate).trim() + 'T12:00:00');
    const rangeEndNoon = new Date(String(endDate).trim() + 'T12:00:00');
    if (isNaN(rangeStartNoon.getTime()) || isNaN(rangeEndNoon.getTime())) {
        throw new Error('auditCycleWeekDistribution: invalid startDate or endDate');
    }
    const leaveDaysArray = leaveDays || [];
    const countsByCycleWeekAndDay = {
        1: { mon: 0, tue: 0, wed: 0, thu: 0, fri: 0, sat: 0, sun: 0 },
        2: { mon: 0, tue: 0, wed: 0, thu: 0, fri: 0, sat: 0, sun: 0 },
        3: { mon: 0, tue: 0, wed: 0, thu: 0, fri: 0, sat: 0, sun: 0 },
        4: { mon: 0, tue: 0, wed: 0, thu: 0, fri: 0, sat: 0, sun: 0 }
    };
    const slotBoundaries = [];
    let run = [];

    const flushRun = () => {
        if (run.length === 0) return;
        const first = run[0];
        const last = run[run.length - 1];
        slotBoundaries.push({
            weekIndex: first.weekIndex,
            cycleWeek: first.cycleWeek,
            startDate: first.iso,
            endDate: last.iso,
            daysInSlot: run.length
        });
        run = [];
    };

    const anchor = normalizeCycleAnchorWeek(currentWeek);
    const cursor = new Date(rangeStartNoon.getTime());
    while (cursor.getTime() <= rangeEndNoon.getTime()) {
        const ctx = computeFourWeekCycleContext(isoStartNorm, cursor, anchor);
        const iso = formatISODate(cursor);

        const entry = { iso, weekIndex: ctx.weekIndex, cycleWeek: ctx.cycleWeek };
        if (run.length > 0 && run[run.length - 1].weekIndex !== ctx.weekIndex) {
            flushRun();
        }
        run.push(entry);

        if (!isLeaveDay(cursor, leaveDaysArray)) {
            const dk = weekdayToDayKey(getWeekday(cursor)) || 'sun';
            countsByCycleWeekAndDay[ctx.cycleWeek][dk] += 1;
        }

        cursor.setDate(cursor.getDate() + 1);
    }
    flushRun();

    return {
        rangeStart: String(startDate).trim(),
        rangeEnd: String(endDate).trim(),
        countsByCycleWeekAndDay,
        slotBoundaries,
        note: 'Slots use every calendar day (cycle advances on leave days too). Weekday counts exclude leave days only — matches expandRoutes visit days.'
    };
}

/**
 * expandRoutes twice + shallow route snapshot — confirms deterministic output and no route mutation.
 */
function verifyExpandRoutesDeterminism(routes, startDate, endDate, currentWeek, leaveDays, mode) {
    const routesSnapshot = JSON.stringify(
        (routes || []).map((r) => ({
            mode: r.mode,
            week: r.week,
            weeks: r.weeks,
            day: r.day,
            days: r.days,
            rowIndex: r.rowIndex,
            customer: r.customer
        }))
    );
    const leave = leaveDays || [];
    const a = expandRoutes(routes, startDate, endDate, currentWeek, leave, mode);
    const b = expandRoutes(routes, startDate, endDate, currentWeek, leave, mode);
    const routesAfter = JSON.stringify(
        (routes || []).map((r) => ({
            mode: r.mode,
            week: r.week,
            weeks: r.weeks,
            day: r.day,
            days: r.days,
            rowIndex: r.rowIndex,
            customer: r.customer
        }))
    );
    const keyVisit = (v) => `${v.date}|${v.rowIndex != null ? v.rowIndex : v.customer}|${v.fullAddress || ''}`;
    const sortVisits = (arr) => [...arr].sort((x, y) => keyVisit(x).localeCompare(keyVisit(y)));
    const identical = JSON.stringify(sortVisits(a)) === JSON.stringify(sortVisits(b));
    return {
        identical,
        firstRunCount: a.length,
        secondRunCount: b.length,
        routesUnchanged: routesSnapshot === routesAfter
    };
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
 * Checks if a date is in the leave/non-working days array.
 * Blocks route generation for that date.
 * leaveDays may be string[] (ISO dates) or { date, reason? } or { date, type, purpose? }[].
 * Both type "annual-leave" and "non-travel" (and legacy entries) block generation.
 */
function isLeaveDay(date, leaveDays) {
    if (!leaveDays || leaveDays.length === 0) {
        return false;
    }
    const dateStr = formatISODate(date);
    for (let i = 0; i < leaveDays.length; i++) {
        const item = leaveDays[i];
        const d = typeof item === 'string' ? item : (item && item.date);
        if (d === dateStr) return true;
    }
    return false;
}

/**
 * Returns the display string for a leave/non-working day row (Purpose column), or null if not in the list.
 * leaveDays may be string[] or { date, reason? } or { date, type, purpose? }[].
 * New format: type "annual-leave" / "non-travel" with purpose → display purpose (e.g. "Annual Leave", "Training").
 * Legacy: { date, reason } or { date } → display reason or "Leave Day".
 */
function getLeaveReason(dateStr, leaveDays) {
    if (!leaveDays || leaveDays.length === 0) return null;
    for (let i = 0; i < leaveDays.length; i++) {
        const item = leaveDays[i];
        if (typeof item === 'string') {
            if (item === dateStr) return 'Leave Day';
        } else if (item && item.date === dateStr) {
            const purpose = item.purpose != null ? String(item.purpose).trim() : '';
            const reason = item.reason != null ? String(item.reason).trim() : '';
            const type = item.type != null ? String(item.type).trim() : '';
            return purpose || reason || type || 'Leave Day';
        }
    }
    return null;
}

/**
 * Normalize frequency string for engine logic.
 * Returns "once-off" or "recurring". Used so the engine does not depend on exact template strings.
 */
function normalizeFrequency(value) {
    const v = (value || "")
        .toString()
        .toLowerCase()
        .trim()
        .replace(/\s+/g, "");

    if (v.includes("once") || v === "single") return "once-off";
    if (v.includes("recurring") || v.includes("weekly") || v.includes("monthly")) return "recurring";

    return "recurring";
}

/**
 * Returns true when frequency should be treated as a single occurrence (visit only on startDate).
 * Uses normalizeFrequency so "Once-Off", "Once Off", "onceoff", "once", "single" all behave as once-off.
 */
function isOnceOffFrequency(frequency) {
    return normalizeFrequency(frequency) === "once-off";
}

/**
 * Expand a single route over a date range using its weekday flags (per-route start/end/frequency).
 * Used when route has startDate (and optionally endDate, frequency).
 */
function expandRouteWithDateRange(route, rangeStart, rangeEnd, leaveDaysArray) {
    const visits = [];
    const start = new Date(rangeStart);
    const end = new Date(rangeEnd);
    if (isNaN(start.getTime()) || start > end) return visits;

    const fullAddress = route.fullAddress || buildFullAddress(route);
    const currentDate = new Date(start);

    while (currentDate <= end) {
        if (isLeaveDay(currentDate, leaveDaysArray)) {
            currentDate.setDate(currentDate.getDate() + 1);
            continue;
        }
        const weekday = getWeekday(currentDate);
        const dayKey = weekdayToDayKey(weekday);
        if (dayKey && dayMatchesRoute(route, dayKey)) {
            visits.push({
                date: formatISODate(currentDate),
                customer: route.customer,
                address: route.address,
                suburb: route.suburb,
                city: route.city || '',
                province: route.province || '',
                fullAddress: fullAddress,
                rowIndex: route.rowIndex != null ? route.rowIndex : 999999,
                lat: route.lat,
                lng: route.lng
            });
        }
        currentDate.setDate(currentDate.getDate() + 1);
    }
    return visits;
}

/**
 * DATE MODE: route has no per-row startDate — expand across tax global range, weekday only (no 4-week cycle).
 */
function expandDateModeGlobalRange(route, isoStart, isoEnd, leaveDaysArray, tripKeysSet) {
    const visits = [];
    const rangeStartNoon = new Date(isoStart + 'T12:00:00');
    const rangeEndNoon = new Date(isoEnd + 'T12:00:00');
    if (isNaN(rangeStartNoon.getTime()) || isNaN(rangeEndNoon.getTime())) return visits;

    const fullAddress = route.fullAddress || buildFullAddress(route);
    const cursor = new Date(rangeStartNoon.getTime());
    while (cursor.getTime() <= rangeEndNoon.getTime()) {
        if (isLeaveDay(cursor, leaveDaysArray)) {
            cursor.setDate(cursor.getDate() + 1);
            continue;
        }
        const dayKey = weekdayToDayKey(getWeekday(cursor));
        const dateStr = formatISODate(cursor);
        if (!dayKey || !dayMatchesRoute(route, dayKey)) {
            cursor.setDate(cursor.getDate() + 1);
            continue;
        }
        const rowId = route.rowIndex != null ? route.rowIndex : route.customer;
        if (!registerLegacyTripIfNew(dateStr, rowId, tripKeysSet)) {
            cursor.setDate(cursor.getDate() + 1);
            continue;
        }
        visits.push({
            date: dateStr,
            customer: route.customer,
            address: route.address,
            suburb: route.suburb,
            city: route.city || '',
            province: route.province || '',
            fullAddress: fullAddress,
            rowIndex: route.rowIndex != null ? route.rowIndex : 999999,
            lat: route.lat,
            lng: route.lng
        });
        cursor.setDate(cursor.getDate() + 1);
    }
    return visits;
}

/**
 * Pre-expansion validation by logbook template mode (salesRep vs business).
 * @param {Object} route
 * @param {string} mode - 'salesRep' | 'business'
 * @returns {boolean}
 */
function validateRoute(route, mode) {
    if (mode === 'salesRep') {
        var days = route.days || {};
        var hasDay = !!(days.mon || days.tue || days.wed || days.thu || days.fri || days.sat);

        if (!hasDay) return false;

        if (route.mode === 'cycle') {
            if (!Array.isArray(route.weeks) || route.weeks.length === 0) {
                return false;
            }
        }

        return true;
    }

    if (mode === 'business') {
        if (!route.startDate) {
            return false;
        }

        return true;
    }

    return false;
}

/**
 * Expands routes into actual calendar visit dates.
 * - DATE MODE (route.mode === "date"): per-route start/end (or global range if no startDate) + weekday; never 4-week cycle.
 * - CYCLE MODE (route.mode === "cycle"): global range + cycle week + weekday. No mode inference — routes without mode are skipped.
 * @param {string} [mode] - When 'business', same-day same-customer visits are preserved (no deduplication). When 'salesRep' or omitted, visits are deduplicated by date+customer.
 */
function expandRoutes(routes, startDate, endDate, currentWeek, leaveDays, mode) {
    if (!routes || routes.length === 0) {
        throw new Error('No routes provided');
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
    const dateRoutes = [];
    const businessDateRoutes = [];
    const cycleRoutes = [];
    let processedDateRoutes = 0;
    let processedCycleRoutes = 0;
    let skippedInvalidRoutes = 0;

    for (let ri = 0; ri < routes.length; ri++) {
        const route = routes[ri];
        const rmode = resolveRouteMode(route);
        if (rmode === null) {
            skippedInvalidRoutes += 1;
            if (typeof console !== 'undefined' && console.warn) {
                console.warn('MODE=invalid/skipped', 'Route missing explicit mode:', route);
            }
            continue;
        }
        if (rmode === 'date') {
            if (mode === 'business' && route.startDate) {
                businessDateRoutes.push(route);
                processedDateRoutes += 1;
                if (typeof console !== 'undefined' && console.log) {
                    console.log('AUDIT MODE=date-business', { row: route.rowIndex, customer: route.customer || route.location });
                }
                continue;
            }
            if (!dateModeRouteHasWeekdayInfo(route)) {
                skippedInvalidRoutes += 1;
                if (typeof console !== 'undefined' && console.warn) {
                    console.warn('MODE=invalid/skipped DATE route missing valid day/days:', route);
                }
                continue;
            }
            dateRoutes.push(route);
            processedDateRoutes += 1;
            if (typeof console !== 'undefined' && console.log) {
                console.log('AUDIT MODE=date', { row: route.rowIndex, customer: route.customer || route.location });
            }
            continue;
        }
        if (rmode === 'cycle') {
            if (!cycleRouteHasExplicitWeekInfo(route)) {
                skippedInvalidRoutes += 1;
                if (typeof console !== 'undefined' && console.warn) {
                    console.warn('MODE=invalid/skipped CYCLE route missing week/weeks:', route);
                }
                continue;
            }
            const allowedCycle = normalizeRouteCycleWeeks(route);
            if (!allowedCycle || allowedCycle.length === 0) {
                skippedInvalidRoutes += 1;
                if (typeof console !== 'undefined' && console.warn) {
                    console.warn('MODE=invalid/skipped CYCLE route has no valid cycle week numbers:', route);
                }
                continue;
            }
            if (!dateModeRouteHasWeekdayInfo(route)) {
                skippedInvalidRoutes += 1;
                if (typeof console !== 'undefined' && console.warn) {
                    console.warn('MODE=invalid/skipped CYCLE route missing valid day/days:', route);
                }
                continue;
            }
            cycleRoutes.push(route);
            processedCycleRoutes += 1;
            if (typeof console !== 'undefined' && console.log) {
                console.log('AUDIT MODE=cycle', { row: route.rowIndex, customer: route.customer || route.location, weeks: allowedCycle });
            }
        }
    }

    let cycleAnchorWeek = 1;
    if (cycleRoutes.length > 0) {
        const cw = Number(currentWeek);
        if (!Number.isInteger(cw) || cw < 1 || cw > 4) {
            throw new Error('currentWeek must be an integer from 1 to 4 when using cycle routes');
        }
        cycleAnchorWeek = cw;
    }

    if (typeof console !== 'undefined' && console.log) {
        console.log('ENGINE VALIDATION SUMMARY', {
            processedDateRoutes,
            processedCycleRoutes,
            skippedInvalidRoutes
        });
    }

    const rangeStartNoon = new Date(startDate + 'T12:00:00');
    const rangeEndNoon = new Date(endDate + 'T12:00:00');
    if (isNaN(rangeStartNoon.getTime()) || isNaN(rangeEndNoon.getTime())) {
        throw new Error('Invalid ISO date range for cycle route expansion');
    }

    for (let bi = 0; bi < businessDateRoutes.length; bi++) {
        const route = businessDateRoutes[bi];
        if (!route.startDate) {
            continue;
        }
        const fullAddress =
            route.fullAddress ||
            buildFullAddress(route) ||
            String(route.location || route.customer || '').trim();
        const purpose =
            route.purpose != null && String(route.purpose).trim() !== ''
                ? String(route.purpose).trim()
                : 'Business Visit';

        if (isOnceOffFrequency(route.frequency)) {
            const visitDay = new Date(String(route.startDate).trim() + 'T12:00:00');
            if (
                !isNaN(visitDay.getTime()) &&
                visitDay.getTime() >= rangeStartNoon.getTime() &&
                visitDay.getTime() <= rangeEndNoon.getTime() &&
                !isLeaveDay(visitDay, leaveDaysArray)
            ) {
                const visit = {
                    date: formatISODate(visitDay),
                    customer: route.customer,
                    address: route.address,
                    suburb: route.suburb,
                    city: route.city || '',
                    province: route.province || '',
                    fullAddress: fullAddress,
                    rowIndex: route.rowIndex != null ? route.rowIndex : 999999,
                    purpose: purpose
                };
                if (route.lat != null && route.lng != null) {
                    visit.lat = route.lat;
                    visit.lng = route.lng;
                }
                visits.push(visit);
            }
            continue;
        }

        let rangeEndStr;
        if (route.endDate) {
            rangeEndStr = route.endDate;
            if (new Date(rangeEndStr) < new Date(route.startDate)) {
                rangeEndStr = route.startDate;
            }
        } else {
            rangeEndStr = endDate;
            if (new Date(rangeEndStr) < new Date(route.startDate)) {
                rangeEndStr = route.startDate;
            }
        }
        const effEndMs = Math.min(
            new Date(String(rangeEndStr).trim() + 'T12:00:00').getTime(),
            rangeEndNoon.getTime()
        );
        const effEnd = new Date(effEndMs);
        if (isNaN(effEnd.getTime())) {
            continue;
        }

        let current = new Date(String(route.startDate).trim() + 'T12:00:00');
        if (isNaN(current.getTime())) {
            continue;
        }
        while (current.getTime() < rangeStartNoon.getTime()) {
            current.setDate(current.getDate() + 7);
        }
        while (current.getTime() <= effEnd.getTime()) {
            if (isLeaveDay(current, leaveDaysArray)) {
                current.setDate(current.getDate() + 7);
                continue;
            }
            const visit = {
                date: formatISODate(current),
                customer: route.customer,
                address: route.address,
                suburb: route.suburb,
                city: route.city || '',
                province: route.province || '',
                fullAddress: fullAddress,
                rowIndex: route.rowIndex != null ? route.rowIndex : 999999,
                purpose: purpose
            };
            if (route.lat != null && route.lng != null) {
                visit.lat = route.lat;
                visit.lng = route.lng;
            }
            visits.push(visit);
            current.setDate(current.getDate() + 7);
        }
    }

    const dateModeGlobalTripKeys = new Set();

    for (const route of dateRoutes) {
        if (route.startDate) {
            if (typeof console !== 'undefined' && console.log) {
                console.log('[FREQUENCY_CHECK]', route.customer || route.location, route.frequency, normalizeFrequency(route.frequency));
            }
            const rangeStart = route.startDate;
            let rangeEnd;
            if (isOnceOffFrequency(route.frequency)) {
                rangeEnd = rangeStart;
            } else if (route.endDate) {
                rangeEnd = route.endDate;
                if (new Date(rangeEnd) < new Date(rangeStart)) rangeEnd = rangeStart;
            } else {
                rangeEnd = endDate;
                if (new Date(rangeEnd) < new Date(rangeStart)) rangeEnd = rangeStart;
            }
            const routeVisits = expandRouteWithDateRange(route, rangeStart, rangeEnd, leaveDaysArray);
            visits.push(...routeVisits);
        } else {
            const globalVisits = expandDateModeGlobalRange(route, startDate, endDate, leaveDaysArray, dateModeGlobalTripKeys);
            visits.push(...globalVisits);
        }
    }

    // CYCLE MODE: global range + 4-week cycle. Per date: dayMatchesRoute AND normalizeRouteCycleWeeks(route).includes(cycleWeek).
    const isoStartNorm = normalizeISOStartDateForCycle(startDate);

    if (typeof console !== 'undefined' && console.log && cycleRoutes.length > 0) {
        const approxWeeks = countApproxCalendarWeeksInclusive(startDate, endDate);
        console.log('AUDIT: 4-week cycle expansion MODE=cycle', {
            rangeISO: { start: startDate, end: endDate },
            approxWeeksInRange: approxWeeks,
            cycleRouteRows: cycleRoutes.length,
            cycleAnchorWeek,
            weekIndexFormula: 'weekIndex = floor(daysSinceRangeStart / 7); cycleWeek = ((weekIndex + (cycleAnchorWeek - 1)) % 4) + 1',
            filters: 'dayMatchesRoute && normalizeRouteCycleWeeks(route).includes(cycleWeek); dedupe registerLegacyTripIfNew(date, rowId)'
        });
        console.log('ANCHOR-BASED CYCLE ENABLED (ClearTrack mode)');
    }

    const cycleTripKeys = new Set();
    const cursor = new Date(rangeStartNoon.getTime());
    while (cursor.getTime() <= rangeEndNoon.getTime()) {
        const cycleWeek = getFourWeekCycleWeek(isoStartNorm, cursor, cycleAnchorWeek);
        const weekday = getWeekday(cursor);
        const dayKey = weekdayToDayKey(weekday);
        const dateStr = formatISODate(cursor);

        if (isLeaveDay(cursor, leaveDaysArray)) {
            cursor.setDate(cursor.getDate() + 1);
            continue;
        }

        for (const route of cycleRoutes) {
            if (
                !dayKey ||
                !dayMatchesRoute(route, dayKey) ||
                !normalizeRouteCycleWeeks(route).includes(cycleWeek)
            ) {
                continue;
            }

            const rowId = route.rowIndex != null ? route.rowIndex : route.customer;
            if (!registerLegacyTripIfNew(dateStr, rowId, cycleTripKeys)) {
                continue;
            }

            const fullAddress = route.fullAddress || buildFullAddress(route);
            visits.push({
                date: dateStr,
                customer: route.customer,
                address: route.address,
                suburb: route.suburb,
                city: route.city || '',
                province: route.province || '',
                fullAddress: fullAddress,
                rowIndex: route.rowIndex != null ? route.rowIndex : 999999,
                lat: route.lat,
                lng: route.lng
            });
        }

        cursor.setDate(cursor.getDate() + 1);
    }

    console.log('VISIT SAMPLE:', visits.slice(0, 2));

    visits.sort((a, b) => {
        if (a.date < b.date) return -1;
        if (a.date > b.date) return 1;
        return 0;
    });

    // Business mode: preserve all visits (same-day same-customer can be multiple valid visits). SalesRep/other: deduplicate by date+customer.
    if (mode === 'business') {
        if (visits.length === 0) {
            throw new Error('No visits generated for provided routes and date range.');
        }
        logRouteRepetitionAudit(visits, 'expanded-business', startDate, endDate, null);
        return visits;
    }

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

    logRouteRepetitionAudit(uniqueVisits, 'expanded-deduped', startDate, endDate, null);
    return uniqueVisits;
}

/**
 * Generates SARS-compliant logbook entries from visits and distances
 */
function generateLogbookEntries(visits, vehicleOpeningKm, homeAddress, startDate, endDate, routes, manualEntries, workSaturdays, leaveDays, input) {
    if (!Array.isArray(visits)) {
        if (typeof console !== 'undefined' && console.warn) {
            console.warn('[generateLogbookEntries] visits not an array; using empty');
        }
        visits = [];
    }

    if (typeof vehicleOpeningKm !== 'number' || vehicleOpeningKm < 0 || isNaN(vehicleOpeningKm)) {
        if (typeof console !== 'undefined' && console.warn) {
            console.warn('[generateLogbookEntries] invalid vehicleOpeningKm; using 0');
        }
        vehicleOpeningKm = 0;
    }

    if (!homeAddress || typeof homeAddress !== 'string') {
        if (typeof console !== 'undefined' && console.warn) {
            console.warn('[generateLogbookEntries] homeAddress missing; using empty string');
        }
        homeAddress = '';
    }

    const homeLat = input && typeof input.homeLat === 'number' && !isNaN(input.homeLat) ? input.homeLat : NaN;
    const homeLng = input && typeof input.homeLng === 'number' && !isNaN(input.homeLng) ? input.homeLng : NaN;
    const homeProvince = input && input.homeProvince != null ? String(input.homeProvince).trim() : '';

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

    let generatedDays = [];

    // Generate entries for all dates in range
    if (typeof console !== 'undefined' && console.log) {
        console.log('[GENERATE_LOGBOOK_ENTRIES_BRANCH]', {
            startDate: startDate,
            endDate: endDate,
            branch: startDate && endDate ? 'main_date_range' : 'fallback_visits_only'
        });
    }
    if (startDate && endDate) {
        const start = new Date(String(startDate).trim() + 'T12:00:00');
        const end = new Date(String(endDate).trim() + 'T12:00:00');
        let currentDate = new Date(start.getTime());

        while (currentDate <= end) {
            const dateStr = formatISODate(currentDate);
            const dayOfWeek = currentDate.getDay();

            const leaveReason = getLeaveReason(dateStr, leaveDays);
            const isLeave = Boolean(leaveReason);
            const year = currentDate.getFullYear();
            const holidayMap = getHolidayMapForYear(year);
            const holidayName = holidayMap[dateStr];
            const isHoliday = Boolean(holidayName);

            if (DEBUG_HOLIDAYS && isHoliday && typeof console !== 'undefined' && console.log) {
              console.log('[DEBUG_HOLIDAYS] matched holiday ' + dateStr + ' = ' + holidayName);
            }

            if (isLeave) {
                generatedDays.push({
                    date: dateStr,
                    day: currentDate.toLocaleDateString('en-ZA', { weekday: 'short' }),
                    openingKm: null,
                    closingKm: null,
                    distanceKm: 0,
                    businessKm: 0,
                    privateKm: 0,
                    purpose: leaveReason,
                    from: '',
                    to: ''
                });
                currentDate.setDate(currentDate.getDate() + 1);
                continue;
            }
            if (isHoliday) {
                generatedDays.push({
                    date: dateStr,
                    day: currentDate.toLocaleDateString('en-ZA', { weekday: 'short' }),
                    openingKm: null,
                    closingKm: null,
                    distanceKm: 0,
                    businessKm: 0,
                    privateKm: 0,
                    purpose: `Public Holiday (${holidayName})`,
                    from: '',
                    to: ''
                });
                currentDate.setDate(currentDate.getDate() + 1);
                continue;
            }
            if (!isWorkDay(currentDate)) {
                generatedDays.push({
                    date: dateStr,
                    day: currentDate.toLocaleDateString('en-ZA', { weekday: 'short' }),
                    openingKm: null,
                    closingKm: null,
                    distanceKm: 0,
                    businessKm: 0,
                    privateKm: 0,
                    purpose: 'Weekend',
                    from: '',
                    to: ''
                });
                currentDate.setDate(currentDate.getDate() + 1);
                continue;
            }
            if (visitsByDate.has(dateStr)) {
                // Generate trips for work days with visits
                const dayVisits = visitsByDate.get(dateStr);
                dayVisits.sort((a, b) => {
                    const aIndex = a.rowIndex || 999999;
                    const bIndex = b.rowIndex || 999999;
                    return aIndex - bIndex;
                });

                if (dayVisits.length > 0) {
                    const day = currentDate.toLocaleDateString('en-ZA', { weekday: 'short' });

                    // Trip 1: Home → First Visit (haversine)
                    const firstVisit = dayVisits[0];
                    const firstVisitAddress = firstVisit.fullAddress || buildFullAddress(firstVisit);

                    assertValidCoords({ lat: homeLat, lng: homeLng, customer: homeAddress });
                    assertValidCoords(firstVisit);

                    const homeToFirstDistance = logbookTripKmHaversine(
                        homeLat,
                        homeLng,
                        firstVisit.lat,
                        firstVisit.lng,
                        homeAddress,
                        firstVisitAddress
                    );

                    const segmentKm = homeToFirstDistance;

                    const firstPurpose =
    (input && input.mode === 'business')
        ? (firstVisit.purpose || 'Business Travel')
        : 'Sales Visit';
                    
                    generatedDays.push({
                        date: dateStr,
                        day,
                        shopName: firstVisit.customer || '',
                        openingKm: null,
                        closingKm: null,
                        distanceKm: segmentKm,
                        businessKm: segmentKm,
                        privateKm: 0,
                        purpose: firstPurpose,
                        from: homeAddress,
                        to: firstVisitAddress,
                        fromProvince: homeProvince,
                        toProvince: String(firstVisit.province || '').trim()
                    });

                    // Trips 2 to N: Visit(i) → Visit(i+1) (haversine)
                    for (let i = 0; i < dayVisits.length - 1; i++) {
                        const fromVisit = dayVisits[i];
                        const toVisit = dayVisits[i + 1];
                        const fromAddress = fromVisit.fullAddress || buildFullAddress(fromVisit);
                        const toAddress = toVisit.fullAddress || buildFullAddress(toVisit);

                        assertValidCoords(fromVisit);
                        assertValidCoords(toVisit);

                        const tripDistance = logbookTripKmHaversine(
                            fromVisit.lat,
                            fromVisit.lng,
                            toVisit.lat,
                            toVisit.lng,
                            fromAddress,
                            toAddress
                        );

                        const tripSegmentKm = tripDistance;

                        const visitPurpose =
    (input && input.mode === 'business')
        ? (toVisit.purpose || 'Business Travel')
        : `${toVisit.reason || 'Sales Visit'} – ${toVisit.customer || ''}`;
                        
                        generatedDays.push({
                            date: dateStr,
                            day,
                            shopName: toVisit.customer || '',
                            openingKm: null,
                            closingKm: null,
                            distanceKm: tripSegmentKm,
                            businessKm: tripSegmentKm,
                            privateKm: 0,
                            purpose: visitPurpose,
                            from: fromAddress,
                            to: toAddress,
                            fromProvince: String(fromVisit.province || '').trim(),
                            toProvince: String(toVisit.province || '').trim()
                        });
                    }

                    // Final trip: Last Visit → Home (haversine)
                    const lastVisit = dayVisits[dayVisits.length - 1];
                    const lastVisitAddress = lastVisit.fullAddress || buildFullAddress(lastVisit);

                    assertValidCoords(lastVisit);
                    assertValidCoords({ lat: homeLat, lng: homeLng, customer: homeAddress });

                    const lastToHomeDistance = logbookTripKmHaversine(
                        lastVisit.lat,
                        lastVisit.lng,
                        homeLat,
                        homeLng,
                        lastVisitAddress,
                        homeAddress
                    );

                    const returnSegmentKm = lastToHomeDistance;

                    const returnPurpose = 'Return Home';
                    
                    generatedDays.push({
                        date: dateStr,
                        day,
                        shopName: lastVisit.customer || '',
                        openingKm: null,
                        closingKm: null,
                        distanceKm: returnSegmentKm,
                        businessKm: returnSegmentKm,
                        privateKm: 0,
                        purpose: returnPurpose,
                        from: lastVisitAddress,
                        to: homeAddress,
                        fromProvince: String(lastVisit.province || '').trim(),
                        toProvince: homeProvince
                    });
                }
            }

            currentDate.setDate(currentDate.getDate() + 1);
        }
    } else {
        // Fallback to original logic if no date range provided
        const logbook = [];

        for (const [date, dayVisits] of visitsByDate.entries()) {
            dayVisits.sort((a, b) => {
                const aIndex = a.rowIndex || 999999;
                const bIndex = b.rowIndex || 999999;
                return aIndex - bIndex;
            });

            if (dayVisits.length === 0) {
                continue;
            }

            const dateObj = new Date(String(date).trim() + 'T12:00:00');
            const day = dateObj.toLocaleDateString('en-ZA', { weekday: 'short' });

            const firstVisit = dayVisits[0];
            const firstVisitAddress = firstVisit.fullAddress || buildFullAddress(firstVisit);

            assertValidCoords({ lat: homeLat, lng: homeLng, customer: homeAddress });
            assertValidCoords(firstVisit);

            const homeToFirstDistance = logbookTripKmHaversine(
                homeLat,
                homeLng,
                firstVisit.lat,
                firstVisit.lng,
                homeAddress,
                firstVisitAddress
            );

            const segmentKm = homeToFirstDistance;

            const firstPurpose =
    (input && input.mode === 'business')
        ? (firstVisit.purpose || 'Business Travel')
        : 'Sales Visit';
            
            logbook.push({
                date,
                day,
                shopName: firstVisit.customer || '',
                openingKm: null,
                closingKm: null,
                distanceKm: segmentKm,
                businessKm: segmentKm,
                privateKm: 0,
                purpose: firstPurpose,
                from: homeAddress,
                to: firstVisitAddress,
                fromProvince: homeProvince,
                toProvince: String(firstVisit.province || '').trim()
            });

            for (let i = 0; i < dayVisits.length - 1; i++) {
                const fromVisit = dayVisits[i];
                const toVisit = dayVisits[i + 1];
                const fromAddress = fromVisit.fullAddress || buildFullAddress(fromVisit);
                const toAddress = toVisit.fullAddress || buildFullAddress(toVisit);

                assertValidCoords(fromVisit);
                assertValidCoords(toVisit);

                const tripDistance = logbookTripKmHaversine(
                    fromVisit.lat,
                    fromVisit.lng,
                    toVisit.lat,
                    toVisit.lng,
                    fromAddress,
                    toAddress
                );

                const tripSegmentKm = tripDistance;

                const visitPurpose =
    (input && input.mode === 'business')
        ? (toVisit.purpose || 'Business Travel')
        : `${toVisit.reason || 'Sales Visit'} – ${toVisit.customer || ''}`;
                
                logbook.push({
                    date,
                    day,
                    shopName: toVisit.customer || '',
                    openingKm: null,
                    closingKm: null,
                    distanceKm: tripSegmentKm,
                    businessKm: tripSegmentKm,
                    privateKm: 0,
                    purpose: visitPurpose,
                    from: fromAddress,
                    to: toAddress,
                    fromProvince: String(fromVisit.province || '').trim(),
                    toProvince: String(toVisit.province || '').trim()
                });
            }

            const lastVisit = dayVisits[dayVisits.length - 1];
            const lastVisitAddress = lastVisit.fullAddress || buildFullAddress(lastVisit);

            assertValidCoords(lastVisit);
            assertValidCoords({ lat: homeLat, lng: homeLng, customer: homeAddress });

            const lastToHomeDistance = logbookTripKmHaversine(
                lastVisit.lat,
                lastVisit.lng,
                homeLat,
                homeLng,
                lastVisitAddress,
                homeAddress
            );

            const returnSegmentKm = lastToHomeDistance;

            const returnPurpose = 'Return Home';
            
            logbook.push({
                date,
                day,
                shopName: lastVisit.customer || '',
                openingKm: null,
                closingKm: null,
                distanceKm: returnSegmentKm,
                businessKm: returnSegmentKm,
                privateKm: 0,
                purpose: returnPurpose,
                from: lastVisitAddress,
                to: homeAddress,
                fromProvince: String(lastVisit.province || '').trim(),
                toProvince: homeProvince
            });
        }

        generatedDays.push(...logbook);
    }

    // Manual trips: merge with generated trips.
    // - If manual.allDay === true: remove all entries for that date and replace with the manual entry (overwrite day).
    // - Otherwise (default): append the manual entry to that date; existing entries for the day remain. Use time '23:59' so manual sorts at end of day.
    // businessKm from haversine on manual.fromLat/fromLng/toLat/toLng when present; else manual.businessKm/manual.km.
    if (manualEntries && Array.isArray(manualEntries) && manualEntries.length > 0) {
        manualEntries.forEach(manual => {
            const manualDateStr = typeof manual.date === 'string' ? manual.date : formatISODate(new Date(manual.date));
            const fromAddr = manual.from != null ? String(manual.from).trim() : '';
            const toAddr = manual.to != null ? String(manual.to).trim() : '';
            let businessKm;
            if (
                manual.fromLat != null && manual.fromLng != null && manual.toLat != null && manual.toLng != null &&
                typeof manual.fromLat === 'number' && typeof manual.fromLng === 'number' &&
                typeof manual.toLat === 'number' && typeof manual.toLng === 'number' &&
                !isNaN(manual.fromLat) && !isNaN(manual.fromLng) && !isNaN(manual.toLat) && !isNaN(manual.toLng)
            ) {
                assertValidCoords({ lat: manual.fromLat, lng: manual.fromLng, customer: fromAddr });
                assertValidCoords({ lat: manual.toLat, lng: manual.toLng, customer: toAddr });

                businessKm = logbookTripKmHaversine(
                    manual.fromLat,
                    manual.fromLng,
                    manual.toLat,
                    manual.toLng,
                    fromAddr,
                    toAddr
                );
            } else {
                businessKm = Number(manual.businessKm) != null && manual.businessKm !== '' ? Number(manual.businessKm) : (Number(manual.km) || 0);
            }
            const privateKm = Number(manual.privateKm) || 0;
            const allDay = manual.allDay === true;
            const manualEntry = {
                date: manualDateStr,
                day: manual.day || (() => { const d = new Date(manualDateStr + 'T12:00:00'); return isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-ZA', { weekday: 'short' }); })(),
                openingKm: manual.openingKm,
                closingKm: manual.closingKm,
                distanceKm: businessKm,
                businessKm,
                privateKm,
                purpose: manual.purpose || 'Manual Trip',
                from: manual.from != null ? String(manual.from) : '',
                to: manual.to != null ? String(manual.to) : '',
                fromProvince: manual.fromProvince != null ? String(manual.fromProvince).trim() : '',
                toProvince: manual.toProvince != null ? String(manual.toProvince).trim() : '',
                type: 'manual'
            };
            if (allDay) {
                generatedDays = generatedDays.filter(d => d.date !== manualDateStr);
            } else {
                manualEntry.time = '23:59';
            }
            generatedDays.push(manualEntry);
        });
        generatedDays.sort((a, b) => {
            if (a.date < b.date) return -1;
            if (a.date > b.date) return 1;
            const aTime = (a.time != null ? String(a.time) : '');
            const bTime = (b.time != null ? String(b.time) : '');
            if (aTime !== bTime) return aTime < bTime ? -1 : 1;
            return 0;
        });
    }

    return generatedDays;
}

/**
 * Main logbook engine function
 * 
 * @param {Object} input - Engine input parameters
 * @param {Array} input.routes - Route objects must set mode: "date" | "cycle" (plus weekday; cycle also needs week/weeks).
 * @param {string} input.startDate - Start date in YYYY-MM-DD format
 * @param {string} input.endDate - End date in YYYY-MM-DD format
 * @param {string} input.homeAddress - Home/base address
 * @param {number} input.openingKm - Starting odometer reading
 * @param {number} [input.currentWeek] - Required when any route uses cycle mode: real cycle week (1–4) on startDate (ClearTrack anchor)
 * @param {string[]} [input.leaveDays] - Optional array of ISO date strings to exclude
 * @param {Object} [input.routingService] - Optional; retained for API compatibility (unused; distances use haversine).
 * @param {number} [input.homeLat] - Home latitude (required)
 * @param {number} [input.homeLng] - Home longitude (required)
 * @param {string} [input.homeProvince] - Home province (optional; used for trip province-mismatch review flags)
 * @param {number} [input.closingKm] - Optional closing odometer reading. If provided, private mileage will be calculated as (closingKm - openingKm) - totalBusinessKm
 * @returns {Promise<Object>} Logbook result with entries, totals, and meta
 */
async function runLogbookEngine(input, adapterRoutesSnapshot) {
    console.log("🚨 ENGINE ENTRY ROUTES:", JSON.stringify(input.routes, null, 2));
    if (
        adapterRoutesSnapshot !== undefined &&
        JSON.stringify(input.routes) !== adapterRoutesSnapshot
    ) {
        throw new Error("PIPELINE MUTATION DETECTED");
    }

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
        employerName,
        homeLat: homeLatIn,
        homeLng: homeLngIn
    } = input;

    console.log('BACKEND ROUTES:', (input.routes || []).slice(0, 2));

    let homeLat = homeLatIn;
    let homeLng = homeLngIn;

    const usePrecomputedVisits = input.visits && Array.isArray(input.visits) && input.visits.length > 0;

    /** Validated route rows (empty when using precomputed visits). */
    let validRoutes = [];

    if (!usePrecomputedVisits && (!routes || !Array.isArray(routes) || routes.length === 0)) {
        throw new Error('routes is required and must be a non-empty array (or provide precomputed input.visits for Workflow 2)');
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

    // Step 1: Expand routes into visits (or use precomputed visits from Workflow 2)
    let visits;
    let routesForWorkDays = routes || [];
    if (usePrecomputedVisits) {
        visits = input.visits;
        const dayMap = { 0: 'sun', 1: 'mon', 2: 'tue', 3: 'wed', 4: 'thu', 5: 'fri', 6: 'sat' };
        const enabledDays = new Set();
        visits.forEach(v => {
            if (v.date) {
                const d = new Date(v.date + 'T12:00:00');
                if (!isNaN(d.getTime())) enabledDays.add(d.getDay());
            }
        });
        const days = { mon: false, tue: false, wed: false, thu: false, fri: false, sat: false, sun: false };
        enabledDays.forEach(dayNum => {
            const key = dayMap[dayNum];
            if (key) days[key] = true;
        });
        if (input.workSaturdays && !days.sat) days.sat = true;
        // Date-mode synthetic row for downstream entry generation; weeks unused (no cycle expansion).
        routesForWorkDays = [{ mode: 'date', days: days, weeks: [] }];
    } else {
        validRoutes = routes.filter(function (r) {
            return validateRoute(r, 'salesRep');
        });
        if (validRoutes.length === 0) {
            throw new Error('No valid routes after validation (all routes were skipped as invalid)');
        }
        const mode = input.mode || null;
        visits = expandRoutes(validRoutes, startDate, endDate, currentWeek, leaveDays || [], mode);
        routesForWorkDays = validRoutes;
    }

    const hasCycleRoutes =
        !usePrecomputedVisits &&
        validRoutes.some(r => (r.mode || '').toLowerCase().trim() === 'cycle');

    const visitDateSetForLog = new Set(visits.map(v => v.date));
    const rangeAnchor = new Date(startDate + 'T12:00:00');
    const rangeEndD = new Date(endDate + 'T12:00:00');
    const leaveDaysArrForLog = leaveDays || [];
    const routesCountForLog = !usePrecomputedVisits && Array.isArray(validRoutes) ? validRoutes.length : 0;
    if (!usePrecomputedVisits) {
        for (let cur = new Date(rangeAnchor.getTime()); cur.getTime() <= rangeEndD.getTime(); cur.setDate(cur.getDate() + 1)) {
            const ds = formatISODate(cur);
            const dk = weekdayToDayKey(cur.getDay());
            if (hasCycleRoutes) {
                const ctxLog = computeFourWeekCycleContext(startDate, cur, currentWeek);
                if (typeof console !== 'undefined' && console.log) {
                    console.log('[DAY_CONTEXT]', {
                        date: ds,
                        dayKey: dk,
                        weekIndex: ctxLog.weekIndex,
                        cycleWeek: ctxLog.cycleWeek,
                        hasRoutes: routesCountForLog > 0
                    });
                }
            }
            if (isLeaveDay(cur, leaveDaysArrForLog)) {
                if (typeof console !== 'undefined' && console.warn) {
                    console.warn('[ROUTING] Skipped – leave day', { date: ds });
                }
                continue;
            }
            if (!dk) {
                if (typeof console !== 'undefined' && console.warn) {
                    console.warn('[ROUTING] Skipped – no business route for this day', { date: ds });
                }
                continue;
            }
            if (!visitDateSetForLog.has(ds)) {
                if (typeof console !== 'undefined' && console.warn) {
                    console.warn('[ROUTING] Skipped – no trips generated', { date: ds });
                }
            }
        }
    } else {
        const seenLogDates = new Set();
        for (const v of visits) {
            if (!v || !v.date || seenLogDates.has(v.date)) continue;
            seenLogDates.add(v.date);
            const c = new Date(v.date + 'T12:00:00');
            const dk = weekdayToDayKey(c.getDay());
            if (typeof console !== 'undefined' && console.log) {
                console.log('[DAY_CONTEXT]', { date: v.date, dayKey: dk, weekCycle: null, hasRoutes: (routesForWorkDays && routesForWorkDays.length) > 0 });
            }
        }
    }

    input.homeLat = homeLat;
    input.homeLng = homeLng;

    if (homeLat == null || homeLng == null || typeof homeLat !== 'number' || typeof homeLng !== 'number' || isNaN(homeLat) || isNaN(homeLng)) {
        if (typeof console !== 'undefined' && console.warn) {
            console.warn('[runLogbookEngine] homeLat/homeLng missing or invalid; distance segments may be 0');
        }
    }

    input.homeLat = homeLat;
    input.homeLng = homeLng;

    console.log('ENGINE VISITS SAMPLE:', visits.slice(0, 3));

    for (let vi = 0; vi < visits.length; vi++) {
        const visit = visits[vi];
        if (!Number.isFinite(visit.lat) || !Number.isFinite(visit.lng)) {
            if (typeof console !== 'undefined' && console.warn) {
                console.warn('[runLogbookEngine] visit missing coordinates:', visit && visit.customer, visit);
            }
        }
    }

    const manualEntries = input.manualEntries || null;

    // Step 5: Generate logbook entries
    const workSaturdays = input.workSaturdays || false;
    const entries = generateLogbookEntries(visits, openingKm, homeAddress, input.startDate, input.endDate, routesForWorkDays, manualEntries, workSaturdays, leaveDays, input);

    const forcedClosing = Number(closingKm);

    for (let i = 0; i < entries.length; i++) {
        entries[i].openingKm = Number(openingKm);

        entries[i].closingKm = Number.isFinite(forcedClosing)
            ? forcedClosing
            : Number(openingKm);
    }

    // ===============================
    // SINGLE SOURCE TOTALS AUTHORITY
    // ===============================

    const warnings = [];

    const hasClosingKm =
        closingKm !== undefined &&
        closingKm !== null &&
        closingKm !== '';

    const totalTravelKm = entries.reduce(function (sum, entry) {
        return sum + (Number(entry && entry.businessKm) || 0);
    }, 0);

    const totalBusinessKm = totalTravelKm;

    const userTravelKm = (Number(closingKm) || 0) - (Number(openingKm) || 0);

    let totalPrivateKm;
    let businessUsePercentage;

    if (hasClosingKm) {
        totalPrivateKm = userTravelKm - totalTravelKm;
        businessUsePercentage =
            userTravelKm !== 0 && Number.isFinite(userTravelKm)
                ? (totalBusinessKm / userTravelKm) * 100
                : 0;
    } else {
        totalPrivateKm = 0;
        businessUsePercentage = 100;
    }

    if (typeof console !== 'undefined' && console.log) {
        console.log('AUDIT: generation km summary (current run — compare two engine versions for original vs new km delta)', {
            totalBusinessKm,
            visitCount: visits.length,
            entryRowCount: entries.length,
            engineVersion: ENGINE_VERSION
        });
    }

    const formattedEntries = entries.map((entry) => {
        const formattedEntry = {
            ...entry,
            openingKm: (entry.openingKm === null || entry.openingKm === undefined) ? '' : entry.openingKm,
            closingKm: (entry.closingKm === null || entry.closingKm === undefined) ? '' : entry.closingKm,
            businessKm: round2(entry.businessKm)
        };
        if (Object.prototype.hasOwnProperty.call(formattedEntry, 'distanceKm')) {
            delete formattedEntry.distanceKm;
        }
        return formattedEntry;
    });

    applySarsTripValidationFlags(formattedEntries);
    const reviewRequired = formattedEntries.some((e) => e && e.flag);
    const status = reviewRequired ? 'REVIEW REQUIRED' : 'OK';

    if (!usePrecomputedVisits && Array.isArray(routes)) {
        const dateRoutes = validRoutes.filter(r => (r.mode || '').toLowerCase().trim() === 'date');
        const cycleRoutes = validRoutes.filter(r => (r.mode || '').toLowerCase().trim() === 'cycle');
        if (typeof console !== 'undefined' && console.log) {
            console.log('ENGINE VALIDATION SUMMARY', {
                totalRoutes: routes.length,
                validRoutes: validRoutes.length,
                skippedRoutes: routes.length - validRoutes.length,
                dateRoutes: dateRoutes.length,
                cycleRoutes: cycleRoutes.length
            });
        }
    }

    return {
        entries: formattedEntries,
        meta: {
            startDate,
            endDate,
            employerName: employerName || null,
            generatedAt: new Date().toISOString(),
            closingKm: hasClosingKm ? closingKm : null,
            warnings,
            reviewRequired,
            status,
            totals: {
                totalKm: totalTravelKm,
                totalBusinessKm,
                totalPrivateKm,
                businessUsePercentage
            },
            ...(input.vehicle && typeof input.vehicle === 'object' ? { vehicle: input.vehicle } : {})
        },
        engineVersion: ENGINE_VERSION
    };
}

// Browser global (for script tag)
if (typeof window !== 'undefined') {
    window.logbookEngine = {
        runLogbookEngine: runLogbookEngine,
        runCycleAudit: runCycleAudit,
        auditCycleFormula: auditCycleFormula,
        auditAnchoredCycle: auditAnchoredCycle,
        testControlRoutes: testControlRoutes,
        auditCycleWeekDistribution: auditCycleWeekDistribution,
        verifyExpandRoutesDeterminism: verifyExpandRoutesDeterminism,
        ENGINE_VERSION: ENGINE_VERSION
    };
    if (typeof console !== 'undefined' && console.log) {
        console.log(
            'AUDIT READY: logbookEngine.auditCycleFormula(start, cw) | .auditAnchoredCycle(start,end,routes,cw) | .testControlRoutes(cw) — e.g. window.currentRoutes'
        );
    }
}
// Node (for server)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        runLogbookEngine: runLogbookEngine,
        runCycleAudit: runCycleAudit,
        auditCycleFormula: auditCycleFormula,
        auditAnchoredCycle: auditAnchoredCycle,
        testControlRoutes: testControlRoutes,
        auditCycleWeekDistribution: auditCycleWeekDistribution,
        verifyExpandRoutesDeterminism: verifyExpandRoutesDeterminism,
        ENGINE_VERSION: ENGINE_VERSION
    };
}

