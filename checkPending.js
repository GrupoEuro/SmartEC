const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

initializeApp();
const db = getFirestore();

async function inspectPending() {
    const ordersSnap = await db.collection('orders')
        .where('sourceChannel', '==', 'mercadolibre')
        .where('status', 'in', ['pending', 'processing'])
        .where('fulfillmentType', '==', 'merchant')
        .get();
        
    console.log(`Found ${ordersSnap.size} pending/processing classic Meli orders.`);
    
    ordersSnap.forEach(doc => {
        const o = doc.data();
        const createdDate = o.createdAt.toDate ? o.createdAt.toDate().toISOString() : new Date(o.createdAt).toISOString();
        console.log(`ID: ${o.id} | Status: ${o.status} | Total: ${o.total} | Created: ${createdDate}`);
    });
}

inspectPending().catch(console.error);
