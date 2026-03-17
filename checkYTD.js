const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

initializeApp();
const db = getFirestore();

async function checkYTD() {
    console.log("Fetching YTD orders...");
    
    // YTD 2026
    const startDate = new Date(2026, 0, 1); // Jan 1 2026
    const endDate = new Date();
    
    const ordersSnap = await db.collection('orders')
        .where('createdAt', '>=', startDate)
        .where('createdAt', '<=', endDate)
        .get();
        
    console.log(`Total YTD Orders in Firestore: ${ordersSnap.size}`);
    
    let meliOrders = 0;
    let meliSales = 0;
    let cancelled = 0;
    let monthlyCounts = {};
    
    ordersSnap.forEach(doc => {
        const o = doc.data();
        const date = o.createdAt.toDate ? o.createdAt.toDate() : new Date(o.createdAt);
        const month = date.getMonth(); // 0 = Jan, 1 = Feb, 2 = Mar
        
        monthlyCounts[month] = (monthlyCounts[month] || 0) + 1;
        
        if (o.sourceChannel === 'mercadolibre' || (o.channel && o.channel.includes('MELI'))) {
            meliOrders++;
            if (['cancelled', 'refunded', 'returned'].includes(o.status)) {
                cancelled++;
            } else {
                let total = o.total || 0;
                meliSales += total;
            }
        }
    });
    
    console.log(`Monthly Distribution: ${JSON.stringify(monthlyCounts)}`);
    console.log(`Meli Orders: ${meliOrders} (of which cancelled: ${cancelled})`);
    console.log(`Meli Sales (excluding cancelled): ${meliSales}`);
}

checkYTD().catch(console.error);
