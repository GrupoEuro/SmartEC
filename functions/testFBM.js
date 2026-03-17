const admin = require('firebase-admin');
const fetch = require('node-fetch');

// Use ADC or fallback
admin.initializeApp({
    credential: admin.credential.applicationDefault()
});

const db = admin.firestore();

async function testMeliStock() {
    try {
        const configDoc = await db.collection('config').doc('integrations').get();
        const meliConfig = configDoc.data()?.meli;

        if (!meliConfig || !meliConfig.accessToken || !meliConfig.userId) {
            console.error('MercadoLibre is not connected.');
            return;
        }

        console.log('Fetching FBM items...');
        const url = `https://api.mercadolibre.com/users/${meliConfig.userId}/items/search?logistic_type=fulfillment&limit=5`;
        const res = await fetch(url, { headers: { 'Authorization': `Bearer ${meliConfig.accessToken}` } });
        const json = await res.json();

        console.log(`Found ${json.results?.length || 0} items.`);

        if (json.results && json.results.length > 0) {
            const itemUrl = `https://api.mercadolibre.com/items?ids=${json.results.join(',')}`;
            const itemRes = await fetch(itemUrl, { headers: { 'Authorization': `Bearer ${meliConfig.accessToken}` } });
            const itemJson = await itemRes.json();

            for (const itemObj of itemJson) {
                if (itemObj.code === 200) {
                    const item = itemObj.body;
                    console.log(`\nItem: ${item.id} - ${item.title}`);
                    console.log(`Inventory ID: ${item.inventory_id}`);
                    console.log(`Available Quantity: ${item.available_quantity}`);

                    if (item.inventory_id) {
                        // Let's try to fetch fulfillment stock
                        const invUrl = `https://api.mercadolibre.com/inventories/${item.inventory_id}`;
                        const invRes = await fetch(invUrl, { headers: { 'Authorization': `Bearer ${meliConfig.accessToken}`, 'x-version': '2' } });
                        if (invRes.ok) {
                            const invJson = await invRes.json();
                            console.log("Inventory Details:", JSON.stringify(invJson, null, 2));
                        } else {
                            console.log("Inventory API failed:", invRes.status, await invRes.text());

                            // Try user-products API
                            const upUrl = `https://api.mercadolibre.com/user-products/${item.inventory_id}/stock`;
                            const upRes = await fetch(upUrl, { headers: { 'Authorization': `Bearer ${meliConfig.accessToken}` } });
                            if (upRes.ok) {
                                console.log("User-Products Stock Details:", JSON.stringify(await upRes.json(), null, 2));
                            } else {
                                console.log("User-Products API failed:", upRes.status, await upRes.text());
                            }
                        }
                    }
                }
            }
        }
    } catch (e) {
        console.error('Error:', e);
    }
}

testMeliStock();
