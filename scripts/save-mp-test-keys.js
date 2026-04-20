/**
 * One-time script: saves MercadoPago TEST credentials to Firestore
 * Run: node scripts/save-mp-test-keys.js
 */
const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

async function main() {
    await db.collection('config').doc('integrations').set({
        mercadopago: {
            accessToken:          'TEST-398646544825942-022715-cbec23472732e892da3798593de42e85-1178500066',
            publicKey:            'TEST-26a04055-43d8-4f69-97c5-7829d3d413bf',
            connected:            true,
            installmentsEnabled:  false,
            maxInstallments:      1,
            isTestMode:           true,   // flag so UI can warn "TEST MODE"
        }
    }, { merge: true });

    console.log('✅ MercadoPago TEST credentials saved to Firestore.');
    process.exit(0);
}

main().catch(err => {
    console.error('❌ Failed:', err);
    process.exit(1);
});
