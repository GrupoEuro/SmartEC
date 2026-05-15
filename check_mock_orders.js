const admin = require('firebase-admin');

admin.initializeApp({
    projectId: 'tiendapraxis',
});
const db = admin.firestore();

async function checkMockOrders() {
    console.log("Analyzing Mock Orders (IDs starting with 'ord_')...");
    
    // We fetch all orders that start with "ord_" or simply fetch all and filter locally for speed if there aren't millions
    const ordersSnap = await db.collection('orders').get();
    
    let mockOrdersCount = 0;
    let minDate = null;
    let maxDate = null;
    let channels = {};
    
    ordersSnap.forEach(doc => {
        const o = doc.data();
        // The seeder uses "ord_1000", "ord_1001", etc.
        // It also uses orderNumber starting with "ORD-2025"
        if (doc.id.startsWith('ord_') || (o.orderNumber && o.orderNumber.startsWith('ORD-2025'))) {
            mockOrdersCount++;
            
            const date = o.createdAt.toDate ? o.createdAt.toDate() : new Date(o.createdAt);
            
            if (!minDate || date < minDate) minDate = date;
            if (!maxDate || date > maxDate) maxDate = date;
            
            const channel = o.channel || o.sourceChannel || 'UNKNOWN';
            channels[channel] = (channels[channel] || 0) + 1;
        }
    });
    
    console.log(`\nFound ${mockOrdersCount} mock orders.`);
    if (mockOrdersCount > 0) {
        console.log(`Earliest Mock Order Date: ${minDate.toISOString()}`);
        console.log(`Latest Mock Order Date: ${maxDate.toISOString()}`);
        console.log(`\nChannel Distribution:`);
        console.log(JSON.stringify(channels, null, 2));
    }
}

checkMockOrders().catch(console.error);
