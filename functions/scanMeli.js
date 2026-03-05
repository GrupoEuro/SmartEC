const admin = require('firebase-admin');
const fetch = require('node-fetch');
var serviceAccount = require("./serviceAccountKey.json");

// Use provided service account
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function scanForFullOrders() {
    try {
        const configDoc = await db.collection('config').doc('integrations').get();
        const meliConfig = configDoc.data()?.meli;

        if (!meliConfig || !meliConfig.accessToken || !meliConfig.userId) {
            console.error('MercadoLibre is not connected.');
            return;
        }

        let offset = 0;
        const limit = 50;
        let foundFull = false;
        let totalChecked = 0;
        const foundTypes = new Set();

        console.log('Starting deep scan for MercadoLibre Full orders...');

        while (!foundFull && totalChecked < 500) {
            const url = `https://api.mercadolibre.com/orders/search?seller=${meliConfig.userId}&sort=date_desc&limit=${limit}&offset=${offset}`;
            const res = await fetch(url, { headers: { 'Authorization': `Bearer ${meliConfig.accessToken}` } });
            const json = await res.json();

            if (!res.ok) {
                console.error('API Error:', json);
                break;
            }

            const meliOrders = json.results || [];
            if (meliOrders.length === 0) break;

            const shippingIds = meliOrders.map(mo => mo.shipping?.id).filter(Boolean);
            if (shippingIds.length > 0) {
                const shipUrl = `https://api.mercadolibre.com/shipments?ids=${shippingIds.join(',')}`;
                const shipRes = await fetch(shipUrl, { headers: { 'Authorization': `Bearer ${meliConfig.accessToken}` } });

                if (shipRes.ok) {
                    const shipJson = await shipRes.json();
                    for (const resObj of shipJson) {
                        if (resObj.code === 200 && resObj.body) {
                            const lType = resObj.body.logistic_type;
                            foundTypes.add(lType);
                            // Log any logistic type that isn't the standard classic ones
                            if (lType && lType !== 'xd_drop_off' && lType !== 'custom' && lType !== 'drop_off') {
                                console.log(`\n\n🎉 POTENTIAL FULL ORDER FOUND!`);
                                console.log(`Order ID: ${meliOrders.find(o => o.shipping?.id === resObj.body.id)?.id}`);
                                console.log(`Logistic Type: '${lType}'`);
                                console.log(`Fulfillment/Tags:`, meliOrders.find(o => o.shipping?.id === resObj.body.id)?.tags);
                                foundFull = true;
                                break; // Found one!
                            }
                        }
                    }
                }
            }

            totalChecked += meliOrders.length;
            offset += limit;
            console.log(`Scanned ${totalChecked} orders so far... Known types: [${Array.from(foundTypes).join(', ')}]`);
        }

        if (!foundFull) {
            console.log(`\nScan complete. Scanned ${totalChecked} orders but did not find any unique 'Full' logistic types.`);
            console.log(`The only logistic types seen in the last 500 orders were: [${Array.from(foundTypes).join(', ')}]`);
        }

    } catch (e) {
        console.error('Fatal Error:', e);
    }
}

scanForFullOrders();
