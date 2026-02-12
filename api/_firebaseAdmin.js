// /api/_firebaseAdmin.js
import admin from "firebase-admin";

let app;

export function getAdminApp() {
  if (app) return app;

  // For Vercel: store full service account JSON in env: FIREBASE_SERVICE_ACCOUNT
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;

  if (!raw) {
    throw new Error("Missing FIREBASE_SERVICE_ACCOUNT env var (service account JSON).");
  }

  const serviceAccount = JSON.parse(raw);

  app =
    admin.apps.length > 0
      ? admin.app()
      : admin.initializeApp({
          credential: admin.credential.cert(serviceAccount),
        });

  return app;
}

export function getDb() {
  getAdminApp();
  return admin.firestore();
}

export async function requireUser(req) {
  const h = req.headers?.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : null;

  if (!token) return null;

  try {
    getAdminApp();
    const decoded = await admin.auth().verifyIdToken(token);
    return decoded; // { uid, ... }
  } catch (e) {
    // invalid/expired token -> treat as not logged in
    return null;
  }
}

