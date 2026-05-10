"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.queryGrowthMetrics = exports.queryPeriodData = exports.queryCustomerSegmentation = exports.queryCustomerMetrics = exports.queryCohortAnalysis = exports.queryCustomerInsights = void 0;
/**
 * customer-analytics.ts
 * BigQuery-powered customer analytics: insights, cohort analysis, metrics,
 * segmentation, period data, growth metrics. Includes BQ result caching.
 */
const functions = require("firebase-functions");
const shared_1 = require("./shared");
const BQ_PROJECT = 'importadora-euro';
const BQ_DATASET = 'euro_analytics';
const BQ_RESULT_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
async function getBQCache(cacheKey) {
    try {
        const doc = await shared_1.db.collection('bq_cache').doc(cacheKey).get();
        if (!doc.exists)
            return null;
        const data = doc.data();
        if (Date.now() > data.expiresAt)
            return null;
        return data.result;
    }
    catch (_a) {
        return null;
    }
}
async function setBQCache(cacheKey, result) {
    try {
        await shared_1.db.collection('bq_cache').doc(cacheKey).set({
            result,
            expiresAt: Date.now() + BQ_RESULT_CACHE_TTL_MS,
        });
    }
    catch ( /* non-fatal */_a) { /* non-fatal */ }
}
exports.queryCustomerInsights = functions
    .runWith({ timeoutSeconds: 120, memory: '512MB' })
    .https.onCall(async (_data, context) => {
    var _a, _b, _c, _d;
    if (!context.auth)
        throw new functions.https.HttpsError('unauthenticated', 'Login required.');
    const cacheKey = 'customer_insights_all';
    const cached = await getBQCache(cacheKey);
    if (cached)
        return cached;
    const query = `
            WITH customer_orders AS (
                SELECT
                    COALESCE(customer_id, customer_email, 'anonymous') AS uid,
                    COALESCE(customer_name, 'Unknown') AS name,
                    COALESCE(customer_email, '') AS email,
                    COUNT(*) AS order_count,
                    SUM(total) AS total_spent,
                    MIN(TIMESTAMP_TRUNC(created_at, DAY)) AS first_order_date,
                    MAX(TIMESTAMP_TRUNC(created_at, DAY)) AS last_order_date
                FROM \`${BQ_PROJECT}.${BQ_DATASET}.orders\`
                WHERE status NOT IN ('cancelled', 'refunded', 'returned', 'pending_payment', 'payment_failed')
                GROUP BY 1, 2, 3
            ),
            scored AS (
                SELECT *,
                    DATE_DIFF(CURRENT_DATE(), DATE(last_order_date), DAY) AS days_since_last,
                    SAFE_DIVIDE(
                        DATE_DIFF(DATE(last_order_date), DATE(first_order_date), DAY),
                        NULLIF(order_count - 1, 0)
                    ) AS avg_days_between_orders
                FROM customer_orders
            ),
            segmented AS (
                SELECT *,
                    CASE
                        WHEN days_since_last > 365 THEN 'Lost'
                        WHEN days_since_last > 180 THEN 'At Risk'
                        WHEN total_spent > 10000 AND order_count > 5 THEN 'Champion'
                        WHEN order_count >= 3 THEN 'Loyal'
                        ELSE 'New'
                    END AS segment,
                    ROUND(total_spent / order_count, 2) AS avg_order_value
                FROM scored
            )
            SELECT
                segment,
                COUNT(*) AS count,
                ROUND(SUM(total_spent), 2) AS total_revenue,
                ROUND(AVG(total_spent), 2) AS avg_ltv,
                ROUND(AVG(avg_order_value), 2) AS avg_order_value,
                ROUND(AVG(days_since_last), 1) AS avg_days_since_last_order
            FROM segmented
            GROUP BY segment
            ORDER BY total_revenue DESC
        `;
    const [rows] = await shared_1.bigquery.query({ query, location: 'US' });
    const totalCLV = rows.reduce((s, r) => { var _a; return s + ((_a = r.total_revenue) !== null && _a !== void 0 ? _a : 0); }, 0);
    const totalCustomers = rows.reduce((s, r) => { var _a; return s + ((_a = r.count) !== null && _a !== void 0 ? _a : 0); }, 0);
    const atRiskValue = ((_b = (_a = rows.find((r) => r.segment === 'At Risk')) === null || _a === void 0 ? void 0 : _a.total_revenue) !== null && _b !== void 0 ? _b : 0) * 0.3;
    const lostCount = (_d = (_c = rows.find((r) => r.segment === 'Lost')) === null || _c === void 0 ? void 0 : _c.count) !== null && _d !== void 0 ? _d : 0;
    const result = {
        profiles: rows.map((r) => {
            var _a, _b, _c;
            return ({
                uid: r.segment,
                name: r.segment,
                email: '',
                totalSpent: (_a = r.avg_ltv) !== null && _a !== void 0 ? _a : 0,
                orderCount: Math.round((_b = r.count) !== null && _b !== void 0 ? _b : 0),
                lastOrderDate: new Date(),
                firstOrderDate: new Date(),
                averageOrderValue: (_c = r.avg_order_value) !== null && _c !== void 0 ? _c : 0,
                churnRiskScore: r.segment === 'Lost' ? 95 : r.segment === 'At Risk' ? 65 : 20,
                segment: r.segment
            });
        }),
        cohorts: [],
        totalCLV,
        avgCLV: totalCustomers > 0 ? totalCLV / totalCustomers : 0,
        churnRate: totalCustomers > 0 ? (lostCount / totalCustomers) * 100 : 0,
        atRiskValue
    };
    await setBQCache(cacheKey, result);
    return result;
});
// ── 2. Cohort Analysis ────────────────────────────────────────────────────────
exports.queryCohortAnalysis = functions
    .runWith({ timeoutSeconds: 180, memory: '512MB' })
    .https.onCall(async (data, context) => {
    var _a;
    if (!context.auth)
        throw new functions.https.HttpsError('unauthenticated', 'Login required.');
    const months = (_a = data === null || data === void 0 ? void 0 : data.months) !== null && _a !== void 0 ? _a : 12;
    const cacheKey = `cohort_analysis_${months}`;
    const cached = await getBQCache(cacheKey);
    if (cached)
        return cached;
    const query = `
            WITH first_orders AS (
                SELECT
                    COALESCE(customer_id, customer_email) AS uid,
                    FORMAT_DATE('%Y-%m', MIN(DATE(created_at))) AS cohort_month
                FROM \`${BQ_PROJECT}.${BQ_DATASET}.orders\`
                WHERE status NOT IN ('cancelled', 'refunded', 'returned')
                  AND created_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL ${months} MONTH)
                  AND customer_id IS NOT NULL
                GROUP BY 1
            ),
            all_orders AS (
                SELECT
                    COALESCE(customer_id, customer_email) AS uid,
                    FORMAT_DATE('%Y-%m', DATE(created_at)) AS order_month
                FROM \`${BQ_PROJECT}.${BQ_DATASET}.orders\`
                WHERE status NOT IN ('cancelled', 'refunded', 'returned')
                  AND customer_id IS NOT NULL
            ),
            cohort_activity AS (
                SELECT
                    f.cohort_month,
                    DATE_DIFF(
                        DATE(PARSE_DATE('%Y-%m', a.order_month)),
                        DATE(PARSE_DATE('%Y-%m', f.cohort_month)),
                        MONTH
                    ) AS period,
                    COUNT(DISTINCT f.uid) AS active_users
                FROM first_orders f
                JOIN all_orders a ON f.uid = a.uid
                GROUP BY 1, 2
            ),
            cohort_sizes AS (
                SELECT cohort_month, COUNT(*) AS total_customers
                FROM first_orders GROUP BY 1
            )
            SELECT
                ca.cohort_month AS cohort,
                cs.total_customers AS totalCustomers,
                ca.period,
                ROUND(ca.active_users / cs.total_customers * 100, 1) AS retention_pct
            FROM cohort_activity ca
            JOIN cohort_sizes cs ON ca.cohort_month = cs.cohort_month
            WHERE ca.period >= 0 AND ca.period <= 5
            ORDER BY cohort_month, period
        `;
    const [rows] = await shared_1.bigquery.query({ query, location: 'US' });
    // Pivot into CohortData[] format
    const cohortMap = new Map();
    rows.forEach((r) => {
        if (!cohortMap.has(r.cohort)) {
            cohortMap.set(r.cohort, { cohort: r.cohort, totalCustomers: r.totalCustomers, period0: 100 });
        }
        const c = cohortMap.get(r.cohort);
        if (r.period > 0)
            c[`period${r.period}`] = r.retention_pct;
    });
    const result = Array.from(cohortMap.values());
    await setBQCache(cacheKey, result);
    return result;
});
// ── 3. Customer Metrics ───────────────────────────────────────────────────────
exports.queryCustomerMetrics = functions
    .runWith({ timeoutSeconds: 60, memory: '256MB' })
    .https.onCall(async (data, context) => {
    var _a, _b, _c, _d, _e;
    if (!context.auth)
        throw new functions.https.HttpsError('unauthenticated', 'Login required.');
    const { startDate, endDate } = data !== null && data !== void 0 ? data : {};
    const cacheKey = `customer_metrics_${startDate !== null && startDate !== void 0 ? startDate : 'all'}_${endDate !== null && endDate !== void 0 ? endDate : 'now'}`;
    const cached = await getBQCache(cacheKey);
    if (cached)
        return cached;
    const dateFilter = startDate && endDate
        ? `AND created_at BETWEEN TIMESTAMP('${startDate}') AND TIMESTAMP('${endDate}')`
        : '';
    const newCustFilter = startDate && endDate
        ? `WHERE first_order_date BETWEEN '${startDate.slice(0, 10)}' AND '${endDate.slice(0, 10)}'`
        : 'WHERE FALSE';
    const query = `
            WITH customer_agg AS (
                SELECT
                    COALESCE(customer_id, customer_email, 'guest') AS uid,
                    MIN(DATE(created_at)) AS first_order_date,
                    SUM(total) AS total_spent,
                    COUNT(*) AS order_count
                FROM \`${BQ_PROJECT}.${BQ_DATASET}.orders\`
                WHERE status NOT IN ('cancelled', 'refunded', 'returned', 'pending_payment', 'payment_failed')
                ${dateFilter}
                GROUP BY 1
            )
            SELECT
                COUNT(*) AS total_customers,
                SUM(order_count) AS total_orders,
                SUM(total_spent) AS total_revenue,
                COUNTIF(${startDate ? `first_order_date >= '${startDate.slice(0, 10)}'` : 'FALSE'}) AS new_customers
            FROM customer_agg
        `;
    const [rows] = await shared_1.bigquery.query({ query, location: 'US' });
    const row = (_a = rows[0]) !== null && _a !== void 0 ? _a : {};
    const totalCustomers = Number((_b = row.total_customers) !== null && _b !== void 0 ? _b : 0);
    const totalOrders = Number((_c = row.total_orders) !== null && _c !== void 0 ? _c : 0);
    const totalRevenue = Number((_d = row.total_revenue) !== null && _d !== void 0 ? _d : 0);
    const newCustomers = Number((_e = row.new_customers) !== null && _e !== void 0 ? _e : 0);
    const result = {
        totalCustomers,
        newCustomers,
        returningCustomers: totalCustomers - newCustomers,
        averageOrderValue: totalOrders > 0 ? totalRevenue / totalOrders : 0,
        customerLifetimeValue: totalCustomers > 0 ? totalRevenue / totalCustomers : 0
    };
    await setBQCache(cacheKey, result);
    return result;
});
// ── 4. Customer Segmentation (RFM) ───────────────────────────────────────────
exports.queryCustomerSegmentation = functions
    .runWith({ timeoutSeconds: 120, memory: '512MB' })
    .https.onCall(async (_data, context) => {
    if (!context.auth)
        throw new functions.https.HttpsError('unauthenticated', 'Login required.');
    const cacheKey = 'customer_segmentation_all';
    const cached = await getBQCache(cacheKey);
    if (cached)
        return cached;
    const query = `
            WITH customer_stats AS (
                SELECT
                    COALESCE(customer_id, customer_email, 'guest') AS uid,
                    COUNT(*) AS order_count,
                    SUM(total) AS total_spent,
                    DATE_DIFF(CURRENT_DATE(), MAX(DATE(created_at)), DAY) AS days_since_last
                FROM \`${BQ_PROJECT}.${BQ_DATASET}.orders\`
                WHERE status NOT IN ('cancelled', 'refunded', 'returned', 'pending_payment', 'payment_failed')
                GROUP BY 1
            ),
            segmented AS (
                SELECT *,
                    CASE
                        WHEN days_since_last > 365 THEN 'Lost'
                        WHEN days_since_last > 180 THEN 'At Risk'
                        WHEN total_spent > 10000 AND order_count > 5 THEN 'Champions'
                        WHEN order_count >= 3 THEN 'Loyal'
                        ELSE 'Potential'
                    END AS segment
                FROM customer_stats
            )
            SELECT
                segment,
                COUNT(*) AS count,
                ROUND(SUM(total_spent), 2) AS totalRevenue,
                ROUND(AVG(total_spent / NULLIF(order_count, 0)), 2) AS averageOrderValue,
                ROUND(AVG(CASE WHEN days_since_last <= 30 THEN 5
                               WHEN days_since_last <= 90 THEN 4
                               WHEN days_since_last <= 180 THEN 3
                               WHEN days_since_last <= 365 THEN 2
                               ELSE 1 END), 2) AS recencyScore,
                ROUND(AVG(CASE WHEN order_count >= 20 THEN 5
                               WHEN order_count >= 10 THEN 4
                               WHEN order_count >= 5 THEN 3
                               WHEN order_count >= 2 THEN 2
                               ELSE 1 END), 2) AS frequencyScore,
                ROUND(AVG(CASE WHEN total_spent >= 10000 THEN 5
                               WHEN total_spent >= 5000 THEN 4
                               WHEN total_spent >= 1000 THEN 3
                               WHEN total_spent >= 500 THEN 2
                               ELSE 1 END), 2) AS monetaryScore
            FROM segmented
            GROUP BY segment
            ORDER BY totalRevenue DESC
        `;
    const [rows] = await shared_1.bigquery.query({ query, location: 'US' });
    const result = rows.map((r) => {
        var _a, _b, _c, _d, _e, _f;
        return ({
            segment: r.segment,
            count: Number((_a = r.count) !== null && _a !== void 0 ? _a : 0),
            totalRevenue: Number((_b = r.totalRevenue) !== null && _b !== void 0 ? _b : 0),
            averageOrderValue: Number((_c = r.averageOrderValue) !== null && _c !== void 0 ? _c : 0),
            recencyScore: Number((_d = r.recencyScore) !== null && _d !== void 0 ? _d : 0),
            frequencyScore: Number((_e = r.frequencyScore) !== null && _e !== void 0 ? _e : 0),
            monetaryScore: Number((_f = r.monetaryScore) !== null && _f !== void 0 ? _f : 0)
        });
    });
    await setBQCache(cacheKey, result);
    return result;
});
// ── 5. Period Data (for period comparison) ────────────────────────────────────
exports.queryPeriodData = functions
    .runWith({ timeoutSeconds: 60, memory: '256MB' })
    .https.onCall(async (data, context) => {
    var _a, _b, _c, _d;
    if (!context.auth)
        throw new functions.https.HttpsError('unauthenticated', 'Login required.');
    const { startDate, endDate } = data !== null && data !== void 0 ? data : {};
    if (!startDate || !endDate)
        throw new functions.https.HttpsError('invalid-argument', 'startDate and endDate required.');
    const cacheKey = `period_data_${startDate}_${endDate}`;
    const cached = await getBQCache(cacheKey);
    if (cached)
        return cached;
    const query = `
            SELECT
                COUNT(*) AS orders,
                ROUND(SUM(total), 2) AS revenue,
                COUNT(DISTINCT COALESCE(customer_id, customer_email)) AS customers
            FROM \`${BQ_PROJECT}.${BQ_DATASET}.orders\`
            WHERE status NOT IN ('cancelled', 'refunded', 'returned', 'pending_payment', 'payment_failed')
              AND created_at BETWEEN TIMESTAMP('${startDate}') AND TIMESTAMP('${endDate}')
        `;
    const [rows] = await shared_1.bigquery.query({ query, location: 'US' });
    const row = (_a = rows[0]) !== null && _a !== void 0 ? _a : {};
    const ordersCount = Number((_b = row.orders) !== null && _b !== void 0 ? _b : 0);
    const revenue = Number((_c = row.revenue) !== null && _c !== void 0 ? _c : 0);
    const result = {
        revenue,
        orders: ordersCount,
        averageOrderValue: ordersCount > 0 ? revenue / ordersCount : 0,
        customers: Number((_d = row.customers) !== null && _d !== void 0 ? _d : 0)
    };
    await setBQCache(cacheKey, result);
    return result;
});
// ── 6. Growth Metrics ─────────────────────────────────────────────────────────
exports.queryGrowthMetrics = functions
    .runWith({ timeoutSeconds: 60, memory: '256MB' })
    .https.onCall(async (data, context) => {
    var _a, _b, _c, _d, _e;
    if (!context.auth)
        throw new functions.https.HttpsError('unauthenticated', 'Login required.');
    const periods = (_a = data === null || data === void 0 ? void 0 : data.periods) !== null && _a !== void 0 ? _a : 12;
    const cacheKey = `growth_metrics_${periods}`;
    const cached = await getBQCache(cacheKey);
    if (cached)
        return cached;
    const query = `
            WITH monthly AS (
                SELECT
                    FORMAT_DATE('%Y-%m', DATE(created_at)) AS month,
                    SUM(total) AS revenue,
                    COUNT(*) AS orders,
                    COUNT(DISTINCT COALESCE(customer_id, customer_email)) AS customers
                FROM \`${BQ_PROJECT}.${BQ_DATASET}.orders\`
                WHERE status NOT IN ('cancelled', 'refunded', 'returned', 'pending_payment', 'payment_failed')
                  AND created_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL ${periods} MONTH)
                GROUP BY 1
                ORDER BY 1
            )
            SELECT * FROM monthly
        `;
    const [rows] = await shared_1.bigquery.query({ query, location: 'US' });
    if (rows.length < 2) {
        const empty = { revenueGrowth: 0, orderGrowth: 0, customerGrowth: 0, aovGrowth: 0, compoundGrowthRate: 0 };
        await setBQCache(cacheKey, empty);
        return empty;
    }
    const first = rows[0];
    const last = rows[rows.length - 1];
    const firstRevenue = Number((_b = first.revenue) !== null && _b !== void 0 ? _b : 0);
    const lastRevenue = Number((_c = last.revenue) !== null && _c !== void 0 ? _c : 0);
    const firstOrders = Number((_d = first.orders) !== null && _d !== void 0 ? _d : 0);
    const lastOrders = Number((_e = last.orders) !== null && _e !== void 0 ? _e : 0);
    const firstAOV = firstOrders > 0 ? firstRevenue / firstOrders : 0;
    const lastAOV = lastOrders > 0 ? lastRevenue / lastOrders : 0;
    const result = {
        revenueGrowth: firstRevenue > 0 ? ((lastRevenue - firstRevenue) / firstRevenue) * 100 : 0,
        orderGrowth: firstOrders > 0 ? ((lastOrders - firstOrders) / firstOrders) * 100 : 0,
        customerGrowth: 0,
        aovGrowth: firstAOV > 0 ? ((lastAOV - firstAOV) / firstAOV) * 100 : 0,
        compoundGrowthRate: firstRevenue > 0
            ? (Math.pow(lastRevenue / firstRevenue, 1 / periods) - 1) * 100
            : 0
    };
    await setBQCache(cacheKey, result);
    return result;
});
//# sourceMappingURL=customer-analytics.js.map