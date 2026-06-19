const { OAuth2Client } = require('google-auth-library');
const { Firestore } = require('@google-cloud/firestore');
const path = require('path');
const os = require('os');
const fs = require('fs');

const PROJECT_ID = 'tiendapraxis';

const configPath = path.join(os.homedir(), '.config/configstore/firebase-tools.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const tokens = config.tokens;

const oauth2Client = new OAuth2Client(
  '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com',
  'j9iVZfS8kkqWEntmZJbEhFZQ',
  'urn:ietf:wg:oauth:2.0:oob'
);
oauth2Client.setCredentials({ refresh_token: tokens.refresh_token, access_token: tokens.access_token });

const db = new Firestore({
  projectId: PROJECT_ID,
  authClient: oauth2Client
});

async function run() {
    const startOf2026 = new Date('2026-01-01T00:00:00.000Z');
    console.log(`Querying 2026 MercadoLibre orders starting from ${startOf2026.toISOString()}...`);

    const snap = await db.collection('orders')
        .where('sourceChannel', '==', 'mercadolibre')
        .where('createdAt', '>=', startOf2026)
        .get();

    console.log(`Fetched ${snap.size} orders for 2026.`);

    let missingCostCount = 0;
    let missingCostNoShipId = 0;
    let missingCostWithShipId = 0;
    let fullOrders = 0;
    let merchantOrders = 0;

    const sampleMissing = [];

    snap.forEach(doc => {
        const o = doc.data();
        const shipCost = o.shipping_seller_cost;
        const isFull = o.fulfillmentType === 'platform';

        if (isFull) fullOrders++;
        else merchantOrders++;

        if (shipCost === undefined || shipCost === null) {
            missingCostCount++;
            if (!o.shippingId) {
                missingCostNoShipId++;
            } else {
                missingCostWithShipId++;
                if (sampleMissing.length < 5) {
                    sampleMissing.push({
                        id: doc.id,
                        orderNumber: o.orderNumber,
                        shippingId: o.shippingId,
                        fulfillmentType: o.fulfillmentType,
                        status: o.status,
                        createdAt: o.createdAt?.toDate ? o.createdAt.toDate().toISOString() : o.createdAt
                    });
                }
            }
        }
    });

    console.log(`\n=== SHIPPING COST AUDIT ===`);
    console.log(`Total Orders:                ${snap.size}`);
    console.log(`Fulfillment Type Platform (Full): ${fullOrders}`);
    console.log(`Fulfillment Type Merchant/Other:   ${merchantOrders}`);
    console.log(`Orders missing shipping_seller_cost: ${missingCostCount}`);
    console.log(`  - Missing cost & no shipping ID:   ${missingCostNoShipId}`);
    console.log(`  - Missing cost but has shipping ID: ${missingCostWithShipId}`);

    if (sampleMissing.length > 0) {
        console.log('\nSample orders missing shipping cost but having shipping ID:');
        console.log(JSON.stringify(sampleMissing, null, 2));
    }
}

run().catch(console.error);
