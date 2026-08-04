/**
 * index.ts — Cloud Functions entry point
 *
 * This file ONLY re-exports functions from focused modules.
 * All business logic lives in the individual module files.
 *
 * Module map:
 *   shared.ts              — db, bigquery, config cache (singletons)
 *   meli-shared.ts         — MeLi token helpers, parseAndSaveMeliOrder (internal)
 *   ai-agents.ts           — EuroMind AI agent functions
 *   analytics.ts           — snapshotProjections, backfillDailyForecasts
 *   competitor-intelligence.ts — competitor price scanning
 *   meli-orders-sync.ts    — computeMeliSkuStats, scheduledMeliSkuStats
 *   meli-auth.ts           — meliAuthUrl, meliCallback, meliRefreshTokenScheduled
 *   meli-orders.ts         — meliSyncOrders, meliBackfillShippingCosts, meliSyncHistorical, etc.
 *   meli-inventory.ts      — meliSyncFullInventory, meliSyncListings, meliPriceScan, etc.
 *   meli-ads.ts            — meliSyncAdsSpend, meliGetAdsSummary (Mercado Ads spend tracking)
 *   meli-webhook.ts        — meliWebhook, getMeliRawOrderDebug
 *   meli-inbox-sync.ts     — syncMeliToInbox, backfillMeliToInbox
 *   payments.ts            — processPayment, cancelOrder, refundOrder, mpWebhook, etc.
 *   skydropx.ts            — skydropxGetRates, skydropxCreateLabel, etc.
 *   user-claims.ts         — syncUserClaims, backfillUserClaims
 *   amazon.ts              — amazonManualSync, amazonSyncCron, amazonOAuthCallback
 *   cart-hooks.ts          — onCartAbandoned, processRecoveryQueue, onOrderCompleted, etc.
 *   analytics-cron.ts      — aggregateDailyStats, backfillMonthlyStats, meliEnrich*, etc.
 *   bq-analytics.ts        — queryMetrics, appendOrdersToBQForDate, backfillOrdersToBigQuery
 *   inbox.ts               — metaInboxWebhook, telegramInboxWebhook, sendInboxReply, etc.
 *   search-analytics.ts    — onSearchEventCreated, backfillSearchEventsToBigQuery, etc.
 *   paid-media.ts          — syncPaidMediaSnapshots, triggerPaidMediaSync, getPaidMediaInsights
 *   seo.ts                 — sitemapXml, googleShoppingFeed, notifyIndexNow, onProductWriteIndexNow
 *   invoice.ts             — generateInvoice, testMeliBilling
 *   customer-analytics.ts  — queryCustomerInsights, queryCohortAnalysis, queryGrowthMetrics, etc.
 */

import * as admin from 'firebase-admin';

// ── MUST be first: initialize Firebase Admin before any module imports db ──────
admin.initializeApp();

// ── AI Agents (EuroMind) ───────────────────────────────────────────────────────
export {
    inboxMessageRouter, agentOrchestrator, agentHandoff,
    analyzeMeliInsights, testAnalyzeMeliInsights,
    euromindWeeklyReport, askEuroMind,
} from './ai-agents';

// ── Analytics & Projections ────────────────────────────────────────────────────
export { snapshotProjections, backfillDailyForecasts } from './analytics';

// ── Competitor Intelligence ────────────────────────────────────────────────────
export {
    meliCompetitorScanCron, meliCompetitorScanManual,
    getCompetitorIntelligence, updateCompetitorConfig,
} from './competitor-intelligence';

// ── MeLi SKU Stats (Replenishment Analytics) ──────────────────────────────────
export { computeMeliSkuStats, scheduledMeliSkuStats } from './meli-orders-sync';

// ── MercadoLibre Auth & Token Management ──────────────────────────────────────
export { meliAuthUrl, meliCallback, meliRefreshTokenScheduled } from './meli-auth';

// ── MercadoLibre Order Sync ────────────────────────────────────────────────────
export {
    meliSyncOrders,
    meliBackfillShippingCosts,
    meliAnalyzeHistoricalSync,
    meliSyncHistorical,
} from './meli-orders';

