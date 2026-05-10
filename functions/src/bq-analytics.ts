/**
 * bq-analytics.ts
 * BigQuery analytics: schema management, queryMetrics, appendOrdersToBQForDate,
 * backfillOrdersToBigQuery.
 */
import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { db, bigquery } from './shared';

export const BQ_DATASET = 'euro_analytics';
export const BQ_PROJECT = 'importadora-euro';  // ← used by BQ analytics functions below
export const BQ_LOCATION = 'us-central1';

const BQ_ORDERS_SCHEMA = [
    { name: 'order_id', type: 'STRING', mode: 'REQUIRED' },
    { name: 'order_date', type: 'DATE', mode: 'REQUIRED' },
    { name: 'created_at', type: 'TIMESTAMP', mode: 'NULLABLE' },
    { name: 'source_channel', type: 'STRING', mode: 'NULLABLE' },
    { name: 'status', type: 'STRING', mode: 'NULLABLE' },
    { name: 'total', type: 'FLOAT64', mode: 'NULLABLE' },
    { name: 'state', type: 'STRING', mode: 'NULLABLE' },
    { name: 'city', type: 'STRING', mode: 'NULLABLE' },
    { name: 'customer_id', type: 'STRING', mode: 'NULLABLE' },
    { name: 'customer_name', type: 'STRING', mode: 'NULLABLE' },
    { name: 'item_count', type: 'INT64', mode: 'NULLABLE' },
    { name: 'fulfillment_type', type: 'STRING', mode: 'NULLABLE' },
    { name: 'payment_method', type: 'STRING', mode: 'NULLABLE' },
    { name: 'external_order_id', type: 'STRING', mode: 'NULLABLE' },
];

const BQ_ITEMS_SCHEMA = [
    { name: 'order_id', type: 'STRING', mode: 'REQUIRED' },
    { name: 'order_date', type: 'DATE', mode: 'REQUIRED' },
    { name: 'source_channel', type: 'STRING', mode: 'NULLABLE' },
    { name: 'status', type: 'STRING', mode: 'NULLABLE' },
    { name: 'sku', type: 'STRING', mode: 'NULLABLE' },
    { name: 'product_name', type: 'STRING', mode: 'NULLABLE' },
    { name: 'quantity', type: 'INT64', mode: 'NULLABLE' },
    { name: 'unit_price', type: 'FLOAT64', mode: 'NULLABLE' },
    { name: 'subtotal', type: 'FLOAT64', mode: 'NULLABLE' },
    { name: 'brand', type: 'STRING', mode: 'NULLABLE' },
    { name: 'product_id', type: 'STRING', mode: 'NULLABLE' },
    { name: 'asin', type: 'STRING', mode: 'NULLABLE' },
    { name: 'ml_item_id', type: 'STRING', mode: 'NULLABLE' },
];

/** Resolves sourceChannel+fulfillmentType into the canonical BQ channel key. */
function resolveChannelBQ(order: any): string {
    const sc = order.sourceChannel;
    const ft = order.fulfillmentType;
    if (!sc || sc === 'storefront') return 'WEB';
    if (sc === 'pos') return 'POS';
    if (sc === 'on_behalf') return 'ON_BEHALF';
    if (sc === 'amazon') return ft === 'platform' ? 'AMAZON_FBA' : 'AMAZON_MFN';
    if (sc === 'mercadolibre') return ft === 'platform' ? 'MELI_FULL' : 'MELI_CLASSIC';
    return 'WEB';
}

