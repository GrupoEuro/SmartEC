"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.backfillUserClaims = exports.syncUserClaims = void 0;
/**
 * user-claims.ts
 * Firebase Auth custom claims sync: syncUserClaims (Firestore trigger),
 * backfillUserClaims (callable).
 */
const functions = require("firebase-functions");
const admin = require("firebase-admin");
const shared_1 = require("./shared");
const VALID_ROLES = ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'STAFF', 'CUSTOMER'];
exports.syncUserClaims = functions.firestore
    .document('users/{uid}')
    .onWrite(async (change, context) => {
    const uid = context.params.uid;
    // Document was deleted — revoke claims
    if (!change.after.exists) {
        await admin.auth().setCustomUserClaims(uid, { role: null });
        console.log(`[Claims] Cleared claims for deleted user: ${uid}`);
        return;
    }
    const data = change.after.data();
    if (!data)
        return;
    const role = VALID_ROLES.includes(data.role) ? data.role : 'CUSTOMER';
    try {
        await admin.auth().setCustomUserClaims(uid, { role });
        console.log(`[Claims] Set role='${role}' for uid=${uid}`);
    }
    catch (err) {
        console.error(`[Claims] Failed to set claim for uid=${uid}:`, err);
    }
});
// ─── Backfill: Set Custom Claims for All Existing Users ──────────────────────
//
// Call this ONE TIME via Firebase Console or CLI after deploying to push Claims
// to all existing users who had roles set before this function existed.
// Only callable by SUPER_ADMIN (verified via existing claims or first-run flag).
//
exports.backfillUserClaims = functions.https.onCall(async (data, context) => {
    var _a, _b;
    // Only allow this to run if the caller is already SUPER_ADMIN
    // OR if there are no admin claims yet (first-time setup)
    const callerRole = (_b = (_a = context.auth) === null || _a === void 0 ? void 0 : _a.token) === null || _b === void 0 ? void 0 : _b.role;
    if (callerRole !== 'SUPER_ADMIN') {
        throw new functions.https.HttpsError('permission-denied', 'Only SUPER_ADMIN can trigger the claims backfill.');
    }
    const usersSnapshot = await shared_1.db.collection('users').get();
    const results = [];
    for (const doc of usersSnapshot.docs) {
        const userData = doc.data();
        const uid = doc.id;
        const role = VALID_ROLES.includes(userData.role) ? userData.role : 'CUSTOMER';
        const email = userData.email || 'unknown';
        try {
            await admin.auth().setCustomUserClaims(uid, { role });
            results.push({ uid, email, role, status: 'ok' });
        }
        catch (err) {
            results.push({ uid, email, role, status: `error: ${err.message}` });
        }
    }
    console.log(`[Claims Backfill] Processed ${results.length} users.`);
    return { processed: results.length, results };
});
// ─── SkyDropX PRO: Shipping Integration ───────────────────────────────────────
//
// Proxies all SkyDropX PRO API calls — API key never hits the browser.
//
// Set these environment variables before deploying (add to .env or Secret Manager):
//   SKYDROPX_API_KEY           = <from SkyDropX PRO dashboard › Conexiones › API>
//   SKYDROPX_ORIGIN_NAME       = Importadora Euro
//   SKYDROPX_ORIGIN_PHONE      = +524441234567
//   SKYDROPX_ORIGIN_STREET     = Av. Salvador Nava
//   SKYDROPX_ORIGIN_NUMBER     = 804
//   SKYDROPX_ORIGIN_COLONIA    = Col. Nuevo Paseo
//   SKYDROPX_ORIGIN_CITY       = San Luis Potosí
//   SKYDROPX_ORIGIN_STATE      = San Luis Potosí
//   SKYDROPX_ORIGIN_ZIPCODE    = 78140
//   SKYDROPX_ORIGIN_COUNTRY    = MX
//
// ─────────────────────────────────────────────────────────────────────────────
//# sourceMappingURL=user-claims.js.map