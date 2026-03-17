const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

initializeApp();
const db = getFirestore();

async function patch14() {
    const ordersSnap = await db.collection('orders')
        .where('sourceChannel', '==', 'mercadolibre')
        .where('status', 'in', ['pending', 'processing'])
        .where('fulfillmentType', '==', 'merchant')
        .get();
        
    const batch = db.batch();
    let count = 0;
    
    for(const doc of ordersSnap.docs) {
        batch.update(doc.ref, { status: 'delivered' });
        count++;
    }
    
    if (count > 0) {
        await batch.commit();
        console.log(`Successfully patched ${count} orders to delivered.`);
    } else {
        console.log(`No orders needed patching.`);
    }
}

patch14().catch(console.error);
