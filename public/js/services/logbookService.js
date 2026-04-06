/**
 * Logbook service – all logbook/route data access goes through this module.
 * UI must only call these functions; no direct fetch/localStorage/firebase in pages.
 */
import { STORAGE_MODE } from './storageAdapter.js';

const ROUTES_STORAGE_KEY = 'autoLogbookRoutes';

function localGetRoutes() {
  try {
    const raw = typeof localStorage !== 'undefined' && localStorage.getItem(ROUTES_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function localSaveRoutes(routes) {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(ROUTES_STORAGE_KEY, JSON.stringify(routes));
  }
}

function localClearRoutes() {
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem(ROUTES_STORAGE_KEY);
  }
}

function firebaseGetRoutes() {
  // Placeholder: replace with Firestore query when STORAGE_MODE === 'firebase'
  return Promise.resolve(null);
}

function firebaseSaveRoutes(/* routes */) {
  // Placeholder: replace with Firestore when STORAGE_MODE === 'firebase'
  return Promise.resolve();
}

function firebaseClearRoutes() {
  // Placeholder: replace with Firestore when STORAGE_MODE === 'firebase'
  return Promise.resolve();
}

/**
 * Get saved route list (e.g. enriched routelist). Returns null if none.
 * @returns {Array|null|Promise<Array|null>}
 */
export function getRoutes() {
  if (STORAGE_MODE === 'firebase') {
    return firebaseGetRoutes();
  }
  return localGetRoutes();
}

/**
 * Save route list.
 * @param {Array} routes
 */
export function saveRoutes(routes) {
  if (STORAGE_MODE === 'firebase') {
    return firebaseSaveRoutes(routes);
  }
  localSaveRoutes(routes);
}

/**
 * Clear saved route list.
 */
export function clearRoutes() {
  if (STORAGE_MODE === 'firebase') {
    return firebaseClearRoutes();
  }
  localClearRoutes();
}
