const admin = require('firebase-admin');

if (!admin.apps.length) {
    admin.initializeApp({
        projectId: 'tiendapraxis'
    });
}

const db = admin.firestore();

async function cleanup() {
    console.log('Scanning customer_conversations for false name links...');
    const snap = await db.collection('customer_conversations').get();
    let count = 0;

    for (const docSnap of snap.docs) {
        const data = docSnap.data();
        const name = (data.customerName || '').toUpperCase();
        
        if (name.includes('BERTIN') || name.includes('VALENCIA') || data.customerId === 'ml_1062485501' || data.customerId === 'ml_72120050') {
            console.log(`Cleaning conv ${docSnap.id}: "${data.customerName}" -> "Cliente ML"`);
            await docSnap.ref.update({
                customerName: 'Cliente ML',
                customerId: admin.firestore.FieldValue.delete()
            });
            count++;
        }
    }

    console.log(`Successfully cleaned ${count} conversations in Firestore.`);
    process.exit(0);
}

cleanup().catch(err => {
    console.error('Error during cleanup:', err);
    process.exit(1);
});
