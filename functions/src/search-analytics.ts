/**
 * search-analytics.ts
 * Search event tracking, BigQuery pipeline, and search analytics queries.
 */
import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { db, bigquery } from './shared';
import { BQ_DATASET, BQ_LOCATION, BQ_PROJECT } from './bq-analytics';

const BQ_SEARCH_TABLE = 'search_events';

const BQ_SEARCH_SCHEMA = [
    { name: 'event_id', type: 'STRING', mode: 'REQUIRED' },
    { name: 'event_date', type: 'DATE', mode: 'REQUIRED' },  // partition key
    { name: 'event_timestamp', type: 'TIMESTAMP', mode: 'REQUIRED' },
    { name: 'event_type', type: 'STRING', mode: 'REQUIRED' },  // query|click|exit|add_to_cart|purchase
    { name: 'term', type: 'STRING', mode: 'NULLABLE' },
    { name: 'normalized_term', type: 'STRING', mode: 'NULLABLE' },
    { name: 'session_id', type: 'STRING', mode: 'NULLABLE' },
    { name: 'user_id', type: 'STRING', mode: 'NULLABLE' },
    { name: 'source', type: 'STRING', mode: 'NULLABLE' },  // navbar|catalog_page|mobile
    { name: 'channel', type: 'STRING', mode: 'NULLABLE' },  // WEB|POS
    // query fields
    { name: 'result_count', type: 'INT64', mode: 'NULLABLE' },
    { name: 'has_results', type: 'BOOL', mode: 'NULLABLE' },
    // click fields
    { name: 'product_id', type: 'STRING', mode: 'NULLABLE' },
    { name: 'product_name', type: 'STRING', mode: 'NULLABLE' },
    { name: 'click_position', type: 'INT64', mode: 'NULLABLE' },
    // exit fields
    { name: 'exit_reason', type: 'STRING', mode: 'NULLABLE' },  // blur|clear|navigate_away
    { name: 'dwell_ms', type: 'INT64', mode: 'NULLABLE' },
    // add_to_cart fields
    { name: 'cart_value', type: 'FLOAT64', mode: 'NULLABLE' },
    { name: 'quantity', type: 'INT64', mode: 'NULLABLE' },
    // purchase fields
    { name: 'order_id', type: 'STRING', mode: 'NULLABLE' },
    { name: 'revenue', type: 'FLOAT64', mode: 'NULLABLE' },
];

/** Ensures the euro_analytics.search_events table exists with the full schema (idempotent). */
async function ensureSearchBQSchema(): Promise<void> {
    const dataset = bigquery.dataset(BQ_DATASET, { location: BQ_LOCATION });
    const [dsExists] = await dataset.exists();
    if (!dsExists) {
        await dataset.create({ location: BQ_LOCATION });
        console.log(`[SearchBQ] Created dataset ${BQ_DATASET}`);
    }

    const table = dataset.table(BQ_SEARCH_TABLE);
    const [tblExists] = await table.exists();
    if (!tblExists) {
        await table.create({
            schema: BQ_SEARCH_SCHEMA,
            timePartitioning: { type: 'DAY', field: 'event_date' },
            clustering: { fields: ['event_type', 'normalized_term'] },
            location: BQ_LOCATION,
        });
        console.log(`[SearchBQ] Created table ${BQ_DATASET}.${BQ_SEARCH_TABLE}`);
    }
}

/** Converts a Firestore search_events document into a flat BQ row. */
function searchEventToBQRow(docId: string, data: any): Record<string, any> {
    // Resolve event_date from Firestore Timestamp
    const ts: FirebaseFirestore.Timestamp | null = data.timestamp ?? null;
    const date = ts ? ts.toDate() : new Date();
    const eventDate = date.toLocaleDateString('sv-SE', { timeZone: 'America/Mexico_City' });

    return {
        event_id: docId,
        event_date: eventDate,
        event_timestamp: date.toISOString(),
        event_type: data.type ?? null,
        term: data.term ?? null,
        normalized_term: data.normalizedTerm ?? null,
        session_id: data.sessionId ?? null,
        user_id: data.userId ?? null,
        source: data.source ?? null,
        channel: data.channel ?? null,
        // query
        result_count: data.resultCount != null ? Number(data.resultCount) : null,
        has_results: data.hasResults != null ? Boolean(data.hasResults) : null,
        // click
        product_id: data.productId ?? null,
        product_name: data.productName ?? null,
        click_position: data.position != null ? Number(data.position) : null,
        // exit
        exit_reason: data.exitReason ?? null,
        dwell_ms: data.dwellMs != null ? Number(data.dwellMs) : null,
        // add_to_cart
        cart_value: data.cartValue != null ? Number(data.cartValue) : null,
        quantity: data.quantity != null ? Number(data.quantity) : null,
        // purchase
        order_id: data.orderId ?? null,
        revenue: data.revenue != null ? Number(data.revenue) : null,
    };
}

