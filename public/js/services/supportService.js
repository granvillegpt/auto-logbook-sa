/**
 * Support service – all support/contact data access goes through this module.
 * UI must only call these functions; no direct fetch/localStorage/firebase in pages.
 */
import { STORAGE_MODE } from './storageAdapter.js';

// Placeholder API for when support form or tickets are added

function localSubmitSupportRequest(/* data */) {
  // Placeholder: use localStorage or no-op until support feature exists
}

function firebaseSubmitSupportRequest(/* data */) {
  // Placeholder: replace with Firestore when STORAGE_MODE === 'firebase'
}

/**
 * Submit a support or contact request (placeholder for future use).
 * @param {{ email?: string, message?: string, subject?: string }} data
 */
export function submitSupportRequest(data) {
  if (STORAGE_MODE === 'firebase') {
    firebaseSubmitSupportRequest(data);
    return;
  }
  localSubmitSupportRequest(data);
}
