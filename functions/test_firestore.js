const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();

async function check() {
    const snap = await db.collection('orders')
        .where('total', '<', 100)
        .where('total', '>', 0)
        .orderBy('total', 'desc')
        .limit(50)
        .get();
        
    console.log("Found:", snap.size);
    snap.docs.forEach(doc => {
        const d = doc.data();
        if (!d.sourceChannel || d.sourceChannel === 'storefront') {
            console.log(doc.id, "Date:", d.createdAt?.toDate(), "Total:", d.total, "Status:", d.status);
        }
    });
}

check().catch(console.error);