// ─── onSearchEventCreated — Firestore trigger (real-time BQ streaming) ─────────
//
// Fires on every new doc in search_events and inserts it into BQ.
// This keeps the analytics table current without any manual steps.
// ─────────────────────────────────────────────────────────────────────────────

export const onSearchEventCreated = functions
    .runWith({ timeoutSeconds: 30 })
    .firestore
    .document('search_events/{eventId}')
    .onCreate(async (snap, context) => {
        const data = snap.data();
        const docId = context.params.eventId;

        try {
            await ensureSearchBQSchema();
            const row = searchEventToBQRow(docId, data);
            await bigquery.dataset(BQ_DATASET).table(BQ_SEARCH_TABLE).insert([row], { skipInvalidRows: true });
            console.log(`[SearchBQ] Streamed event ${docId} (type=${data.type})`);
        } catch (err) {
            // Non-critical — BQ is analytics layer; don't block the write
            console.error('[SearchBQ] Failed to stream event to BQ:', err);
        }
    });

// ─── backfillSearchEventsToBigQuery — callable ────────────────────────────────
//
// One-time (or re-runnable) callable to seed ALL historical search_events
// into BigQuery. Uses pagination to handle large collections.
//
// Returns: { inserted, skipped, errors }
// ─────────────────────────────────────────────────────────────────────────────

export const backfillSearchEventsToBigQuery = functions
    .runWith({ timeoutSeconds: 540, memory: '1GB' })
    .https.onCall(async (_data, context) => {
        if (!context.auth) {
            throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
        }

        console.log('[SearchBQ Backfill] Starting...');
        await ensureSearchBQSchema();

        const table = bigquery.dataset(BQ_DATASET).table(BQ_SEARCH_TABLE);
        const BATCH_SIZE = 500;
        let inserted = 0;
        let skipped = 0;
        let errors = 0;

        // Paginate through all search_events docs
        let query = db.collection('search_events').orderBy('timestamp').limit(BATCH_SIZE);
        let lastDoc: FirebaseFirestore.QueryDocumentSnapshot | null = null;

        while (true) {
            const snap: FirebaseFirestore.QuerySnapshot = lastDoc
                ? await query.startAfter(lastDoc).get()
                : await query.get();

            if (snap.empty) break;

            const rows = snap.docs.map((d: FirebaseFirestore.QueryDocumentSnapshot) => searchEventToBQRow(d.id, d.data()));

            try {
                await table.insert(rows, { skipInvalidRows: true, raw: false });
                inserted += rows.length;
            } catch (err: any) {
                // BigQuery insert errors are per-row — count them but continue
                const rowErrors = err?.errors?.length ?? rows.length;
                errors += rowErrors;
                inserted += rows.length - rowErrors;
                console.error(`[SearchBQ Backfill] Batch error:`, err?.message);
            }

            lastDoc = snap.docs[snap.docs.length - 1];
            if (snap.docs.length < BATCH_SIZE) break;
        }

        console.log(`[SearchBQ Backfill] Done — inserted=${inserted}, skipped=${skipped}, errors=${errors}`);
        return { inserted, skipped, errors };
    });

// ─── querySearchAnalytics — callable ─────────────────────────────────────────
//
// General-purpose search analytics callable. Accepts { queryType, params }
// and returns typed result rows from BigQuery.
//
// Query types:
//   'funnel'            → 5-step conversion funnel (query→click→exit→cart→purchase)
//   'topTerms'          → top search terms ranked by volume + CTR + null-result %
//   'zeroResults'       → terms that returned 0 results (catalog gap analysis)
//   'heatmap'           → search volume by hour-of-day × day-of-week
//   'trendingTerms'     → rising terms: 7-day vs 30-day baseline velocity
//   'revenueAttribution'→ search-attributed revenue by term (via sessionId joins)
// ─────────────────────────────────────────────────────────────────────────────

