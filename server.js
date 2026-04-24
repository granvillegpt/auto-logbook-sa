require('dotenv').config();
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const { getGoogleApiKey } = require('./functions/src/googleApiKey');

console.log('[ENV CHECK]', {
  hasGoogleKey: !!getGoogleApiKey()
});

if (!getGoogleApiKey()) {
  console.error(
    'Google API key missing. Set GOOGLE_API_KEY or GOOGLE_PLACES_API_KEY (or GOOGLE_MAPS_API_KEY / GOOGLE_GEOCODE_API_KEY) in .env'
  );
  process.exit(1);
}

const express = require('express');
const fs = require('fs');
const { resolveStoreAddresses } = require('./functions/src/resolveStore');
const {
  assertResolveStoreAllowedHttp,
  evaluateLogbookAccessHttp,
  consumeLogbookToken,
  getLogbookAccessTokenFromRequest,
  isGateDisabled,
} = require('./functions/src/resolveStoreGate');
const { generateLogbook } = require('./functions/engineAdapter');
const app = express();

const ADMIN_KEY = process.env.ADMIN_KEY || 'your-secret-key';

/** Allow logbook static/emulator (e.g. :5000) to call API on another host:port (:3000). */
app.use(function corsAllowLogbookOrigins(req, res, next) {
  const origin = req.headers.origin;
  const devLocal =
    origin &&
    /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);
  const prodHosted =
    origin &&
    /^https:\/\/(www\.)?autologbook(\.co\.za|-sa\.web\.app|-sa\.firebaseapp\.com)$/i.test(origin);
  if (devLocal || prodHosted) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Logbook-Token, x-logbook-token, x-logbook-key, X-Request-Id, x-request-id');
    res.setHeader('Vary', 'Origin');
  }
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

app.use(express.json({ limit: '2mb' }));

const REVIEWS_PATH = path.join(__dirname, 'data', 'reviews.json');

