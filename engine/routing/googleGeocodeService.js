/**
 * Address resolution for route rows (browser).
 * Street geocoding: POST /api/geocodeAddresses (backend only). Else: Find Place → Text Search → Place Details via same-origin /api/* proxies (no keys in browser).
 * In-memory cache.
 */
(function (global) {
  'use strict';

  var geocodeCache = new Map();
  var coordinateCache = new Map();
  /** In-memory cache by normalized address (address|suburb|city) so duplicate addresses are geocoded only once. */
  var addressCache = new Map();
  /** Dev mode: when true, no backend geocode/place calls; return mock coordinates to avoid cost during development. */
  function isDevMode() {
    var g = typeof global !== 'undefined' ? global : (typeof window !== 'undefined' ? window : this);
    return g.GEOCODE_DEV_MODE === true;
  }
  var MOCK_COORDS = { lat: -33.9249, lng: 18.4241, address: null, suburb: null, city: null, province: null };
  var FIND_PLACE_URL = '/api/findPlace';
  var TEXT_SEARCH_URL = '/api/textSearch';
  var PLACE_DETAILS_URL = '/api/placeDetails';

  /**
   * Parse address_components (Geocoding or Place Details) into { address, suburb, city, province }.
   * street_number + route → address; sublocality_level_1 OR sublocality OR neighborhood → suburb; locality → city; administrative_area_level_1 → province.
   * Fallbacks: suburb from administrative_area_level_2 or formatted_address (2nd segment); city from formatted_address (2nd segment) when locality missing; address from formatted_address (1st) or place.name.
   * @param {Array} components - address_components from API
   * @param {{ formatted_address?: string, name?: string }} options - optional
   */
  function parseAddressComponents(components, options) {
    var streetNumber = '';
    var route = '';
    var suburb = null;
    var city = null;
    var province = null;
    var adminLevel2 = null;
    if (components && components.length > 0) {
      for (var i = 0; i < components.length; i++) {
        var c = components[i];
        var types = c.types || [];
        var name = c.long_name || '';
        if (types.indexOf('street_number') !== -1) streetNumber = name;
        if (types.indexOf('route') !== -1) route = name;
        if (types.indexOf('sublocality_level_1') !== -1 || types.indexOf('sublocality') !== -1) { if (!suburb) suburb = name; }
        if (types.indexOf('neighborhood') !== -1 && !suburb) suburb = name;
        if (types.indexOf('administrative_area_level_2') !== -1) adminLevel2 = name;
        if (types.indexOf('locality') !== -1) city = name;
        if (types.indexOf('administrative_area_level_1') !== -1) province = name;
      }
    }
    if (!suburb && adminLevel2) suburb = adminLevel2;
    var parts = options && options.formatted_address ? (options.formatted_address || '').toString().split(',').map(function (p) { return p ? p.trim() : ''; }) : [];
    var address = (streetNumber + ' ' + route).trim() || null;
    if (!address && parts[0]) address = parts[0];
    if (!address && options && options.name) {
      var nameStr = (options.name || '').toString().trim();
      if (nameStr) address = nameStr;
    }
    if (!suburb && parts[1]) suburb = parts[1];
    if (!city && parts[1]) city = parts[1];
    return { address: address || null, suburb: suburb || null, city: city || null, province: province || null };
  }

  /**
   * Return true if the string looks like a real street address (e.g. number + street word).
   * Return false for business names, short strings, or values without numbers.
   */
  function looksLikeStreetAddress(str) {
    var s = (str || '').toString().trim();
    if (!s || s.length < 3) return false;
    if (!/\d/.test(s)) return false;
    return /\d+\s+\w+/.test(s);
  }

  /**
   * Geocode one address string via backend POST /api/geocodeAddresses only (no Nominatim, no /api/geocode).
   * Uses cache key "addr:" + query. Returns Promise<{ address, suburb, city, province, lat, lng }>.
   * apiKey unused; server uses GOOGLE_API_KEY.
   */
  function geocodeOne(query, apiKey) {
    var key = 'addr:' + (query || '').toString().trim().toLowerCase();
    var empty = { address: null, suburb: null, city: null, province: null, lat: null, lng: null };
    if (!key || key === 'addr:') return Promise.resolve(empty);
    if (geocodeCache.has(key)) {
      return Promise.resolve(geocodeCache.get(key));
    }
    if (isDevMode()) {
      geocodeCache.set(key, MOCK_COORDS);
      return Promise.resolve(MOCK_COORDS);
    }

    var trimmed = (query || '').toString().trim();
    return fetch('/api/geocodeAddresses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ addresses: [trimmed] })
    })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (data && data.error) {
          console.warn('[Geocoding] API error:', data.error);
          geocodeCache.set(key, empty);
          return empty;
        }
        if (!Array.isArray(data) || data.length === 0) {
          geocodeCache.set(key, empty);
          return empty;
        }
        var row = data[0];
        if (!row || row.lat == null || row.lng == null || row.resolved === false) {
          geocodeCache.set(key, empty);
          return empty;
        }
        var fa = row.formatted_address != null ? String(row.formatted_address) : (row.address != null ? String(row.address) : '');
        var parts = fa ? fa.split(',').map(function (p) { return p ? p.trim() : ''; }) : [];
        var out = {
          address: parts[0] || fa || null,
          suburb: parts[1] || null,
          city: parts[2] || null,
          province: parts[3] || null,
          lat: row.lat,
          lng: row.lng
        };
        geocodeCache.set(key, out);
        return out;
      })
      .catch(function (err) {
        console.warn('[Geocoding] request failed:', err);
        geocodeCache.set(key, empty);
        return empty;
      });
  }

  /**
   * Find Place From Text. Caller should pass input as storeName + ", South Africa". Returns Promise<place_id | null>.
   */
  function findPlaceFromText(input, apiKey) {
    if (isDevMode()) return Promise.resolve(null);
    var url = FIND_PLACE_URL + '?input=' + encodeURIComponent(input) + '&inputtype=textquery&fields=place_id';
    return fetch(url)
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (data.status !== 'OK' || !data.candidates || data.candidates.length === 0) return null;
        return data.candidates[0].place_id || null;
      })
      .catch(function () { return null; });
  }

  /**
   * Place Text Search (restricted to South Africa via region=za). Returns Promise<place_id | null>.
   */
  function placeTextSearch(query, apiKey) {
    if (isDevMode()) return Promise.resolve(null);
    var url = TEXT_SEARCH_URL + '?query=' + encodeURIComponent(query) + '&region=za';
    return fetch(url)
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (data.status !== 'OK' || !data.results || data.results.length === 0) return null;
        return data.results[0].place_id || null;
      })
      .catch(function () { return null; });
  }

  /**
   * Place Details by place_id. Returns Promise<{ address, suburb, city, province, lat, lng }>. Cached by "placeid:" + place_id.
   * Discards result unless address_components has country with short_name "ZA".
   */
  function placeDetails(placeId, apiKey) {
    var key = 'placeid:' + (placeId || '');
    var empty = { address: null, suburb: null, city: null, province: null, lat: null, lng: null };
    if (!placeId) return Promise.resolve(empty);
    if (geocodeCache.has(key)) {
      return Promise.resolve(geocodeCache.get(key));
    }
    if (isDevMode()) {
      geocodeCache.set(key, MOCK_COORDS);
      return Promise.resolve(MOCK_COORDS);
    }
    var url = PLACE_DETAILS_URL + '?place_id=' + encodeURIComponent(placeId) + '&fields=address_components,formatted_address,name,types,geometry';
    return fetch(url)
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (data.error) {
          console.warn('[Place Details] Proxy/API error:', data.error);
          geocodeCache.set(key, empty);
          return empty;
        }
        if (data.status !== 'OK' || !data.result) {
          geocodeCache.set(key, empty);
          return empty;
        }
        var result = data.result;
        var components = result.address_components || [];
        var country = components.find(function (c) {
          return c.types && c.types.indexOf('country') !== -1;
        });
        if (!country || country.short_name !== 'ZA') {
          geocodeCache.set(key, empty);
          return empty;
        }
        var formattedAddress = result.formatted_address != null ? String(result.formatted_address) : '';
        var placeName = result.name != null ? String(result.name) : '';
        var parsed = parseAddressComponents(components, {
          formatted_address: formattedAddress || null,
          name: placeName || null
        });
        var lat = null;
        var lng = null;
        if (result.geometry && result.geometry.location) {
          lat = result.geometry.location.lat;
          lng = result.geometry.location.lng;
        }
        var out = { address: parsed.address, suburb: parsed.suburb, city: parsed.city, province: parsed.province, lat: lat, lng: lng };
        geocodeCache.set(key, out);
        return out;
      })
      .catch(function () {
        geocodeCache.set(key, empty);
        return empty;
      });
  }

  function isParsedEmpty(parsed) {
    return !parsed || (
      (parsed.address == null || parsed.address === '') &&
      (parsed.suburb == null || parsed.suburb === '') &&
      (parsed.city == null || parsed.city === '') &&
      (parsed.province == null || parsed.province === '')
    );
  }

  /** Normalize address string for cache key: lowercase, trim, expand common abbreviations to reduce duplicate keys. */
  function normalizeAddressPart(str) {
    var s = (str || '').toString().trim().toLowerCase();
    if (!s) return '';
    var abbrev = [
      { re: /\b(rd|road)\b/g, to: 'road' },
      { re: /\b(st|street)\b/g, to: 'street' },
      { re: /\b(ave|av|avenue)\b/g, to: 'avenue' },
      { re: /\b(dr|drive)\b/g, to: 'drive' },
      { re: /\b(blvd|boulevard)\b/g, to: 'boulevard' },
      { re: /\b(pl|place)\b/g, to: 'place' },
      { re: /\b(ln|lane)\b/g, to: 'lane' },
      { re: /\b(cres|circuit)\b/g, to: 'circuit' }
    ];
    for (var i = 0; i < abbrev.length; i++) {
      s = s.replace(abbrev[i].re, abbrev[i].to);
    }
    return s;
  }

  /** Cache key for geocode results: includes customer so two stops in the same suburb do not share one centroid. */
  function getAddressCacheKey(route) {
    var cust = normalizeAddressPart(route.customer);
    var a = normalizeAddressPart(route.address);
    var s = normalizeAddressPart(route.suburb);
    var c = normalizeAddressPart(route.city);
    if (!cust && !a && !s && !c) return '';
    return (cust + '|' + a + '|' + s + '|' + c).trim();
  }

  /** Key for coordinate cache: customer|address|suburb|city, lowercased and trimmed. */
  function normalizedAddressKey(customer, address, suburb, city) {
    var c = (customer || '').toString().trim();
    var a = (address || '').toString().trim();
    var s = (suburb || '').toString().trim();
    var t = (city || '').toString().trim();
    return (c + '|' + a + '|' + s + '|' + t).toLowerCase().trim();
  }

  /** Store resolved result in coordinate cache only when lat, lng, and fullAddress exist. */
  function storeCoordinateCacheIfValid(normalizedKey, parsed, debug, storeLabel) {
    if (!parsed || parsed.lat == null || parsed.lng == null) return;
    var fullAddress = buildFullAddressFromParts(parsed.address, parsed.suburb, parsed.city, parsed.province);
    if (!fullAddress) return;
    coordinateCache.set(normalizedKey, {
      lat: parsed.lat,
      lng: parsed.lng,
      fullAddress: fullAddress,
      suburb: parsed.suburb || null,
      city: parsed.city || null,
      province: parsed.province || null
    });
    if (debug && storeLabel !== undefined) console.log('[DEBUG_ROUTELIST] cache stored store="' + storeLabel + '"');
  }

  /** Geocode fallback: prefer customer + address + suburb + city so distance is not tied to suburb centroid alone. */
  function buildGeocodeFallbackQuery(route) {
    var parts = [];
    if (route.customer) parts.push((route.customer || '').toString().trim());
    if (route.address) parts.push((route.address || '').toString().trim());
    if (route.suburb) parts.push((route.suburb || '').toString().trim());
    if (route.city) parts.push((route.city || '').toString().trim());
    return parts.filter(Boolean).join(', ') + (parts.length ? ', South Africa' : '');
  }

  /**
   * Resolve one route: Places first (store/client name + suburb + city), then geocode fallback if Places returns empty.
   * If address looks like a street address use Geocoding only. Cache key for place path: "place:" + customer (lowercase).
   * Returns Promise<{ address, suburb, city, province }>.
   */
  function resolveOne(route, apiKey, options) {
    var debug = options && options.debug;
    var addressStr = (route.address || '').toString().trim();
    var customer = (route.customer || '').toString().trim();
    var normalizedKey = normalizedAddressKey(route.customer, route.address, route.suburb, route.city);

    var existingLat = route.lat;
    var existingLng = route.lng;
    if (
      existingLat != null && existingLng != null &&
      typeof existingLat === 'number' && typeof existingLng === 'number' &&
      !isNaN(existingLat) && !isNaN(existingLng)
    ) {
      if (debug) console.log('[DEBUG_ROUTELIST] resolver=coordinates (skip geocode) store="' + (customer || '') + '"');
      var faExisting = route.fullAddress || buildFullAddressFromParts(route.address, route.suburb, route.city, route.province);
      return Promise.resolve({
        address: route.address || null,
        suburb: route.suburb || null,
        city: route.city || null,
        province: route.province || null,
        lat: existingLat,
        lng: existingLng,
        fullAddress: faExisting || null
      });
    }

    if (coordinateCache.has(normalizedKey)) {
      var cached = coordinateCache.get(normalizedKey);
      if (debug) console.log('[DEBUG_ROUTELIST] resolver=cache store="' + (customer || '') + '"');
      var addressPart = (cached.fullAddress && cached.fullAddress.split(',')[0].trim()) || null;
      return Promise.resolve({
        address: addressPart,
        suburb: cached.suburb,
        city: cached.city,
        province: cached.province,
        lat: cached.lat,
        lng: cached.lng
      });
    }

    var hasStreetAddress = addressStr.length > 0 && looksLikeStreetAddress(route.address);
    if (hasStreetAddress) {
      if (debug) console.log('[DEBUG_ROUTELIST] resolver=geocode (street address) store="' + (customer || '') + '"');
      return geocodeOne(route.address, apiKey).then(function (parsed) {
        var addrKey = getAddressCacheKey(route);
        if (addrKey) addressCache.set(addrKey, parsed);
        storeCoordinateCacheIfValid(normalizedKey, parsed, debug, customer);
        return parsed;
      });
    }

    if (!customer) {
      return Promise.resolve({ address: null, suburb: null, city: null, province: null, lat: null, lng: null });
    }

    var placeCacheKey = 'place:' + customer.toLowerCase() + '|' + (route.suburb || '') + '|' + (route.city || '');
    if (geocodeCache.has(placeCacheKey)) {
      return Promise.resolve(geocodeCache.get(placeCacheKey));
    }

    var placeQueryParts = [customer];
    if (route.suburb) placeQueryParts.push((route.suburb || '').toString().trim());
    if (route.city) placeQueryParts.push((route.city || '').toString().trim());
    placeQueryParts.push('South Africa');
    var placeQuery = placeQueryParts.filter(Boolean).join(' ');

    if (debug) console.log('[DEBUG_ROUTELIST] resolver=places store="' + customer + '"');

    return findPlaceFromText(placeQuery, apiKey).then(function (placeId) {
      if (placeId) return placeDetails(placeId, apiKey);
      return placeTextSearch(placeQuery, apiKey).then(function (id) {
        if (id) return placeDetails(id, apiKey);
        return null;
      });
    }).then(function (parsed) {
      if (parsed && !isParsedEmpty(parsed)) {
        geocodeCache.set(placeCacheKey, parsed);
        storeCoordinateCacheIfValid(normalizedKey, parsed, debug, customer);
        return parsed;
      }
      if (debug) console.log('[DEBUG_ROUTELIST] resolver=geocode fallback store="' + customer + '"');
      var addrKey = getAddressCacheKey(route);
      if (addrKey && addressCache.has(addrKey)) {
        var cachedParsed = addressCache.get(addrKey);
        geocodeCache.set(placeCacheKey, cachedParsed);
        storeCoordinateCacheIfValid(normalizedKey, cachedParsed, debug, customer);
        return Promise.resolve(cachedParsed);
      }
      var fallbackQuery = buildGeocodeFallbackQuery(route);
      if (!fallbackQuery || fallbackQuery === ', South Africa') {
        if (debug) console.log('[DEBUG_ROUTELIST] resolver failed store="' + customer + '"');
        var emptyRes = { address: null, suburb: null, city: null, province: null, lat: null, lng: null };
        geocodeCache.set(placeCacheKey, emptyRes);
        return emptyRes;
      }
      return geocodeOne(fallbackQuery, apiKey).then(function (geocodeParsed) {
        if (addrKey) addressCache.set(addrKey, geocodeParsed);
        if (!isParsedEmpty(geocodeParsed)) {
          geocodeCache.set(placeCacheKey, geocodeParsed);
          storeCoordinateCacheIfValid(normalizedKey, geocodeParsed, debug, customer);
          return geocodeParsed;
        }
        if (debug) console.log('[DEBUG_ROUTELIST] resolver failed store="' + customer + '"');
        geocodeCache.set(placeCacheKey, geocodeParsed);
        return geocodeParsed;
      });
    });
  }

  function buildFullAddressFromParts(address, suburb, city, province) {
    var parts = [];
    if (address) parts.push(String(address).trim());
    if (suburb) parts.push(String(suburb).trim());
    if (city) parts.push(String(city).trim());
    if (province) parts.push(String(province).trim());
    return parts.length > 0 ? parts.join(', ') : null;
  }

  /**
   * Resolve missing address data for route rows.
   * Pipeline: Places first (store name + suburb + city), then geocode fallback. Rows with street-like address use geocode only.
   * Rejects with error.unresolvedRows if any row could not be resolved to a routable location.
   * @param {Array} routes - Enriched route objects (mutated in place)
   * @param {string} apiKey - Google API key (if missing, returns routes unchanged)
   * @param {{ debug: boolean }} options - optional; if debug true, logs stats
   * @returns {Promise<Array>} Same routes array with address fields updated
   */
  function resolveRouteAddresses(routes, apiKey, options) {
    var debug = options && options.debug;
    var stats = { resolved: 0, skipped: 0 };
    var queue = [];
    for (var i = 0; i < routes.length; i++) {
      var r = routes[i];
      var hasStreetAddress = (r.address || '').toString().trim().length > 0 && looksLikeStreetAddress(r.address);
      if (hasStreetAddress) {
        stats.skipped++;
        continue;
      }
      var hasCustomer = (r.customer || '').toString().trim().length > 0;
      if (!hasCustomer) {
        stats.skipped++;
        continue;
      }
      queue.push({ route: r, routeIndex: i });
    }
    if (queue.length === 0) {
      if (debug) console.log('[DEBUG_ROUTELIST] address resolution: resolved=', stats.resolved, 'skipped=', stats.skipped);
      return Promise.resolve(routes);
    }
    var CONCURRENCY = 10;
    function runBatch(startIdx) {
      if (startIdx >= queue.length) return Promise.resolve();
      var endIdx = Math.min(startIdx + CONCURRENCY, queue.length);
      var batch = [];
      for (var i = startIdx; i < endIdx; i++) {
        (function (item) {
          batch.push(
            resolveOne(item.route, apiKey, options).then(function (parsed) {
              item.route.address = parsed.address;
              item.route.suburb = parsed.suburb;
              item.route.city = parsed.city;
              item.route.province = parsed.province;
              item.route.fullAddress = (parsed.fullAddress && String(parsed.fullAddress).trim()) || buildFullAddressFromParts(parsed.address, parsed.suburb, parsed.city, parsed.province);
              item.route.lat = parsed.lat != null ? parsed.lat : undefined;
              item.route.lng = parsed.lng != null ? parsed.lng : undefined;
              stats.resolved++;
              return parsed;
            })
          );
        })(queue[i]);
      }
      return Promise.all(batch).then(function () { return runBatch(endIdx); });
    }
    return runBatch(0).then(function () {
      if (debug) console.log('[DEBUG_ROUTELIST] address resolution: resolved=', stats.resolved, 'skipped=', stats.skipped);
      var unresolved = [];
      for (var q = 0; q < queue.length; q++) {
        var r = queue[q].route;
        var fa = (r.fullAddress || '').toString().trim();
        if (!fa) {
          unresolved.push({
            rowIndex: r.rowIndex != null ? r.rowIndex : (queue[q].routeIndex + 1),
            customer: (r.customer || '').toString().trim(),
            address: [r.address, r.suburb, r.city, r.province].filter(Boolean).join(', ') || '',
            reason: 'We could not resolve a routable location for this entry.'
          });
        }
      }
      if (unresolved.length > 0) {
        var err = new Error('UNRESOLVED_ROUTE_ADDRESSES');
        err.unresolvedRows = unresolved;
        return Promise.reject(err);
      }
      return routes;
    });
  }

  global.geocodeCache = geocodeCache;
  global.resolveRouteAddresses = resolveRouteAddresses;
  global.geocodeOne = geocodeOne;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { geocodeCache: geocodeCache, resolveRouteAddresses: resolveRouteAddresses, geocodeOne: geocodeOne };
  }
})(typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : this);
