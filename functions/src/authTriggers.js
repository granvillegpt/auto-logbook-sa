const functions = require("firebase-functions/v1");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");

const ADMIN_EMAIL = "granvillepowell@icloud.com";

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

/** Gen1 Auth user.create; requires functions runtime Node 20 (Gen1 does not support Node 24). */
const assignAdminOnUserCreate = functions
  .region("us-central1")
  .auth.user()
  .onCreate(async (user) => {
    const email = normalizeEmail(user.email);
    if (email !== normalizeEmail(ADMIN_EMAIL)) {
      return;
    }
    console.log("[assignAdminOnUserCreate] admin email matched:", email);
    await admin.auth().setCustomUserClaims(user.uid, { admin: true });
    console.log("[assignAdminOnUserCreate] assigned admin custom claim", {
      uid: user.uid,
      email,
    });
  });

const setAdminByEmail = onCall(
  {
    region: "us-central1",
    cors: true,
    invoker: "public",
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Authentication required.");
    }
    const requested = normalizeEmail(request.data && request.data.email);
    if (!requested) {
      throw new HttpsError("invalid-argument", "email is required.");
    }
    if (requested !== normalizeEmail(ADMIN_EMAIL)) {
      throw new HttpsError(
        "permission-denied",
        "Only the configured admin email can receive admin claims."
      );
    }
    const callerEmail = normalizeEmail(request.auth.token.email);
    if (callerEmail !== requested) {
      throw new HttpsError(
        "permission-denied",
        "Signed-in user must match the target email."
      );
    }
    let targetUser;
    try {
      targetUser = await admin.auth().getUserByEmail(requested);
    } catch (e) {
      if (e && e.code === "auth/user-not-found") {
        throw new HttpsError("not-found", "No user for that email.");
      }
      throw e;
    }
    if (targetUser.uid !== request.auth.uid) {
      throw new HttpsError("permission-denied", "User mismatch.");
    }
    console.log("[setAdminByEmail] admin email matched, assigning claim:", {
      email: requested,
      uid: targetUser.uid,
    });
    await admin.auth().setCustomUserClaims(targetUser.uid, { admin: true });
    console.log("[setAdminByEmail] assigned admin custom claim", {
      uid: targetUser.uid,
      email: requested,
    });
    return { success: true, uid: targetUser.uid, email: requested };
  }
);

module.exports = {
  assignAdminOnUserCreate,
  setAdminByEmail,
};