function readReviews() {
  try {
    const data = fs.readFileSync(REVIEWS_PATH, 'utf8');
    return JSON.parse(data);
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
}

function writeReviews(reviews) {
  fs.mkdirSync(path.dirname(REVIEWS_PATH), { recursive: true });
  fs.writeFileSync(REVIEWS_PATH, JSON.stringify(reviews, null, 2), 'utf8');
}

// Google API key must be set on the server (not sent from browser). Enable Geocoding + Places APIs.
const GOOGLE_API_KEY = getGoogleApiKey();
const GOOGLE_BASE = 'https://maps.googleapis.com/maps/api';

function proxyToGoogle(path, req, res) {
  if (!GOOGLE_API_KEY) {
    return res.status(500).json({ error: 'Server missing Google API key. Set GOOGLE_API_KEY.' });
  }
  const params = new URLSearchParams(req.query);
  params.set('key', GOOGLE_API_KEY);
  const url = `${GOOGLE_BASE}${path}?${params.toString()}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 20000);
  fetch(url, { signal: controller.signal })
    .then((r) => {
      return r.json().then((data) => ({ status: r.status, data }));
    })
    .then(({ status, data }) => {
      clearTimeout(timeoutId);
      if (status === 403 || (data && data.status === 'REQUEST_DENIED')) {
        const msg = data?.error_message || data?.status || '';
        console.error('[Google API]', status, msg);
        if (status === 403 && msg.toLowerCase().includes('not authorized')) {
          console.error('[Google API] Fix: In Cloud Console → Credentials → your key → set Application restriction to "None" (or "IP addresses") for server-side calls.');
        }
      }
      res.status(status).json(data);
    })
    .catch((err) => {
      clearTimeout(timeoutId);
      if (err.name === 'AbortError') {
        return res.status(504).json({ error: 'Google API request timed out after 20 seconds. Please try again.' });
      }
      res.status(502).json({ error: String(err.message) });
    });
}

app.get('/api/geocode', (req, res) => {
  proxyToGoogle('/geocode/json', req, res);
});

app.get('/api/findPlace', (req, res) => {
  proxyToGoogle('/place/findplacefromtext/json', req, res);
});

app.get('/api/textSearch', (req, res) => {
  proxyToGoogle('/place/textsearch/json', req, res);
});

app.get('/api/placeDetails', (req, res) => {
  proxyToGoogle('/place/details/json', req, res);
});

/** Geocode one or more address strings (same contract as Cloud Function api). */
app.post('/api/geocodeAddresses', async (req, res) => {
  if (!GOOGLE_API_KEY) return res.status(500).json({ error: 'Server missing Google API key.' });
  try {
    const addresses = Array.isArray(req.body?.addresses) ? req.body.addresses : [];
    if (addresses.length === 0) return res.status(400).json({ error: 'Missing or empty addresses array.' });
    const results = [];
    for (const addr of addresses) {
      const trimmed = typeof addr === 'string' ? addr.trim() : '';
      if (!trimmed) {
        results.push({ address: trimmed, lat: null, lng: null, formatted_address: null, resolved: false });
        continue;
      }
      const url = `${GOOGLE_BASE}/geocode/json?address=${encodeURIComponent(trimmed)}&key=${GOOGLE_API_KEY}`;
      const r = await fetch(url);
      const data = await r.json();
      const first = data.results && data.results[0];
      const loc = first && first.geometry && first.geometry.location;
      if (loc != null && typeof loc.lat === 'number' && typeof loc.lng === 'number') {
        results.push({
          address: trimmed,
          lat: loc.lat,
          lng: loc.lng,
          formatted_address: first.formatted_address || trimmed,
          resolved: true
        });
      } else {
        results.push({ address: trimmed, lat: null, lng: null, formatted_address: null, resolved: false });
      }
    }
    res.status(200).json(results);
  } catch (err) {
    console.error('geocodeAddresses error:', err);
    res.status(500).json({ error: err.message || 'Geocode failed.' });
  }
});

const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org';
const NOMINATIM_USER_AGENT =
  'AutoLogbookSA/1.0 (admin store geocode; https://autologbook.co.za)';

/** Admin-only geocode via OSM Nominatim (no Google). */
app.post('/api/geocode-nominatim', async (req, res) => {
  const key = req.headers['x-admin-key'];
  if (key !== ADMIN_KEY) {
    return res.status(403).json({ error: 'Unauthorized', lat: null, lng: null });
  }
  try {
    const address = req.body?.address;
    const trimmed = typeof address === 'string' ? address.trim() : '';
    if (!trimmed) {
      return res.status(400).json({ error: 'Missing address', lat: null, lng: null });
    }
    const url = `${NOMINATIM_BASE}/search?q=${encodeURIComponent(trimmed)}&format=json&limit=1`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20000);
    const r = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': NOMINATIM_USER_AGENT,
        Accept: 'application/json',
      },
    });
    clearTimeout(timeoutId);
    if (!r.ok) {
      return res.status(502).json({ error: 'Nominatim request failed', lat: null, lng: null });
    }
    const results = await r.json();
    const first = Array.isArray(results) && results[0];
    if (!first) {
      return res.status(404).json({ error: 'No results', lat: null, lng: null });
    }
    const lat = parseFloat(first.lat);
    const lng = parseFloat(first.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(502).json({ error: 'Invalid Nominatim response', lat: null, lng: null });
    }
    res.status(200).json({ lat, lng, display_name: first.display_name || null });
  } catch (err) {
    console.error('geocode-nominatim error:', err);
    const msg =
      err && err.name === 'AbortError' ? 'Nominatim request timed out' : err.message || 'Geocode failed.';
    res.status(500).json({ error: msg, lat: null, lng: null });
  }
});

app.post('/api/logbookAccessState', async (req, res) => {
  try {
    const state = await evaluateLogbookAccessHttp(req);
    return res.status(200).json(state);
  } catch (err) {
    console.error('logbookAccessState error:', err);
    return res.status(500).json({
      canGenerate: false,
      isAdmin: false,
      reason: 'Server error',
    });
  }
});

app.post('/api/generateLogbook', async (req, res) => {
  if (!req.body) {
    return res.status(400).json({ success: false, error: 'Missing request body.' });
  }
  let access;
  try {
    access = await evaluateLogbookAccessHttp(req);
    if (!access.canGenerate) {
      return res.status(403).json({
        success: false,
        error: access.reason || 'Forbidden',
      });
    }
  } catch (accessErr) {
    console.error('generateLogbook access check:', accessErr);
    return res.status(500).json({ success: false, error: 'Access check failed.' });
  }
  const { routes, startDate, endDate, homeAddress, openingKm } = req.body;
  if (!routes || !startDate || !endDate || !homeAddress || openingKm === undefined) {
    return res.status(400).json({
      success: false,
      error: 'Missing required fields: routes, startDate, endDate, homeAddress, openingKm.'
    });
  }
  if (!isGateDisabled() && !access.isAdmin) {
    const token = getLogbookAccessTokenFromRequest(req);
    if (!token) {
      return res.status(403).json({
        success: false,
        error: 'Invalid or missing token',
      });
    }
    try {
      const requestId = req.headers['x-request-id'];
      await consumeLogbookToken(token, requestId);
    } catch (consumeErr) {
      const msg =
        consumeErr && consumeErr.message ? String(consumeErr.message) : 'Token error';
      if (
        msg === 'Invalid token' ||
        msg === 'Token already used' ||
        msg === 'No tokens remaining' ||
        msg === 'Invalid token state'
      ) {
        return res.status(403).json({ success: false, error: msg });
      }
      console.error('consumeLogbookToken:', consumeErr);
      return res.status(500).json({ success: false, error: 'Token error' });
    }
  }
  try {
    const result = await generateLogbook(req.body);
    const entries = result.entries || [];
    const meta = result.meta || {};
    res.json({
      success: true,
      data: {
        ...result,
        audit: {
          engineVersion: result.engineVersion,
          generatedAt: meta.generatedAt,
          entryCount: entries.length,
          warnings: meta.warnings || []
        }
      }
    });
  } catch (err) {
    console.error('Logbook generation failed:', err);
    res.status(500).json({ success: false, error: err.message || 'Generation failed.' });
  }
});

/** Legacy resolver — disabled; use Cloud Functions upload / reprocess flows instead. */
app.post('/api/resolveRouteAddresses', (req, res) => {
  console.warn("LEGACY RESOLVER HIT:", {
    path: req.path,
    method: req.method,
    ip: req.ip,
    time: new Date().toISOString()
  });

  res.status(410).json({
    error: "LEGACY RESOLVER DISABLED"
  });

  return;
});


app.post('/engine/resolve-store', async (req, res) => {
  try {
    await assertResolveStoreAllowedHttp(req, ADMIN_KEY);
    const body = req.body && (req.body.routes != null ? req.body : { routes: req.body });
    const routes = Array.isArray(body.routes) ? body.routes : [];
    if (routes.length === 0) {
      return res.status(400).json({ error: 'Missing or empty routes array.' });
    }

    const enriched = await resolveStoreAddresses(routes);
    return res.status(200).json(enriched);
  } catch (err) {
    const code = err && err.statusCode;
    if (code === 403) {
      return res.status(403).json({ error: err.message || 'Invalid token' });
    }
    console.error('[RESOLVE ERROR]', err);
    return res.status(500).json({ error: 'Resolver failed' });
  }
});

function storeRowNeedsCoordinateAttention(data) {
  if (!data || typeof data !== 'object') return true;
  if (data.missingCoords === true || data.needsAdminReview === true) return true;
  const lat = data.lat;
  const lng = data.lng;
  if (lat == null || lng == null) return true;
  const ln = Number(lat);
  const lg = Number(lng);
  return !Number.isFinite(ln) || !Number.isFinite(lg);
}

async function resolveStoreLocationRefForAdminUpdateServer(firestore, body) {
  const col = firestore.collection('storeLocations');
  const id = body && body.id != null ? String(body.id).trim() : '';
  const canonicalName =
    body && body.canonicalName != null ? String(body.canonicalName).trim() : '';
  const normalizedQuery =
    body && body.normalizedQuery != null ? String(body.normalizedQuery).trim() : '';

  if (id) {
    const ref = col.doc(id);
    const snap = await ref.get();
    if (snap.exists) return ref;
  }
  for (const key of [canonicalName, normalizedQuery]) {
    if (!key) continue;
    const ref = col.doc(key);
    const snap = await ref.get();
    if (snap.exists) return ref;
    const q = await col.where('canonicalName', '==', key).limit(1).get();
    if (!q.empty) return q.docs[0].ref;
  }
  return null;
}

// Admin: fetch unresolved stores (missing coordinates) — authoritative storeLocations only.
app.get('/admin/missing-coords', async (req, res) => {
  try {
    const key = req.headers['x-admin-key'];
    if (key !== ADMIN_KEY) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const admin = require('firebase-admin');

    if (!admin.apps.length) {
      admin.initializeApp();
    }

    const db = admin.firestore();
    const snap = await db.collection('storeLocations').get();
    const rows = snap.docs
      .map((doc) => {
        const data = doc.data() || {};
        return {
          ...data,
          id: doc.id,
          normalizedQuery: doc.id
        };
      })
      .filter((row) => storeRowNeedsCoordinateAttention(row));

    return res.status(200).json(rows);
  } catch (err) {
    console.error('[MISSING COORDS ERROR]', err);
    return res.status(500).json({ error: 'Failed to fetch unresolved stores' });
  }
});

app.post('/admin/update-coords', async (req, res) => {
  try {
    const key = req.headers['x-admin-key'];
    if (key !== ADMIN_KEY) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const { lat, lng } = req.body || {};
    const latN = lat != null ? Number(lat) : NaN;
    const lngN = lng != null ? Number(lng) : NaN;
    if (!Number.isFinite(latN) || !Number.isFinite(lngN)) {
      return res.status(400).json({ error: 'Invalid or missing lat/lng' });
    }

    const admin = require('firebase-admin');
    if (!admin.apps.length) {
      admin.initializeApp();
    }
    const db = admin.firestore();
    const ref = await resolveStoreLocationRefForAdminUpdateServer(db, req.body || {});
    if (!ref) {
      return res.status(404).json({ error: 'Store document not found in storeLocations' });
    }

    await ref.set(
      {
        lat: latN,
        lng: lngN,
        missingCoords: false,
        needsAdminReview: false,
        updatedAt: Date.now()
      },
      { merge: true }
    );

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('[UPDATE COORDS ERROR]', err);
    return res.status(500).json({ error: err.message || 'Update failed' });
  }
});

app.get('/api/distancematrix', async (req, res) => {
  try {
    const { origins, destinations } = req.query;

    if (!origins || !destinations) {
      return res.status(400).json({ error: 'Missing origins or destinations' });
    }

    if (!GOOGLE_API_KEY) {
      return res.status(500).json({ error: 'Server missing Google API key. Set GOOGLE_API_KEY.' });
    }

    const url =
      'https://maps.googleapis.com/maps/api/distancematrix/json' +
      `?origins=${encodeURIComponent(origins)}` +
      `&destinations=${encodeURIComponent(destinations)}` +
      '&units=metric' +
      `&key=${GOOGLE_API_KEY}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20000);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    const data = await response.json();
    res.json(data);
  } catch (err) {
    if (err.name === 'AbortError') {
      return res.status(504).json({ error: 'Google Distance Matrix request timed out after 20 seconds. Please try again.' });
    }
    console.error('Distance Matrix proxy error:', err);
    res.status(500).json({ error: 'Distance Matrix request failed' });
  }
});

