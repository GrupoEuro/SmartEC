const https = require('https');

const MELI_ACCESS_TOKEN = 'APP_USR-849509261003985-052016-655d13b5d39825225b340ed1e433a815-1178500066';
const ORDER_ID = '2000016528011810';

function fetchMeli(url) {
    return new Promise((resolve, reject) => {
        const options = {
            headers: {
                'Authorization': `Bearer ${MELI_ACCESS_TOKEN}`
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
        console.log(`\n=== FETCHING ORDER ${ORDER_ID} ===`);
        const order = await fetchMeli(`https://api.mercadolibre.com/orders/${ORDER_ID}`);
        console.log(JSON.stringify(order, null, 2));

        if (order.shipping && order.shipping.id) {
            const shipmentId = order.shipping.id;
            console.log(`\n=== FETCHING SHIPMENT ${shipmentId} ===`);
            const shipment = await fetchMeli(`https://api.mercadolibre.com/shipments/${shipmentId}`);
            console.log(JSON.stringify(shipment, null, 2));

            console.log(`\n=== FETCHING SHIPMENT COSTS FOR ${shipmentId} ===`);
            try {
                const costs = await fetchMeli(`https://api.mercadolibre.com/shipments/${shipmentId}/costs`);
                console.log(JSON.stringify(costs, null, 2));
            } catch (e) {
                console.error("Error fetching shipment costs:", e.message);
            }
        } else {
            console.log("No shipment associated with this order.");
        }

    } catch (e) {
        console.error("Error:", e.message);
    }
}

run();
