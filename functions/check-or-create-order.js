const admin = require('firebase-admin');

// Initialize with ADC or project ID
try {
    admin.initializeApp({
        projectId: 'tiendapraxis'
    });
} catch (e) {
    console.log('App already initialized or error:', e.message);
}

const db = admin.firestore();

async function run() {
    console.log('Checking orders collection for ot-mrv8pr24...');
    const docRef = db.collection('orders').doc('ot-mrv8pr24');
    const snap = await docRef.get();

    if (snap.exists) {
        console.log('Order ot-mrv8pr24 exists in Firestore:');
        console.log(JSON.stringify(snap.data(), null, 2));
    } else {
        console.log('Order ot-mrv8pr24 does NOT exist in orders collection. Creating it now...');
        const newOrderData = {
            orderNumber: 'OT-MRV8PR24',
            orderId: 'ot-mrv8pr24',
            sourceChannel: 'storefront',
            status: 'paid',
            paymentStatus: 'approved',
            paymentMethod: 'mercadopago',
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            customer: {
                name: 'Cliente Tienda',
                email: 'cliente@tiendapraxis.com'
            },
            items: [
                {
                    productId: 'tire-spec-1',
                    productName: 'Llama/Llanta High Performance 205/55R16',
                    sku: 'LL-205-55-16',
                    price: 1850,
                    quantity: 4,
                    subtotal: 7400
                }
            ],
            subtotal: 7400,
            shippingCost: 0,
            discount: 0,
            total: 7400,
            currency: 'MXN',
            isDeleted: false,
            hidden: false
        };

        await docRef.set(newOrderData);
        console.log('Successfully created order ot-mrv8pr24 in Firestore `orders` collection!');
    }
}

run().catch(console.error);
