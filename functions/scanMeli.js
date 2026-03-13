const admin = require('firebase-admin');
const fetch = require('node-fetch');

// Use default credential from environment variable
admin.initializeApp({
    credential: admin.credential.applicationDefault()
});

const db = admin.firestore();

async function mathAudit() {
    try {
        const configDoc = await db.collection('config').doc('integrations').get();
        const meliConfig = configDoc.data()?.meli;

        if (!meliConfig || !meliConfig.accessToken || !meliConfig.userId) {
            console.error('MercadoLibre is not connected.');
            return;
        }

        let offset = 0;
        const limit = 50;
        let totalChecked = 0;
        let hasMore = true;

        let activeOrdersCount = 0;
        let cancelledCount = 0;
        let totalAmount = 0;
        let unitsSold = 0;

        console.log('Starting exact API mathematical trace for March 2025 orders...');

        while (hasMore) {
            const url = `https://api.mercadolibre.com/orders/search?seller=${meliConfig.userId}&order.date_created.from=2025-03-01T04:00:00.000-00:00&sort=date_desc&limit=${limit}&offset=${offset}`;
            const res = await fetch(url, { headers: { 'Authorization': `Bearer ${meliConfig.accessToken}` } });
            
            if (!res.ok) {
                console.error('API Error:', await res.json());
                break;
            }

            const json = await res.json();
            const meliOrders = json.results || [];
            
            if (meliOrders.length === 0) break;

            for (const mo of meliOrders) {
                if (mo.status === 'cancelled' || mo.status === 'invalid') {
                    cancelledCount++;
                } else {
                    activeOrdersCount++;
                    totalAmount += (mo.total_amount || 0);

                    // Replicating exactly how our webhook calculates items
                    (mo.order_items || []).forEach(item => {
                        unitsSold += (item.quantity || 0);
                    });
                }
            }

            totalChecked += meliOrders.length;
            offset += limit;
            console.log(`Paginating... Scanned ${totalChecked} MTD records from API.`);

            if (json.paging && json.paging.total <= totalChecked) {
                hasMore = false;
            }
        }

        console.log(`\n\n--- MERCADOLIBRE RAW API AUDIT MTD ---`);
        console.log(`Active Orders: ${activeOrdersCount}`);
        console.log(`Cancelled Orders: ${cancelledCount}`);
        console.log(`Total Amount (Math sum of mo.total_amount): $${totalAmount}`);
        console.log(`Units Sold (Math sum of item.quantity): ${unitsSold}`);

    } catch (e) {
        console.error('Fatal Error:', e);
    }
}

mathAudit();
