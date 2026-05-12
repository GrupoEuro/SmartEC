const admin = require('firebase-admin');
const fs = require('fs');
if (!admin.apps.length) {
    const serviceAccountPath = './serviceAccountKey.json';
    if (fs.existsSync(serviceAccountPath)) {
        admin.initializeApp({
            credential: admin.credential.cert(require(serviceAccountPath))
        });
    } else {
        console.log("No service account found");
        process.exit(1);
    }
}

async function seed() {
    const db = admin.firestore();
    
    // 1. Give the components a fake cost so it's not 0
    await db.collection('products').doc('110/70-17-EY-030-TL').set({
        costPrice: 250,
        active: true,
        sku: '110/70-17-EY-030-TL'
    }, { merge: true });

    await db.collection('products').doc('120/80-17-EY-198-TL').set({
        costPrice: 300,
        active: true,
        sku: '120/80-17-EY-198-TL'
    }, { merge: true });

    // 2. Create the Bundle
    console.log("Creating bundle: COMBO-MOTO-TEST");
    await db.collection('bundles').doc('COMBO-MOTO-TEST').set({
        bundle_sku: 'COMBO-MOTO-TEST',
        title: 'Kit 2 Llantas Praxis (110/70 + 120/80)',
        components: [
            { sku: '110/70-17-EY-030-TL', qty: 1 },
            { sku: '120/80-17-EY-198-TL', qty: 1 }
        ],
        shipping_profile: 150 // Custom shipping override for the bulky box
    });

    // 3. Create a mock MeLi listing so it appears in the UI
    console.log("Creating MeLi listing for combo");
    await db.collection('meli_listings').doc('MLM-TEST-COMBO').set({
        seller_custom_field: 'COMBO-MOTO-TEST',
        title: 'Kit 2 Llantas Praxis (110/70 + 120/80)',
        price: 1499,
        net_amount: 1200,
        selling_fee_amount: 200,
        logistic_type: 'fulfillment',
        is_full: true
    });

    console.log("Done seeding test bundle. Refresh the browser!");
    process.exit(0);
}

seed();
