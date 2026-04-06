/**
 * Post-init: logging / optional emulators. App + Firestore + Storage are set in /firebase/init.js only.
 */
(function () {
  'use strict';
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

  const USE_EMULATOR = false;
  if (USE_EMULATOR && window.db) {
    console.log('Connecting to Firestore emulator');
    window.db.useEmulator('127.0.0.1', 8080);
    if (firebase.auth) {
      firebase.auth().useEmulator('http://127.0.0.1:9099');
    }
  }
})();
