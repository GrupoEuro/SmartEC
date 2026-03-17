const admin = require('firebase-admin');
const fetch = require('node-fetch');

admin.initializeApp({
    credential: admin.credential.applicationDefault()
});
const db = admin.firestore();

async function checkSales() {
    const configDoc = await db.collection('config').doc('integrations').get();
    const meliConfig = configDoc.data()?.meli;

    if (!meliConfig) return console.error('No config');

    // Get the inventory item ZTHJ21547 if it exists, or just the first item
    const invRef = await db.collection('meli_fbm_inventory').limit(5).get();
    
    for (const doc of invRef.docs) {
        const data = doc.data();
        console.log(`\n--- Item: ${data.sku} / ML ID: ${data.mlItemId} / Inv ID: ${data.inventoryId} ---`);
        
        // Let's try to query the item
        const res = await fetch(`https://api.mercadolibre.com/items/${data.mlItemId}`, {
            headers: { 'Authorization': `Bearer ${meliConfig.accessToken}` }
        });
        const item = await res.json();
        console.log(`sold_quantity: ${item.sold_quantity}`);
        console.log(`health: ${item.health}`);
        
        // Let's check the metric API if it exists or metrics on the item.
        // There is the /items/{id}/metrics endpoint maybe? No.
        // Check /visits/items?ids=xxx ?
        
        // Let's print out all keys of the item to see if there's any new field for 30-day sales
        console.log("Keys:", Object.keys(item).join(', '));
    }
}
checkSales();
