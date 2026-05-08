const admin = require('firebase-admin');
const { BigQuery } = require('@google-cloud/bigquery');

const serviceAccount = require('./tiendapraxis-firebase-adminsdk.json'); // Replace with actual path if it exists

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();
const bigquery = new BigQuery({
  projectId: 'tiendapraxis',
  keyFilename: './tiendapraxis-firebase-adminsdk.json'
});

const BQ_DATASET = 'euro_analytics';
const BQ_LOCATION = 'US';

async function syncToBQ() {
    console.log("Starting BQ Sync for the last 5 days...");
    const today = new Date();
    
    // Canonical non-revenue statuses
    const NON_REVENUE = ['pending_payment', 'payment_failed', 'cancelled', 'refunded', 'returned'];

    const resolveChannel = (order) => {
        const sc  = order.sourceChannel;
        const ft  = order.fulfillmentType;
        if (!sc || sc === 'storefront') return 'WEB';
        if (sc === 'pos')               return 'POS';
        if (sc === 'on_behalf')         return 'ON_BEHALF';
        if (sc === 'amazon')            return ft === 'platform' ? 'AMAZON_FBA' : 'AMAZON_MFN';
        if (sc === 'mercadolibre')      return ft === 'platform' ? 'MELI_FULL' : 'MELI_CLASSIC';
        return 'WEB';
    };

    for (let i = 0; i < 5; i++) {
        const now = new Date(today);
        now.setDate(now.getDate() - i);
        
        const year  = now.getFullYear();
        const month = now.getMonth();
        const day   = now.getDate();
        
        const monthStr   = `${year}-${String(month + 1).padStart(2, '0')}`;
        const dayStr     = String(day).padStart(2, '0');
        const dateStr    = `${monthStr}-${dayStr}`;
        
        const startOfDay = new Date(`${dateStr}T00:00:00-06:00`);
        const endOfDay   = new Date(`${dateStr}T23:59:59.999-06:00`);

        console.log(`Syncing date: ${dateStr}`);
        
        const ordersSnap = await db.collection('orders')
            .where('createdAt', '>=', admin.firestore.Timestamp.fromDate(startOfDay))
            .where('createdAt', '<=', admin.firestore.Timestamp.fromDate(endOfDay))
            .get();
            
        console.log(`Found ${ordersSnap.docs.length} total orders for ${dateStr}.`);

        const bqPayload = ordersSnap.docs
            .filter(docSnap => !NON_REVENUE.includes(docSnap.data()['status']))
            .map(docSnap => ({
                orderId: docSnap.id,
                order:   docSnap.data(),
                channel: resolveChannel(docSnap.data()),
            }));

        console.log(`Appending ${bqPayload.length} valid orders to BQ for ${dateStr}.`);

        // Perform BQ deletion to ensure idempotency
        try {
            await bigquery.query({
                query: `DELETE FROM \`tiendapraxis.${BQ_DATASET}.orders\` WHERE order_date = @fromDate`,
                params: { fromDate: dateStr }, location: BQ_LOCATION,
            });
            await bigquery.query({
                query: `DELETE FROM \`tiendapraxis.${BQ_DATASET}.order_items\` WHERE order_date = @fromDate`,
                params: { fromDate: dateStr }, location: BQ_LOCATION,
            });
        } catch(e) {
            console.log("Error during deletion (maybe first time?): ", e.message);
        }

        if (bqPayload.length === 0) continue;

        const orderRows = [];
        const itemRows = [];

        for (const { orderId, order, channel } of bqPayload) {
            const createdAt = order.createdAt?.toDate();
            const items = order.items ?? [];

            orderRows.push({
                order_id:         orderId,
                order_date:       dateStr,
                created_at:       createdAt?.toISOString() ?? null,
                source_channel:   channel,
                status:           order.status ?? null,
                total:            Number(order.total ?? 0),
                state:            order.shippingAddress?.state  ?? null,
                city:             order.shippingAddress?.city   ?? null,
                customer_id:      order.customer?.id            ?? null,
                customer_name:    order.customer?.name          ?? null,
                item_count:       items.length,
                fulfillment_type: order.fulfillmentType         ?? null,
                payment_method:   order.paymentMethod           ?? null,
                external_order_id: order.externalOrderId        ?? null,
            });

            for (const item of items) {
                const unitPrice = Number(item.price ?? item.unitPrice ?? 0);
                const qty       = Number(item.quantity ?? 1);
                itemRows.push({
                    order_id:     orderId,
                    order_date:   dateStr,
                    source_channel: channel,
                    status:       order.status ?? null,
                    sku:          item.sku          ?? null,
                    product_name: item.productName  ?? item.name ?? null,
                    quantity:     qty,
                    unit_price:   unitPrice,
                    subtotal:     Number(item.subtotal ?? (unitPrice * qty)),
                    brand:        item.brand         ?? null,
                    product_id:   item.productId     ?? null,
                    asin:         item.asin          ?? null,
                    ml_item_id:   item.mlItemId      ?? null,
                });
            }
        }

        const BATCH = 500;
        const ordTable = bigquery.dataset(BQ_DATASET).table('orders');
        const itmTable = bigquery.dataset(BQ_DATASET).table('order_items');

        for (let j = 0; j < orderRows.length; j += BATCH) {
            await ordTable.insert(orderRows.slice(j, j + BATCH), { skipInvalidRows: true });
        }
        for (let j = 0; j < itemRows.length; j += BATCH) {
            await itmTable.insert(itemRows.slice(j, j + BATCH), { skipInvalidRows: true });
        }

        console.log(`[BQ Append] ${dateStr}: orders=${orderRows.length}, items=${itemRows.length} successfully inserted.`);
    }
}

syncToBQ().then(() => console.log('Done')).catch(console.error);