// ── MercadoLibre Inventory & Listings ─────────────────────────────────────────
export {
    testMeliApi,
    meliGetShippingLabel,
    meliSyncFullInventory,
    meliSyncListings,
    meliPriceScan,
    prunePriceHistory,
    meliSyncOrdersCron,
} from './meli-inventory';

// ── MercadoLibre Webhooks ──────────────────────────────────────────────────────
export { meliWebhook, getMeliRawOrderDebug } from './meli-webhook';

// ── MercadoLibre Revenue Reconciliator ────────────────────────────────────────
export { meliReconciliator, meliForceResync, meliXlsAudit } from './meli-reconciliator';

// ── Mercado Ads Spend Tracking ─────────────────────────────────────────────────
export { meliSyncAdsSpend, meliGetAdsSummary } from './meli-ads';

// ── MercadoLibre → Inbox Sync ──────────────────────────────────────────────────
export { syncMeliToInbox, backfillMeliToInbox } from './meli-inbox-sync';

// ── MercadoPago Payments ───────────────────────────────────────────────────────
export {
    processPayment, createPaymentLink, cancelOrder, refundOrder,
    mpWebhook, mpAuthUrl, mpCallback, mpDiag,
} from './payments';

// ── Skydropx Shipping ─────────────────────────────────────────────────────────
export {
    skydropxTestConnection, skydropxGetRates, skydropxRawTest,
    skydropxCreateLabel, skydropxGetTracking,
} from './skydropx';

// ── User Claims ───────────────────────────────────────────────────────────────
export { syncUserClaims, backfillUserClaims } from './user-claims';

// ── Amazon SP-API ──────────────────────────────────────────────────────────────
export { amazonManualSync, amazonSyncCron, amazonOAuthCallback } from './amazon';

// ── Cart, Order & Review Hooks ────────────────────────────────────────────────
export {
    onCartAbandoned, processRecoveryQueue,
    onOrderCompleted, processReviewRequests,
    onReferralOrderCompleted,
} from './cart-hooks';

// ── Analytics Cron Jobs ────────────────────────────────────────────────────────
export {
    detectAbandonedCarts, detectAbandonedCartsHttp,
    backfillMonthlyStats, aggregateDailyStats,
    cleanupAbandonedCheckouts,
    meliEnrichInventoryVelocity, meliEnrichInventoryVelocityCallable,
    backfillAnalytics,
    meliPriceScanDiag,
} from './analytics-cron';

// ── Paid Media ────────────────────────────────────────────────────────────────
export {
    syncPaidMediaSnapshots, triggerPaidMediaSync, getPaidMediaInsights,
} from './paid-media';

// ── SEO ───────────────────────────────────────────────────────────────────────
export {
    sitemapXml,
    googleShoppingFeed, notifyIndexNow, onProductWriteIndexNow,
} from './seo';

// ── Invoice / Billing ─────────────────────────────────────────────────────────
export { generateInvoice, cancelInvoice, testMeliBilling, testSwSapienConnection, testSwSapienStamp } from './invoice';

// ── BigQuery Analytics ────────────────────────────────────────────────────────
export {
    queryMetrics, backfillOrdersToBigQuery,
} from './bq-analytics';

// ── BQ Order Writer (used by analytics-cron) ──────────────────────────────────
export { appendOrdersToBQForDate } from './inbox';

// ── Universal Inbox Webhooks ───────────────────────────────────────────────────
export {
    metaInboxWebhook, telegramInboxWebhook, emailInboxWebhook,
    applyInboxChannelConfig, sendInboxReply,
} from './inbox';

// ── Search Analytics ──────────────────────────────────────────────────────────
export {
    onSearchEventCreated, backfillSearchEventsToBigQuery, querySearchAnalytics,
} from './search-analytics';

// ── Customer Analytics ────────────────────────────────────────────────────────
export {
    queryCustomerInsights, queryCohortAnalysis,
    queryCustomerMetrics, queryCustomerSegmentation,
    queryPeriodData, queryGrowthMetrics,
} from './customer-analytics';

// ── Pricing & Costs (OmniEuro) ────────────────────────────────────────────────
export {
    processPricingUpload,
    commitPricingSimulation
} from './pricing';