// Reviews API
app.get('/api/reviews', (req, res) => {
  try {
    const reviews = readReviews();
    const pending = req.query.pending === '1';
    if (pending) {
      return res.json(reviews.filter((r) => r.status === 'pending'));
    }
    res.json(reviews.filter((r) => r.status === 'approved'));
  } catch (err) {
    console.error('Reviews GET error:', err);
    res.status(500).json({ error: 'Failed to load reviews' });
  }
});

app.post('/api/reviews', (req, res) => {
  try {
    const reviews = readReviews();
    const { name = '', company = '', rating, comment } = req.body || {};
    const id = reviews.length ? Math.max(...reviews.map((r) => r.id)) + 1 : 1;
    const date = new Date().toISOString().slice(0, 10);
    if (typeof rating !== 'number' || rating < 1 || rating > 5 || !comment || typeof comment !== 'string') {
      return res.status(400).json({ error: 'Rating (1–5) and comment are required.' });
    }
    const review = {
      id,
      name: String(name).trim(),
      company: String(company).trim(),
      rating: Math.min(5, Math.max(1, Math.floor(rating))),
      comment: String(comment).trim(),
      status: 'pending',
      date,
    };
    reviews.push(review);
    writeReviews(reviews);
    res.status(201).json({ id: review.id, status: 'pending' });
  } catch (err) {
    console.error('Reviews POST error:', err);
    res.status(500).json({ error: 'Failed to submit review' });
  }
});

app.patch('/api/reviews/:id', (req, res) => {
  try {
    const reviews = readReviews();
    const id = parseInt(req.params.id, 10);
    const { status } = req.body || {};
    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'status must be approved or rejected' });
    }
    const idx = reviews.findIndex((r) => r.id === id);
    if (idx === -1) return res.status(404).json({ error: 'Review not found' });
    if (status === 'rejected') {
      reviews.splice(idx, 1);
    } else {
      reviews[idx].status = 'approved';
    }
    writeReviews(reviews);
    res.json({ id, status });
  } catch (err) {
    console.error('Reviews PATCH error:', err);
    res.status(500).json({ error: 'Failed to update review' });
  }
});

app.use(express.static('public'));
app.use('/engine', express.static('engine'));

const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, () => {
  console.log('Auto Logbook SA running at http://localhost:' + PORT);
});