export const querySearchAnalytics = functions
    .runWith({ timeoutSeconds: 60, memory: '512MB' })
    .https.onCall(async (data: {
        queryType: 'funnel' | 'topTerms' | 'zeroResults' | 'heatmap' | 'dailyVolume' | 'trendingTerms' | 'revenueAttribution';
        fromDate: string;   // YYYY-MM-DD
        toDate: string;   // YYYY-MM-DD
        limit?: number;
    }, context) => {
        if (!context.auth) {
            throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
        }

        const { queryType, fromDate, toDate, limit = 50 } = data;
        const PROJECT = JSON.parse(process.env.FIREBASE_CONFIG || '{}').projectId || process.env.GCLOUD_PROJECT || 'importadora-euro';
        const DS = BQ_DATASET;
        const TBL = `\`${PROJECT}.${DS}.${BQ_SEARCH_TABLE}\``;

        let sql = '';
        const params: Record<string, any> = { fromDate, toDate, limit };

        switch (queryType) {

            // ── 1. Conversion Funnel ─────────────────────────────────────────────────
            // Shows total events per step + conversion rates between consecutive steps.
            case 'funnel':
                sql = `
                    SELECT
                        event_type,
                        COUNT(*)                          AS event_count,
                        COUNT(DISTINCT session_id)        AS unique_sessions,
                        COUNT(DISTINCT user_id)           AS unique_users
                    FROM ${TBL}
                    WHERE event_date BETWEEN @fromDate AND @toDate
                    GROUP BY event_type
                    ORDER BY
                        CASE event_type
                            WHEN 'query'       THEN 1
                            WHEN 'click'       THEN 2
                            WHEN 'exit'        THEN 3
                            WHEN 'add_to_cart' THEN 4
                            WHEN 'purchase'    THEN 5
                            ELSE 6
                        END
                `;
                break;

            // ── 2. Top Search Terms ──────────────────────────────────────────────────
            // Ranked by search volume. Includes CTR, zero-result %, avg position.
            case 'topTerms':
                sql = `
                    WITH
                    -- Apply same normalization as the storefront normalizeTerm():
                    -- strip trailing special chars, collapse spaces.
                    -- This merges historical variants like '130/90\' and '130/90?' into '130/90'.
                    cleaned AS (
                        SELECT
                            *,
                            TRIM(REGEXP_REPLACE(
                                REGEXP_REPLACE(
                                    REGEXP_REPLACE(LOWER(TRIM(normalized_term)), r'[\\\\?!.,;:*+]+$', ''),
                                r"['\'\`]+$", ''),
                            r'\\s+', ' ')) AS clean_term
                        FROM ${TBL}
                        WHERE event_date BETWEEN @fromDate AND @toDate
                          AND normalized_term IS NOT NULL
                    ),
                    queries AS (
                        SELECT
                            clean_term                                                        AS normalized_term,
                            COUNT(*)                                                          AS searches,
                            COUNT(DISTINCT session_id)                                        AS unique_sessions,
                            COUNTIF(has_results = FALSE)                                      AS zero_result_searches,
                            SAFE_DIVIDE(COUNTIF(has_results = FALSE), COUNT(*))               AS zero_result_rate,
                            AVG(CAST(result_count AS FLOAT64))                                AS avg_result_count,
                            COUNT(DISTINCT normalized_term)                                   AS variants
                        FROM cleaned
                        WHERE event_type = 'query'
                        GROUP BY clean_term
                    ),
                    clicks AS (
                        SELECT clean_term AS normalized_term, COUNT(*) AS clicks, AVG(click_position) AS avg_position
                        FROM cleaned
                        WHERE event_type = 'click'
                        GROUP BY clean_term
                    ),
                    carts AS (
                        SELECT clean_term AS normalized_term, COUNT(*) AS cart_adds
                        FROM cleaned
                        WHERE event_type = 'add_to_cart'
                        GROUP BY clean_term
                    ),
                    purchases AS (
                        SELECT clean_term AS normalized_term, COUNT(*) AS conversions, SUM(revenue) AS attributed_revenue
                        FROM cleaned
                        WHERE event_type = 'purchase'
                        GROUP BY clean_term
                    )
                    SELECT
                        q.normalized_term                                          AS term,
                        q.searches,
                        q.unique_sessions,
                        COALESCE(c.clicks, 0)                                      AS clicks,
                        SAFE_DIVIDE(COALESCE(c.clicks, 0), q.searches)            AS ctr,
                        q.zero_result_searches,
                        q.zero_result_rate,
                        q.avg_result_count,
                        COALESCE(ca.cart_adds, 0)                                 AS cart_adds,
                        COALESCE(p.conversions, 0)                                AS conversions,
                        COALESCE(p.attributed_revenue, 0)                         AS attributed_revenue,
                        COALESCE(c.avg_position, 0)                               AS avg_click_position,
                        q.variants
                    FROM queries q
                    LEFT JOIN clicks    c  ON q.normalized_term = c.normalized_term
                    LEFT JOIN carts     ca ON q.normalized_term = ca.normalized_term
                    LEFT JOIN purchases p  ON q.normalized_term = p.normalized_term
                    -- Suppress 1-count terms: mostly partial mid-type queries (user was still typing)
                    HAVING q.searches >= 2
                    ORDER BY q.searches DESC
                    LIMIT @limit
                `;
                break;

            // ── 3. Zero-Result Terms (Catalog Gap Analysis) ──────────────────────────
            // Pure list of terms where has_results = false. Sorted by frequency.
            case 'zeroResults':
                sql = `
                    WITH cleaned AS (
                        SELECT
                            *,
                            TRIM(REGEXP_REPLACE(
                            TRIM(REGEXP_REPLACE(
                                REGEXP_REPLACE(
                                    REGEXP_REPLACE(LOWER(TRIM(normalized_term)), r'[\\\\?!.,;:*+]+$', ''),
                                r"['\'\`]+$", ''),
                            r'\\s+', ' ')) AS clean_term
                        FROM ${TBL}
                        WHERE event_date BETWEEN @fromDate AND @toDate
                          AND normalized_term IS NOT NULL
                    )
                    SELECT
                        clean_term                       AS term,
                        COUNT(*)                         AS searches,
                        COUNT(DISTINCT session_id)       AS unique_sessions,
                        COUNT(DISTINCT user_id)          AS unique_users,
                        MIN(event_date)                  AS first_seen,
                        MAX(event_date)                  AS last_seen
                    FROM cleaned
                    WHERE event_type = 'query'
                      AND has_results = FALSE
                    GROUP BY clean_term
                    HAVING searches >= 2
                    ORDER BY searches DESC
                    LIMIT @limit
                `;
                break;

            // ── 4. Search Heatmap (hour-of-day × day-of-week) ───────────────────────
            // Returns 7×24 = 168 cells, each with search count. Used for a heatmap widget.
            // Mexico City time (UTC-6).
            case 'heatmap':
                sql = `
                    SELECT
                        EXTRACT(DAYOFWEEK FROM DATETIME(event_timestamp, 'America/Mexico_City')) AS day_of_week,
                        EXTRACT(HOUR     FROM DATETIME(event_timestamp, 'America/Mexico_City')) AS hour_of_day,
                        COUNT(*)                         AS searches,
                        COUNT(DISTINCT session_id)       AS unique_sessions
                    FROM ${TBL}
                    WHERE event_date BETWEEN @fromDate AND @toDate
                      AND event_type = 'query'
                    GROUP BY day_of_week, hour_of_day
                    ORDER BY day_of_week, hour_of_day
                `;
                break;

            // ── 4b. Daily Volume (calendar heatmap for 30d / MTD) ────────────────────
            // Returns one row per calendar date with total search volume.
            // Used to render a month-calendar heatmap on 30d/MTD ranges.
            case 'dailyVolume':
                sql = `
                    SELECT
                        event_date                       AS event_date,
                        EXTRACT(DAYOFWEEK FROM PARSE_DATE('%Y-%m-%d', CAST(event_date AS STRING))) AS day_of_week,
                        COUNT(*)                         AS searches,
                        COUNT(DISTINCT session_id)       AS unique_sessions
                    FROM ${TBL}
                    WHERE event_date BETWEEN @fromDate AND @toDate
                      AND event_type = 'query'
                    GROUP BY event_date
                    ORDER BY event_date
                `;
                break;

            // ── 5. Trending Terms (7-day vs 30-day baseline velocity) ────────────────
            // Identifies terms whose recent volume is significantly above their baseline.
            // velocity_ratio > 1.5 = trending up; < 0.5 = declining.
            case 'trendingTerms':
                sql = `
                    WITH baseline AS (
                        SELECT
                            normalized_term,
                            COUNT(*) / 30.0   AS daily_avg_30d
                        FROM ${TBL}
                        WHERE event_date BETWEEN
                                DATE_SUB(CURRENT_DATE('America/Mexico_City'), INTERVAL 30 DAY)
                              AND CURRENT_DATE('America/Mexico_City')
                          AND event_type = 'query'
                          AND normalized_term IS NOT NULL
                        GROUP BY normalized_term
                    ),
                    recent AS (
                        SELECT
                            normalized_term,
                            COUNT(*) / 7.0   AS daily_avg_7d
                        FROM ${TBL}
                        WHERE event_date BETWEEN
                                DATE_SUB(CURRENT_DATE('America/Mexico_City'), INTERVAL 7 DAY)
                              AND CURRENT_DATE('America/Mexico_City')
                          AND event_type = 'query'
                          AND normalized_term IS NOT NULL
                        GROUP BY normalized_term
                    )
                    SELECT
                        r.normalized_term                                        AS term,
                        r.daily_avg_7d,
                        b.daily_avg_30d,
                        SAFE_DIVIDE(r.daily_avg_7d, NULLIF(b.daily_avg_30d, 0)) AS velocity_ratio,
                        ROUND(r.daily_avg_7d * 7)                               AS searches_7d,
                        ROUND(b.daily_avg_30d * 30)                             AS searches_30d
                    FROM recent r
                    JOIN baseline b ON r.normalized_term = b.normalized_term
                    WHERE r.daily_avg_7d >= 1.0  -- filter noise (at least 1/day recently)
                    ORDER BY velocity_ratio DESC
                    LIMIT @limit
                `;
                break;

            // ── 6. Search-Attributed Revenue ─────────────────────────────────────────
            // Revenue attributed to searches via the purchase event's session.
            // This is the most direct "search drove this sale" metric.
            case 'revenueAttribution':
                sql = `
                    WITH purchase_events AS (
                        SELECT
                            normalized_term,
                            session_id,
                            order_id,
                            revenue,
                            event_date
                        FROM ${TBL}
                        WHERE event_date BETWEEN @fromDate AND @toDate
                          AND event_type = 'purchase'
                          AND normalized_term IS NOT NULL
                    ),
                    term_stats AS (
                        SELECT
                            normalized_term                  AS term,
                            COUNT(DISTINCT order_id)         AS attributed_orders,
                            SUM(revenue)                     AS attributed_revenue,
                            AVG(revenue)                     AS avg_order_value,
                            COUNT(DISTINCT session_id)       AS converting_sessions
                        FROM purchase_events
                        GROUP BY normalized_term
                    ),
                    search_volume AS (
                        SELECT normalized_term, COUNT(*) AS searches
                        FROM ${TBL}
                        WHERE event_date BETWEEN @fromDate AND @toDate
                          AND event_type = 'query'
                          AND normalized_term IS NOT NULL
                        GROUP BY normalized_term
                    )
                    SELECT
                        t.term,
                        t.attributed_orders,
                        t.attributed_revenue,
                        t.avg_order_value,
                        t.converting_sessions,
                        sv.searches,
                        SAFE_DIVIDE(t.attributed_orders, sv.searches) AS purchase_rate
                    FROM term_stats t
                    LEFT JOIN search_volume sv ON t.term = sv.normalized_term
                    ORDER BY t.attributed_revenue DESC
                    LIMIT @limit
                `;
                break;

            default:
                throw new functions.https.HttpsError('invalid-argument', `Unknown queryType: ${queryType}`);
        }

        const [rows] = await bigquery.query({
            query: sql,
            params,
            location: BQ_LOCATION,
        });

        // Serialize BigQuery row values — same pattern as queryMetrics
        const serialize = (v: any): any => {
            if (v == null) return null;
            if (typeof v === 'object' && 'value' in v) {
                const n = Number(v.value);
                return isFinite(n) ? n : (v.value ?? null);
            }
            if (typeof v === 'number') return isFinite(v) ? v : null;
            if (typeof v === 'boolean') return v;
            return v;
        };

        const result = rows.map((row: any) => {
            const out: Record<string, any> = {};
            for (const [k, v] of Object.entries(row)) out[k] = serialize(v);
            return out;
        });

        return { queryType, fromDate, toDate, rowCount: result.length, rows: result };
    });


// ═══════════════════════════════════════════════════════════════════════════════
// ─── GOOGLE SHOPPING FEED ─────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
//
// Generates a live Google Merchant Center RSS/XML product feed from Firestore.
//
// Host at: https://importadoraeuro.com/google-shopping-feed.xml
// (add rewrite in firebase.json: "/google-shopping-feed.xml" → this function)
//
// Google Merchant Center Setup:
//  1. merchants.google.com → Add site → Verify via GA4 (already verified)
//  2. Products → Feeds → Add feed → Scheduled fetch → paste the URL above
//  3. Enable "Free Listings" for the Shopping tab (no cost)
//  4. Enable "Surfaces across Google" for Image Search & Maps
//
// Google Shopping Category 5613 = Vehicles & Parts > Motor Vehicle Parts
// ─────────────────────────────────────────────────────────────────────────────