/** Ensures the euro_analytics dataset and both tables exist (idempotent). */
export async function ensureBQSchema(): Promise<void> {
    const dataset = bigquery.dataset(BQ_DATASET, { location: BQ_LOCATION });
    const [dsExists] = await dataset.exists();
    if (!dsExists) {
        await dataset.create({ location: BQ_LOCATION });
        console.log(`[BQ] Created dataset ${BQ_DATASET}`);
    }

    const ordersTable = dataset.table('orders');
    const [ordExists] = await ordersTable.exists();
    if (!ordExists) {
        await ordersTable.create({
            schema: BQ_ORDERS_SCHEMA,
            timePartitioning: { type: 'DAY', field: 'order_date' },
            clustering: { fields: ['source_channel', 'status'] },
        });
        console.log('[BQ] Created table orders');
    }

    const itemsTable = dataset.table('order_items');
    const [itmExists] = await itemsTable.exists();
    if (!itmExists) {
        await itemsTable.create({
            schema: BQ_ITEMS_SCHEMA,
            timePartitioning: { type: 'DAY', field: 'order_date' },
            clustering: { fields: ['source_channel', 'sku'] },
        });
        console.log('[BQ] Created table order_items');
    }
}

export const backfillOrdersToBigQuery = functions
    .runWith({ timeoutSeconds: 540, memory: '2GB' })
    .https.onCall(async (data: { fromDate?: string; deleteFirst?: boolean }, context) => {
        if (!context.auth) {
            throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
        }

        const NON_REVENUE = ['pending_payment', 'payment_failed'];

        const toMxDate = (d: Date): string =>
            d.toLocaleDateString('sv-SE', { timeZone: 'America/Mexico_City' });

        const fromDate = data?.fromDate
            ? new Date(data.fromDate + 'T06:00:00')
            : new Date('2023-01-01T06:00:00');   // default: start of 2023

        const toDate = new Date();

        // Ensure BQ dataset + tables exist
        await ensureBQSchema();

        // Optionally clear existing data for a clean backfill
        if (data?.deleteFirst) {
            const dataset = bigquery.dataset(BQ_DATASET);
            const fromStr = fromDate.toLocaleDateString('sv-SE');
            const PROJECT = JSON.parse(process.env.FIREBASE_CONFIG || '{}').projectId || process.env.GCLOUD_PROJECT || 'importadora-euro';
            await bigquery.query({
                query: `DELETE FROM \`${PROJECT}.${BQ_DATASET}.orders\` WHERE order_date >= CAST(@fromDate AS DATE)`,
                params: { fromDate: fromStr }, location: BQ_LOCATION,
            });
            await bigquery.query({
                query: `DELETE FROM \`${PROJECT}.${BQ_DATASET}.order_items\` WHERE order_date >= CAST(@fromDate AS DATE)`,
                params: { fromDate: fromStr }, location: BQ_LOCATION,
            });
            console.log(`[BQ Backfill] Cleared existing data from ${fromStr}`);
        }

        // Load all orders in range
        const snap = await db.collection('orders')
            .where('createdAt', '>=', admin.firestore.Timestamp.fromDate(fromDate))
            .where('createdAt', '<=', admin.firestore.Timestamp.fromDate(toDate))
            .get();

        console.log(`[BQ Backfill] Loaded ${snap.size} orders from Firestore`);

        const orderRows: any[] = [];
        const itemRows: any[] = [];

        for (const docSnap of snap.docs) {
            const o = docSnap.data();
            const orderId = docSnap.id;

            // Skip truly ghost orders — but keep cancelled/refunded so analytics
            // can answer "what % of orders were cancelled?"
            if (NON_REVENUE.includes(o['status'])) continue;

            const createdAt = (o['createdAt'] as admin.firestore.Timestamp)?.toDate();
            const orderDate = toMxDate(createdAt ?? new Date());
            const channel = resolveChannelBQ(o);
            const items: any[] = o['items'] ?? [];

            orderRows.push({
                order_id: orderId,
                order_date: orderDate,
                created_at: createdAt?.toISOString() ?? null,
                source_channel: channel,
                status: o['status'] ?? null,
                total: Number(o['total'] ?? 0),
                state: o['shippingAddress']?.state ?? null,
                city: o['shippingAddress']?.city ?? null,
                customer_id: o['customer']?.id ?? null,
                customer_name: o['customer']?.name ?? null,
                item_count: items.length,
                fulfillment_type: o['fulfillmentType'] ?? null,
                payment_method: o['paymentMethod'] ?? null,
                external_order_id: o['externalOrderId'] ?? null,
            });

            for (const item of items) {
                const unitPrice = Number(item.price ?? item.unitPrice ?? 0);
                const qty = Number(item.quantity ?? 1);
                itemRows.push({
                    order_id: orderId,
                    order_date: orderDate,
                    source_channel: channel,
                    status: o['status'] ?? null,
                    sku: item.sku ?? null,
                    product_name: item.productName ?? item.name ?? null,
                    quantity: qty,
                    unit_price: unitPrice,
                    subtotal: Number(item.subtotal ?? (unitPrice * qty)),
                    brand: item.brand ?? null,
                    product_id: item.productId ?? null,
                    asin: item.asin ?? null,
                    ml_item_id: item.mlItemId ?? null,
                });
            }
        }

        // Insert in batches of 500 (BQ streaming insert limit)
        const BATCH = 500;
        const ordersTable = bigquery.dataset(BQ_DATASET).table('orders');
        const itemsTable = bigquery.dataset(BQ_DATASET).table('order_items');

        for (let i = 0; i < orderRows.length; i += BATCH) {
            await ordersTable.insert(orderRows.slice(i, i + BATCH), { skipInvalidRows: true });
        }
        for (let i = 0; i < itemRows.length; i += BATCH) {
            await itemsTable.insert(itemRows.slice(i, i + BATCH), { skipInvalidRows: true });
        }

        console.log(`[BQ Backfill] Done. orders=${orderRows.length}, items=${itemRows.length}`);
        return { ordersWritten: orderRows.length, itemsWritten: itemRows.length, dataset: BQ_DATASET };
    });


