const https = require('https');

const MP_ACCESS_TOKEN = 'APP_USR-398646544825942-022715-e23fc852e95aafba3b8f6a244cbd896b-1178500066';
const ORDER_ID = '2000016528011810';

function fetchMp(url) {
    return new Promise((resolve, reject) => {
        const options = {
            headers: {
                'Authorization': `Bearer ${MP_ACCESS_TOKEN}`
            }
        };
        https.get(url, options, (res) => {
            let data = '';
            res.on('data', chunk => { data += chunk; });
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    try {
                        resolve(JSON.parse(data));
                    } catch (e) {
                        resolve(data);
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
        console.log(`\n=== SEARCHING MP PAYMENTS FOR ORDER_ID: ${ORDER_ID} ===`);
        const searchResults = await fetchMp(`https://api.mercadopago.com/v1/payments/search?external_reference=${ORDER_ID}`);
        console.log(JSON.stringify(searchResults, null, 2));

        // Also let's try searching by other parameters if that returns empty
        if (!searchResults.results || searchResults.results.length === 0) {
            console.log("\nNo payments found by external_reference. Trying search by metadata/query...");
            // Let's do a general search of recent payments
            const recentPayments = await fetchMp(`https://api.mercadopago.com/v1/payments/search?sort=date_created&criteria=desc&limit=10`);
            console.log("Recent payments summary:");
            recentPayments.results?.forEach(p => {
                console.log(`ID: ${p.id}, status: ${p.status}, amount: ${p.transaction_amount}, ext_ref: ${p.external_reference}, desc: ${p.description}`);
            });
        }
    } catch (e) {
        console.error("Error:", e.message);
    }
}

run();
