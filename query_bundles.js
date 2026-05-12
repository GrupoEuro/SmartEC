const admin = require('firebase-admin');
const fs = require('fs');
if (!admin.apps.length) {
    const serviceAccountPath = '/Volumes/MacData/Projects/Eurollantas/Website/importadora-euro/functions/serviceAccountKey.json';
    if (fs.existsSync(serviceAccountPath)) {
        admin.initializeApp({
            credential: admin.credential.cert(require(serviceAccountPath))
        });
    } else {
        console.log("No service account found");
        process.exit(0);
    }
}

async function run() {
    try {
        const snap = await admin.firestore().collection('bundles').limit(1).get();
        if (snap.empty) {
            console.log("bundles collection is empty or does not exist.");
        } else {
            console.log("Found bundle:");
            console.dir(snap.docs[0].data(), {depth: null});
        }
    } catch (e) {
        console.error(e);
    }
    process.exit(0);
}
run();