// ─── queryMetrics — callable ──────────────────────────────────────────────────
//
// General-purpose BigQuery analytics callable.
// Accepts { queryType, params } and returns typed result rows.
//
// Query types:
//   'productRevenue'  → top SKUs ranked by revenue
//   'geoBreakdown'    → revenue + orders grouped by state
//   'channelSku'      → SKU velocity per channel
//   'customerCohorts' → monthly cohort revenue (placeholder)
//
// All queries use date partitioning — only scans relevant slices.
// ─────────────────────────────────────────────────────────────────────────────

export const queryMetrics = functions
    .runWith({ timeoutSeconds: 60, memory: '512MB' })
    .https.onCall(async (data: {
        queryType: 'productRevenue' | 'geoBreakdown' | 'channelSku' | 'customerCohorts' | 'summaryKpis' | 'dailyTrend' | 'cancellationRate';
        fromDate: string;   // YYYY-MM-DD
        toDate: string;   // YYYY-MM-DD
        channel?: string;   // optional channel filter (e.g. 'MELI_FULL')
        limit?: number;
    }, context) => {
        if (!context.auth) {
            throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
        }

        const { queryType, fromDate, toDate, channel, limit = 50 } = data;
        const PROJECT = JSON.parse(process.env.FIREBASE_CONFIG || '{}').projectId || process.env.GCLOUD_PROJECT || 'importadora-euro';
        const DS = BQ_DATASET;

        // Revenue-positive statuses only — 'paid' = web/MP orders confirmed by webhook
        const REVENUE_STATUSES = `('pending','processing','shipped','delivered','completed','in_transit','picked_up','paid','refund_pending')`;

        let sql = '';
        let params: Record<string, any> = { fromDate, toDate, limit };

        switch (queryType) {

            // ── Top products by revenue in the period ─────────────────────────────
            case 'productRevenue':
                sql = `
                    SELECT
                        i.sku,
                        MAX(i.product_id) AS product_id,
                        i.product_name,
                        i.brand,
                        SUM(i.quantity)  AS total_units,
                        SUM(i.subtotal)  AS total_revenue,
                        COUNT(DISTINCT i.order_id) AS total_orders,
                        SUM(i.subtotal) / NULLIF(SUM(i.quantity), 0) AS avg_unit_price
                    FROM \`${PROJECT}.${DS}.order_items\` i
                    JOIN \`${PROJECT}.${DS}.orders\` o ON i.order_id = o.order_id
                    WHERE i.order_date BETWEEN @fromDate AND @toDate
                      AND o.status IN ${REVENUE_STATUSES}
                      ${channel ? 'AND i.source_channel = @channel' : ''}
                    GROUP BY i.sku, i.product_name, i.brand
                    HAVING i.sku IS NOT NULL
                    ORDER BY total_revenue DESC
                    LIMIT @limit
                `;
                if (channel) params.channel = channel;
                break;

            // ── Revenue + orders grouped by shipping state ────────────────────────
            case 'geoBreakdown':
                sql = `
                    SELECT
                        COALESCE(o.state, '(Sin estado)') AS state,
                        COUNT(*)                                                       AS total_orders,
                        SUM(o.total)                                                   AS total_revenue,
                        AVG(o.total)                                                   AS avg_ticket,
                        SUM(o.item_count)                                              AS total_units,
                        COUNT(DISTINCT IF(o.customer_id IS NOT NULL, o.customer_id, NULL)) AS unique_customers
                    FROM \`${PROJECT}.${DS}.orders\` o
                    WHERE o.order_date BETWEEN @fromDate AND @toDate
                      AND o.status IN ${REVENUE_STATUSES}
                      ${channel ? 'AND o.source_channel = @channel' : ''}
                    GROUP BY state
                    ORDER BY total_revenue DESC
                    LIMIT @limit
                `;
                if (channel) params.channel = channel;
                break;


            // ── SKU revenue broken down by channel ────────────────────────────────
            case 'channelSku':
                sql = `
                    SELECT
                        i.source_channel,
                        i.sku,
                        i.product_name,
                        SUM(i.quantity)  AS total_units,
                        SUM(i.subtotal)  AS total_revenue
                    FROM \`${PROJECT}.${DS}.order_items\` i
                    JOIN \`${PROJECT}.${DS}.orders\` o ON i.order_id = o.order_id
                    WHERE i.order_date BETWEEN @fromDate AND @toDate
                      AND o.status IN ${REVENUE_STATUSES}
                      ${channel ? 'AND i.source_channel = @channel' : ''}
                    GROUP BY i.source_channel, i.sku, i.product_name
                    HAVING i.sku IS NOT NULL
                    ORDER BY i.source_channel, total_revenue DESC
                    LIMIT @limit
                `;
                if (channel) params.channel = channel;
                break;

            // ── Monthly revenue by first-purchase cohort month ────────────────────
            case 'customerCohorts':
                sql = `
                    WITH first_orders AS (
                        SELECT
                            customer_id,
                            MIN(order_date) AS first_order_date,
                            FORMAT_DATE('%Y-%m', MIN(order_date)) AS cohort_month
                        FROM \`${PROJECT}.${DS}.orders\`
                        WHERE customer_id IS NOT NULL
                          AND order_date BETWEEN @fromDate AND @toDate
                          AND status IN ${REVENUE_STATUSES}
                        GROUP BY customer_id
                    )
                    SELECT
                        fo.cohort_month,
                        FORMAT_DATE('%Y-%m', o.order_date) AS activity_month,
                        COUNT(DISTINCT o.customer_id)  AS customers,
                        SUM(o.total)                   AS revenue,
                        COUNT(DISTINCT o.order_id)     AS orders
                    FROM \`${PROJECT}.${DS}.orders\` o
                    JOIN first_orders fo ON o.customer_id = fo.customer_id
                    WHERE o.order_date BETWEEN @fromDate AND @toDate
                      AND o.status IN ${REVENUE_STATUSES}
                    GROUP BY fo.cohort_month, activity_month
                    ORDER BY fo.cohort_month, activity_month
                    LIMIT @limit
                `;
                break;

            // ── KPI summary by channel — replaces MetricsHub Firestore reads ────────
            case 'summaryKpis':
                sql = `
                    SELECT
                        source_channel,
                        SUM(total)                    AS revenue,
                        COUNT(DISTINCT order_id)      AS orders,
                        SUM(item_count)               AS units,
                        SAFE_DIVIDE(SUM(total), COUNT(DISTINCT order_id)) AS avg_ticket
                    FROM \`${PROJECT}.${DS}.orders\`
                    WHERE order_date BETWEEN @fromDate AND @toDate
                      AND status IN ${REVENUE_STATUSES}
                    GROUP BY source_channel
                    ORDER BY revenue DESC
                `;
                break;

            // ── Cancellation + return rate by channel ─────────────────────────────
            case 'cancellationRate':
                sql = `
                    SELECT
                        source_channel,
                        COUNT(DISTINCT order_id)                                                          AS total_orders,
                        COUNT(DISTINCT CASE WHEN status IN ${REVENUE_STATUSES} THEN order_id END)         AS completed_orders,
                        COUNT(DISTINCT CASE WHEN status IN ('cancelled','refunded','returned') THEN order_id END) AS cancelled_orders,
                        SAFE_DIVIDE(
                            COUNT(DISTINCT CASE WHEN status IN ('cancelled','refunded','returned') THEN order_id END),
                            NULLIF(COUNT(DISTINCT order_id), 0)
                        ) AS cancellation_rate
                    FROM \`${PROJECT}.${DS}.orders\`
                    WHERE order_date BETWEEN @fromDate AND @toDate
                    GROUP BY source_channel
                    ORDER BY completed_orders DESC
                `;
                break;

            case 'dailyTrend':
                sql = `
                    SELECT
                        order_date,
                        source_channel,
                        SUM(total)               AS revenue,
                        COUNT(DISTINCT order_id) AS orders,
                        SUM(item_count)          AS units
                    FROM \`${PROJECT}.${DS}.orders\`
                    WHERE order_date BETWEEN @fromDate AND @toDate
                      AND status IN ${REVENUE_STATUSES}
                      ${channel ? 'AND source_channel = @channel' : ''}
                    GROUP BY order_date, source_channel
                    ORDER BY order_date
                `;
                if (channel) params['channel'] = channel;
                break;

            default:
                throw new functions.https.HttpsError('invalid-argument', `Unknown queryType: ${queryType}`);
        }

        const [rows] = await bigquery.query({
            query: sql,
            params,
            location: BQ_LOCATION,
        });

        // Serialize BigQuery row values to plain JSON-safe JS primitives.
        // BigQuery INT64/FLOAT64 → { value: '123' }  → parse as number
        // BigQuery DATE/STRING   → { value: '2024-01-15' } → keep as string
        // NaN / Infinity are not JSON-serializable — replace with null.
        const serialize = (v: any): any => {
            if (v == null) return null;
            if (typeof v === 'object' && 'value' in v) {
                // Try numeric; if NaN it's a DATE/STRING — return raw string
                const n = Number(v.value);
                return isFinite(n) ? n : (v.value ?? null);
            }
            if (typeof v === 'number') return isFinite(v) ? v : null;
            return v;
        };

        const result = rows.map((row: any) => {
            const out: Record<string, any> = {};
            for (const [k, v] of Object.entries(row)) out[k] = serialize(v);
            return out;
        });

        return { queryType, fromDate, toDate, rowCount: result.length, rows: result };
    });


// ─── Universal Inbox — Atención al Cliente ───────────────────────────────────
// Centralizes messages from WhatsApp, Instagram, Facebook, Telegram and Email
// into a unified customer_conversations collection for the internal app.
// ─────────────────────────────────────────────────────────────────────────────

