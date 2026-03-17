const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const serviceAccount = require('./functions/serviceAccountKey.json');

initializeApp({
  credential: cert(serviceAccount)
});

const db = getFirestore();

async function checkMissingMeli() {
    console.log("Fetching YTD MercadoLibre orders...");
    const startOf2025 = new Date('2025-01-01T00:00:00.000Z');
    
    const ordersRef = db.collection('orders');
    const snapshot = await ordersRef
        .where('sourceChannel', '==', 'mercadolibre')
        .where('createdAt', '>=', startOf2025)
        .get();
    
    let activeOrders = 0;
    let cancelledOrders = 0;
    let totalSales = 0;
    let totalItems = 0;
    
    snapshot.forEach(doc => {
        const data = doc.data();
        const st = data.status || 'unknown';
        
        if (st === 'cancelled' || st === 'refunded' || st === 'returned') {
            cancelledOrders++;
        } else {
            activeOrders++;
            totalSales += (data.total || 0);
            
            if (data.items && Array.isArray(data.items)) {
                data.items.forEach(item => {
                    totalItems += (item.quantity || 0);
                });
            }
        }
    });

    console.log(`\n--- DATABASE SUMMARY ---`);
    console.log(`Total Meli Orders in DB: ${snapshot.size}`);
    console.log(`Active (Sold) Orders: ${activeOrders}`);
    console.log(`Cancelled/Refunded: ${cancelledOrders}`);
    console.log(`Total Sales (MXN): ${totalSales}`);
    console.log(`Total Items Sold: ${totalItems}`);
    console.log(`\nMercadoLibre's Website claims: 996 (Active), 25 (Canceled), $817,520 (Sales), 1,013 (Items)`);
}

checkMissingMeli().catch(console.error);
