/**
 * Post-init: logging / optional emulators. App + Firestore + Storage are set in /firebase/init.js only.
 */
(function () {
  'use strict';
  const IS_ADMIN_PAGE =
    typeof window !== 'undefined' && window.location.pathname.includes('admin');
  if (IS_ADMIN_PAGE) return;
  if (typeof firebase === 'undefined' || !window.firebaseReady) return;
  const isProd = window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1';

  if (isProd) {
    const originalWarn = console.warn;
    console.warn = function (...args) {
      const msg = String(args[0] || '');
      if (
        msg.includes('non-passive event listener') ||
        (msg.includes('Firestore') && msg.includes('Could not reach backend'))
      ) {
        return;
      }
      originalWarn.apply(console, args);
    };
  }

  if (firebase.firestore && firebase.firestore.setLogLevel) {
    firebase.firestore.setLogLevel('error');
  }

  // DEBUG START — homepage ads: see 🔥 logs from sponsoredTools load on index.html
  console.log('[ADS DEBUG] If live ads are missing on the homepage, check the 🔥 RAW SNAPSHOT / SLOT / FINAL logs from the Recommended Tools loader on index.html.');
  // DEBUG END

  const USE_EMULATOR = false;
  if (
    (location.hostname === 'localhost' || location.hostname === '127.0.0.1') &&
    USE_EMULATOR &&
    window.db
  ) {
    console.log('Connecting to Firestore emulator');
    window.db.useEmulator('127.0.0.1', 8080);
    if (firebase.auth) {
      firebase.auth().useEmulator('http://127.0.0.1:9099');
    }
  }
})();
