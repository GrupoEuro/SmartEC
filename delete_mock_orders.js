const admin = require('firebase-admin');

admin.initializeApp({
    projectId: 'tiendapraxis',
});
const db = admin.firestore();

async function deleteMockOrders() {
    console.log("Locating Mock Orders (IDs starting with 'ord_')...");
    
    const ordersSnap = await db.collection('orders').get();
    
    let batch = db.batch();
    let deleteCount = 0;
    
    ordersSnap.forEach(doc => {
        // The seeder uses "ord_1000", "ord_1001", etc.
        if (doc.id.startsWith('ord_')) {
            batch.delete(doc.ref);
            deleteCount++;
        }
    });
    
    if (deleteCount > 0) {
        console.log(`Found ${deleteCount} mock orders. Deleting...`);
        await batch.commit();
        console.log(`✅ Successfully deleted ${deleteCount} mock orders from the database.`);
    } else {
        console.log(`No mock orders found to delete.`);
    }
}

deleteMockOrders().catch(console.error);
