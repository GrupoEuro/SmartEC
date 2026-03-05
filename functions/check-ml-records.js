const admin = require('firebase-admin');
const https = require('https');

admin.initializeApp({
    projectId: "eurollantas-production" // Fallback project ID if not set in GOOGLE_APPLICATION_CREDENTIALS
});
const db = admin.firestore();

function getActiveOrders(url, token) {
    return new Promise((resolve, reject) => {
        const options = {
            headers: { 'Authorization': `Bearer ${token}` }
        };
        https.get(url, options, (res) => {
            let data = '';
            res.on('data', chunk => { data += chunk; });
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    try {
                        resolve(JSON.parse(data));
                    } catch (e) {
                        reject(e);
                    }
                } else {
                    reject(new Error(`API Error ${res.statusCode}: ${data}`));
                }
            });
        }).on('error', reject);
    });
}

async function run() {
    try {
        const doc = await db.collection('config').doc('integrations').get();
        const data = doc.data();
        if (!data || !data.mercadolibreToken) {
            console.log("No MercadoLibre active token found in config/integrations");
            return;
        }

        const { access_token, user_id } = data.mercadolibreToken;
        console.log(`Checking total records for ML Seller ID: ${user_id}`);

        const url = `https://api.mercadolibre.com/orders/search?seller=${user_id}&limit=1`;
        const response = await getActiveOrders(url, access_token);

        const total = response.paging.total;
        console.log('----------------------------------------------------');
        console.log(`TOTAL HISTORICAL RECORDS FROM MERCADOLIBRE: ${total}`);
        console.log(`With a chunk size of 250 orders per batch: ${Math.ceil(total / 250)} batches to process.`);
        console.log('----------------------------------------------------');
        
    } catch (e) {
        console.error('Error fetching ML orders:', e.message);
    }
}

run();
