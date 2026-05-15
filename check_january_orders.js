const admin = require('firebase-admin');

admin.initializeApp({
    projectId: 'tiendapraxis',
});
const db = admin.firestore();

async function checkJan() {
    console.log("Fetching January orders...");
    
    for (const year of [2026, 2025]) {
        const startDate = new Date(year, 0, 1); 
        const endDate = new Date(year, 1, 1); 
        
        const ordersSnap = await db.collection('orders')
            .where('createdAt', '>=', startDate)
            .where('createdAt', '<', endDate)
            .get();
            
        console.log(`Total January ${year} Orders: ${ordersSnap.size}`);
        
        let meliFullCount = 0;
        let samples = [];
        
        ordersSnap.forEach(doc => {
            const o = doc.data();
            // Let's check fulfillment or sourceChannel
            const isFull = o.sourceChannel === 'MELI_FULL' || o.channel === 'MELI_FULL' || o.fulfillmentType === 'Fulfillment' || (o.attributes && o.attributes.fulfillment_type === 'fulfillment');
            if (isFull) {
                meliFullCount++;
                if (samples.length < 1) {
                    samples.push({
                        id: doc.id,
                        orderNumber: o.orderNumber,
                        sourceChannel: o.sourceChannel,
                        channel: o.channel,
                        fulfillmentType: o.fulfillmentType,
                        status: o.status,
                        createdAt: o.createdAt.toDate ? o.createdAt.toDate() : o.createdAt
                    });
                }
            }
        });
        
        console.log(`MELI_FULL Orders in Jan ${year}: ${meliFullCount}`);
        if (samples.length > 0) {
            console.log(`Sample MELI_FULL order from Jan ${year}:`, JSON.stringify(samples[0], null, 2));
        }
        console.log('-----------------------------------');
    }
}

checkJan().catch(console.error);
