window.FIREBASE_CONFIG = {
  apiKey: "AIzaSyAA7K54BiKg4kva91wEz-KM2_NfoMNjhBI",
  authDomain: "autologbook-sa.firebaseapp.com",
  projectId: "autologbook-sa",
  storageBucket: "autologbook-sa.firebasestorage.app",
  messagingSenderId: "774300867996",
  appId: "1:774300867996:web:XXXXX"
};

try {
  if (typeof firebase === "undefined") {
    console.warn("Firebase not loaded — using fallback");
    window.firebaseReady = false;
  } else {
    if (typeof firebase !== "undefined") {
      window.firebase = firebase;
    }
    if (!firebase.apps.length) {
      firebase.initializeApp(window.FIREBASE_CONFIG);
    }

    window.firebaseFunctions =
      typeof firebase.functions === "function"
        ? firebase.functions()
        : null;

    window.firebaseApp = firebase.app();
    window.db = typeof firebase.firestore === "function" ? firebase.firestore() : null;
    if (
      location.hostname === "localhost" ||
      location.hostname === "127.0.0.1"
    ) {
      console.log("🔥 CONNECTING TO FIRESTORE EMULATOR");
      if (window.db) {
        window.db.useEmulator("127.0.0.1", 8086);
      }
    } else {
      console.log("🚀 USING PRODUCTION FIRESTORE");
    }
    window.storage = typeof firebase.storage === "function" ? firebase.storage() : null;

    console.log("🔥 INIT READY:", window.firebaseApp);
    console.log("🔥 DB READY:", window.db);

    window.firebaseReady = true;
  }
} catch (e) {
  console.error("Firebase init failed:", e);
  window.firebaseReady = false;
}
