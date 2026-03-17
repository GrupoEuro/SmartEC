const admin = require('firebase-admin');

// Ensure correct initialization using Application Default Credentials
if (admin.apps.length === 0) {
  admin.initializeApp({
    credential: admin.credential.applicationDefault()
  });
}

const db = admin.firestore();

async function checkOrderDates() {
    const start = new Date("2026-01-01T00:00:00.000Z");
    const snap = await db.collection('orders')
        .where('createdAt', '>=', start)
        .get();
        
    let marCount = 0;
    let febCount = 0;
    let janCount = 0;
    let unknownCount = 0;
    
    snap.forEach(doc => {
        const data = doc.data();
        const dateStr = data.createdAt ? data.createdAt.toDate().toISOString() : "Unknown";
        if (dateStr.includes("2026-03")) marCount++;
        else if (dateStr.includes("2026-02")) febCount++;
        else if (dateStr.includes("2026-01")) janCount++;
        else unknownCount++;
    });
    
    console.log(`Total Found: ${snap.size}`);
    console.log(`Orders in Jan: ${janCount}`);
    console.log(`Orders in Feb: ${febCount}`);
    console.log(`Orders in Mar: ${marCount}`);
    console.log(`Orders Unknown: ${unknownCount}`);
}

checkOrderDates().then(() => process.exit(0)).catch(err => {
    console.error(err);
    process.exit(1);
});
