/**
 * Auto Logbook SA – Logbook page.
 * Flow: parse Excel → preview → POST /api/generateLogbook (authoritative). DEBUG_LOCAL_ENGINE === true uses in-browser engine only.
 */
(function () {
  'use strict';
  console.log("STEP 1 — IIFE START");
  try {

  /** Cloud Functions base: emulator on localhost; production otherwise (same project as resolveStores / reprocessPreviewRoutes). */
  var LOGBOOK_FUNCTIONS_BASE = (typeof window !== 'undefined' && window.location &&
    (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'))
    ? 'http://127.0.0.1:5007/autologbook-sa/us-central1'
    : 'https://us-central1-autologbook-sa.cloudfunctions.net';
  /** Express Cloud Function `api` — paths under /api/... */
  var LOGBOOK_API_FUNCTION_BASE = LOGBOOK_FUNCTIONS_BASE + '/api';
  function resolveLogbookExpressApiUrl(path) {
    if (typeof window !== 'undefined' && window.location && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
      return LOGBOOK_API_FUNCTION_BASE + path;
    }
    return path;
  }

  var isInIframe = false;
  try {
    isInIframe = window.location !== window.parent.location;
  } catch (e) {
    isInIframe = true;
  }

  var isAdminDashboardEmbed = false;
  try {
    isAdminDashboardEmbed = new URLSearchParams(window.location.search).get('adminEmbed') === '1';
  } catch (e2) {
    isAdminDashboardEmbed = false;
  }

  /** Admin embed only: same ID token as admin.js (parent window getAdminToken). */
  function getAdminEmbedIdTokenAsPromise() {
    if (!isAdminDashboardEmbed) {
      return Promise.resolve(null);
    }
    try {
      var p = window.parent;
      if (p && p !== window && typeof p.getAdminToken === 'function') {
        return p.getAdminToken().catch(function (err) {
          console.error('FAILED TO GET ID TOKEN', err);
          return null;
        });
      }
    } catch (e) { /* cross-origin */ }
    if (typeof window.getAdminToken === 'function') {
      return window.getAdminToken().catch(function (err) {
        console.error('FAILED TO GET ID TOKEN', err);
        return null;
      });
    }
    return Promise.resolve(null);
  }

  var DEBUG_ROUTELIST = true;

  /** When true, final logbook runs in-browser (legacy). Default false = server is source of truth. Set before this script: window.DEBUG_LOCAL_ENGINE = true */
  if (typeof window.DEBUG_LOCAL_ENGINE === 'undefined') {
    window.DEBUG_LOCAL_ENGINE = false;
  }

  if (window.DEBUG_LOCAL_ENGINE === true && window.logbookEngine && window.logbookEngine.runLogbookEngine) {
    window.logbookEngine.generate = window.logbookEngine.runLogbookEngine;
  }

  if (typeof window.selectedRegions === 'undefined' || !Array.isArray(window.selectedRegions)) {
    window.selectedRegions = ['western_cape'];
  }

  if (typeof window.selectedCities === 'undefined' || !Array.isArray(window.selectedCities)) {
    window.selectedCities = ['cape_town'];
  }

  var droppedRoutelistFile = null;
  var droppedExcelFile = null;
  var lastProcessedRoutelistFileId = null;
  var userHasEditedAddress = false;
  var leaveDaysArray = [];
  var manualEntriesArray = [];
  var lastLogbookResult = null;
  var monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var currentCalendarMonth = new Date().getMonth();
  var currentCalendarYear = new Date().getFullYear();
  console.log("STEP 2 — BEFORE SET");
  var selectedDates = new Set();
  console.log("STEP 3 — AFTER SET");
  var selectedManualDates = [];
  var leaveCalendarSelecting = false;
  var logbookService = window.logbookService;
  /** Authoritative access from POST /api/logbookAccessState (server only). */
  var logbookAccessState = { canGenerate: false, isAdmin: false, reason: null };
  /** Paid flow: trimmed URL ?token=; used by fetchDownloadStatus + consume. */
  var sessionToken = null;
  /** True when URL token exists and server reports 0 downloads remaining (authoritative). */
  var logbookGenerateBlockedByDownloads = false;

  function showLogbookAccessMessage(text) {
    var btn = document.getElementById('generateLogbookBtn');
    var el = document.getElementById('logbookAccessMessage');
    if (!text) {
      if (el) {
        el.textContent = '';
        el.style.display = 'none';
      }
      return;
    }
    if (!el) {
      el = document.createElement('div');
      el.id = 'logbookAccessMessage';
      el.setAttribute('role', 'alert');
      el.style.display = 'block';
      el.style.marginTop = '10px';
      el.style.color = '#c0392b';
      el.style.fontWeight = '600';
      if (btn) btn.insertAdjacentElement('afterend', el);
      else (document.body || document.documentElement).appendChild(el);
    }
    el.textContent = text;
    el.style.display = 'block';
  }

  function applyLogbookAccessToUi() {
    var btn = document.getElementById('generateLogbookBtn');
    if (btn) {
      if (isInIframe) {
        // Admin iframe must never be blocked by token gating.
        btn.disabled = false;
        btn.classList.remove('disabled');
        btn.style.opacity = '';
        btn.style.cursor = '';
      } else {
        var blockedByDownloads = logbookGenerateBlockedByDownloads === true;
        btn.disabled = !logbookAccessState.canGenerate || blockedByDownloads;
        if (logbookAccessState.canGenerate && !blockedByDownloads) {
          btn.classList.remove('disabled');
        } else {
          btn.classList.add('disabled');
        }
        if (blockedByDownloads) {
          btn.style.opacity = '0.5';
          btn.style.cursor = 'not-allowed';
        } else {
          btn.style.opacity = '';
          btn.style.cursor = '';
        }
      }
    }
    if (!isInIframe) {
      if (!logbookAccessState.canGenerate && logbookAccessState.reason) {
        showLogbookAccessMessage(logbookAccessState.reason);
      } else {
        showLogbookAccessMessage('');
      }
    } else {
      // In admin iframe, suppress token error messaging entirely.
      showLogbookAccessMessage('');
    }
    if (logbookAccessState.isAdmin) {
      document.documentElement.classList.add('logbook-firebase-admin');
    } else {
      document.documentElement.classList.remove('logbook-firebase-admin');
    }
  }

  async function refreshLogbookAccessState() {
    try {
      var headers = await buildLogbookApiHeaders();
      var res = await fetch(resolveLogbookExpressApiUrl('/api/logbookAccessState'), {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({}),
      });
      var state = await res.json();
      logbookAccessState = {
        canGenerate: !!state.canGenerate,
        isAdmin: !!state.isAdmin,
        reason: state.reason != null && String(state.reason).trim() !== '' ? String(state.reason).trim() : null,
      };
    } catch (err) {
      logbookAccessState = {
        canGenerate: false,
        isAdmin: false,
        reason: 'Could not verify access. Try again.',
      };
    }
    applyLogbookAccessToUi();
  }

  function initLogbookAuthListener() {
    try {
      if (typeof firebase === 'undefined' || !firebase.auth) return;
      firebase.auth().onAuthStateChanged(function () {
        refreshLogbookAccessState();
      });
    } catch (e) { /* ignore */ }
  }

  /** One-shot wait so IndexedDB-restored Firebase user is visible before reading currentUser (admin iframe). */
  var firebaseAuthInitialReadyPromise = null;
  function getFirebaseAuthInitialReadyPromise() {
    if (firebaseAuthInitialReadyPromise) return firebaseAuthInitialReadyPromise;
    firebaseAuthInitialReadyPromise = new Promise(function (resolve) {
      if (typeof firebase === 'undefined' || !firebase.auth) {
        resolve();
        return;
      }
      try {
        var unsub = firebase.auth().onAuthStateChanged(function () {
          unsub();
          resolve();
        });
      } catch (e) {
        resolve();
      }
    });
    return firebaseAuthInitialReadyPromise;
  }

  /** Headers for /api/logbookAccessState: X-Logbook-Token + optional Bearer ID token.
   * In admin iframe context, this must not enforce payment/token and should return minimal JSON headers only. */
  function buildLogbookApiHeaders() {
    // Admin dashboard embeds logbook.html in an iframe. In that context we bypass payment/token checks
    // and let the backend enforce any admin auth. We forward the admin key and admin email when available.
    if (isInIframe) {
      var iframeHeaders = { 'Content-Type': 'application/json' };
      try {
        if (window.parent && window.parent.ADMIN_KEY) {
          iframeHeaders['x-admin-key'] = window.parent.ADMIN_KEY;
        }
      } catch (e) {
        // cross-origin or missing parent; ignore and send bare headers
      }
      try {
        if (typeof firebase !== 'undefined' && firebase.auth) {
          var uAdmin = firebase.auth().currentUser;
          if (uAdmin && uAdmin.email) {
            iframeHeaders['x-user-email'] = uAdmin.email;
          }
        }
      } catch (e) {
        // ignore – admin email header is best-effort
      }
      if (!isAdminDashboardEmbed) {
        return Promise.resolve(iframeHeaders);
      }
      return getAdminEmbedIdTokenAsPromise().then(function (tok) {
        if (tok) {
          iframeHeaders['Authorization'] = 'Bearer ' + tok;
        }
        return iframeHeaders;
      });
    }

    var headers = { 'Content-Type': 'application/json' };
    var urlParamsHdr = new URLSearchParams(window.location.search);
    var sessionTokenHdr = urlParamsHdr.get('token');
    if (sessionTokenHdr != null && String(sessionTokenHdr).trim() !== '') {
      headers['X-Logbook-Token'] = String(sessionTokenHdr).trim();
    }
    return getFirebaseAuthInitialReadyPromise().then(function () {
      try {
        if (typeof firebase !== 'undefined' && firebase.auth) {
          var u = firebase.auth().currentUser;
          if (u && typeof u.getIdToken === 'function') {
            return u.getIdToken(false).then(function (tok) {
              if (tok) headers['Authorization'] = 'Bearer ' + tok;
              return headers;
            }).catch(function () { return headers; });
          }
        }
      } catch (e) { /* ignore */ }
      return headers;
    });
  }

  function unlockPage() {
    var content = document.getElementById('logbookContent');
    if (content) content.style.display = 'block';
  }

  async function checkAccess() {
    if (isInIframe) {
      unlockPage();
      return;
    }

    var urlParams = new URLSearchParams(window.location.search);
    sessionToken = urlParams.get('token');
    if (sessionToken != null) {
      sessionToken = String(sessionToken).trim();
    }
    if (sessionToken === '') {
      sessionToken = null;
    }
    console.log('SESSION TOKEN:', sessionToken);
    unlockPage();
    await refreshLogbookAccessState();
    await fetchDownloadStatus();
  }

  function lockUI() {
    var generateBtn = document.getElementById('generateLogbookBtn') || document.getElementById('generateBtn');
    var downloadBtn = document.getElementById('downloadBtn');
    if (generateBtn) {
      generateBtn.disabled = true;
      generateBtn.innerText = 'Locked';
    }
    if (downloadBtn) {
      downloadBtn.disabled = true;
    }
  }

  function updateDownloadsUI(value) {
    var display = value;
    if (display === null || display === undefined) {
      display = '—';
    }
    var el = document.getElementById('downloadsLeft');
    if (el) el.textContent = display;
    var badge = document.getElementById('tokenBadge');
    if (!badge) {
      badge = document.createElement('div');
      badge.id = 'tokenBadge';
      badge.style.position = 'fixed';
      badge.style.top = '10px';
      badge.style.right = '10px';
      badge.style.background = '#000';
      badge.style.color = '#fff';
      badge.style.padding = '8px 12px';
      badge.style.borderRadius = '8px';
      badge.style.zIndex = '9999';
      document.body.appendChild(badge);
    }
    badge.innerText = 'Downloads left: ' + display;

    var n =
      value !== null && value !== undefined && value !== '—'
        ? Number(value)
        : NaN;
    logbookGenerateBlockedByDownloads = Number.isFinite(n) && n <= 0;

    var btn = document.getElementById('generateLogbookBtn');
    if (btn && !isInIframe) {
      applyLogbookAccessToUi();
    }
  }

  async function fetchDownloadStatus() {
    try {
      var urlParams = new URLSearchParams(window.location.search);
      var tok = urlParams.get('token');
      if (!tok || String(tok).trim() === '') {
        updateDownloadsUI('—');
        return null;
      }
      var res = await fetch(resolveLogbookExpressApiUrl('/api/getDownloadStatus'), {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'X-Logbook-Token': String(tok).trim()
        }
      });
      var data = await res.json().catch(function () { return {}; });
      var errStr = data.error != null ? String(data.error) : '';
      if (
        errStr.indexOf('No downloads remaining') !== -1 ||
        errStr.indexOf('No tokens remaining') !== -1
      ) {
        updateDownloadsUI(0);
        showTokenMessage('You have no downloads remaining');
        lockUI();
        return 0;
      }
      if (!res.ok) {
        if (
          errStr.indexOf('No tokens remaining') !== -1 ||
          errStr.indexOf('No downloads remaining') !== -1
        ) {
          updateDownloadsUI(0);
          showTokenMessage('You have no downloads remaining');
          lockUI();
          return 0;
        }
        updateDownloadsUI(0);
        return 0;
      }
      var n = data.downloadsRemaining != null ? Number(data.downloadsRemaining) : 0;
      if (!Number.isFinite(n)) n = 0;
      updateDownloadsUI(n);
      if (n <= 0) {
        showTokenMessage('You have no downloads remaining');
        lockUI();
      }
      return n;
    } catch (e) {
      console.error('fetchDownloadStatus:', e);
      return null;
    }
  }

  function showTokenMessage(message) {
    const btn =
      document.getElementById("downloadBtn") ||
      document.getElementById("generateLogbookBtn");
    if (!btn) return;

    let el = document.getElementById("tokenMessage");
    if (!el) {
      el = document.createElement("div");
      el.id = "tokenMessage";
      el.style.display = "block";
      el.style.marginTop = "10px";
      el.style.color = "#c0392b";
      el.style.fontWeight = "600";
    }

    el.innerText = message;
    el.style.display = "block";
    el.style.marginTop = "10px";
    btn.insertAdjacentElement("afterend", el);
  }

  async function downloadLogbook(result) {
    var data = result != null ? result : lastLogbookResult;
    if (!data || !data.entries || data.entries.length === 0) {
      return;
    }

    var urlParamsDl = new URLSearchParams(window.location.search);
    var sessionTokenDl = urlParamsDl.get('token');
    if (!isInIframe && sessionTokenDl != null && String(sessionTokenDl).trim() !== '') {
      var beforeLeft = await fetchDownloadStatus();
      if (beforeLeft === 0) {
        window.alert('No downloads remaining');
        return;
      }
    }

    if (sessionTokenDl == null || String(sessionTokenDl).trim() === '') {
      if (isInIframe) {
        exportLogbookToXlsx(data);
        return;
      }
      alert('Payment required');
      return;
    }

    var exported = exportLogbookToXlsx(data);
    if (!exported) {
      return;
    }

    try {
      var sessionToken = String(sessionTokenDl).trim();
      var consumeUrl = LOGBOOK_FUNCTIONS_BASE + '/consumeLogbookDownload';
      var consumeHeaders = {
        'Content-Type': 'application/json',
        'X-Logbook-Token': sessionToken,
        'X-Request-Id': crypto.randomUUID()
      };
      if (isAdminDashboardEmbed) {
        consumeHeaders['X-Admin-Dashboard'] = 'true';
        var idTokenDl = await getAdminEmbedIdTokenAsPromise();
        if (idTokenDl) {
          consumeHeaders['Authorization'] = 'Bearer ' + idTokenDl;
        }
      }
      var consumeRes = await fetch(consumeUrl, {
        method: 'POST',
        headers: consumeHeaders
      });
      var consumeData = await consumeRes.json().catch(function () { return {}; });
      if (consumeData.success) {
        await fetchDownloadStatus();
      } else {
        console.error('🔥 CONSUME FAILED:', consumeData.error);
        await fetchDownloadStatus();
      }
    } catch (err) {
      console.error('🔥 CONSUME ERROR:', err);
      await fetchDownloadStatus();
    }

    await refreshLogbookAccessState();
  }

  if (!window._routelistMode) {
    try {
      var savedRoutelistMode = localStorage.getItem('routelistMode');
      if (savedRoutelistMode === 'business' || savedRoutelistMode === 'salesRep') {
        window._routelistMode = savedRoutelistMode;
      }
    } catch (e) { /* ignore */ }
  }

  var ADDRESS_CACHE_KEY = 'autoLogbookAddressCache';

  /**
   * Pure predicate — no mutation. Final gate before engine: customer, ≥1 weekday in days.*,
   * and for mode === 'cycle' a non-empty weeks array.
   */
  function isMeaningfulRoute(route, mode) {
    console.log("FILTER INPUT:", {
      customer: route && route.customer,
      mode: mode,
      routeMode: route && route.mode,
      days: route && route.days,
      weeks: route && route.weeks
    });

    if (!route || typeof route !== 'object') {
      console.log("FILTER REJECT: invalid route object", route);
      return false;
    }

    if (!route.customer || String(route.customer).trim() === '') {
      console.log("FILTER REJECT: empty customer", route);
      return false;
    }

    // SALES REP MODE (UNCHANGED BEHAVIOR)
    if (mode === 'salesRep') {
      var days = route.days || {};
      var hasDay = !!(days.mon || days.tue || days.wed || days.thu || days.fri || days.sat);
      if (!hasDay) {
        console.log("FILTER REJECT: no active days", route.customer, route.days);
        return false;
      }

      if (route.mode === 'cycle') {
        if (!Array.isArray(route.weeks) || route.weeks.length === 0) {
          console.log("FILTER REJECT: invalid weeks", route.customer, route.weeks);
          return false;
        }
      }
    }

    // BUSINESS MODE (DATE-BASED)
    if (mode === 'business') {
      if (!route.startDate) {
        return false;
      }
    }

    return true;
  }

  function applyIframeLayout() {
    if (!isInIframe) return;
    var header = document.querySelector('header');
    var footer = document.querySelector('footer');
    if (header) header.style.display = 'none';
    if (footer) footer.style.display = 'none';
    if (document.body) {
      document.body.style.margin = '0';
      document.body.style.padding = '0';
    }
  }

  function updateStepProgress() {
    var step1 = document.getElementById('stepProgress1');
    if (!step1) return;
    var hasRoutes = window.currentRoutes && window.currentRoutes.length > 0;
    if (hasRoutes) step1.classList.add('completed'); else step1.classList.remove('completed');
  }

  function updateClearRoutelistButtonVisibility() {
    var btn = document.getElementById('clear-routes-btn');
    if (!btn) return;
    var routes = window.currentRoutes;
    if (!routes || !Array.isArray(routes) || routes.length === 0) {
      btn.classList.add('hidden');
    } else {
      btn.classList.remove('hidden');
    }
  }
  function exportLogbookToXlsx(result) {
    var XLSX = window.XLSX;
    if (!XLSX) return false;
    if (!result || !result.entries || result.entries.length === 0) {
      var statusEl = document.getElementById('statusArea');
      if (statusEl) {
        statusEl.textContent = 'No logbook entries were generated for this period.';
        statusEl.style.display = 'block';
      }
      return false;
    }

    var meta = result.meta || {};
    var totals = (result.meta && result.meta.totals) || result.totals || {};
    var entries = result.entries;
    var firstEntry = entries[0];
    var lastEntry = entries[entries.length - 1];

    function el(id) {
      var node = document.getElementById(id);
      return node && node.value != null ? (node.value || '').toString().trim() : '';
    }

    var firstName = el('firstName');
    var surname = el('surname');
    var idNumber = el('idNumber');
    var vehicleMake = el('vehicleMake');
    var vehicleModel = el('vehicleModel');
    var vehicleYear = el('vehicleYear');
    var registrationNumber = el('registrationNumber');
    var employerName = el('employerName') || (meta.employerName != null ? String(meta.employerName) : '');
    var startDate = el('startDate') || (meta.startDate || '');
    var endDate = el('endDate') || (meta.endDate || '');
    // Odometer columns: always use what the user typed on the form when present, else engine result
    function kmFromFormOrResult(formRaw, fallback) {
      if (formRaw !== '') {
        var parsed = parseFloat(formRaw, 10);
        return !isNaN(parsed) ? parsed : (fallback != null && fallback !== '' ? fallback : '');
      }
      return fallback != null && fallback !== '' ? fallback : '';
    }
    var openingKm = kmFromFormOrResult(el('openingKm'), firstEntry && firstEntry.openingKm != null ? firstEntry.openingKm : '');
    var closingKm = kmFromFormOrResult(
      el('closingKm'),
      result.meta && result.meta.closingKm != null
        ? result.meta.closingKm
        : (lastEntry && lastEntry.closingKm != null ? lastEntry.closingKm : '')
    );

    function yyyyMmDdToDdMmYyyy(iso) {
      if (!iso || iso.length < 10) return iso || '';
      var y = iso.slice(0, 4);
      var m = iso.slice(5, 7);
      var d = iso.slice(8, 10);
      return d + '/' + m + '/' + y;
    }

    function stripAddressSuffix(addr) {
      if (!addr || typeof addr !== 'string') return addr || '';
      var s = addr.trim();
      var patterns = [', South Africa', ', Western Cape'];
      for (var i = 0; i < patterns.length; i++) {
        var p = patterns[i];
        if (s.length > p.length && s.slice(-p.length) === p) {
          s = s.slice(0, -p.length).trim();
        }
      }
      return s;
    }

    function purposeBeforeDash(purpose) {
      if (!purpose) return '';
      var idx = purpose.indexOf(' – ');
      return idx !== -1 ? (purpose.slice(0, idx) || '').trim() : purpose;
    }

    function purposeAfterDash(purpose) {
      if (!purpose) return '';
      var idx = purpose.indexOf(' – ');
      return idx !== -1 ? (purpose.slice(idx + 3) || '').trim() : '';
    }

    var totalBusinessKm = totals.totalBusinessKm != null ? totals.totalBusinessKm : 0;
    var totalTravelKm = closingKm !== '' && openingKm !== '' && !isNaN(Number(closingKm)) && !isNaN(Number(openingKm))
      ? (Number(closingKm) - Number(openingKm)) : (totals.totalKm != null ? totals.totalKm : 0);
    var totalPrivateKm = Math.max(0, totalTravelKm - totalBusinessKm);

    function kmRound2(n) {
      var x = Number(n);
      if (!isFinite(x)) return 0;
      return Math.round(x * 100) / 100;
    }
    totalBusinessKm = kmRound2(totalBusinessKm);
    totalPrivateKm = kmRound2(totalPrivateKm);

    var taxYearStr = startDate && endDate ? (startDate.slice(0, 4) + '/' + endDate.slice(0, 4)) : '';
    var periodStr = startDate && endDate ? (yyyyMmDdToDdMmYyyy(startDate) + ' – ' + yyyyMmDdToDdMmYyyy(endDate)) : '';

    var data = [];
    var sectionRanges = [];
    var sectionLabelRows = [];

    function addSection(title, rows) {
      var start = data.length;
      data.push([title, '']);
      for (var i = 0; i < rows.length; i++) {
        data.push([rows[i][0], rows[i][1]]);
      }
      var end = data.length - 1;
      sectionRanges.push({ start: start, end: end });
      for (var r = start + 1; r <= end; r++) sectionLabelRows.push(r);
      data.push([]);
    }

    data.push(['AUTO LOGBOOK SA']);
    data.push([]);

    addSection('TAXPAYER', [
      ['Full Name', (firstName + ' ' + surname).trim() || ''],
      ['Tax Number', idNumber || ''],
      ['Employer', employerName || '']
    ]);

    addSection('VEHICLE', [
      ['Make', vehicleMake || ''],
      ['Model', vehicleModel || ''],
      ['Year', vehicleYear || ''],
      ['Registration', registrationNumber || '']
    ]);

    addSection('TAX YEAR', [
      ['Tax Year', taxYearStr || ''],
      ['Period', periodStr || '']
    ]);

    addSection('ODOMETER SUMMARY', [
      ['Opening KM', openingKm],
      ['Closing KM', closingKm],
      ['Total Travel KM', totalTravelKm],
      ['Total Business KM', totalBusinessKm],
      ['Total Private KM', totalPrivateKm],
      ['Method', 'Odometer Reconciliation']
    ]);

    data.push([]);

    // South African public holidays (MM-DD -> display name) for export labelling only
    var saPublicHolidays = {
      '03-21': 'Human Rights Day',
      '04-27': 'Freedom Day',
      '06-16': 'Youth Day',
      '08-09': 'National Women\'s Day',
      '09-24': 'Heritage Day',
      '12-16': 'Day of Reconciliation',
      '12-25': 'Christmas Day',
      '12-26': 'Day of Goodwill'
    };
    function isWeekend(dateStr) {
      if (!dateStr || dateStr.length < 10) return false;
      var d = new Date(dateStr + 'T12:00:00');
      if (isNaN(d.getTime())) return false;
      var day = d.getDay();
      return day === 0 || day === 6;
    }
    function getPublicHolidayName(dateStr) {
      if (!dateStr || dateStr.length < 10) return null;
      var mm = dateStr.slice(5, 7);
      var dd = dateStr.slice(8, 10);
      return saPublicHolidays[mm + '-' + dd] || null;
    }

    // Group entries by date to detect "no trips" days (single entry, 0 km)
    var entriesByDate = {};
    entries.forEach(function (e) {
      var dt = e.date || '';
      if (!entriesByDate[dt]) entriesByDate[dt] = [];
      entriesByDate[dt].push(e);
    });
    function isNoTripsDay(entry) {
      var list = entriesByDate[entry.date] || [];
      if (list.length !== 1) return false;
      var km = list[0].businessKm;
      return (km == null || km === '' || Number(km) === 0);
    }

    var tripHeaders = ['Date', 'Day', 'From', 'To', 'Business Location', 'Purpose', 'Opening KM', 'Closing KM', 'Business KM', 'Distance KM'];
    data.push(tripHeaders);
    var tripStartRow = data.length;
    var fromToMerges = [];

    entries.forEach(function (e, idx) {
      var businessKm = e.businessKm != null ? e.businessKm : '';
      var dateStr = e.date || '';
      var dayStr;
      if (e.date) {
        var d = new Date(e.date + 'T12:00:00');
        dayStr = isNaN(d.getTime()) ? (e.day || '') : d.toLocaleDateString('en-ZA', { weekday: 'long' });
      } else {
        dayStr = e.day || '';
      }
      var noTrips = isNoTripsDay(e);

      var fromCell, toCell, shopName, purposeCell;
      if (noTrips && isWeekend(dateStr)) {
        fromCell = 'Weekend';
        toCell = '';
        shopName = '';
        purposeCell = 'Weekend';
        fromToMerges.push({ s: { r: tripStartRow + idx, c: 2 }, e: { r: tripStartRow + idx, c: 3 } });
      } else if (noTrips && getPublicHolidayName(dateStr)) {
        var holidayName = getPublicHolidayName(dateStr);
        fromCell = 'Public Holiday (' + holidayName + ')';
        toCell = '';
        shopName = '';
        purposeCell = 'Public Holiday (' + holidayName + ')';
        fromToMerges.push({ s: { r: tripStartRow + idx, c: 2 }, e: { r: tripStartRow + idx, c: 3 } });
      } else {
        fromCell = stripAddressSuffix(e.from || '');
        toCell = stripAddressSuffix(e.to || '');
        shopName = e.shopName || e.customer || '';
        purposeCell = purposeBeforeDash(e.purpose || '');
      }

      data.push([
        dateStr,
        dayStr,
        fromCell,
        toCell,
        shopName,
        purposeCell,
        (e.openingKm ?? openingKm),
        (e.closingKm ?? closingKm),
        businessKm,
        businessKm
      ]);
    });

    data.push(['TOTALS', '', '', '', '', '', '', closingKm, totalBusinessKm, totalBusinessKm]);
    var totalsRow0Based = data.length - 1;
    data.push([]);
    data.push(['Generated by Auto Logbook SA. Users must verify all entries before submission to SARS.']);

    var ws = XLSX.utils.aoa_to_sheet(data);
    var footerRow = data.length - 1;
    var merges = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: 9 } },
      { s: { r: footerRow, c: 0 }, e: { r: footerRow, c: 9 } }
    ];
    sectionRanges.forEach(function (sec) {
      merges.push({ s: { r: sec.start, c: 0 }, e: { r: sec.start, c: 1 } });
    });
    fromToMerges.forEach(function (m) { merges.push(m); });
    ws['!merges'] = merges;
    fromToMerges.forEach(function (m) {
      var ref = XLSX.utils.encode_cell({ r: m.s.r, c: m.s.c });
      if (ws[ref]) {
        ws[ref].s = ws[ref].s || {};
        ws[ref].s.alignment = { horizontal: 'center', vertical: 'center' };
      }
    });

    var headerRow0Based = tripStartRow - 1;
    var lastLogbookRow0Based = tripStartRow + entries.length - 1;
    var numFmt = '#,##0.00';
    var headerRow1Based = tripStartRow;
    var lastRow1Based = tripStartRow + entries.length;
    var autofilterRef = 'A' + headerRow1Based + ':J' + lastRow1Based;

    ws['!pane'] = { state: 'frozen', ySplit: tripStartRow, activePane: 'bottomLeft', sqref: 'A1' };
    ws['!autofilter'] = { ref: autofilterRef };

    ws['!cols'] = [
      { wch: 12 }, // Date
      { wch: 10 }, // Day
      { wch: 40 }, // From
      { wch: 40 }, // To
      { wch: 28 }, // Business Location
      { wch: 18 }, // Purpose
      { wch: 12 }, // Opening KM
      { wch: 12 }, // Closing KM
      { wch: 12 }, // Business KM
      { wch: 12 }  // Distance KM
    ];

    function thinBorder() {
      return {
        top: { style: 'thin' },
        bottom: { style: 'thin' },
        left: { style: 'thin' },
        right: { style: 'thin' }
      };
    }

    function applyBorder(r0, r1, c0, c1) {
      for (var rr = r0; rr <= r1; rr++) {
        for (var cc = c0; cc <= c1; cc++) {
          var ref = XLSX.utils.encode_cell({ r: rr, c: cc });
          if (!ws[ref]) ws[ref] = { t: 's', v: '' };
          ws[ref].s = ws[ref].s || {};
          ws[ref].s.border = thinBorder();
        }
      }
    }

    // Style title
    var titleRef = XLSX.utils.encode_cell({ r: 0, c: 0 });
    if (ws[titleRef]) {
      ws[titleRef].s = ws[titleRef].s || {};
      ws[titleRef].s.font = { bold: true, sz: 14 };
      ws[titleRef].s.alignment = { horizontal: 'left', vertical: 'center' };
    }

    // Section titles + labels + section borders
    sectionRanges.forEach(function (sec) {
      var secRef = XLSX.utils.encode_cell({ r: sec.start, c: 0 });
      if (ws[secRef]) {
        ws[secRef].s = ws[secRef].s || {};
        ws[secRef].s.font = { bold: true };
      }
      applyBorder(sec.start, sec.end, 0, 1);
    });
    sectionLabelRows.forEach(function (rr) {
      var labelRef = XLSX.utils.encode_cell({ r: rr, c: 0 });
      if (ws[labelRef]) {
        ws[labelRef].s = ws[labelRef].s || {};
        ws[labelRef].s.font = { bold: true };
      }
    });

    for (var c = 0; c <= 9; c++) {
      var headerRef = XLSX.utils.encode_cell({ r: headerRow0Based, c: c });
      if (ws[headerRef]) {
        ws[headerRef].s = ws[headerRef].s || {};
        ws[headerRef].s.font = { bold: true };
        ws[headerRef].s.fill = { fgColor: { rgb: 'FFE0E0E0' } };
        ws[headerRef].s.alignment = { horizontal: 'center', vertical: 'center', wrapText: true };
        ws[headerRef].s.border = thinBorder();
      }
    }

   // Borders and alignment for table rows (data + totals)
applyBorder(tripStartRow, totalsRow0Based, 0, 9);

for (var r = tripStartRow; r <= lastLogbookRow0Based; r++) {

  // --- Wrap text for address columns ---
  for (var wrapCol = 2; wrapCol <= 4; wrapCol++) {
    var wrapRef = XLSX.utils.encode_cell({ r: r, c: wrapCol });
    if (ws[wrapRef]) {
      ws[wrapRef].s = ws[wrapRef].s || {};
      ws[wrapRef].s.alignment = ws[wrapRef].s.alignment || {};
      ws[wrapRef].s.alignment.wrapText = true;
      ws[wrapRef].s.alignment.vertical = 'top';
    }
  }

  // --- Right-align and format numeric columns ---
  for (var col = 6; col <= 9; col++) {
    var cellRef = XLSX.utils.encode_cell({ r: r, c: col });
    if (ws[cellRef] && (ws[cellRef].v !== undefined && ws[cellRef].v !== '')) {
      ws[cellRef].z = numFmt;
      if (!ws[cellRef].t) ws[cellRef].t = 'n';
      ws[cellRef].s = ws[cellRef].s || {};
      ws[cellRef].s.alignment = ws[cellRef].s.alignment || {};
      ws[cellRef].s.alignment.horizontal = 'right';
      ws[cellRef].s.alignment.vertical = 'center';
    }
  }

  // --- Highlight "Return Home" rows ---
  var dateRef = XLSX.utils.encode_cell({ r: r, c: 0 });
var kmRef = XLSX.utils.encode_cell({ r: r, c: 8 });

var dateVal = ws[dateRef] ? ws[dateRef].v : null;
var kmVal = ws[kmRef] ? ws[kmRef].v : null;

// Detect weekend
var isWeekendDay = false;
if (dateVal) {
  var d = new Date(dateVal + 'T12:00:00');
  if (!isNaN(d.getTime())) {
    var day = d.getDay();
    isWeekendDay = (day === 0 || day === 6);
  }
}

// Detect public holiday
var isPublicHolidayDay = typeof getPublicHolidayName === 'function' && getPublicHolidayName(dateVal);

// Detect zero KM
var isZeroKmDay = (kmVal === 0 || kmVal === '0' || kmVal === null || kmVal === '');

if (isWeekendDay || isPublicHolidayDay || isZeroKmDay) {
  for (var cHighlight = 0; cHighlight <= 9; cHighlight++) {
    var highlightRef = XLSX.utils.encode_cell({ r: r, c: cHighlight });
    if (ws[highlightRef]) {
      ws[highlightRef].s = ws[highlightRef].s || {};
      ws[highlightRef].s.fill = { fgColor: { rgb: 'FFFFFF99' } }; // soft yellow
    }
  }
}

}
    for (var totalsCol = 6; totalsCol <= 9; totalsCol++) {
      var totalsRef = XLSX.utils.encode_cell({ r: totalsRow0Based, c: totalsCol });
      if (ws[totalsRef] && (ws[totalsRef].v !== undefined && ws[totalsRef].v !== '')) {
        ws[totalsRef].z = numFmt;
        ws[totalsRef].s = ws[totalsRef].s || {};
        ws[totalsRef].s.alignment = ws[totalsRef].s.alignment || {};
        ws[totalsRef].s.alignment.horizontal = 'right';
      }
    }

    var tableRef = 'A' + headerRow1Based + ':J' + lastRow1Based;
    try {
      ws['!table'] = { ref: tableRef, style: { name: 'TableStyleMedium2', showRowStripes: true } };
    } catch (e) { /* table may not be supported in this xlsx build */ }

    var routeCount = (window.currentRoutes && Array.isArray(window.currentRoutes)) ? window.currentRoutes.length : 0;
    var engineVersion = (result.engineVersion != null) ? String(result.engineVersion) : (meta.ENGINE_VERSION != null ? String(meta.ENGINE_VERSION) : '');
    var generatedOn = new Date().toLocaleString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).replace(', ', ' ');
    var taxpayerName = (firstName + ' ' + surname).trim() || '';
    var vehicleName = [vehicleMake, vehicleModel].filter(Boolean).join(' ').trim() || '';

    var summaryData = [];
    summaryData.push(['DRAFT LOGBOOK – REVIEW REQUIRED']);
    summaryData.push(['']);
    summaryData.push(['This logbook has been generated automatically based on the data provided.']);
    summaryData.push(['']);
    summaryData.push(['This document is NOT final and should NOT be submitted to SARS without review.']);
    summaryData.push(['']);
    summaryData.push(['Please verify the following:']);
    summaryData.push(['• All routes and locations are correct']);
    summaryData.push(['• Dates and travel patterns are accurate']);
    summaryData.push(['• Opening and closing odometer readings are correct']);
    summaryData.push(['• Business vs private travel is reasonable and complete']);
    summaryData.push(['']);
    summaryData.push(['Once confirmed, this logbook can be finalised for submission.']);
    summaryData.push(['']);
    summaryData.push(['The user remains responsible for ensuring the accuracy and completeness of this logbook before submission.']);
    summaryData.push(['']);
    summaryData.push(['Logbook Summary / Review Notes']);
    summaryData.push([]);

    summaryData.push(['Basic Information']);
    summaryData.push(['Field', 'Value']);
    summaryData.push(['Taxpayer Name', taxpayerName]);
    summaryData.push(['Vehicle', vehicleName]);
    summaryData.push(['Registration', registrationNumber || '']);
    summaryData.push(['Period Covered', (startDate && endDate) ? startDate + ' – ' + endDate : '']);
    summaryData.push(['Routes Processed', routeCount]);
    summaryData.push(['Engine Version', engineVersion]);
    summaryData.push(['Generated On', generatedOn]);
    summaryData.push([]);

    summaryData.push(['Manual Trips Added']);
    if (manualEntriesArray && manualEntriesArray.length > 0) {
      summaryData.push(['Date', 'From', 'To', 'Distance KM']);
      var usedEntryIndices = {};
      manualEntriesArray.forEach(function (m) {
        var date = m.date || '';
        var from = '';
        var to = '';
        var dist = '';
        for (var i = 0; i < entries.length; i++) {
          if (usedEntryIndices[i]) continue;
          var e = entries[i];
          var mFrom = (m.from != null ? m.from : '').toString().trim();
          var mTo = (m.to != null ? m.to : '').toString().trim();
          if (e.date === date && stripAddressSuffix(e.from || '') === stripAddressSuffix(mFrom) && stripAddressSuffix(e.to || '') === stripAddressSuffix(mTo)) {
            date = e.date || date;
            from = stripAddressSuffix(e.from || '');
            to = stripAddressSuffix(e.to || '');
            dist = (e.businessKm != null && e.businessKm !== '') ? e.businessKm : '';
            usedEntryIndices[i] = true;
            break;
          }
        }
        if (from === '' && to === '') {
          from = (m.from != null ? m.from : '').toString();
          to = (m.to != null ? m.to : '').toString();
          dist = (m.businessKm != null && m.businessKm !== '') ? m.businessKm : '';
        }
        summaryData.push([date, from, to, dist]);
      });
    } else {
      summaryData.push(['No manual trips added.']);
    }
    summaryData.push([]);

    summaryData.push(['Leave Days Applied']);
    var leaveItems = (leaveDaysArray || []).slice().filter(function (item) {
      return item && (item.date || '');
    });
    
    // 🔥 ADD THIS SUMMARY LINE
    summaryData.push(['Total Leave Days', leaveItems.length]);
    
    // (keep your existing sort)
    leaveItems.sort(function (a, b) {
      return (a.date || '').localeCompare(b.date || '');
    });
    if (leaveItems.length > 0) {
      summaryData.push(['Date', 'Description']);
      leaveItems.forEach(function (item) {
        var dateStr = item.date || '';
        var purpose = (item.purpose != null ? item.purpose : item.reason != null ? item.reason : 'Leave').toString().trim() || 'Leave';
        var weekday = '';
        if (dateStr && dateStr.length >= 10) {
          var d = new Date(dateStr + 'T12:00:00');
          if (!isNaN(d.getTime())) weekday = d.toLocaleDateString('en-ZA', { weekday: 'long' });
        }
        summaryData.push([dateStr, weekday + ' – ' + purpose]);
      });
    } else {
      summaryData.push(['No leave days applied.']);
    }
    summaryData.push([]);

    summaryData.push(['Weekend Trips Detected']);
    var weekendTrips = [];
    entries.forEach(function (e) {
      if (!e.date || e.date.length < 10) return;
      if (!isWeekend(e.date)) return;
      if (isNoTripsDay(e)) return;
      var desc = (e.from || '') + ' to ' + (e.to || '');
      if (e.purpose) desc += ' – ' + (e.purpose || '');
      weekendTrips.push({ date: e.date, description: desc.trim() || 'Trip' });
    });
    if (weekendTrips.length > 0) {
      summaryData.push(['Date', 'Trip Description']);
      weekendTrips.forEach(function (t) {
        summaryData.push([t.date, t.description]);
      });
    } else {
      summaryData.push(['No weekend travel detected.']);
    }
    summaryData.push([]);

    summaryData.push(['Addresses Requiring Review']);
    var addressWarnings = (meta.warnings && Array.isArray(meta.warnings)) ? meta.warnings : [];
    if (addressWarnings.length > 0) {
      summaryData.push(['Address']);
      addressWarnings.forEach(function (w) {
        summaryData.push([typeof w === 'string' ? w : String(w)]);
      });
    } else {
      summaryData.push(['No address issues detected.']);
    }

    var summarySheet = XLSX.utils.aoa_to_sheet(summaryData);
    var summaryRows = summaryData.length;
    var sectionTitles = ['Logbook Summary / Review Notes', 'Basic Information', 'Manual Trips Added', 'Leave Days Applied', 'Weekend Trips Detected', 'Addresses Requiring Review'];
    for (var sr = 0; sr < summaryRows; sr++) {
      var a1Ref = XLSX.utils.encode_cell({ r: sr, c: 0 });
      var cell = summarySheet[a1Ref];
      if (cell && summaryData[sr] && summaryData[sr][0] && sectionTitles.indexOf(summaryData[sr][0]) !== -1) {
        var existingStyle = cell.s || {};
        var existingFont = existingStyle.font || {};
        cell.s = Object.assign({}, existingStyle, {
          font: Object.assign({}, existingFont, { bold: true })
        });
      }
    }
    summarySheet['!cols'] = [{ wch: 24 }, { wch: 50 }];

    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Logbook');
    XLSX.utils.book_append_sheet(wb, summarySheet, 'Summary');
    XLSX.writeFile(wb, 'auto-logbook-sa-logbook.xlsx');
    return true;
  }

  function readFileAsArrayBuffer(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = function () { reject(new Error('Failed to read file')); };
      reader.readAsArrayBuffer(file);
    });
  }

  /** Prefer user-facing line: currentAddress (post-edit) then address. */
  function fullAddressFromBackend(route) {
    if (route == null) return '';
    if (route.currentAddress != null && String(route.currentAddress).trim() !== '') {
      return String(route.currentAddress);
    }
    if (route.address == null) return '';
    return String(route.address);
  }

  /** UI-only: presence of numeric coords (0 is valid; avoid truthiness on lat/lng). */
  function routeHasNumericLatLng(r) {
    return r != null && typeof r.lat === 'number' && typeof r.lng === 'number';
  }

  /** UI-only: engine needs coordinates (backend sets lat/lng). */
  function routesHaveLatLng(routes) {
    if (!routes || !Array.isArray(routes) || routes.length === 0) return false;
    return routes.every(routeHasNumericLatLng);
  }

  function getRoutePreviewBadgeLabel(routeObj) {
    if (!routeHasNumericLatLng(routeObj)) return '\u26A0 Reprocess required';
    var st = routeObj.resolutionStatus;
    if (st === 'WARN') return '\u26A0 Review';
    if (st === 'needs_attention' || st === 'REJECT') return '\u26A0 Needs attention';
    if (st === 'ok' || st === 'ok_places' || st === 'ok_db' || st === 'ok_cache' || st === 'ACCEPT' || st === 'google') {
      return '\u2714 OK';
    }
    if (routeObj.failed === true) return '\u26A0 Needs attention';
    return '\u2714 OK';
  }

  function buildRouteVerifiedReadOnlyInnerHtml(routeObj) {
    var addrVal = '';
    if (routeObj.currentAddress != null && String(routeObj.currentAddress).trim() !== '') {
      addrVal = String(routeObj.currentAddress);
    } else if (routeObj.address != null) {
      addrVal = String(routeObj.address);
    }
    var suburbVal = routeObj.suburb != null ? String(routeObj.suburb) : '';
    var cityVal = routeObj.city != null ? String(routeObj.city) : '';
    var provinceVal = routeObj.province != null ? String(routeObj.province) : '';
    var metaLine = [suburbVal, cityVal, provinceVal].filter(function (x) { return x; }).join(', ');
    var lbl = getRoutePreviewBadgeLabel(routeObj);
    return '<div class="route-row">' +
      '<div class="route-text"><div class="route-title">' + escapeAttrForPreview(routeObj.customer) + '</div><div class="route-address">' + escapeAttrForPreview(addrVal) + '</div>' +
      '<div class="route-address-meta">' + escapeAttrForPreview(metaLine) + '</div></div>' +
      '<span class="route-status-badge">' + lbl + '</span>' +
      '<button type="button" class="route-verified-edit-btn btn btn-secondary btn-sm">Edit</button>' +
      '</div>';
  }

  function clearRouteResolutionState(route) {
    if (!route) return;
    route._resolved = false;
    route.resolutionStatus = null;
    route.lat = null;
    route.lng = null;
    route.confidence = null;
    route.addressEdited = false;
  }

  function routeResolutionOk(r) {
    if (!r) return false;
    if ((r.address || '').toString().trim() !== '') return true;
    return (
      r._resolved === true &&
      (r.resolutionStatus === 'ok' ||
        r.resolutionStatus === 'ok_places' ||
        r.resolutionStatus === 'ok_db' ||
        r.resolutionStatus === 'ok_cache' ||
        r.resolutionStatus === 'ACCEPT' ||
        r.resolutionStatus === 'google')
    );
  }

  function buildCanonicalCustomer(input) {
    if (!input) return '';
    return String(input)
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/-\s*\d+/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }
  console.log("STEP 4 — BEFORE CANONICAL");
  window.buildCanonicalCustomer = buildCanonicalCustomer;
  console.log("STEP 5 — AFTER CANONICAL");

  function normalizeCustomerName(name) {
    return String(name || '')
      .toLowerCase()
      .replace(/-\s*\d+/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function detectDuplicateStores(routes) {
    var map = {};
    if (!Array.isArray(routes)) return [];
    routes.forEach(function (r, index) {
      var key = normalizeCustomerName(r && r.customer);
      if (!key) return;
      if (!map[key]) map[key] = [];
      map[key].push({ route: r, index: index });
    });
    return Object.keys(map)
      .filter(function (k) { return map[k].length > 1; })
      .map(function (key) {
        var list = map[key];
        return { key: key, count: list.length, entries: list };
      });
  }

  /**
   * Mirrors public/engine/parseRouteListExcel.js routeRowHasAnyWeekday — same shapes as parser + backend preview routes.
   */
  function routePreviewHasAnyWeekday(route) {
    if (!route || typeof route !== 'object') return false;
    if (route.days && typeof route.days === 'object') {
      return !!(
        route.days.mon ||
        route.days.tue ||
        route.days.wed ||
        route.days.thu ||
        route.days.fri ||
        route.days.sat
      );
    }
    if (route.mon || route.tue || route.wed || route.thu || route.fri || route.sat) return true;
    if (route.day != null && String(route.day).trim() !== '') return true;
    return false;
  }

  function detectInvalidRoutes(routes) {
    if (!Array.isArray(routes)) return [];
    if (window._routelistMode !== 'salesRep') return [];
    var invalidWeekday = routes.filter(function (route) {
      if (!route) return false;
      if (route.mode === 'date') return false;
      return !routePreviewHasAnyWeekday(route);
    });
    if (invalidWeekday.length && typeof console !== 'undefined' && console.log) {
      console.log(
        'TRACE INVALID ROUTES:',
        invalidWeekday.map(function (r) {
          return {
            customer: r.customer,
            _routeId: r._routeId,
            rowIndex: r.rowIndex,
            weeks: r.weeks,
            days: r.days,
            day: r.day
          };
        })
      );
    }
    return invalidWeekday;
  }

  function detectMissingWeeks(routes) {
    if (window._routelistMode !== 'salesRep') return [];

    var missingWeek = (routes || []).filter(function (route) {
      if (!route) return false;
      if (route.mode === 'date') return false;

      return Array.isArray(route.weeks) && route.weeks.length === 0;
    });
    if (missingWeek.length && typeof console !== 'undefined' && console.log) {
      console.log(
        'TRACE INVALID ROUTES:',
        missingWeek.map(function (r) {
          return {
            customer: r.customer,
            _routeId: r._routeId,
            rowIndex: r.rowIndex,
            weeks: r.weeks,
            days: r.days,
            day: r.day
          };
        })
      );
    }
    if (typeof console !== 'undefined' && console.log) {
      console.log(
        'MISSING WEEK CHECK INPUT:',
        (routes || []).map(function (r) {
          return {
            customer: r.customer,
            weeks: r.weeks,
            mode: r.mode,
            _routeId: r._routeId
          };
        })
      );
      console.log(
        'MISSING WEEK RESULT:',
        (routes || [])
          .filter(function (route) {
            if (!route) return false;
            if (route.mode === 'date') return false;
            return Array.isArray(route.weeks) && route.weeks.length === 0;
          })
          .map(function (r) {
            return {
              customer: r.customer,
              weeks: r.weeks,
              _routeId: r._routeId
            };
          })
      );
    }
    return missingWeek;
  }

  function detectCityMismatches(routes) {
    if (window._routelistMode !== 'salesRep') return [];
    if (!Array.isArray(routes)) return [];

    var selected =
      window.selectedCities && window.selectedCities.length
        ? window.selectedCities
        : ['cape_town'];

    return routes.filter(function (r) {
      if (!r) return false;

      var city = String(r.city != null ? r.city : '').toLowerCase();
      var province = String(r.province != null ? r.province : '').toLowerCase();

      var isMatch = selected.some(function (sel) {

        // 🔥 Cape Town = Western Cape
        if (sel === 'cape_town') {
          return province.includes('western cape');
        }

        // 🔥 Johannesburg = Gauteng
        if (sel === 'johannesburg') {
          return province.includes('gauteng');
        }

        // 🔥 Pretoria = Gauteng
        if (sel === 'pretoria') {
          return province.includes('gauteng');
        }

        // 🔥 Durban = KwaZulu-Natal
        if (sel === 'durban') {
          return province.includes('kwazulu-natal');
        }

        // 🔥 Port Elizabeth = Eastern Cape
        if (sel === 'port_elizabeth') {
          return province.includes('eastern cape');
        }

        // 🔥 East London = Eastern Cape
        if (sel === 'east_london') {
          return province.includes('eastern cape');
        }

        return false;
      });

      return !isMatch;
    });
  }

  function detectRegionMismatches(routes) {
    if (window._routelistMode !== 'salesRep') return [];
    if (!Array.isArray(routes)) return [];
    return routes.filter(function (r) {
      return r && r._flag === 'wrong_region';
    });
  }

  function renderInvalidRouteError(invalidRoutes, allRoutes) {
    var container = document.getElementById('routesContainer');
    if (!container) return;

    var parent = container.parentNode;
    if (parent) {
      var oldBanners = parent.querySelectorAll('.invalid-route-error');
      for (var ob = 0; ob < oldBanners.length; ob++) {
        oldBanners[ob].remove();
      }
    }

    var clearItems = container.querySelectorAll('.route-verified-item');
    for (var ci = 0; ci < clearItems.length; ci++) {
      clearItems[ci].classList.remove('duplicate-highlight');
    }

    if (!invalidRoutes || invalidRoutes.length === 0) return;

    var banner = document.createElement('div');
    banner.className = 'invalid-route-error';
    banner.textContent =
      'Some routes have no days selected. Please select at least one weekday for each route in your Excel file and upload again.';

    // Same placement as renderDuplicateError: first child of #routelistPreview (above "Routes" heading).
    parent.insertBefore(banner, parent.firstChild);

    var list = Array.isArray(allRoutes) ? allRoutes : [];
    var indices = invalidRoutes
      .map(function (r) {
        return list.indexOf(r);
      })
      .filter(function (i) {
        return i >= 0;
      });
    invalidRoutes.forEach(function (r) {
      var idx = list.indexOf(r);
      var sel = '.route-verified-item[data-route-index="' + idx + '"]';
      var el = idx >= 0 && container ? container.querySelector(sel) : null;
      if (typeof console !== 'undefined' && console.log) {
        console.log('TRACE HIGHLIGHT MATCH:', {
          customer: r.customer,
          _routeId: r._routeId,
          rowIndex: r.rowIndex,
          selector: sel,
          found: !!el
        });
      }
    });
    highlightRoutesLikeDuplicates(indices);
  }

  function renderMissingWeekError(invalidRoutes, routes) {
    var container = document.getElementById('routesContainer');
    if (!container) return;

    var parent = container.parentNode;
    if (parent) {
      var existing = parent.querySelectorAll('.missing-week-error');
      for (var mw = 0; mw < existing.length; mw++) {
        existing[mw].remove();
      }
    }

    if (!invalidRoutes || !invalidRoutes.length) return;

    var banner = document.createElement('div');
    banner.className = 'missing-week-error duplicate-error';
    banner.textContent =
      'Some routes have no week selected. Please select at least one week for each route in your Excel file and upload again.';

    parent.insertBefore(banner, parent.firstChild);

    invalidRoutes.forEach(function (r) {
      var container = document.getElementById('routesContainer');
      if (!container) return;

      var el = container.querySelector('.route-verified-item[data-route-id="' + r._routeId + '"]');
      if (el) {
        el.classList.add('duplicate-highlight');
      }
    });
  }

  function renderRegionMismatchError(invalidRoutes, routes) {
    var container = document.getElementById('routesContainer');
    if (!container) return;

    var parent = container.parentNode;
    if (parent) {
      var existing = parent.querySelectorAll('.region-mismatch-error');
      for (var rm = 0; rm < existing.length; rm++) {
        existing[rm].remove();
      }
    }

    if (!invalidRoutes || !invalidRoutes.length) return;

    var banner = document.createElement('div');
    banner.className = 'duplicate-error region-mismatch-error';
    var n = invalidRoutes.length;
    banner.innerHTML =
      '⚠️ Location mismatch detected<br>' +
      n +
      ' store(s) appear outside your selected region';

    parent.insertBefore(banner, parent.firstChild);

    invalidRoutes.forEach(function (r) {
      var c = document.getElementById('routesContainer');
      if (!c) return;

      var el = c.querySelector('.route-verified-item[data-route-id="' + String(r._routeId) + '"]');
      if (el) {
        el.classList.add('duplicate-highlight');
      }
    });
  }

  function renderCityMismatchError(invalidRoutes) {
    var container = document.getElementById('routesContainer');
    var parent = container ? container.parentNode : null;
    if (!parent) return;

    var existing = parent.querySelectorAll('.city-mismatch-error');
    var ex;
    for (ex = 0; ex < existing.length; ex++) {
      existing[ex].remove();
    }

    if (!invalidRoutes || !invalidRoutes.length) return;

    var banner = document.createElement('div');
    banner.className = 'duplicate-error city-mismatch-error';
    banner.innerHTML =
      '\u26A0\uFE0F Location mismatch detected<br>' +
      invalidRoutes.length +
      ' store(s) appear outside your selected city/cities';

    parent.insertBefore(banner, parent.firstChild);

    invalidRoutes.forEach(function (r) {
      if (!container) return;

      var el = container.querySelector('.route-verified-item[data-route-id="' + String(r._routeId) + '"]');
      if (el) el.classList.add('duplicate-highlight');
    });
  }

  function showSuccessMessage(msg) {
    var routes = window.currentRoutes || [];

    var duplicates = detectDuplicateStores(routes);
    var invalidDays = detectInvalidRoutes(routes);
    var missingWeeks = detectMissingWeeks(routes);
    var regionMismatches = detectRegionMismatches(routes);
    var cityMismatches = detectCityMismatches(routes);

    if (
      (duplicates && duplicates.length) ||
      (invalidDays && invalidDays.length) ||
      (missingWeeks && missingWeeks.length) ||
      (regionMismatches && regionMismatches.length) ||
      (cityMismatches && cityMismatches.length)
    ) {
      console.log('🚫 BLOCKING SUCCESS MESSAGE — validation issues exist');
      return;
    }

    var statusEl = document.getElementById('routeStatus');
    if (!statusEl) return;

    statusEl.innerHTML = '';

    var div = document.createElement('div');
    div.className = 'success-message';
    div.textContent = msg;

    statusEl.appendChild(div);
  }

  function updateRoutelistStatus(routes) {
    var modeRs = window._routelistMode || (function () {
      try {
        var sm = localStorage.getItem('routelistMode');
        if (sm === 'business' || sm === 'salesRep') return sm;
      } catch (e) { /* ignore */ }
      return 'salesRep';
    })();
    var duplicates = modeRs === 'salesRep' ? detectDuplicateStores(routes) : [];
    var invalidDays = detectInvalidRoutes(routes);
    var missingWeeks = detectMissingWeeks(routes);
    var regionMismatches = detectRegionMismatches(routes);
    var cityMismatches = detectCityMismatches(routes);

    var statusEl = document.getElementById('routeStatus');
    if (statusEl) {
      var successNodes = statusEl.querySelectorAll('.success-message');
      for (var sn = 0; sn < successNodes.length; sn++) {
        successNodes[sn].remove();
      }
    }

    var previewRoot = document.getElementById('routelistPreview');
    var bannerScope = previewRoot || document;
    var dupErrs = bannerScope.querySelectorAll('.duplicate-error');
    for (var de = 0; de < dupErrs.length; de++) {
      dupErrs[de].remove();
    }
    var invErrs = bannerScope.querySelectorAll('.invalid-route-error');
    for (var ie = 0; ie < invErrs.length; ie++) {
      invErrs[ie].remove();
    }

    if (duplicates && duplicates.length) {
      renderDuplicateError(duplicates);
      if (statusEl) {
        statusEl.textContent = '';
        statusEl.style.color = '';
      }
      return;
    }

    if (invalidDays && invalidDays.length) {
      renderInvalidRouteError(invalidDays, routes);
      if (statusEl) {
        statusEl.textContent = '';
        statusEl.style.color = '';
      }
      return;
    }

    if (missingWeeks && missingWeeks.length) {
      renderMissingWeekError(missingWeeks, routes);
      if (statusEl) {
        statusEl.textContent = '';
        statusEl.style.color = '';
      }
      return;
    }

    if (regionMismatches && regionMismatches.length) {
      renderRegionMismatchError(regionMismatches, routes);
      if (statusEl) {
        statusEl.textContent = '';
        statusEl.style.color = '';
      }
      return;
    }

    if (cityMismatches && cityMismatches.length) {
      renderCityMismatchError(cityMismatches);
      if (statusEl) {
        statusEl.textContent = '';
        statusEl.style.color = '';
      }
      return;
    }

    showSuccessMessage('All addresses processed successfully. You are ready to generate your logbook.');
  }

  function highlightRoutesLikeDuplicates(indices) {
    var container = document.getElementById('routesContainer');
    if (!container) return;
    indices.forEach(function (idx) {
      var el = container.querySelector('.route-verified-item[data-route-index="' + idx + '"]');
      if (el) el.classList.add('duplicate-highlight');
    });
  }

  function renderDuplicateError(duplicates) {
    var container = document.querySelector('#routesContainer');
    var routesSection = container && container.parentElement;
    if (!routesSection) return;

    var prevMsgs = routesSection.querySelectorAll('.duplicate-error');
    for (var pi = 0; pi < prevMsgs.length; pi++) {
      prevMsgs[pi].remove();
    }
    if (container) {
      var inList = container.querySelectorAll('.duplicate-error');
      for (var px = 0; px < inList.length; px++) {
        inList[px].remove();
      }
    }

    var prevItems = container ? container.querySelectorAll('.route-verified-item') : [];
    for (var pj = 0; pj < prevItems.length; pj++) {
      prevItems[pj].style.border = '';
    }

    if (!duplicates || duplicates.length === 0) return;

    var message = document.createElement('div');
    message.className = 'duplicate-error';
    message.innerText = 'Duplicate stores found. Please remove duplicates from your Excel file and upload again.';

    routesSection.insertBefore(message, routesSection.firstChild);

    duplicates.forEach(function (dup) {
      var entries = dup && dup.entries ? dup.entries : [];
      if (entries.length > 0) {
        entries.forEach(function (ent) {
          var idx = ent.index;
          var el = container.querySelector('.route-verified-item[data-route-index="' + idx + '"]');
          if (el) el.style.border = '1px solid red';
        });
      } else {
        var name = dup && dup.key != null ? dup.key : String(dup);
        var items = container.querySelectorAll('.route-verified-item');
        items.forEach(function (el) {
          if (el.innerText.toLowerCase().indexOf(String(name).toLowerCase()) !== -1) {
            el.style.border = '1px solid red';
          }
        });
      }
    });
  }

  function showRouteLoading() {
    var container = document.querySelector('#routesContainer');
    if (!container) return;
    var previewEl = document.getElementById('routelistPreview');
    var dupScope = previewEl || container.parentElement || container;
    var dupes = dupScope.querySelectorAll('.duplicate-error');
    for (var di = 0; di < dupes.length; di++) {
      dupes[di].remove();
    }
    var inv = dupScope.querySelectorAll('.invalid-route-error');
    for (var ii = 0; ii < inv.length; ii++) {
      inv[ii].remove();
    }
    var content = document.getElementById('routelistPreviewContent');
    if (!content) {
      container.innerHTML =
        '<div id="routelistPreviewContent" class="routelist-preview-content routes-scroll" aria-label="Routelist verification">' +
        '<div class="routelist-loading">Processing your route list...</div></div>';
    } else {
      content.innerHTML = '<div class="routelist-loading">Processing your route list...</div>';
    }
    var wrap = document.getElementById('routelistPreview');
    if (wrap) {
      wrap.classList.remove('hidden');
      wrap.style.display = '';
    }
  }

  function hideRouteLoading() {
    var content = document.getElementById('routelistPreviewContent');
    if (!content) return;
    var loading = content.querySelector('.routelist-loading');
    if (loading) {
      loading.remove();
    }
  }

  /**
   * Run the full routelist workflow: parse Excel → preview (parsed data only).
   * Used by both file input change (auto) and Generate button (fallback).
   */
  function processRoutelistFile(file) {
    var status = document.getElementById('routeStatus');
    if (!file || !/\.(xlsx|xls)$/i.test(file.name || '')) return;
    lastProcessedRoutelistFileId = file.name + '-' + file.size;
    readFileAsArrayBuffer(file).then(function (buffer) {
      // Clear previously stored routes so a new file always replaces; no reuse of cached routes.
      var cleared = logbookService ? logbookService.clearRoutes() : undefined;
      var runAfterClear = function () {
        try {
        var routes;
        var templateType = 'sales';
        var headerLabels = [];
        var raw = null;
        var sheetRows = null;

        var XLSX = typeof window !== 'undefined' && window.XLSX;
        if (XLSX) {
          try {
            var workbook = XLSX.read(buffer, { type: 'array', cellDates: false });
            var sheetName = workbook.SheetNames[0];
            var worksheet = workbook.Sheets[sheetName];
            sheetRows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: null });
            const row0 = (sheetRows[0] || []).map(function (c) {
              return (c != null ? String(c) : '').trim();
            });

            const row0Lower = row0.map(function (h) {
              return h.toLowerCase();
            });

            function hasHeader(name) {
              return row0Lower.includes(String(name).toLowerCase());
            }

            // REAL TEMPLATE RULES
            // SALES template headers:
            //   Customer, Monday..Saturday, Week
            // BUSINESS template headers:
            //   Location, Purpose, Monday..Saturday, Frequency, Start Date, End Date

            const isBusinessTemplate =
              hasHeader('start date') &&
              hasHeader('frequency');

            const isSalesTemplate =
              hasHeader('week') &&
              hasHeader('customer');

            if (isBusinessTemplate) {
              templateType = 'business';
              headerLabels = row0;
            } else {
              templateType = 'sales';
              headerLabels = row0;
            }

            console.log('[AUDIT HEADERS]', row0);
            console.log('[AUDIT TEMPLATE SELECTED]', templateType);
          } catch (e) { /* fall through to default sales */ }
        }
        console.log('[BUSINESS_PARSER_EXISTS]', typeof window.parseBusinessRoutes);
        console.log('[SALES_PARSER_EXISTS]', typeof window.parseRouteListExcel);

        if (templateType !== 'business') {
          raw = parseRawRouteListExcel(buffer);
          headerLabels = (raw.headerRow || []).map(function (c) { return (c != null ? String(c) : '').trim(); });
          if (DEBUG_ROUTELIST) {
            console.log('[DEBUG_ROUTELIST] columnMap (detected column indices):', raw.columnMap);
            console.log('[DEBUG_ROUTELIST] detected column names (header labels):', raw.detectedColumnNames || { address: raw.headerRow && raw.columnMap.addressCol != null ? raw.headerRow[raw.columnMap.addressCol] : null, suburb: raw.headerRow && raw.columnMap.suburbCol != null ? raw.headerRow[raw.columnMap.suburbCol] : null, city: raw.headerRow && raw.columnMap.cityCol != null ? raw.headerRow[raw.columnMap.cityCol] : null, province: raw.headerRow && raw.columnMap.provinceCol != null ? raw.headerRow[raw.columnMap.provinceCol] : null, customer: raw.headerRow && raw.columnMap.customerCol != null ? raw.headerRow[raw.columnMap.customerCol] : null });
            console.log('[DEBUG_ROUTELIST] raw parsed:', { headerRowIndex: raw.headerRowIndex, rowCount: raw.rows.length, firstRows: raw.rows.slice(0, 3) });
          }
        }

        // Exactly one parser runs: business OR sales (parseRaw + enrich), never both.
        var auditParserUsed = 'none';
        if (templateType === 'business' && typeof window.parseBusinessRoutes === 'function' && sheetRows && sheetRows.length > 0) {
          var dataRows = sheetRows.slice(1);
          var rowObjects = dataRows.map(function (rowArr) {
            var obj = {};
            for (var c = 0; c < headerLabels.length; c++) {
              if (headerLabels[c]) obj[headerLabels[c]] = rowArr[c];
            }
            return obj;
          });
          routes = window.parseBusinessRoutes(rowObjects);
          auditParserUsed = 'parseBusinessRoutes';
          console.log('[PARSER_USED]', 'parseBusinessRoutes');
        } else {
          if (raw != null) {
            routes = enrichRouteRows(raw);
            console.log("UI AFTER PARSER:", routes.map(function (r) {
              return {
                customer: r.customer,
                days: r.days,
                weeks: r.weeks,
                rowIndex: r.rowIndex
              };
            }));
            routes = routes.map(function (row) {
              var rawCustomer = (row.Customer || row.Location || row.client || row.location || row.customer || '');
              var customer = buildCanonicalCustomer(rawCustomer);
              if (!customer || customer === '<TEMP>') return null;
              return Object.assign({}, row, { customer: customer });
            }).filter(Boolean);
            auditParserUsed = 'enrichRouteRows';
            console.log('[PARSER_USED]', 'parseRouteListExcel');
          } else {
            routes = [];
            auditParserUsed = 'skipped (raw null)';
          }
        }
        console.log('[AUDIT PARSER USED]', auditParserUsed);
        if (routes && routes.length > 0) {
          routes.forEach(function (route) {
            console.log('STEP 1 PARSED ROUTE:', {
              customer: route.customer,
              address: route.address,
              suburb: route.suburb,
              city: route.city,
              province: route.province
            });
          });
        }
        console.log('RAW ROUTES:', routes);
        console.log('[AUDIT RAW ROUTES]', routes);
        if (routes && routes[0]) {
          console.log('[AUDIT SAMPLE ROUTE]', routes[0]);
          var r0 = routes[0];
          console.log('[AUDIT ROUTE STRUCTURE]', {
            customer: r0.customer,
            days: r0.days,
            weeks: r0.weeks,
            mode: r0.mode
          });
        }
        window._routelistMode = templateType === 'business' ? 'business' : 'salesRep';
        try {
          localStorage.setItem('routelistMode', window._routelistMode);
        } catch (e) { /* ignore */ }
        var mode = window._routelistMode;
        var duplicates = detectDuplicateStores(routes);
        if (mode === 'salesRep' && duplicates.length > 0) {
          console.error('[VALIDATION] Duplicate stores not allowed in salesRep mode', duplicates);
          window._hasSalesRepDuplicates = true;
          renderDuplicateError(duplicates);
        } else if (mode === 'salesRep') {
          window._hasSalesRepDuplicates = false;
          renderDuplicateError([]);
        }
        if (mode !== 'salesRep') {
          renderDuplicateError([]);
        }

        var previewWrap = document.getElementById('routelistPreview');
        if (previewWrap) previewWrap.classList.add('hidden');

        routes = routes.map(function (r, i) {
          return Object.assign({}, r, {
            _routeId: i,
            id: i,
            addressEdited: r.addressEdited === true
          });
        });
        if (routes && routes[0]) {
          console.log('[AUDIT BEFORE ENRICH]', routes[0]);
        }
        finishWithProcessedRoutes(routes);
        } catch (err) {
          if (status) {
            status.textContent = (err && err.message) ? err.message : 'Could not process routelist.';
            status.style.color = 'red';
          }
        }
      };
      if (cleared && typeof cleared.then === 'function') cleared.then(runAfterClear); else runAfterClear();
    }).catch(function () {
      if (status) { status.textContent = 'Failed to read file.'; status.style.color = 'red'; }
    });
  }

  function renderRoutelistPreview(routes) {
    const content = document.getElementById("routelistPreviewContent");
    if (!content) return;

    console.log("🔥 RENDERING:", routes);

    (routes || []).forEach(function (r, i) {
      if (!r._routeId) {
        r._routeId = 'route_' + i;
      }
    });

    const html = (routes || []).map(function (r, i) {
      if (typeof console !== 'undefined' && console.log) {
        console.log('TRACE PREVIEW ROW:', {
          customer: r.customer,
          _routeId: r._routeId,
          rowIndex: r.rowIndex,
          previewIndex: i
        });
      }
      return '<div class="route-verified-item" data-route-index="' + i + '" data-route-id="' + escapeAttrForPreview(String(r._routeId)) + '">' + buildRouteVerifiedReadOnlyInnerHtml(r) + '</div>';
    }).join('');

    content.innerHTML = html;

    var wrap = document.getElementById('routelistPreview');
    if (wrap) {
      if ((routes || []).length) {
        wrap.classList.remove('hidden');
        wrap.style.display = '';
      } else {
        wrap.classList.add('hidden');
        window._hasSalesRepDuplicates = false;
      }
    }

    console.log('PREVIEW ROUTE SAMPLE FOR INVALID-DAY CHECK:', routes && routes[0]);
    var invalidSampleLog = detectInvalidRoutes(routes || []);
    if (invalidSampleLog.length > 0) {
      console.log('PREVIEW ROUTE SAMPLE MISSING WEEKDAY:', invalidSampleLog[0]);
    }

    if (typeof window.validateLogbookForm === 'function') window.validateLogbookForm();

    var modeDup = window._routelistMode;
    var dupAfterRender = detectDuplicateStores(routes || []);
    if (modeDup === 'salesRep' && dupAfterRender.length > 0) {
      renderDuplicateError(dupAfterRender);
    } else {
      renderDuplicateError([]);
    }
    var invalidAfterRender =
      modeDup === 'salesRep'
        ? detectInvalidRoutes(routes || [])
        : [];
    renderInvalidRouteError(invalidAfterRender, routes || []);
    var missingWeeks = detectMissingWeeks(routes || []);
    renderMissingWeekError(missingWeeks, routes || []);
    const mismatches = detectRegionMismatches(routes || []);
    renderRegionMismatchError(mismatches, routes || []);
    const cityMismatches = detectCityMismatches(routes || []);
    renderCityMismatchError(cityMismatches);
  }

  function syncRouteStatusWarnHelper(routes) {
    var id = 'routeStatus-warn-helper';
    var existing = document.getElementById(id);
    if (existing) existing.remove();
    var statusEl = document.getElementById('routeStatus');
    if (!statusEl || !routes || !Array.isArray(routes) || routes.length === 0) return;
    if (!routes.some(function (r) { return r.resolutionStatus === "WARN"; })) return;
    var div = document.createElement('div');
    div.id = id;
    div.textContent = 'Yellow items are approximate matches. If correct, you can continue. If not, please edit the address.';
    statusEl.appendChild(div);
  }

  function updateRouteStatusFromRoutes(routes) {
    var statusEl = document.getElementById('routeStatus');
    if (!statusEl || !routes || !Array.isArray(routes) || routes.length === 0) {
      syncRouteStatusWarnHelper(null);
      return;
    }
    var modeRs = window._routelistMode || (function () {
      try {
        var sm = localStorage.getItem('routelistMode');
        if (sm === 'business' || sm === 'salesRep') return sm;
      } catch (e) { /* ignore */ }
      return 'salesRep';
    })();
    if (modeRs === 'salesRep' && detectDuplicateStores(routes).length > 0) {
      updateRoutelistStatus(routes);
      syncRouteStatusWarnHelper(routes);
      return;
    }
    if (routes.some(function (r) { return r != null && !routeHasNumericLatLng(r); })) {
      statusEl.textContent = 'Click Reprocess addresses to prepare routes before generating your logbook.';
      statusEl.style.color = '#b8860b';
      syncRouteStatusWarnHelper(routes);
      return;
    }
    var needsAttention = routes.some(function (r) {
      if (!r) return false;
      if (r.failed === true) return true;
      if (r.resolutionStatus === 'needs_attention' || r.resolutionStatus === 'REJECT') return true;
      return !routeResolutionOk(r);
    });
    if (needsAttention) {
      statusEl.textContent = 'All addresses have been processed. Some locations need your attention. Please review them in the list below.';
      statusEl.style.color = '#b8860b';
    } else {
      updateRoutelistStatus(routes);
    }
    syncRouteStatusWarnHelper(routes);
  }

  async function finishWithProcessedRoutes(routes) {
    try {
      console.log('🔥 SAVE TRIGGERED');
      showRouteLoading();
      const sessionToken = new URLSearchParams(window.location.search).get('token')?.trim();
      var processUrl = LOGBOOK_FUNCTIONS_BASE + '/processRoutelistUpload';
      console.log('🔥 SAVE REQUEST URL:', processUrl);
      console.log('🔥 SAVE REQUEST BODY:', { routes: routes });
      var idToken = await getAdminEmbedIdTokenAsPromise();
      const uploadHeaders = {
        'Content-Type': 'application/json'
      };
      if (idToken) {
        uploadHeaders['Authorization'] = 'Bearer ' + idToken;
      }
      if (isAdminDashboardEmbed) {
        uploadHeaders['X-Admin-Dashboard'] = 'true';
      }
      if (sessionToken) {
        uploadHeaders['X-Logbook-Token'] = sessionToken;
      }
      syncWorkingRegionSelection();
      var uploadBody = { routes: routes, selectedRegions: window.selectedRegions.slice() };
      if (sessionToken) {
        uploadBody.logbookAccessToken = sessionToken;
      }
      const res = await fetch(processUrl, {
        method: 'POST',
        headers: uploadHeaders,
        body: JSON.stringify(uploadBody)
      });
      const body = await res.json().catch(function () { return {}; });
      console.log('🔥 SAVE RESPONSE:', body);
      console.log("🔥 BACKEND RESPONSE ROUTES:", body.routes);
      if (!res.ok) {
        var errParts = [];
        if (body && body.error) errParts.push(String(body.error));
        if (body && body.message) errParts.push(String(body.message));
        throw new Error(errParts.length ? errParts.join(': ') : ('HTTP ' + res.status));
      }
      if (!body.routes || !Array.isArray(body.routes)) {
        throw new Error('Invalid processRoutelistUpload response');
      }
      window.currentRoutes = body.routes;
      for (var fj = 0; fj < window.currentRoutes.length; fj++) {
        if (window.currentRoutes[fj]) {
          window.currentRoutes[fj].fullAddress = fullAddressFromBackend(window.currentRoutes[fj]);
        }
      }
      hideRouteLoading();
      renderRoutelistPreview(window.currentRoutes);
      updateRouteStatusFromRoutes(window.currentRoutes);
    } catch (err) {
      console.error('🔥 SAVE ERROR:', err);
      console.error("🔥 RESOLVER ERROR:", err);
      hideRouteLoading();
    }
  }

  function escapeAttrForPreview(s) {
    return (s != null ? String(s) : '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /**
   * Apply reprocessPreviewRoutes response rows into window.currentRoutes by index, then refresh preview UI.
   * Shared by per-row Save (single index) and Reprocess addresses (batch).
   */
  function mergeReprocessRoutesIntoPreview(editedIndices, responseRoutes) {
    if (!responseRoutes || !Array.isArray(responseRoutes)) {
      throw new Error('Invalid reprocess response');
    }
    if (responseRoutes.length !== editedIndices.length) {
      throw new Error('Reprocess response count does not match edited routes');
    }
    var schedulePreserveKeys = [
      'days',
      'weeks',
      'week',
      'mode',
      'mon',
      'tue',
      'wed',
      'thu',
      'fri',
      'sat',
      'day',
      'startDate',
      'endDate',
      'frequency',
      'rowIndex',
      '_routeId'
    ];
    var mi;
    for (mi = 0; mi < responseRoutes.length; mi++) {
      var slot = editedIndices[mi];
      var pr = responseRoutes[mi];
      if (typeof slot !== 'number' || slot < 0 || !window.currentRoutes || slot >= window.currentRoutes.length) {
        continue;
      }
      var existing = window.currentRoutes[slot];
      if (!existing || !pr || typeof pr !== 'object') {
        continue;
      }
      var mergedRow = Object.assign({}, existing, pr);
      var sk;
      for (sk = 0; sk < schedulePreserveKeys.length; sk++) {
        var key = schedulePreserveKeys[sk];
        if (existing[key] !== undefined) {
          mergedRow[key] = existing[key];
        }
      }
      if (existing.addressEdited === true || existing.isEdited === true) {
        if (existing.province !== undefined && existing.province !== null) {
          mergedRow.province = String(existing.province).trim();
        }
      }
      window.currentRoutes[slot] = mergedRow;
      if (window.currentRoutes[slot]) {
        window.currentRoutes[slot].isEdited = false;
        if (
          window.currentRoutes[slot].currentAddress != null &&
          String(window.currentRoutes[slot].currentAddress).trim() !== ''
        ) {
          window.currentRoutes[slot].address = window.currentRoutes[slot].currentAddress;
        }
        console.log('🔥 PREVIEW ROUTE:', window.currentRoutes[slot]);
        window.currentRoutes[slot].fullAddress = fullAddressFromBackend(window.currentRoutes[slot]);
      }
    }
    renderRoutelistPreview(window.currentRoutes);
    updateRouteStatusFromRoutes(window.currentRoutes);
  }

  function initRoutelistPreviewEdit() {
    var wrap = document.getElementById('routelistPreview');
    if (!wrap) return;
    wrap.addEventListener('input', function (e) {
      var target = e.target;
      var idx = target.getAttribute('data-index');
      var field = target.getAttribute('data-field');
      if (idx == null || field == null || !window.currentRoutes) return;
      var index = parseInt(idx, 10);
      if (isNaN(index) || index < 0 || index >= window.currentRoutes.length) return;
      var route = window.currentRoutes[index];
      var prevCustomer = (route.customer != null ? String(route.customer) : '').trim();
      route[field] = (target.value || '').trim();
      if (field === 'customer') {
        var nextCustomer = (route.customer != null ? String(route.customer) : '').trim();
        if (nextCustomer !== prevCustomer) {
          clearRouteResolutionState(route);
        }
      } else if (field === 'address') {
        route.addressEdited = true;
      } else if (field === 'suburb' || field === 'city' || field === 'province') {
        route.addressEdited = true;
      }
      route.isEdited = true;
      route.fullAddress = fullAddressFromBackend(route);
      updateRouteStatusFromRoutes(window.currentRoutes);
      userHasEditedAddress = true;
      var reprocessBtn = document.getElementById('reprocess-addresses-btn');
      if (reprocessBtn) reprocessBtn.classList.remove('hidden');
    });

    wrap.addEventListener('click', function (e) {
      var target = e.target;
      if (!target || !window.currentRoutes) return;
      var item = target.closest('.route-verified-item');
      if (!item) return;
      var index = parseInt(item.getAttribute('data-route-index'), 10);
      if (isNaN(index) || index < 0 || index >= window.currentRoutes.length) return;
      var route = window.currentRoutes[index];

      if (target.classList.contains('route-verified-edit-btn')) {
        e.preventDefault();
        var content = document.getElementById('routelistPreviewContent');
        var currentlyEditing = content && content.querySelector('.route-verified-item-editing');
        if (currentlyEditing && currentlyEditing !== item) {
          var otherIndex = parseInt(currentlyEditing.getAttribute('data-route-index'), 10);
          var otherRoute = window.currentRoutes[otherIndex];
          if (otherRoute) {
            currentlyEditing.innerHTML = buildRouteVerifiedReadOnlyInnerHtml(otherRoute);
            currentlyEditing.classList.remove('route-verified-item-editing');
          }
        }
        var addrVal = (route.currentAddress != null && String(route.currentAddress).trim() !== '')
          ? String(route.currentAddress)
          : (route.address != null ? String(route.address) : '');
        var customerVal = (route.customer != null ? String(route.customer) : '');
        var suburbVal = (route.suburb != null ? String(route.suburb) : '');
        var cityVal = (route.city != null ? String(route.city) : '');
        var provinceVal = (route.province != null ? String(route.province) : '');
        var editFormHtml = '<div class="route-verified-edit-form">' +
          '<div class="route-field route-field-full"><label class="route-label">Store Name</label><input type="text" class="routelist-edit-input" data-row-id="' + index + '" data-index="' + index + '" data-field="customer" value="' + escapeAttrForPreview(customerVal) + '" /></div>' +
          '<div class="route-field route-field-full"><label class="route-label">Address:</label><input type="text" class="routelist-edit-input" data-row-id="' + index + '" data-index="' + index + '" data-field="address" value="' + escapeAttrForPreview(addrVal) + '" /></div>' +
          '<div class="route-field-row">' +
          '<div class="route-field"><label class="route-label">Suburb:</label><input type="text" class="routelist-edit-input" data-row-id="' + index + '" data-index="' + index + '" data-field="suburb" value="' + escapeAttrForPreview(suburbVal) + '" /></div>' +
          '<div class="route-field"><label class="route-label">City:</label><input type="text" class="routelist-edit-input" data-row-id="' + index + '" data-index="' + index + '" data-field="city" value="' + escapeAttrForPreview(cityVal) + '" /></div>' +
          '</div>' +
          '<div class="route-field route-field-full"><label class="route-label">Province:</label><input type="text" class="routelist-edit-input" data-row-id="' + index + '" data-index="' + index + '" data-field="province" value="' + escapeAttrForPreview(provinceVal) + '" /></div>' +
          '<div class="route-verified-edit-actions">' +
          '<button type="button" class="route-verified-save-btn btn btn-primary btn-sm">Save</button> ' +
          '<button type="button" class="route-verified-cancel-btn btn btn-secondary btn-sm">Cancel</button>' +
          '</div></div>';
        item.innerHTML = editFormHtml;
        item.classList.add('route-verified-item-editing');
      } else if (target.classList.contains('route-verified-save-btn')) {
        e.preventDefault();
        console.log('🔥 SAVE TRIGGERED (preview row — reprocessPreviewRoutes for coordinates)');
        var form = item.querySelector('.route-verified-edit-form');
        if (!form) return;
        var prevCustomer = (route.customer != null ? String(route.customer) : '').trim();
        var inputs = form.querySelectorAll('input[data-field]');
        for (var k = 0; k < inputs.length; k++) {
          var inp = inputs[k];
          var field = inp.getAttribute('data-field');
          if (field) {
            var vIn = (inp.value || '').trim();
            route[field] = vIn;
          }
        }
        var nextCustomer = (route.customer != null ? String(route.customer) : '').trim();
        if (nextCustomer !== prevCustomer) {
          clearRouteResolutionState(route);
        } else {
          route.addressEdited = true;
        }
        route.isEdited = true;
        route.fullAddress = fullAddressFromBackend(route);
        userHasEditedAddress = true;
        var reprocessBtn = document.getElementById('reprocess-addresses-btn');
        if (reprocessBtn) reprocessBtn.classList.remove('hidden');

        var saveIndex = index;
        var saveBtnEl = target;
        var statusSave = document.getElementById('routeStatus');
        saveBtnEl.disabled = true;
        var saveBtnOrigText = saveBtnEl.textContent;
        saveBtnEl.textContent = 'Saving...';

        syncWorkingRegionSelection();
        var payloadSave = {
          routes: [Object.assign({}, window.currentRoutes[saveIndex])],
          selectedRegions: window.selectedRegions.slice()
        };
        var reprocessUrlSave = LOGBOOK_FUNCTIONS_BASE + '/reprocessPreviewRoutes';

        fetch(reprocessUrlSave, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payloadSave)
        })
          .then(function (res) {
            return res.json().catch(function () {
              return {};
            }).then(function (body) {
              return { res: res, body: body };
            });
          })
          .then(function (packed) {
            var res = packed.res;
            var body = packed.body;
            if (!res.ok) {
              throw new Error((body && body.error) ? String(body.error) : ('HTTP ' + res.status));
            }
            if (!body.routes || !Array.isArray(body.routes)) {
              throw new Error('Invalid reprocess response');
            }
            mergeReprocessRoutesIntoPreview([saveIndex], body.routes);
            if (statusSave) {
              statusSave.textContent =
                'Address saved and coordinates updated. Changes have been saved for admin review.';
              statusSave.style.color = 'green';
            }
            console.log('🔥 EDITED ROUTES AFTER SAVE:', window.currentRoutes);
          })
          .catch(function (err) {
            console.error('🔥 PREVIEW SAVE REPROCESS ERROR:', err);
            if (statusSave) {
              statusSave.textContent =
                (err && err.message)
                  ? err.message
                  : 'Could not refresh coordinates. Try Reprocess addresses.';
              statusSave.style.color = 'red';
            }
            item.innerHTML = buildRouteVerifiedReadOnlyInnerHtml(window.currentRoutes[saveIndex]);
            item.classList.remove('route-verified-item-editing');
          })
          .finally(function () {
            try {
              saveBtnEl.disabled = false;
              saveBtnEl.textContent = saveBtnOrigText;
            } catch (fe) { /* node may be detached after full re-render */ }
          });
      } else if (target.classList.contains('route-verified-cancel-btn')) {
        e.preventDefault();
        item.innerHTML = buildRouteVerifiedReadOnlyInnerHtml(route);
        item.classList.remove('route-verified-item-editing');
      }
    });
  }

  /**
   * Preview DOM is source of truth for address fields before reprocess / regen.
   * Uses explicit card selectors so the first ambiguous querySelector never reads the wrong row.
   */
  function findRouteCardEl(content, index) {
    if (!content) return null;
    var sel = '[data-route-index="' + index + '"]';
    return (
      content.querySelector('.route-card-needs-verification' + sel) ||
      content.querySelector('.route-verified-item' + sel)
    );
  }

  function collectRoutesFromPreviewTable() {
    var base = window.currentRoutes;
    if (!base || !Array.isArray(base)) return [];
    var content = document.getElementById('routelistPreviewContent');
    if (!content) return base.slice();
    var result = [];
    for (var i = 0; i < base.length; i++) {
      var route = base[i];
      if (!route) continue;
      var prevCustomer = (route.customer != null ? String(route.customer) : '').trim();
      var copy = Object.assign({}, route);
      if ((!copy.originalAddress || String(copy.originalAddress).trim() === '') &&
          copy.original && copy.original.address != null) {
        copy.originalAddress = String(copy.original.address).trim();
      }
      var card = findRouteCardEl(content, i);
      if (card) {
        var form = card.querySelector('.route-verified-edit-form');
        var inputs = form ? form.querySelectorAll('input[data-field]') : card.querySelectorAll('input[data-field]');
        for (var j = 0; j < inputs.length; j++) {
          var input = inputs[j];
          var field = input.getAttribute('data-field');
          if (field) {
            var v = (input.value || '').trim();
            copy[field] = v;
          }
        }
      }
      var nextCustomer = (copy.customer != null ? String(copy.customer) : '').trim();
      if (nextCustomer !== prevCustomer) {
        clearRouteResolutionState(copy);
      }
      copy.fullAddress = fullAddressFromBackend(copy);
      result.push(copy);
    }
    return result;
  }

  function saveRouteChanges() {
    console.log('🔥 SAVE TRIGGERED (collect from table — in-memory; use Reprocess for Firestore)');
    if (!window.currentRoutes) return;
    var routes = collectRoutesFromPreviewTable();
    window.currentRoutes = routes;
    console.log('[ROUTES] user edits saved:', routes.length);
    console.log('🔥 EDITED ROUTES AFTER SAVE:', window.currentRoutes);
    updateRouteStatusFromRoutes(routes);
  }

  function clearRoutes() {
    if (logbookService) {
      var done = logbookService.clearRoutes();
      if (done && typeof done.then === 'function') {
        done.then(function () { window.currentRoutes = null; location.reload(); });
      } else {
        window.currentRoutes = null;
        location.reload();
      }
    } else {
      window.currentRoutes = null;
      location.reload();
    }
  }
  window.saveRouteChanges = saveRouteChanges;
  window.clearRoutes = clearRoutes;

  function initRoutelistDropzone() {
    var dropzone = document.getElementById('routelist-dropzone');
    var fileInput = document.getElementById('routeFileInput');
    var filenameEl = document.getElementById('routelist-dropzone-filename');
    if (!dropzone || !fileInput) return;
    var suppressDropzoneClick = false;
    function setFilename(f) {
      if (filenameEl) filenameEl.textContent = (f && f.name) ? f.name : '';
    }
    function clearFileError() {
      var status = document.getElementById('routeStatus');
      if (status) {
        status.textContent = '';
        status.style.color = '';
        status.style.display = '';
      }
    }
    function assignFileToInput(f) {
      try {
        var dt = new DataTransfer();
        dt.items.add(f);
        fileInput.files = dt.files;
      } catch (err) { /* older browsers: droppedRoutelistFile still holds the file */ }
    }
    dropzone.addEventListener('click', function (e) {
      if (suppressDropzoneClick) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      fileInput.click();
    });
    fileInput.addEventListener('change', function (e) {
      if (!e.target.files || !e.target.files.length) {
        droppedRoutelistFile = null;
        lastProcessedRoutelistFileId = null;
        setFilename(null);
        dropzone.classList.remove('invalid');
        return;
      }
      var f = e.target.files[0];
      droppedRoutelistFile = f;
      setFilename(f);
      clearFileError();
      if (/\.(xlsx|xls)$/i.test(f.name || '')) {
        dropzone.classList.remove('invalid');
        processRoutelistFile(f);
      } else {
        dropzone.classList.add('invalid');
      }
    });
    dropzone.addEventListener('dragenter', function (e) {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.add('drag-over');
      dropzone.classList.remove('invalid');
    });
    dropzone.addEventListener('dragover', function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      dropzone.classList.add('drag-over');
    });
    dropzone.addEventListener('dragleave', function (e) {
      var rt = e.relatedTarget;
      if (rt != null && dropzone.contains(rt)) return;
      dropzone.classList.remove('drag-over');
    });
    dropzone.addEventListener('drop', function (e) {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.remove('drag-over');
      suppressDropzoneClick = true;
      window.setTimeout(function () { suppressDropzoneClick = false; }, 400);
      var files = e.dataTransfer && e.dataTransfer.files;
      var f = files && files[0] ? files[0] : null;
      if (f && /\.(xlsx|xls)$/i.test(f.name || '')) {
        dropzone.classList.remove('invalid');
        droppedRoutelistFile = f;
        assignFileToInput(f);
        setFilename(f);
        clearFileError();
        processRoutelistFile(f);
      } else if (f) {
        dropzone.classList.add('invalid');
        setFilename(f);
        clearFileError();
      }
    });
  }

  function updateCityLabel() {
    var labels = {
      cape_town: 'Cape Town',
      johannesburg: 'Johannesburg',
      pretoria: 'Pretoria',
      durban: 'Durban',
      port_elizabeth: 'Port Elizabeth',
      east_london: 'East London'
    };
    var text = window.selectedCities
      .map(function (c) {
        return labels[c] || c;
      })
      .join(', ');
    var labelSpan = document.getElementById('cityDropdownLabelText');
    if (labelSpan) {
      labelSpan.textContent = text;
      return;
    }
    var trigger = document.getElementById('cityDropdownTrigger');
    if (trigger && trigger.childNodes[0] && trigger.childNodes[0].nodeType === 3) {
      trigger.childNodes[0].nodeValue = text + ' ';
    }
  }

  function seedCityCheckboxesFromWindow() {
    var menu = document.getElementById('cityDropdownMenu');
    if (!menu) return;
    var from = Array.isArray(window.selectedCities) ? window.selectedCities : [];
    var allowed = {
      cape_town: true,
      johannesburg: true,
      pretoria: true,
      durban: true,
      port_elizabeth: true,
      east_london: true
    };
    var vals = [];
    var vi;
    for (vi = 0; vi < from.length; vi++) {
      if (allowed[from[vi]]) vals.push(from[vi]);
    }
    if (!vals.length) vals = ['cape_town'];
    window.selectedCities = vals.slice();
    var cbs = menu.querySelectorAll('input[type="checkbox"]');
    var j;
    for (j = 0; j < cbs.length; j++) {
      cbs[j].checked = vals.indexOf(cbs[j].value) !== -1;
    }
    updateCityLabel();
  }

  function syncWorkingRegionSelection() {
    /* Working Region UI replaced by Working City; upload payload still uses window.selectedRegions default. */
  }

  function initWorkingCityDropdown() {
    var dropdown = document.getElementById('cityDropdown');
    var trigger = document.getElementById('cityDropdownTrigger');
    var menu = document.getElementById('cityDropdownMenu');
    if (!dropdown || !trigger || !menu) return;

    seedCityCheckboxesFromWindow();

    function setOpen(isOpen) {
      if (isOpen) {
        dropdown.classList.add('open');
        trigger.setAttribute('aria-expanded', 'true');
      } else {
        dropdown.classList.remove('open');
        trigger.setAttribute('aria-expanded', 'false');
      }
    }

    trigger.addEventListener('click', function (e) {
      e.stopPropagation();
      setOpen(!dropdown.classList.contains('open'));
    });

    trigger.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        setOpen(!dropdown.classList.contains('open'));
      }
    });

    menu.addEventListener('click', function (e) {
      e.stopPropagation();
    });

    var checkboxes = menu.querySelectorAll('input[type="checkbox"]');
    var k;
    for (k = 0; k < checkboxes.length; k++) {
      checkboxes[k].addEventListener('change', function () {
        if (!this.checked) {
          var selectedCount = menu.querySelectorAll('input[type="checkbox"]:checked').length;
          if (selectedCount === 0) {
            this.checked = true;
            return;
          }
        }
        var selected = [];
        var all = menu.querySelectorAll('input[type="checkbox"]');
        var m;
        for (m = 0; m < all.length; m++) {
          if (all[m].checked) selected.push(all[m].value);
        }
        window.selectedCities = selected.length ? selected : ['cape_town'];
        updateCityLabel();
        if (window.currentRoutes && window.currentRoutes.length) {
          renderRoutelistPreview(window.currentRoutes);
        }
      });
    }

    document.addEventListener('click', function (e) {
      if (!dropdown.contains(e.target)) {
        setOpen(false);
      }
    });
  }

  function initClearRoutelistButton() {
    var btn = document.getElementById('clear-routes-btn');
    if (!btn) return;
    btn.addEventListener('click', function () {
      console.log('🧹 Clearing routelist');
      var preview = document.getElementById('routelistPreview');
      if (!preview) {
        if (logbookService) logbookService.clearRoutes();
        location.reload();
        return;
      }
      preview.classList.add('closing');
      setTimeout(function () {
        if (logbookService) logbookService.clearRoutes();
        window.currentRoutes = null;
        userHasEditedAddress = false;
        var content = document.getElementById('routelistPreviewContent');
        if (content) content.innerHTML = '';
        var statusEl = document.getElementById('routeStatus');
        if (statusEl) statusEl.textContent = '';
        preview.classList.add('hidden');
        preview.classList.remove('closing');
        updateClearRoutelistButtonVisibility();
        updateStepProgress();
        resetLogbookForm();
      }, 250);
    });
    updateClearRoutelistButtonVisibility();
  }

  function initNewLogbookButton() {
    var btn = document.getElementById('btnNewLogbook');
    var modal = document.getElementById('newLogbookModal');
    var confirmBtn = document.getElementById('modalConfirm');
    var cancelBtn = document.getElementById('modalCancel');
    if (!btn || !modal || !confirmBtn || !cancelBtn) return;
    btn.addEventListener('click', function () {
      modal.classList.remove('hidden');
    });
    cancelBtn.addEventListener('click', function () {
      modal.classList.add('hidden');
    });
    confirmBtn.addEventListener('click', function () {
      modal.classList.add('hidden');
      location.reload();
    });
  }

  function initRefreshRoutesButton() {
    var btn = document.getElementById('btnRefreshRoutes');
    if (!btn) return;
    btn.addEventListener('click', function () {
      console.log('🔄 Routes reset by user');
      var fileInput = document.getElementById('routeFileInput');
      if (fileInput) fileInput.value = '';
      droppedRoutelistFile = null;
      lastProcessedRoutelistFileId = null;
      if (logbookService) logbookService.clearRoutes();
      window.currentRoutes = null;
      userHasEditedAddress = false;
      window._hasSalesRepDuplicates = false;
      var content = document.getElementById('routelistPreviewContent');
      if (content) content.innerHTML = '';
      var statusEl = document.getElementById('routeStatus');
      if (statusEl) {
        statusEl.textContent = '';
        statusEl.style.color = '';
        statusEl.style.display = '';
      }
      var preview = document.getElementById('routelistPreview');
      if (preview) {
        preview.classList.add('hidden');
        preview.classList.remove('closing');
      }
      var fn = document.getElementById('routelist-dropzone-filename');
      if (fn) fn.textContent = '';
      var dropzone = document.getElementById('routelist-dropzone');
      if (dropzone) dropzone.classList.remove('invalid', 'drag-over');
      updateClearRoutelistButtonVisibility();
      updateStepProgress();
      if (typeof window.validateLogbookForm === 'function') window.validateLogbookForm();
    });
  }

  function initReprocessAddressesButton() {
    var btn = document.getElementById('reprocess-addresses-btn');
    var status = document.getElementById('routeStatus');
    if (!btn) return;
    btn.addEventListener('click', async function () {
      console.log('🔥 SAVE TRIGGERED');
      if (!window.currentRoutes || !window.currentRoutes.length) {
        if (status) { status.textContent = 'No routes to reprocess.'; status.style.color = 'red'; }
        return;
      }
      saveRouteChanges();
      var editedIndices = [];
      var updatedRoutes = [];
      for (var ei = 0; ei < window.currentRoutes.length; ei++) {
        var er = window.currentRoutes[ei];
        if (er && er.isEdited === true) {
          editedIndices.push(ei);
          updatedRoutes.push(Object.assign({}, er));
        }
      }
      if (!updatedRoutes.length) {
        window.alert('No changes to submit');
        return;
      }
      console.log('REGEN INPUT:', updatedRoutes);
      console.log('🔥 REPROCESS PAYLOAD ROUTES (edited only):', updatedRoutes);

      var modeRe = (function () {
        if (window._routelistMode) return window._routelistMode;
        var savedMode = localStorage.getItem('routelistMode');
        if (savedMode === 'business' || savedMode === 'salesRep') return savedMode;
        return 'salesRep';
      })();
      var duplicatesRe = detectDuplicateStores(window.currentRoutes);
      if (modeRe === 'salesRep' && duplicatesRe.length > 0) {
        console.error('[VALIDATION] Duplicate stores not allowed in salesRep mode', duplicatesRe);
        window._hasSalesRepDuplicates = true;
        renderDuplicateError(duplicatesRe);
      } else if (modeRe === 'salesRep') {
        window._hasSalesRepDuplicates = false;
        renderDuplicateError([]);
      }
      if (modeRe !== 'salesRep') {
        renderDuplicateError([]);
      }

      syncWorkingRegionSelection();
      var payload = {
        routes: updatedRoutes.map(function (r) {
          return Object.assign({}, r);
        }),
        selectedRegions: window.selectedRegions.slice()
      };

      var originalHtml = btn.innerHTML;
      btn.disabled = true;
      btn.classList.add('loading');
      btn.innerHTML = '\u23F3 Processing...';

      try {
        var reprocessUrl = LOGBOOK_FUNCTIONS_BASE + '/reprocessPreviewRoutes';
        console.log('🔥 SAVE REQUEST URL:', reprocessUrl);
        console.log('🔥 SAVE REQUEST BODY:', payload);
        var res = await fetch(reprocessUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        var body = await res.json().catch(function () { return {}; });
        console.log('🔥 SAVE RESPONSE:', body);
        console.log("🔥 REPROCESS RESPONSE ROUTES:", body.routes);
        if (!res.ok) {
          throw new Error((body && body.error) ? String(body.error) : ('HTTP ' + res.status));
        }
        if (!body.routes || !Array.isArray(body.routes)) {
          throw new Error('Invalid reprocess response');
        }
        if (body.routes.length !== editedIndices.length) {
          throw new Error('Reprocess response count does not match edited routes');
        }
        mergeReprocessRoutesIntoPreview(editedIndices, body.routes);
        if (status) {
          status.textContent = 'Preview reprocessed. Updated routes are ready for logbook generation. Changes have been saved for admin review.';
          status.style.color = 'green';
        }
      } catch (err) {
        console.error('🔥 SAVE ERROR:', err);
        console.error('reprocessPreviewRoutes:', err);
        if (status) {
          status.textContent = (err && err.message) ? err.message : 'Reprocess failed.';
          status.style.color = 'red';
        }
      } finally {
        btn.disabled = false;
        btn.classList.remove('loading');
        btn.innerHTML = originalHtml;
      }
    });
  }

  function initParseButton() {
    var btn = document.getElementById('parseRouteBtn');
    var status = document.getElementById('routeStatus');
    var fileInput = document.getElementById('routeFileInput');
    if (!btn) return;
    btn.addEventListener('click', function () {
      var file = droppedRoutelistFile || (fileInput && fileInput.files && fileInput.files[0]) || null;
      if (!file) {
        if (status) { status.textContent = 'Please select a file.'; status.style.color = 'red'; }
        return;
      }
      var fileId = file.name + '-' + file.size;
      if (fileId === lastProcessedRoutelistFileId) {
        return;
      }
      processRoutelistFile(file);
    });
  }

  function initLogbookDropzone() {
    var dropzone = document.getElementById('route-dropzone');
    var fileInput = document.getElementById('logbookExcelInput');
    var filenameEl = document.getElementById('route-dropzone-filename');
    if (!dropzone || !fileInput) return;
    function setFilename(f) {
      if (filenameEl) filenameEl.textContent = (f && f.name) ? f.name : '';
    }
    dropzone.addEventListener('click', function () { fileInput.click(); });
    fileInput.addEventListener('change', function () {
      var f = fileInput.files && fileInput.files[0] ? fileInput.files[0] : null;
      droppedExcelFile = f;
      setFilename(f);
    });
    dropzone.addEventListener('dragenter', function (e) { e.preventDefault(); dropzone.classList.add('drag-over'); });
    dropzone.addEventListener('dragover', function (e) { e.preventDefault(); dropzone.classList.add('drag-over'); });
    dropzone.addEventListener('dragleave', function () { dropzone.classList.remove('drag-over'); });
    dropzone.addEventListener('drop', function (e) {
      e.preventDefault();
      dropzone.classList.remove('drag-over');
      var files = e.dataTransfer && e.dataTransfer.files;
      var f = files && files[0] ? files[0] : null;
      if (f) { droppedExcelFile = f; setFilename(f); }
    });
  }

  /**
   * Returns the start year of the latest completed SARS tax year.
   * SARS tax year runs 1 March – 28/29 Feb. Only closed years are selectable for logbooks.
   * If today >= 1 March: latest closed = (currentYear - 1) / currentYear.
   * If today is Jan/Feb: latest closed = (currentYear - 2) / (currentYear - 1).
   */
  function getLatestClosedTaxYear() {
    var now = new Date();
    var year = now.getFullYear();
    var month = now.getMonth();
    if (month >= 2) {
      return year - 1;
    }
    return year - 2;
  }

  function populateTaxYearSelect() {
    var sel = document.getElementById('taxYear');
    if (!sel) return;
    sel.innerHTML = '';
    var sarsStart = getLatestClosedTaxYear();
    for (var i = 0; i < 10; i++) {
      var s = sarsStart - i;
      var e = s + 1;
      var opt = document.createElement('option');
      opt.value = s + '/' + e;
      opt.textContent = s + ' / ' + e + ' (1 Mar ' + s + ' – 28 Feb ' + e + ')';
      if (i === 0) opt.selected = true;
      sel.appendChild(opt);
    }
    updateDatesFromTaxYear();
  }

  function updateDatesFromTaxYear() {
    var sel = document.getElementById('taxYear');
    var startIn = document.getElementById('startDate');
    var endIn = document.getElementById('endDate');
    if (!sel || !startIn || !endIn) return;
    var v = sel.value;
    var m = v.match(/^(\d{4})\/(\d{4})$/);
    if (m) {
      var s = parseInt(m[1], 10);
      var e = parseInt(m[2], 10);
      if (e === s + 1) {
        startIn.value = s + '-03-01';
        endIn.value = e + '-02-28';
        if (e % 4 === 0 && (e % 100 !== 0 || e % 400 === 0)) endIn.value = e + '-02-29';
      }
    }
  }

  function renderLeaveCalendar() {
    var g = document.getElementById('ct-calendar-grid');
    var listEl = document.getElementById('selectedDateChips');
    if (!g) return;
    g.innerHTML = '';
    var startDateEl = document.getElementById('startDate');
    var endDateEl = document.getElementById('endDate');
    var rangeStart = null;
    var rangeEnd = null;
    if (startDateEl && startDateEl.value && endDateEl && endDateEl.value) {
      rangeStart = new Date(startDateEl.value + 'T00:00:00').getTime();
      rangeEnd = new Date(endDateEl.value + 'T23:59:59').getTime();
    }
    function toggleLeaveDate(dayIso, cell, addOnly) {
      if (leaveCalendarSelecting) {
        if (addOnly) {
          if (!selectedDates.has(dayIso)) {
            selectedDates.add(dayIso);
            if (cell) cell.classList.add('ct-day-selected');
          }
        } else {
          if (selectedDates.has(dayIso)) {
            selectedDates.delete(dayIso);
            if (cell) cell.classList.remove('ct-day-selected');
          } else {
            selectedDates.add(dayIso);
            if (cell) cell.classList.add('ct-day-selected');
          }
        }
        return;
      }
      if (selectedDates.has(dayIso)) selectedDates.delete(dayIso); else selectedDates.add(dayIso);
      renderLeaveCalendar();
    }
    var first = new Date(currentCalendarYear, currentCalendarMonth, 1).getDay();
    var days = new Date(currentCalendarYear, currentCalendarMonth + 1, 0).getDate();
    var i, d, iso, cell, cellTime, inRange;
    for (i = 0; i < first; i++) g.appendChild(document.createElement('div'));
    for (d = 1; d <= days; d++) {
      iso = currentCalendarYear + '-' + String(currentCalendarMonth + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
      cell = document.createElement('div');
      cell.textContent = d;
      cell.setAttribute('data-iso', iso);
      inRange = true;
      if (rangeStart != null && rangeEnd != null) {
        cellTime = new Date(iso + 'T12:00:00').getTime();
        inRange = cellTime >= rangeStart && cellTime <= rangeEnd;
        if (!inRange) cell.classList.add('ct-day-disabled');
      }
      if (selectedDates.has(iso)) cell.classList.add('ct-day-selected');
      if (inRange) {
        cell.addEventListener('click', function () {
          toggleLeaveDate(this.getAttribute('data-iso'));
        });
        cell.addEventListener('mousedown', function (e) {
          e.preventDefault();
          leaveCalendarSelecting = true;
          toggleLeaveDate(this.getAttribute('data-iso'), this, false);
        });
        cell.addEventListener('mouseenter', function () {
          if (leaveCalendarSelecting) toggleLeaveDate(this.getAttribute('data-iso'), this, true);
        });
      }
      g.appendChild(cell);
    }
    if (listEl) {
      listEl.innerHTML = '';
      Array.from(selectedDates).sort().forEach(function (iso) {
        var chip = document.createElement('span');
        chip.className = 'date-chip leave-day-chip';
        chip.innerHTML = iso + ' <button type="button" aria-label="Remove">×</button>';
        chip.querySelector('button').addEventListener('click', function () {
          selectedDates.delete(iso);
          renderLeaveCalendar();
        });
        listEl.appendChild(chip);
      });
    }
  }

  function normalizeLeaveDays(arr) {
    if (!Array.isArray(arr)) return [];
    return arr.map(function (x) {
      if (typeof x === 'string') return { date: x, reason: 'Leave' };
      if (x.type && x.purpose) return { date: x.date, type: x.type, purpose: x.purpose, businessKm: x.businessKm != null ? x.businessKm : 0 };
      return { date: x.date, reason: (x.reason && x.reason.trim()) || 'Leave' };
    });
  }

  function initLeaveModal() {
    var openBtn = document.getElementById('openLeaveModalBtn');
    var modal = document.getElementById('leaveModal');
    var closeBtn = document.getElementById('closeLeaveModal');
    var addBtn = document.getElementById('leaveAddBtn');
    var listEl = document.getElementById('selectedDateChips');
    var hidden = document.getElementById('leaveDaysInput');
    var listDisplay = document.getElementById('leaveDaysList');
    var mSel = document.getElementById('ct-month-select');
    var ySel = document.getElementById('ct-year-select');
    var prevBtn = document.getElementById('ct-prev-month');
    var nextBtn = document.getElementById('ct-next-month');
    var reasonSelect = document.getElementById('reasonSelect');
    var otherReasonContainer = document.getElementById('otherReasonContainer');
    var reasonOtherInput = document.getElementById('otherReasonInput');

    if (reasonSelect && otherReasonContainer) {
      reasonSelect.addEventListener('change', function () {
        if (this.value === 'Other') {
          otherReasonContainer.classList.remove('hidden');
        } else {
          otherReasonContainer.classList.add('hidden');
        }
      });
    }
    if (reasonOtherInput && reasonSelect && reasonSelect.value !== 'Other') {
      reasonOtherInput.value = '';
    }

    if (mSel && ySel) {
      monthNames.forEach(function (n, i) {
        var o = document.createElement('option');
        o.value = String(i);
        o.textContent = n;
        mSel.appendChild(o);
      });
      var yearMin = currentCalendarYear - 10;
      var yearMax = currentCalendarYear + 10;
      for (var yr = yearMin; yr <= yearMax; yr++) {
        var o = document.createElement('option');
        o.value = String(yr);
        o.textContent = yr;
        ySel.appendChild(o);
      }
      mSel.value = String(currentCalendarMonth);
      ySel.value = String(currentCalendarYear);
      mSel.addEventListener('change', function () { currentCalendarMonth = parseInt(mSel.value, 10); renderLeaveCalendar(); });
      ySel.addEventListener('change', function () { currentCalendarYear = parseInt(ySel.value, 10); renderLeaveCalendar(); });
    }
    if (prevBtn) prevBtn.addEventListener('click', function () {
      currentCalendarMonth--;
      if (currentCalendarMonth < 0) { currentCalendarMonth = 11; currentCalendarYear--; }
      if (mSel) mSel.value = String(currentCalendarMonth);
      if (ySel) { ySel.value = String(currentCalendarYear); }
      renderLeaveCalendar();
    });
    if (nextBtn) nextBtn.addEventListener('click', function () {
      currentCalendarMonth++;
      if (currentCalendarMonth > 11) { currentCalendarMonth = 0; currentCalendarYear++; }
      if (mSel) mSel.value = String(currentCalendarMonth);
      if (ySel) { ySel.value = String(currentCalendarYear); }
      renderLeaveCalendar();
    });

    function sync() {
      if (hidden) hidden.value = JSON.stringify(leaveDaysArray);
      if (listDisplay) listDisplay.textContent = leaveDaysArray.length ? leaveDaysArray.length + ' non-working days selected' : '';
      updateAdjustmentsSummary();
    }

    var leaveModalErrorEl = document.getElementById('leaveModalError');
    if (closeBtn && modal) closeBtn.addEventListener('click', function () { modal.classList.add('hidden'); if (leaveModalErrorEl) leaveModalErrorEl.textContent = ''; });
    if (modal) modal.addEventListener('click', function (e) { if (e.target === modal) { modal.classList.add('hidden'); if (leaveModalErrorEl) leaveModalErrorEl.textContent = ''; } });
    if (addBtn && modal) {
      addBtn.addEventListener('click', function () {
        if (leaveModalErrorEl) leaveModalErrorEl.textContent = '';
        if (selectedDates.size === 0) {
          if (leaveModalErrorEl) leaveModalErrorEl.textContent = 'Please select at least one date from the calendar.';
          return;
        }
        var startDateEl = document.getElementById('startDate');
        var endDateEl = document.getElementById('endDate');
        var startDateStr = startDateEl && startDateEl.value ? startDateEl.value.trim() : '';
        var endDateStr = endDateEl && endDateEl.value ? endDateEl.value.trim() : '';
        if (startDateStr && endDateStr) {
          var rangeStart = new Date(startDateStr + 'T00:00:00').getTime();
          var rangeEnd = new Date(endDateStr + 'T23:59:59').getTime();
          var outOfRange = [];
          selectedDates.forEach(function (dateVal) {
            var selectedDate = new Date(dateVal + 'T12:00:00').getTime();
            if (selectedDate < rangeStart || selectedDate > rangeEnd) outOfRange.push(dateVal);
          });
          if (outOfRange.length > 0) {
            var startDisplay = formatManualTripDateDisplay(startDateStr);
            var endDisplay = formatManualTripDateDisplay(endDateStr);
            if (leaveModalErrorEl) leaveModalErrorEl.textContent = 'The selected leave date is outside the chosen tax year. Allowed range: ' + startDisplay + ' – ' + endDisplay + '.';
            return;
          }
        }
        var selectedType = (reasonSelect && reasonSelect.value) || 'Leave';
        var userEnteredReason = (reasonOtherInput && reasonOtherInput.value) ? reasonOtherInput.value.trim() : '';
        var newPurpose = selectedType === 'Leave' ? 'Annual Leave' : (userEnteredReason || 'Other');
        var newType = selectedType === 'Leave' ? 'annual-leave' : 'non-travel';
        var newLeaveDays = (leaveDaysArray || [])
          .filter(function (entry) { return !selectedDates.has(entry.date); })
          .map(function (entry) {
            return {
              date: entry.date,
              type: entry.type || 'annual-leave',
              purpose: (entry.purpose && entry.purpose.trim()) || (entry.reason && entry.reason.trim()) || 'Leave',
              businessKm: entry.businessKm != null ? entry.businessKm : 0
            };
          });
        Array.from(selectedDates).sort().forEach(function (date) {
          newLeaveDays.push({
            date: date,
            type: newType,
            purpose: newPurpose,
            businessKm: 0
          });
        });
        leaveDaysArray = newLeaveDays;
        sync();
        selectedDates.clear();
        renderLeaveCalendar();
        if (leaveModalErrorEl) leaveModalErrorEl.textContent = '';
        modal.classList.add('hidden');
      });
    }
    if (openBtn && modal) {
      openBtn.addEventListener('click', function () {
        leaveDaysArray = normalizeLeaveDays(leaveDaysArray);
        selectedDates = new Set();
        if (leaveModalErrorEl) leaveModalErrorEl.textContent = '';
        var startDateEl = document.getElementById('startDate');
        if (startDateEl && startDateEl.value) {
          var startDate = new Date(startDateEl.value);
          if (!isNaN(startDate.getTime())) {
            currentCalendarMonth = startDate.getMonth();
            currentCalendarYear = startDate.getFullYear();
          }
        }
        if (mSel) mSel.value = currentCalendarMonth;
        if (ySel) ySel.value = currentCalendarYear;
        if (reasonSelect) reasonSelect.value = 'Leave';
        if (otherReasonContainer) otherReasonContainer.classList.add('hidden');
        if (reasonOtherInput) reasonOtherInput.value = '';
        renderLeaveCalendar();
        modal.classList.remove('hidden');
      });
    }
    if (modal) modal.addEventListener('click', function (e) { if (e.target === modal) modal.classList.add('hidden'); });
    document.addEventListener('mouseup', function () {
      var wasSelecting = leaveCalendarSelecting;
      leaveCalendarSelecting = false;
      if (wasSelecting) renderLeaveCalendar();
    });
    sync();
  }

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      var openModal = document.querySelector('.vehicle-modal:not(.hidden)');
      if (openModal) openModal.classList.add('hidden');
    }
  });

  function updateAdjustmentsSummary() {
    var leaveEl = document.getElementById('leavePreview');
    var manualEl = document.getElementById('manualPreview');
    if (!leaveEl || !manualEl) return;

    function makeTag(label, removeKey, keyType) {
      var tag = document.createElement('div');
      tag.className = 'adjustment-tag';
      tag.setAttribute('data-' + keyType, removeKey);
      tag.textContent = label;
      var removeSpan = document.createElement('span');
      removeSpan.className = 'remove';
      removeSpan.setAttribute('aria-label', 'Remove');
      removeSpan.textContent = '\u00D7';
      tag.appendChild(removeSpan);
      return tag;
    }

    leaveEl.innerHTML = '';
    leaveEl.classList.remove('is-empty');
    var leaveDays = leaveDaysArray || [];
    if (leaveDays.length === 0) {
      leaveEl.classList.add('is-empty');
      leaveEl.textContent = 'No non-working days added';
    } else {
      leaveDays.forEach(function (item) {
        var reason = (item.purpose && item.purpose.trim()) || (item.reason && item.reason.trim()) || 'Leave';
        var date = item.date || '';
        if (date) leaveEl.appendChild(makeTag(reason + ' \u2022 ' + date, date, 'date'));
      });
    }

    manualEl.innerHTML = '';
    manualEl.classList.remove('is-empty');
    var manual = manualEntriesArray || [];
    if (manual.length === 0) {
      manualEl.classList.add('is-empty');
      manualEl.textContent = 'No manual trips added';
    } else {
      manual.forEach(function (entry, idx) {
        var p = (entry.purpose && entry.purpose.trim()) || 'Manual trip';
        var d = entry.date || '';
        if (d) manualEl.appendChild(makeTag(p + ' \u2022 ' + d, String(idx), 'index'));
      });
    }
  }

  function setupAdjustmentsSummaryRemove() {
    var container = document.querySelector('.optional-adjustments-section');
    if (!container) return;
    container.addEventListener('click', function (e) {
      var removeBtn = e.target && e.target.classList && e.target.classList.contains('remove') ? e.target : null;
      if (!removeBtn) return;
      var tag = removeBtn.closest('.adjustment-tag');
      if (!tag) return;
      e.preventDefault();
      var date = tag.getAttribute('data-date');
      var index = tag.getAttribute('data-index');
      if (date != null) {
        leaveDaysArray = (leaveDaysArray || []).filter(function (item) { return item.date !== date; });
        var hidden = document.getElementById('leaveDaysInput');
        if (hidden) hidden.value = JSON.stringify(leaveDaysArray);
        updateAdjustmentsSummary();
      } else if (index != null) {
        var i = parseInt(index, 10);
        if (!isNaN(i) && manualEntriesArray && i >= 0 && i < manualEntriesArray.length) {
          manualEntriesArray.splice(i, 1);
          syncManualTripsList();
        }
      }
    });
  }

  function syncManualTripsList() {
    var listDisplay = document.getElementById('manualTripsList');
    if (listDisplay) {
      listDisplay.textContent = manualEntriesArray.length
        ? manualEntriesArray.length + ' manual trip(s) added'
        : '';
    }
    updateAdjustmentsSummary();
  }

  /**
   * Full reset of Step 2 logbook form, adjustments state, and related UI.
   * Called after route list is cleared so no stale taxpayer/vehicle/odometer data remains.
   */
  function resetLogbookForm() {
    console.log('🧹 Resetting logbook form');

    leaveDaysArray = [];
    manualEntriesArray = [];
    lastLogbookResult = null;
    selectedDates = new Set();
    selectedManualDates = [];
    window._hasSalesRepDuplicates = false;

    var form = document.getElementById('logbookForm');
    if (form) {
      try {
        form.reset();
      } catch (e) { /* ignore */ }
    }

    var radioHome = document.getElementById('originTypeHome');
    var radioWork = document.getElementById('originTypeWork');
    var radioOther = document.getElementById('originTypeOther');
    if (radioHome) radioHome.checked = true;
    if (radioWork) radioWork.checked = false;
    if (radioOther) radioOther.checked = false;
    var originAddressInput = document.getElementById('originAddress');
    if (originAddressInput && typeof getOriginTypePlaceholder === 'function') {
      originAddressInput.placeholder = getOriginTypePlaceholder('home');
    }

    populateTaxYearSelect();

    var leaveHidden = document.getElementById('leaveDaysInput');
    if (leaveHidden) leaveHidden.value = '';
    var manualHidden = document.getElementById('manualEntriesInput');
    if (manualHidden) manualHidden.value = '';
    var manualList = document.getElementById('manualEntriesList');
    if (manualList) manualList.innerHTML = '';
    var leaveListTag = document.getElementById('leaveDaysList');
    if (leaveListTag) leaveListTag.textContent = '';

    var chips = document.getElementById('selectedDateChips');
    if (chips) chips.innerHTML = '';
    var manualChips = document.getElementById('manualTripSelectedDateDisplay');
    if (manualChips) manualChips.innerHTML = '';

    var otherReason = document.getElementById('otherReasonInput');
    if (otherReason) otherReason.value = '';
    var reasonSelect = document.getElementById('reasonSelect');
    var otherReasonContainer = document.getElementById('otherReasonContainer');
    if (reasonSelect) reasonSelect.value = 'Leave';
    if (otherReasonContainer) otherReasonContainer.classList.add('hidden');
    var leaveErr = document.getElementById('leaveModalError');
    if (leaveErr) leaveErr.textContent = '';
    var tripReason = document.getElementById('tripReason');
    var tripFrom = document.getElementById('tripFrom');
    var tripTo = document.getElementById('tripTo');
    if (tripReason) tripReason.value = '';
    if (tripFrom) tripFrom.value = '';
    if (tripTo) tripTo.value = '';
    var allDayEl = document.getElementById('manual-all-day');
    if (allDayEl) allDayEl.checked = false;
    var manualTripErr = document.getElementById('manualTripModalError');
    if (manualTripErr) manualTripErr.textContent = '';

    var leaveModalEl = document.getElementById('leaveModal');
    if (leaveModalEl) leaveModalEl.classList.add('hidden');
    var manualAdjModal = document.getElementById('manualAdjustmentModal');
    if (manualAdjModal) manualAdjModal.classList.add('hidden');
    var manualDetailsModal = document.getElementById('manualTripDetailsModal');
    if (manualDetailsModal) manualDetailsModal.classList.add('hidden');

    var routeFile = document.getElementById('routeFileInput');
    if (routeFile) {
      try {
        routeFile.value = '';
      } catch (e) { /* ignore */ }
    }
    var logbookExcelInput = document.getElementById('logbookExcelInput');
    if (logbookExcelInput) {
      try {
        logbookExcelInput.value = '';
      } catch (e) { /* ignore */ }
    }
    droppedRoutelistFile = null;
    lastProcessedRoutelistFileId = null;
    var dropFilename = document.getElementById('routelist-dropzone-filename');
    if (dropFilename) dropFilename.textContent = '';
    var dropzone = document.getElementById('routelist-dropzone');
    if (dropzone) dropzone.classList.remove('invalid', 'drag-over');

    var logbookStatus = document.getElementById('logbookStatus');
    if (logbookStatus) {
      logbookStatus.textContent = '';
      logbookStatus.style.color = '';
      logbookStatus.style.whiteSpace = '';
      logbookStatus.classList.remove('status-error', 'logbook-status-calculating');
    }

    var genBtn = document.getElementById('generateLogbookBtn');
    var loadingBlock = document.getElementById('logbookLoadingBlock');
    if (loadingBlock) {
      loadingBlock.classList.add('hidden');
    }
    if (genBtn) {
      genBtn.classList.remove('hidden');
      genBtn.classList.add('disabled');
      genBtn.disabled = true;
    }

    syncManualTripsList();
    updateAdjustmentsSummary();

    if (typeof window.validateLogbookForm === 'function') {
      window.validateLogbookForm();
    }
    refreshLogbookAccessState();
  }

  function formatManualTripDateDisplay(iso) {
    if (!iso) return '';
    var d = new Date(iso + 'T12:00:00');
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('en-ZA', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function renderManualTripCalendar() {
    var g = document.getElementById('ct-mt-calendar-grid');
    var displayEl = document.getElementById('manualTripSelectedDateDisplay');
    if (!g) return;
    g.innerHTML = '';
    var startDateEl = document.getElementById('startDate');
    var endDateEl = document.getElementById('endDate');
    var rangeStart = null;
    var rangeEnd = null;
    if (startDateEl && startDateEl.value && endDateEl && endDateEl.value) {
      rangeStart = new Date(startDateEl.value + 'T00:00:00').getTime();
      rangeEnd = new Date(endDateEl.value + 'T23:59:59').getTime();
    }
    var first = new Date(currentCalendarYear, currentCalendarMonth, 1).getDay();
    var days = new Date(currentCalendarYear, currentCalendarMonth + 1, 0).getDate();
    var i, d, iso, cell, cellTime, inRange;
    for (i = 0; i < first; i++) g.appendChild(document.createElement('div'));
    for (d = 1; d <= days; d++) {
      iso = currentCalendarYear + '-' + String(currentCalendarMonth + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
      cell = document.createElement('div');
      cell.textContent = d;
      cell.setAttribute('data-iso', iso);
      inRange = true;
      if (rangeStart != null && rangeEnd != null) {
        cellTime = new Date(iso + 'T12:00:00').getTime();
        inRange = cellTime >= rangeStart && cellTime <= rangeEnd;
        if (!inRange) cell.classList.add('ct-day-disabled');
      }
      if (selectedManualDates.indexOf(iso) !== -1) cell.classList.add('ct-day-selected');
      if (inRange) {
        cell.addEventListener('click', function () {
          var dateIso = this.getAttribute('data-iso');
          var idx = selectedManualDates.indexOf(dateIso);
          if (idx !== -1) {
            selectedManualDates.splice(idx, 1);
          } else {
            selectedManualDates.push(dateIso);
          }
          renderManualTripCalendar();
        });
      }
      g.appendChild(cell);
    }
    if (displayEl) {
      displayEl.innerHTML = '';
      var reasonLabel = (document.getElementById('tripReason') && document.getElementById('tripReason').value) ? document.getElementById('tripReason').value.trim() : 'Manual trip';
      if (!reasonLabel) reasonLabel = 'Manual trip';
      selectedManualDates.slice().sort().forEach(function (iso) {
        var chip = document.createElement('span');
        chip.className = 'date-chip leave-day-chip';
        chip.textContent = reasonLabel + ' · ' + formatManualTripDateDisplay(iso) + ' ';
        var removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.setAttribute('aria-label', 'Remove');
        removeBtn.textContent = '\u00D7';
        removeBtn.addEventListener('click', function () {
          var i = selectedManualDates.indexOf(iso);
          if (i !== -1) selectedManualDates.splice(i, 1);
          renderManualTripCalendar();
        });
        chip.appendChild(removeBtn);
        displayEl.appendChild(chip);
      });
    }
  }

  function initManualModals() {
    var openAdj = document.getElementById('addManualTripBtn');
    var modalAdj = document.getElementById('manualAdjustmentModal');
    var closeAdj = document.getElementById('closeManualAdjustmentModal');
    var modalDetails = document.getElementById('manualTripDetailsModal');
    var closeDetails = document.getElementById('closeManualTripDetailsModal');
    var cancelDetails = document.getElementById('cancelManualTripDetails');
    var mSelMT = document.getElementById('ct-mt-month-select');
    var ySelMT = document.getElementById('ct-mt-year-select');
    var prevBtnMT = document.getElementById('ct-mt-prev-month');
    var nextBtnMT = document.getElementById('ct-mt-next-month');
    if (mSelMT && ySelMT) {
      monthNames.forEach(function (n, i) {
        var o = document.createElement('option');
        o.value = String(i);
        o.textContent = n;
        mSelMT.appendChild(o);
      });
      for (var yr = currentCalendarYear - 10; yr <= currentCalendarYear + 10; yr++) {
        var o = document.createElement('option');
        o.value = String(yr);
        o.textContent = yr;
        ySelMT.appendChild(o);
      }
      mSelMT.value = String(currentCalendarMonth);
      ySelMT.value = String(currentCalendarYear);
      mSelMT.addEventListener('change', function () { currentCalendarMonth = parseInt(mSelMT.value, 10); renderManualTripCalendar(); });
      ySelMT.addEventListener('change', function () { currentCalendarYear = parseInt(ySelMT.value, 10); renderManualTripCalendar(); });
    }
    if (prevBtnMT) prevBtnMT.addEventListener('click', function () {
      currentCalendarMonth--;
      if (currentCalendarMonth < 0) { currentCalendarMonth = 11; currentCalendarYear--; }
      if (mSelMT) mSelMT.value = String(currentCalendarMonth);
      if (ySelMT) ySelMT.value = String(currentCalendarYear);
      renderManualTripCalendar();
    });
    if (nextBtnMT) nextBtnMT.addEventListener('click', function () {
      currentCalendarMonth++;
      if (currentCalendarMonth > 11) { currentCalendarMonth = 0; currentCalendarYear++; }
      if (mSelMT) mSelMT.value = String(currentCalendarMonth);
      if (ySelMT) ySelMT.value = String(currentCalendarYear);
      renderManualTripCalendar();
    });
    if (openAdj && modalAdj) {
      openAdj.addEventListener('click', function () {
        selectedManualDates = [];
        if (manualTripErrorEl) manualTripErrorEl.textContent = '';
        var startDateEl = document.getElementById('startDate');
        if (startDateEl && startDateEl.value) {
          var startDate = new Date(startDateEl.value);
          if (!isNaN(startDate.getTime())) {
            currentCalendarMonth = startDate.getMonth();
            currentCalendarYear = startDate.getFullYear();
          }
        }
        if (mSelMT) mSelMT.value = String(currentCalendarMonth);
        if (ySelMT) ySelMT.value = String(currentCalendarYear);
        renderManualTripCalendar();
        modalAdj.classList.remove('hidden');
      });
    }
    if (closeAdj && modalAdj) closeAdj.addEventListener('click', function () { modalAdj.classList.add('hidden'); if (manualTripErrorEl) manualTripErrorEl.textContent = ''; });
    if (modalAdj) modalAdj.addEventListener('click', function (e) { if (e.target === modalAdj) { modalAdj.classList.add('hidden'); if (manualTripErrorEl) manualTripErrorEl.textContent = ''; } });
    if (closeDetails && modalDetails) closeDetails.addEventListener('click', function () { modalDetails.classList.add('hidden'); });
    if (cancelDetails && modalDetails) cancelDetails.addEventListener('click', function () { modalDetails.classList.add('hidden'); });
    if (modalDetails) modalDetails.addEventListener('click', function (e) { if (e.target === modalDetails) modalDetails.classList.add('hidden'); });
    var saveDetails = document.getElementById('saveManualTripDetails');
    if (saveDetails && modalDetails) saveDetails.addEventListener('click', function () { modalDetails.classList.add('hidden'); });
    var saveAdj = document.getElementById('manualAdjustmentSaveBtn');
    var tripReason = document.getElementById('tripReason');
    var tripFrom = document.getElementById('tripFrom');
    var tripTo = document.getElementById('tripTo');
    var manualTripErrorEl = document.getElementById('manualTripModalError');
    if (saveAdj && modalAdj) {
      saveAdj.addEventListener('click', function () {
        if (manualTripErrorEl) manualTripErrorEl.textContent = '';
        var reason = (tripReason && tripReason.value) ? tripReason.value.trim() : '';
        var fromVal = tripFrom && tripFrom.value ? tripFrom.value.trim() : '';
        var toVal = tripTo && tripTo.value ? tripTo.value.trim() : '';
        if (!selectedManualDates || selectedManualDates.length === 0) {
          if (manualTripErrorEl) manualTripErrorEl.textContent = 'Please select at least one date from the calendar.';
          return;
        }
        if (!reason) {
          if (manualTripErrorEl) manualTripErrorEl.textContent = 'Please enter a reason for this trip.';
          return;
        }
        if (!fromVal) {
          if (manualTripErrorEl) manualTripErrorEl.textContent = 'Please enter a From address so distance can be calculated.';
          return;
        }
        if (!toVal) {
          if (manualTripErrorEl) manualTripErrorEl.textContent = 'Please enter a To address so distance can be calculated.';
          return;
        }
        var startDateEl = document.getElementById('startDate');
        var endDateEl = document.getElementById('endDate');
        var startDateStr = startDateEl && startDateEl.value ? startDateEl.value.trim() : '';
        var endDateStr = endDateEl && endDateEl.value ? endDateEl.value.trim() : '';
        if (startDateStr && endDateStr) {
          var rangeStart = new Date(startDateStr + 'T00:00:00').getTime();
          var rangeEnd = new Date(endDateStr + 'T23:59:59').getTime();
          for (var di = 0; di < selectedManualDates.length; di++) {
            var dateVal = selectedManualDates[di];
            var selectedDate = new Date(dateVal + 'T12:00:00').getTime();
            if (selectedDate < rangeStart || selectedDate > rangeEnd) {
              var startDisplay = formatManualTripDateDisplay(startDateStr);
              var endDisplay = formatManualTripDateDisplay(endDateStr);
              if (manualTripErrorEl) manualTripErrorEl.textContent = 'A selected date is outside the chosen tax year. Allowed range: ' + startDisplay + ' – ' + endDisplay + '.';
              return;
            }
          }
        }
        saveAdj.disabled = true;
        if (manualTripErrorEl) manualTripErrorEl.textContent = 'Resolving addresses…';
        fetch(resolveLogbookExpressApiUrl('/api/geocodeAddresses'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ addresses: [fromVal, toVal] })
        }).then(function (r) { return r.json().then(function (data) { return { ok: r.ok, status: r.status, data: data }; }); }).then(function (result) {
          saveAdj.disabled = false;
          if (manualTripErrorEl) manualTripErrorEl.textContent = '';
          if (!result.ok) {
            if (manualTripErrorEl) manualTripErrorEl.textContent = result.data && result.data.error ? result.data.error : 'Address resolution failed. Please try again.';
            return;
          }
          var resolved = Array.isArray(result.data) ? result.data : [];
          var fromRes = resolved[0];
          var toRes = resolved[1];
          if (!fromRes || !fromRes.resolved) {
            if (manualTripErrorEl) manualTripErrorEl.textContent = 'Could not resolve the From address. Please check it and try again.';
            return;
          }
          if (!toRes || !toRes.resolved) {
            if (manualTripErrorEl) manualTripErrorEl.textContent = 'Could not resolve the To address. Please check it and try again.';
            return;
          }
          var allDayEl = document.getElementById('manual-all-day');
          var allDay = allDayEl ? allDayEl.checked : false;
          selectedManualDates.forEach(function (dateVal) {
            manualEntriesArray.push({
              date: dateVal,
              from: fromVal,
              to: toVal,
              purpose: reason,
              day: new Date(dateVal + 'T12:00:00').toLocaleDateString('en-ZA', { weekday: 'short' }),
              businessKm: 0,
              privateKm: 0,
              fromLat: fromRes.lat,
              fromLng: fromRes.lng,
              toLat: toRes.lat,
              toLng: toRes.lng,
              allDay: allDay
            });
          });
          syncManualTripsList();
          selectedManualDates = [];
          if (tripReason) tripReason.value = '';
          if (tripFrom) tripFrom.value = '';
          if (tripTo) tripTo.value = '';
          if (allDayEl) allDayEl.checked = false;
          modalAdj.classList.add('hidden');
        }).catch(function (err) {
          saveAdj.disabled = false;
          if (manualTripErrorEl) manualTripErrorEl.textContent = 'Address resolution failed. Please check your connection and try again.';
        });
      });
    }
    syncManualTripsList();
  }

  function initTemplateDownload() {
    var btn = document.getElementById('downloadRoutelistTemplateBtn');
    if (btn && btn.getAttribute('href') === '#') {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        var status = document.getElementById('routeStatus');
        if (status) {
          status.textContent = 'Use a raw route list template. The app will detect columns (e.g. Address, Customer, Mon–Sat, Week) and enrich the data.';
          status.classList.add('status-error');
          status.style.color = 'red';
        }
      });
    }
  }

  function initFormSubmit() {
    var form = document.getElementById('logbookForm');
    var statusEl = document.getElementById('logbookStatus');
    var btn = document.getElementById('generateLogbookBtn');
    var loadingBlock = document.getElementById('logbookLoadingBlock');
    var fileInput = document.getElementById('logbookExcelInput');
    if (!form || !btn) return;

    function markFieldInvalid(el, bad) {
      if (!el) return;
      if (bad) el.classList.add('logbook-field-invalid');
      else el.classList.remove('logbook-field-invalid');
    }

    function validateForm() {
      var firstName = document.getElementById('firstName');
      var surname = document.getElementById('surname');
      var vehicleMake = document.getElementById('vehicleMake');
      var vehicleModel = document.getElementById('vehicleModel');
      var registrationNumber = document.getElementById('registrationNumber');
      var originAddress = document.getElementById('originAddress');
      var openingKm = document.getElementById('openingKm');
      var closingKm = document.getElementById('closingKm');
      var startDate = document.getElementById('startDate');
      var endDate = document.getElementById('endDate');
      var taxYear = document.getElementById('taxYear');
      function filled(el) {
        return el && (el.value || '').toString().trim() !== '';
      }
      var routesArr = window.currentRoutes;
      var hasRoutes = routesArr && Array.isArray(routesArr) && routesArr.length > 0 &&
        routesArr.every(function (r) { return (r.address || '').toString().trim() !== ''; });
      var allAddressesResolved = !hasRoutes || routesArr.every(function (r) { return routeResolutionOk(r); });
      var modeVal = window._routelistMode || (function () {
        try {
          var sm = localStorage.getItem('routelistMode');
          if (sm === 'business' || sm === 'salesRep') return sm;
        } catch (e) { /* ignore */ }
        return 'salesRep';
      })();
      var salesRepBlockedByDup = modeVal === 'salesRep' && routesArr && detectDuplicateStores(routesArr).length > 0;
      var previewHasCoords = !hasRoutes || routesHaveLatLng(routesArr);
      var confirmCheckbox = document.getElementById('confirm-logbook-review');
      var confirmAddressesCheckbox = document.getElementById('confirm-addresses-correct');
      var confirmed = confirmCheckbox && confirmCheckbox.checked;
      var confirmedAddresses = confirmAddressesCheckbox && confirmAddressesCheckbox.checked;
      var valid = filled(firstName) && filled(surname) && filled(vehicleMake) && filled(vehicleModel) &&
        filled(registrationNumber) && filled(originAddress) && filled(openingKm) && filled(closingKm) &&
        filled(startDate) && filled(endDate) && filled(taxYear) && hasRoutes && allAddressesResolved &&
        previewHasCoords &&
        confirmed &&
        confirmedAddresses &&
        !salesRepBlockedByDup;

      markFieldInvalid(firstName, !filled(firstName));
      markFieldInvalid(surname, !filled(surname));
      markFieldInvalid(vehicleMake, !filled(vehicleMake));
      markFieldInvalid(vehicleModel, !filled(vehicleModel));
      markFieldInvalid(registrationNumber, !filled(registrationNumber));
      markFieldInvalid(originAddress, !filled(originAddress));
      markFieldInvalid(openingKm, !filled(openingKm));
      markFieldInvalid(closingKm, !filled(closingKm));
      markFieldInvalid(startDate, !filled(startDate));
      markFieldInvalid(endDate, !filled(endDate));
      markFieldInvalid(taxYear, !filled(taxYear));
      markFieldInvalid(confirmCheckbox, !confirmed);
      markFieldInvalid(confirmAddressesCheckbox, !confirmedAddresses);
      var previewWrap = document.getElementById('routelistPreview');
      if (previewWrap) {
        markFieldInvalid(
          previewWrap,
          !hasRoutes ||
            salesRepBlockedByDup ||
            !allAddressesResolved ||
            !previewHasCoords
        );
      }

      return valid;
    }
    window.validateLogbookForm = validateForm;

    form.addEventListener('input', function () { validateForm(); });
    form.addEventListener('change', function () { validateForm(); });
    var confirmCheckboxEl = document.getElementById('confirm-logbook-review');
    var confirmAddressesCheckboxEl = document.getElementById('confirm-addresses-correct');
    if (confirmCheckboxEl) confirmCheckboxEl.addEventListener('change', function () { validateForm(); });
    if (confirmAddressesCheckboxEl) confirmAddressesCheckboxEl.addEventListener('change', function () { validateForm(); });

    form.addEventListener('submit', async function (e) {
      e.preventDefault();

      var routesForGen = collectRoutesFromPreviewTable();
      window.currentRoutes = routesForGen;
      if (!validateForm()) {
        return;
      }
      if (!routesHaveLatLng(routesForGen)) {
        if (statusEl) {
          statusEl.textContent = 'Please reprocess the preview before generating the logbook.';
          statusEl.style.color = 'red';
          statusEl.classList.add('status-error');
        }
        validateForm();
        return;
      }

      var logbookGenerateRequestId = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
        ? crypto.randomUUID()
        : (String(Date.now()) + '-' + Math.random().toString(36).slice(2, 12));

      btn.disabled = true;
      btn.classList.add('disabled');
      if (loadingBlock) {
        loadingBlock.innerHTML = '<div class="loading-car-block"><div class="loading-car">\uD83D\uDE97</div><div class="loading-text">Generating your logbook...</div></div>';
        loadingBlock.classList.remove('hidden');
      }
      btn.classList.add('hidden');
      if (statusEl) { statusEl.textContent = 'Loading…'; statusEl.style.color = '#666'; statusEl.classList.remove('status-error'); }

      var startDate = document.getElementById('startDate').value;
      var endDate = document.getElementById('endDate').value;
      var originAddressEl = document.getElementById('originAddress');
      var originAddress = (originAddressEl && originAddressEl.value) ? originAddressEl.value.trim() : '';
      var openingKm = parseFloat(document.getElementById('openingKm').value, 10);
      var closingKmEl = document.getElementById('closingKm');
      var closingKm = closingKmEl && closingKmEl.value !== '' ? parseFloat(closingKmEl.value, 10) : undefined;
      var currentWeekEl = document.getElementById('currentWeek');
      var currentWeekParsed = currentWeekEl && currentWeekEl.value !== ''
        ? parseInt(currentWeekEl.value, 10)
        : NaN;
      var currentWeek = (currentWeekParsed >= 1 && currentWeekParsed <= 4) ? currentWeekParsed : 1;
      var employerName = (document.getElementById('employerName') && document.getElementById('employerName').value) ? document.getElementById('employerName').value.trim() : null;

      function runEngineWithRoutes(routes) {
        const parsedRoutes = routes || [];
        const routesToSend = parsedRoutes;
        console.log('🚨 UI FINAL ROUTES:', parsedRoutes.length);
        var engineMode = window._routelistMode || 'salesRep';

        console.log('[ENGINE MODE]', engineMode);

        if (!parsedRoutes || parsedRoutes.length === 0) {
          if (statusEl) { statusEl.textContent = 'No routes to generate logbook from.'; statusEl.style.color = 'red'; }
          if (loadingBlock) loadingBlock.classList.add('hidden');
          btn.classList.remove('hidden');
          validateForm();
          refreshLogbookAccessState();
          return;
        }
        var engineMode = window._routelistMode || (function () {
          try { var sm = localStorage.getItem('routelistMode'); if (sm === 'business' || sm === 'salesRep') return sm; } catch (e) { /* ignore */ }
          return 'salesRep';
        })();
        console.log('[AUDIT ENGINE MODE]', engineMode);
        var vehicleMakeEl = document.getElementById('vehicleMake');
        var vehicleModelEl = document.getElementById('vehicleModel');
        var vehicleYearEl = document.getElementById('vehicleYear');
        var registrationNumberEl = document.getElementById('registrationNumber');
        var engineInput = {
          routes: routesToSend,
          startDate: startDate,
          endDate: endDate,
          homeAddress: originAddress,
          openingKm: openingKm,
          currentWeek: currentWeek,
          leaveDays: leaveDaysArray || [],
          employerName: employerName || null,
          mode: engineMode,
          vehicle: {
            make: (vehicleMakeEl && vehicleMakeEl.value) ? vehicleMakeEl.value.trim() : '',
            model: (vehicleModelEl && vehicleModelEl.value) ? vehicleModelEl.value.trim() : '',
            registration: (registrationNumberEl && registrationNumberEl.value) ? registrationNumberEl.value.trim() : '',
            year: (vehicleYearEl && vehicleYearEl.value) ? vehicleYearEl.value.trim() : ''
          }
        };
        if (closingKm != null && !isNaN(closingKm)) engineInput.closingKm = closingKm;
        if (manualEntriesArray && manualEntriesArray.length > 0) engineInput.manualEntries = manualEntriesArray;
        (function logEngineInputAudit() {
          var msDay = 86400000;
          var anchor = new Date(startDate + 'T12:00:00');
          var firstEightCycleWeeks = [];
          if (!isNaN(anchor.getTime())) {
            var anchorWeek = (currentWeek >= 1 && currentWeek <= 4) ? currentWeek : 1;
            for (var k = 0; k < 8; k++) {
              var d = new Date(anchor.getTime() + k * msDay);
              var daysElapsed = Math.floor((d - anchor) / msDay);
              var weekIndex = Math.floor(daysElapsed / 7);
              firstEightCycleWeeks.push(((weekIndex + (anchorWeek - 1)) % 4) + 1);
            }
          }
          var sample = parsedRoutes && parsedRoutes[0] ? {
            mode: parsedRoutes[0].mode,
            days: parsedRoutes[0].days,
            weeks: parsedRoutes[0].weeks,
            day: parsedRoutes[0].day,
            customer: parsedRoutes[0].customer,
            startDate: parsedRoutes[0].startDate,
            endDate: parsedRoutes[0].endDate
          } : null;
          var cycleSample = null;
          for (var ci = 0; parsedRoutes && ci < parsedRoutes.length; ci++) {
            if (parsedRoutes[ci] && String(parsedRoutes[ci].mode || '').toLowerCase().trim() === 'cycle') {
              cycleSample = {
                mode: parsedRoutes[ci].mode,
                days: parsedRoutes[ci].days,
                weeks: parsedRoutes[ci].weeks,
                customer: parsedRoutes[ci].customer
              };
              break;
            }
          }
          console.log('[ENGINE_INPUT_AUDIT]', {
            startDate: startDate,
            endDate: endDate,
            currentWeek: currentWeek,
            routeCount: parsedRoutes ? parsedRoutes.length : 0,
            engineMode: engineMode,
            firstEightCycleWeeksFromStartDate: firstEightCycleWeeks,
            firstRouteSample: sample,
            firstCycleRouteSample: cycleSample,
            note: 'currentWeek is the ClearTrack anchor: cycle week (1–4) on startDate; engine uses ((weekIndex + (currentWeek-1)) % 4) + 1 for cycle routes.'
          });
        })();
        var useLocalEngine = window.DEBUG_LOCAL_ENGINE === true;
        var runLocal = window.logbookEngine && (window.logbookEngine.generate || window.logbookEngine.runLogbookEngine);
        if (useLocalEngine && !runLocal) {
          if (statusEl) {
            statusEl.textContent = 'Engine not loaded. Set window.DEBUG_LOCAL_ENGINE = false for server generation, or load the engine script.';
            statusEl.style.color = 'red';
          }
          if (loadingBlock) loadingBlock.classList.add('hidden');
          btn.classList.remove('hidden');
          validateForm();
          refreshLogbookAccessState();
          return;
        }
        if (statusEl) {
          statusEl.textContent = useLocalEngine ? 'Calculating travel distances…' : 'Generating logbook on server…';
          statusEl.style.color = '#1f6f78';
          statusEl.classList.add('logbook-status-calculating');
        }
        var coordMap = {};
        for (var r = 0; r < parsedRoutes.length; r++) {
          var route = parsedRoutes[r];
          var addrKey = route && route.address != null ? String(route.address) : '';
          if (addrKey && route.lat != null && route.lng != null) {
            var pt = { lat: route.lat, lng: route.lng };
            if (route.province != null && String(route.province).trim()) {
              pt.province = String(route.province).trim();
            }
            coordMap[addrKey] = pt;
          }
        }
        var manualEntries = engineInput.manualEntries || [];
        for (var m = 0; m < manualEntries.length; m++) {
          var manual = manualEntries[m];
          var fromStr = manual && manual.from != null ? String(manual.from).trim() : '';
          var toStr = manual && manual.to != null ? String(manual.to).trim() : '';
          if (fromStr && manual.fromLat != null && manual.fromLng != null) {
            coordMap[fromStr] = { lat: manual.fromLat, lng: manual.fromLng };
          }
          if (toStr && manual.toLat != null && manual.toLng != null) {
            coordMap[toStr] = { lat: manual.toLat, lng: manual.toLng };
          }
        }
        var unresolvedManual = manualEntries.filter(function (e) {
          return e && (e.fromLat == null || e.fromLng == null || e.toLat == null || e.toLng == null);
        });
        if (unresolvedManual.length > 0 && statusEl) {
          statusEl.textContent = unresolvedManual.length + ' manual trip(s) have unresolved addresses and will show 0 km. Remove or re-add them with valid From/To to get distance.';
          statusEl.style.color = 'orange';
          statusEl.classList.remove('logbook-status-calculating');
          if (loadingBlock) loadingBlock.classList.remove('hidden');
          btn.classList.remove('hidden');
          refreshLogbookAccessState();
          return;
        }
        function executeEngineRun() {
          engineInput.mode = engineMode;
          console.log('🚨 MODE SENT TO ENGINE:', engineMode);

          var generateUrl = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
            ? LOGBOOK_API_FUNCTION_BASE + '/generateLogbook'
            : resolveLogbookExpressApiUrl('/api/generateLogbook');
          if (useLocalEngine) {
            var homeCoords = originAddress ? coordMap[originAddress] : null;
            if (homeCoords && homeCoords.lat != null && homeCoords.lng != null) {
              engineInput.homeLat = homeCoords.lat;
              engineInput.homeLng = homeCoords.lng;
            }
            if (originAddress && coordMap[originAddress] && coordMap[originAddress].province) {
              engineInput.homeProvince = String(coordMap[originAddress].province).trim();
            }
            var localResult = runLocal(engineInput);
            console.log('UI PAYLOAD SENT:', {
              routesCount: engineInput.routes.length,
              hasLatLng: engineInput.routes.every(r => typeof r.lat === 'number' && typeof r.lng === 'number'),
              homeLat: engineInput.homeLat,
              homeLng: engineInput.homeLng
            });
            /* No auth headers: avoids a second token consume; compare is diagnostic only. */
            fetch(generateUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(engineInput)
            }).then(function (r) {
              return r.json();
            }).then(function (backendResult) {
              Promise.resolve(localResult).then(function (resolvedLocalResult) {
                window.__localResult = resolvedLocalResult;
                window.__backendResult = backendResult;
                console.log('LOCAL:', resolvedLocalResult);
                console.log('BACKEND:', backendResult);
                if (JSON.stringify(resolvedLocalResult) !== JSON.stringify(backendResult.data)) {
                  console.warn('ENGINE MISMATCH DETECTED');
                }
              });
            }).catch(function (err) {
              console.warn('Backend comparison failed:', err && err.message ? err.message : err);
            });
            return localResult;
          }

          var homeLat = undefined;
          var homeLng = undefined;
          var hkSend = String(originAddress || '').trim();
          if (hkSend && coordMap[hkSend]) {
            homeLat = Number(coordMap[hkSend].lat);
            homeLng = Number(coordMap[hkSend].lng);
          }
          console.log("🚨 UI → API ROUTES:", JSON.stringify(parsedRoutes, null, 2));
          var idTokenPromise = getAdminEmbedIdTokenAsPromise();
          return idTokenPromise.then(function (idToken) {
            var genHeaders = { 'Content-Type': 'application/json' };
            if (idToken) {
              genHeaders['Authorization'] = 'Bearer ' + idToken;
            }
            if (isAdminDashboardEmbed) {
              genHeaders['X-Admin-Dashboard'] = 'true';
            }
            var urlParamsGen = new URLSearchParams(window.location.search);
            var sessionToken = urlParamsGen.get('token');
            sessionToken =
              sessionToken != null && String(sessionToken).trim() !== ''
                ? String(sessionToken).trim()
                : '';
            genHeaders['X-Logbook-Token'] = sessionToken;
            genHeaders['X-Request-Id'] = crypto.randomUUID();
            return fetch(generateUrl, {
              method: 'POST',
              headers: genHeaders,
              body: JSON.stringify({
                routes: parsedRoutes,
                sessionToken: sessionToken,
                logbookAccessToken: sessionToken,
                startDate: startDate,
                endDate: endDate,
                openingKm: openingKm,
                homeAddress: originAddress,
                homeLat: homeLat,
                homeLng: homeLng,
                currentWeek: currentWeek,
                mode: engineMode,
                leaveDays: leaveDaysArray || [],
                manualEntries: manualEntriesArray || []
              })
            }).then(function (r) {
              return r.text().then(function (text) {
                var body = {};
                try {
                  body = text ? JSON.parse(text) : {};
                } catch (parseErr) {
                  body = {};
                }
                if (!r.ok) {
                  if (r.status === 403) {
                    return refreshLogbookAccessState().then(function () {
                      throw new Error((body && body.error) ? body.error : (text || ('HTTP ' + r.status)));
                    });
                  }
                  throw new Error((body && body.error) ? body.error : (text || ('HTTP ' + r.status)));
                }
                if (!body.success || !body.data) {
                  throw new Error((body && body.error) ? body.error : 'Request failed');
                }
                return body.data;
              });
            });
          });
        }

        var homeGeocodePromise = Promise.resolve();
        if (originAddress && !coordMap[originAddress]) {
          homeGeocodePromise = fetch(resolveLogbookExpressApiUrl('/api/geocodeAddresses'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ addresses: [originAddress] })
          }).then(function (r) { return r.json(); }).then(function (data) {
            var resolved = Array.isArray(data) ? data : [];
            var homeRes = resolved[0];
            if (homeRes && homeRes.resolved && homeRes.lat != null && homeRes.lng != null) {
              coordMap[originAddress] = { lat: homeRes.lat, lng: homeRes.lng };
            }
          }).catch(function () {
            // Keep existing behavior if home geocoding fails.
          });
        }

        homeGeocodePromise.then(function () {
          if (!useLocalEngine && engineInput.homeAddress && String(engineInput.homeAddress).trim()) {
            var hk = String(engineInput.homeAddress).trim();
            var hPt = coordMap[hk];
            var hLat = hPt != null ? Number(hPt.lat) : NaN;
            var hLng = hPt != null ? Number(hPt.lng) : NaN;
            if (isNaN(hLat) || isNaN(hLng)) {
              return Promise.reject(new Error(
                'We could not resolve coordinates for your home or origin address. Check the address spelling, or resolve route addresses first so the map includes this location, then try again.'
              ));
            }
          }
          return executeEngineRun();
        }).then(async function (result) {
          lastLogbookResult = result;
          if (statusEl) {
            statusEl.classList.remove('logbook-status-calculating');
            statusEl.classList.remove('status-error');
          }
          var legacyWarning = document.querySelector(".logbook-warning-block");
          if (legacyWarning) legacyWarning.remove();
          try {
            await downloadLogbook(result);
            if (statusEl) {
              statusEl.textContent = '✅ Logbook generated and downloaded successfully. Please check your Downloads folder if the file did not open automatically.';
              statusEl.style.color = 'green';
              var reviewNeeded =
                (result.meta && result.meta.reviewRequired === true) ||
                (result.meta && result.meta.status === 'REVIEW REQUIRED');
              if (!reviewNeeded && result.entries && result.entries.length) {
                for (var ri = 0; ri < result.entries.length; ri++) {
                  if (result.entries[ri] && result.entries[ri].flag) {
                    reviewNeeded = true;
                    break;
                  }
                }
              }
              if (reviewNeeded) {
                statusEl.textContent = '\u26A0 Review Required\n\n' + statusEl.textContent;
                statusEl.style.whiteSpace = 'pre-line';
              }
            }
          } catch (dlErr) {
            if (statusEl) {
              statusEl.textContent = (dlErr && dlErr.message)
                ? String(dlErr.message)
                : 'Logbook was generated but the download step failed. Check your tokens and try again.';
              statusEl.style.color = '#b45309';
            }
          }
          if (loadingBlock) loadingBlock.classList.add('hidden');
          btn.classList.remove('hidden');
          validateForm();
          refreshLogbookAccessState();
        }).catch(function (err) {
          if (statusEl) {
            statusEl.classList.remove('logbook-status-calculating');
            statusEl.style.color = 'red';
            if (err && err.invalidAddresses && Array.isArray(err.invalidAddresses) && err.invalidAddresses.length > 0) {
              statusEl.style.whiteSpace = 'pre-line';
              var errRoutes = window.currentRoutes || [];
              var lines = err.invalidAddresses.map(function (addr) {
                var a = (addr || '').toString().trim();
                var route = errRoutes.find(function (r) {
                  var ra = r && r.address != null ? String(r.address).trim() : '';
                  return ra === a;
                });
                var storeName = route && (route.customer != null) ? (route.customer || '').toString().trim() : '';
                if (storeName) {
                  return 'Client / Store: ' + storeName + '\n\nAddress:\n' + (a || '(unknown)');
                }
                return 'Address:\n' + (a || '(unknown)');
              });
              var intro = lines.length === 1
                ? 'We could not calculate a route for this routelist entry.\n\n'
                : 'We could not calculate routes for the following routelist entries.\n\n';
              statusEl.textContent =
                intro +
                lines.join('\n\n---\n\n') +
                '\n\nPlease correct the address in the routelist Excel file.\n\nTip: Use a clear address or identifiable location.';
            } else {
              statusEl.style.whiteSpace = '';
              statusEl.textContent = (err && err.message) ? err.message : 'Something went wrong.';
            }
          }
          if (loadingBlock) loadingBlock.classList.add('hidden');
          btn.classList.remove('hidden');
          validateForm();
          refreshLogbookAccessState();
        });
      }

      var resolvedRoutes = window.currentRoutes;
      console.log('UI DATA SOURCE:', window.currentRoutes);
      console.log('[AUDIT ENGINE INPUT COUNT]', resolvedRoutes ? resolvedRoutes.length : 0);
      runEngineWithRoutes(resolvedRoutes);
    });
  }

  function getOriginTypePlaceholder(originType) {
    if (originType === 'work') return 'Office or depot address';
    if (originType === 'other') return 'Enter starting location';
    return 'Home address';
  }

  function initOriginStartUI() {
    var originAddressInput = document.getElementById('originAddress');
    var radioHome = document.getElementById('originTypeHome');
    var radioWork = document.getElementById('originTypeWork');
    var radioOther = document.getElementById('originTypeOther');
    if (!originAddressInput) return;

    function updatePlaceholder() {
      var t = (radioHome && radioHome.checked) ? 'home' : (radioWork && radioWork.checked) ? 'work' : 'other';
      originAddressInput.placeholder = getOriginTypePlaceholder(t);
    }

    try {
      var legacyHome = typeof sessionStorage !== 'undefined' && sessionStorage.getItem('logbook_homeAddress');
      if (legacyHome) {
        if (radioHome) radioHome.checked = true;
        originAddressInput.value = legacyHome;
        sessionStorage.removeItem('logbook_homeAddress');
      }
    } catch (e) { /* ignore */ }

    updatePlaceholder();
    if (radioHome) radioHome.addEventListener('change', updatePlaceholder);
    if (radioWork) radioWork.addEventListener('change', updatePlaceholder);
    if (radioOther) radioOther.addEventListener('change', updatePlaceholder);
  }

  async function init() {
    applyIframeLayout();
    initLogbookAuthListener();
    try {
      /* Never localStorage.clear() here: it wipes Firebase Auth persistence (same origin as admin iframe parent). */
      if (typeof sessionStorage !== 'undefined') sessionStorage.clear();
      if ('caches' in window && window.caches && typeof window.caches.keys === 'function') {
        window.caches.keys().then(function (names) { names.forEach(function (n) { window.caches.delete(n); }); }).catch(function () {});
      }
    } catch (e) { /* ignore */ }
    updateClearRoutelistButtonVisibility();
    initClearRoutelistButton();
    initNewLogbookButton();
    initReprocessAddressesButton();
    initTemplateDownload();
    initRoutelistDropzone();
    initWorkingCityDropdown();
    initRefreshRoutesButton();
    initRoutelistPreviewEdit();
    initParseButton();
    populateTaxYearSelect();
    var taxSel = document.getElementById('taxYear');
    if (taxSel) taxSel.addEventListener('change', updateDatesFromTaxYear);
    initOriginStartUI();
    initLogbookDropzone();
    initLeaveModal();
    initManualModals();
    setupAdjustmentsSummaryRemove();
    updateAdjustmentsSummary();
    initFormSubmit();
    try {
      await checkAccess();
    } catch (e) {
      console.error(e);
    }
    updateStepProgress();
    if (typeof window.validateLogbookForm === 'function') window.validateLogbookForm();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      init().catch(console.error);
    });
  } else {
    init().catch(console.error);
  }
  } catch (e) {
    console.error("Logbook page crash:", e);
  }
})();
