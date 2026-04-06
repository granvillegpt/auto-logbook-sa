const admin = require('firebase-admin');

admin.initializeApp();

const email = process.argv[2];

if (!email) {
  console.error("Usage: node scripts/setAdmin.js <email>");
  process.exit(1);
}

async function run() {
  try {
    const user = await admin.auth().getUserByEmail(email);

    await admin.auth().setCustomUserClaims(user.uid, { admin: true });

    console.log("Admin role assigned");
    console.log("UID:", user.uid);

    process.exit(0);
  } catch (err) {
    console.error("Error:", err.message);
    process.exit(1);
  }
}

run();
