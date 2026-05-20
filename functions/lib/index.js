"use strict";
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
 *   analytics.ts           — snapshotProjections
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.syncUserClaims = exports.skydropxGetTracking = exports.skydropxCreateLabel = exports.skydropxRawTest = exports.skydropxGetRates = exports.skydropxTestConnection = exports.mpDiag = exports.mpCallback = exports.mpAuthUrl = exports.mpWebhook = exports.refundOrder = exports.cancelOrder = exports.processPayment = exports.backfillMeliToInbox = exports.syncMeliToInbox = exports.meliGetAdsSummary = exports.meliSyncAdsSpend = exports.meliXlsAudit = exports.meliForceResync = exports.meliReconciliator = exports.getMeliRawOrderDebug = exports.meliWebhook = exports.meliSyncOrdersCron = exports.prunePriceHistory = exports.meliPriceScan = exports.meliSyncListings = exports.meliSyncFullInventory = exports.meliGetShippingLabel = exports.testMeliApi = exports.meliSyncHistorical = exports.meliAnalyzeHistoricalSync = exports.meliBackfillShippingCosts = exports.meliSyncOrders = exports.meliRefreshTokenScheduled = exports.meliCallback = exports.meliAuthUrl = exports.scheduledMeliSkuStats = exports.computeMeliSkuStats = exports.updateCompetitorConfig = exports.getCompetitorIntelligence = exports.meliCompetitorScanManual = exports.meliCompetitorScanCron = exports.snapshotProjections = exports.askEuroMind = exports.euromindWeeklyReport = exports.testAnalyzeMeliInsights = exports.analyzeMeliInsights = exports.agentHandoff = exports.agentOrchestrator = exports.inboxMessageRouter = void 0;
exports.commitPricingSimulation = exports.processPricingUpload = exports.queryGrowthMetrics = exports.queryPeriodData = exports.queryCustomerSegmentation = exports.queryCustomerMetrics = exports.queryCohortAnalysis = exports.queryCustomerInsights = exports.querySearchAnalytics = exports.backfillSearchEventsToBigQuery = exports.onSearchEventCreated = exports.sendInboxReply = exports.applyInboxChannelConfig = exports.emailInboxWebhook = exports.telegramInboxWebhook = exports.metaInboxWebhook = exports.appendOrdersToBQForDate = exports.backfillOrdersToBigQuery = exports.queryMetrics = exports.testMeliBilling = exports.generateInvoice = exports.onProductWriteIndexNow = exports.notifyIndexNow = exports.googleShoppingFeed = exports.sitemapXml = exports.getPaidMediaInsights = exports.triggerPaidMediaSync = exports.syncPaidMediaSnapshots = exports.meliPriceScanDiag = exports.backfillAnalytics = exports.meliEnrichInventoryVelocityCallable = exports.meliEnrichInventoryVelocity = exports.cleanupAbandonedCheckouts = exports.aggregateDailyStats = exports.backfillMonthlyStats = exports.detectAbandonedCartsHttp = exports.detectAbandonedCarts = exports.onReferralOrderCompleted = exports.processReviewRequests = exports.onOrderCompleted = exports.processRecoveryQueue = exports.onCartAbandoned = exports.amazonOAuthCallback = exports.amazonSyncCron = exports.amazonManualSync = exports.backfillUserClaims = void 0;
const admin = require("firebase-admin");
// ── MUST be first: initialize Firebase Admin before any module imports db ──────
admin.initializeApp();
// ── AI Agents (EuroMind) ───────────────────────────────────────────────────────
var ai_agents_1 = require("./ai-agents");
Object.defineProperty(exports, "inboxMessageRouter", { enumerable: true, get: function () { return ai_agents_1.inboxMessageRouter; } });
Object.defineProperty(exports, "agentOrchestrator", { enumerable: true, get: function () { return ai_agents_1.agentOrchestrator; } });
Object.defineProperty(exports, "agentHandoff", { enumerable: true, get: function () { return ai_agents_1.agentHandoff; } });
Object.defineProperty(exports, "analyzeMeliInsights", { enumerable: true, get: function () { return ai_agents_1.analyzeMeliInsights; } });
Object.defineProperty(exports, "testAnalyzeMeliInsights", { enumerable: true, get: function () { return ai_agents_1.testAnalyzeMeliInsights; } });
Object.defineProperty(exports, "euromindWeeklyReport", { enumerable: true, get: function () { return ai_agents_1.euromindWeeklyReport; } });
Object.defineProperty(exports, "askEuroMind", { enumerable: true, get: function () { return ai_agents_1.askEuroMind; } });
// ── Analytics & Projections ────────────────────────────────────────────────────
var analytics_1 = require("./analytics");
Object.defineProperty(exports, "snapshotProjections", { enumerable: true, get: function () { return analytics_1.snapshotProjections; } });
// ── Competitor Intelligence ────────────────────────────────────────────────────
var competitor_intelligence_1 = require("./competitor-intelligence");
Object.defineProperty(exports, "meliCompetitorScanCron", { enumerable: true, get: function () { return competitor_intelligence_1.meliCompetitorScanCron; } });
Object.defineProperty(exports, "meliCompetitorScanManual", { enumerable: true, get: function () { return competitor_intelligence_1.meliCompetitorScanManual; } });
Object.defineProperty(exports, "getCompetitorIntelligence", { enumerable: true, get: function () { return competitor_intelligence_1.getCompetitorIntelligence; } });
Object.defineProperty(exports, "updateCompetitorConfig", { enumerable: true, get: function () { return competitor_intelligence_1.updateCompetitorConfig; } });
// ── MeLi SKU Stats (Replenishment Analytics) ──────────────────────────────────
var meli_orders_sync_1 = require("./meli-orders-sync");
Object.defineProperty(exports, "computeMeliSkuStats", { enumerable: true, get: function () { return meli_orders_sync_1.computeMeliSkuStats; } });
Object.defineProperty(exports, "scheduledMeliSkuStats", { enumerable: true, get: function () { return meli_orders_sync_1.scheduledMeliSkuStats; } });
// ── MercadoLibre Auth & Token Management ──────────────────────────────────────
var meli_auth_1 = require("./meli-auth");
Object.defineProperty(exports, "meliAuthUrl", { enumerable: true, get: function () { return meli_auth_1.meliAuthUrl; } });
Object.defineProperty(exports, "meliCallback", { enumerable: true, get: function () { return meli_auth_1.meliCallback; } });
Object.defineProperty(exports, "meliRefreshTokenScheduled", { enumerable: true, get: function () { return meli_auth_1.meliRefreshTokenScheduled; } });
// ── MercadoLibre Order Sync ────────────────────────────────────────────────────
var meli_orders_1 = require("./meli-orders");
Object.defineProperty(exports, "meliSyncOrders", { enumerable: true, get: function () { return meli_orders_1.meliSyncOrders; } });
Object.defineProperty(exports, "meliBackfillShippingCosts", { enumerable: true, get: function () { return meli_orders_1.meliBackfillShippingCosts; } });
Object.defineProperty(exports, "meliAnalyzeHistoricalSync", { enumerable: true, get: function () { return meli_orders_1.meliAnalyzeHistoricalSync; } });
Object.defineProperty(exports, "meliSyncHistorical", { enumerable: true, get: function () { return meli_orders_1.meliSyncHistorical; } });
// ── MercadoLibre Inventory & Listings ─────────────────────────────────────────
var meli_inventory_1 = require("./meli-inventory");
Object.defineProperty(exports, "testMeliApi", { enumerable: true, get: function () { return meli_inventory_1.testMeliApi; } });
Object.defineProperty(exports, "meliGetShippingLabel", { enumerable: true, get: function () { return meli_inventory_1.meliGetShippingLabel; } });
Object.defineProperty(exports, "meliSyncFullInventory", { enumerable: true, get: function () { return meli_inventory_1.meliSyncFullInventory; } });
Object.defineProperty(exports, "meliSyncListings", { enumerable: true, get: function () { return meli_inventory_1.meliSyncListings; } });
Object.defineProperty(exports, "meliPriceScan", { enumerable: true, get: function () { return meli_inventory_1.meliPriceScan; } });
Object.defineProperty(exports, "prunePriceHistory", { enumerable: true, get: function () { return meli_inventory_1.prunePriceHistory; } });
Object.defineProperty(exports, "meliSyncOrdersCron", { enumerable: true, get: function () { return meli_inventory_1.meliSyncOrdersCron; } });
// ── MercadoLibre Webhooks ──────────────────────────────────────────────────────
var meli_webhook_1 = require("./meli-webhook");
Object.defineProperty(exports, "meliWebhook", { enumerable: true, get: function () { return meli_webhook_1.meliWebhook; } });
Object.defineProperty(exports, "getMeliRawOrderDebug", { enumerable: true, get: function () { return meli_webhook_1.getMeliRawOrderDebug; } });
// ── MercadoLibre Revenue Reconciliator ────────────────────────────────────────
var meli_reconciliator_1 = require("./meli-reconciliator");
Object.defineProperty(exports, "meliReconciliator", { enumerable: true, get: function () { return meli_reconciliator_1.meliReconciliator; } });
Object.defineProperty(exports, "meliForceResync", { enumerable: true, get: function () { return meli_reconciliator_1.meliForceResync; } });
Object.defineProperty(exports, "meliXlsAudit", { enumerable: true, get: function () { return meli_reconciliator_1.meliXlsAudit; } });
// ── Mercado Ads Spend Tracking ─────────────────────────────────────────────────
var meli_ads_1 = require("./meli-ads");
Object.defineProperty(exports, "meliSyncAdsSpend", { enumerable: true, get: function () { return meli_ads_1.meliSyncAdsSpend; } });
Object.defineProperty(exports, "meliGetAdsSummary", { enumerable: true, get: function () { return meli_ads_1.meliGetAdsSummary; } });
// ── MercadoLibre → Inbox Sync ──────────────────────────────────────────────────
var meli_inbox_sync_1 = require("./meli-inbox-sync");
Object.defineProperty(exports, "syncMeliToInbox", { enumerable: true, get: function () { return meli_inbox_sync_1.syncMeliToInbox; } });
Object.defineProperty(exports, "backfillMeliToInbox", { enumerable: true, get: function () { return meli_inbox_sync_1.backfillMeliToInbox; } });
// ── MercadoPago Payments ───────────────────────────────────────────────────────
var payments_1 = require("./payments");
Object.defineProperty(exports, "processPayment", { enumerable: true, get: function () { return payments_1.processPayment; } });
Object.defineProperty(exports, "cancelOrder", { enumerable: true, get: function () { return payments_1.cancelOrder; } });
Object.defineProperty(exports, "refundOrder", { enumerable: true, get: function () { return payments_1.refundOrder; } });
Object.defineProperty(exports, "mpWebhook", { enumerable: true, get: function () { return payments_1.mpWebhook; } });
Object.defineProperty(exports, "mpAuthUrl", { enumerable: true, get: function () { return payments_1.mpAuthUrl; } });
Object.defineProperty(exports, "mpCallback", { enumerable: true, get: function () { return payments_1.mpCallback; } });
Object.defineProperty(exports, "mpDiag", { enumerable: true, get: function () { return payments_1.mpDiag; } });
// ── Skydropx Shipping ─────────────────────────────────────────────────────────
var skydropx_1 = require("./skydropx");
Object.defineProperty(exports, "skydropxTestConnection", { enumerable: true, get: function () { return skydropx_1.skydropxTestConnection; } });
Object.defineProperty(exports, "skydropxGetRates", { enumerable: true, get: function () { return skydropx_1.skydropxGetRates; } });
Object.defineProperty(exports, "skydropxRawTest", { enumerable: true, get: function () { return skydropx_1.skydropxRawTest; } });
Object.defineProperty(exports, "skydropxCreateLabel", { enumerable: true, get: function () { return skydropx_1.skydropxCreateLabel; } });
Object.defineProperty(exports, "skydropxGetTracking", { enumerable: true, get: function () { return skydropx_1.skydropxGetTracking; } });
// ── User Claims ───────────────────────────────────────────────────────────────
var user_claims_1 = require("./user-claims");
Object.defineProperty(exports, "syncUserClaims", { enumerable: true, get: function () { return user_claims_1.syncUserClaims; } });
Object.defineProperty(exports, "backfillUserClaims", { enumerable: true, get: function () { return user_claims_1.backfillUserClaims; } });
// ── Amazon SP-API ──────────────────────────────────────────────────────────────
var amazon_1 = require("./amazon");
Object.defineProperty(exports, "amazonManualSync", { enumerable: true, get: function () { return amazon_1.amazonManualSync; } });
Object.defineProperty(exports, "amazonSyncCron", { enumerable: true, get: function () { return amazon_1.amazonSyncCron; } });
Object.defineProperty(exports, "amazonOAuthCallback", { enumerable: true, get: function () { return amazon_1.amazonOAuthCallback; } });
// ── Cart, Order & Review Hooks ────────────────────────────────────────────────
var cart_hooks_1 = require("./cart-hooks");
Object.defineProperty(exports, "onCartAbandoned", { enumerable: true, get: function () { return cart_hooks_1.onCartAbandoned; } });
Object.defineProperty(exports, "processRecoveryQueue", { enumerable: true, get: function () { return cart_hooks_1.processRecoveryQueue; } });
Object.defineProperty(exports, "onOrderCompleted", { enumerable: true, get: function () { return cart_hooks_1.onOrderCompleted; } });
Object.defineProperty(exports, "processReviewRequests", { enumerable: true, get: function () { return cart_hooks_1.processReviewRequests; } });
Object.defineProperty(exports, "onReferralOrderCompleted", { enumerable: true, get: function () { return cart_hooks_1.onReferralOrderCompleted; } });
// ── Analytics Cron Jobs ────────────────────────────────────────────────────────
var analytics_cron_1 = require("./analytics-cron");
Object.defineProperty(exports, "detectAbandonedCarts", { enumerable: true, get: function () { return analytics_cron_1.detectAbandonedCarts; } });
Object.defineProperty(exports, "detectAbandonedCartsHttp", { enumerable: true, get: function () { return analytics_cron_1.detectAbandonedCartsHttp; } });
Object.defineProperty(exports, "backfillMonthlyStats", { enumerable: true, get: function () { return analytics_cron_1.backfillMonthlyStats; } });
Object.defineProperty(exports, "aggregateDailyStats", { enumerable: true, get: function () { return analytics_cron_1.aggregateDailyStats; } });
Object.defineProperty(exports, "cleanupAbandonedCheckouts", { enumerable: true, get: function () { return analytics_cron_1.cleanupAbandonedCheckouts; } });
Object.defineProperty(exports, "meliEnrichInventoryVelocity", { enumerable: true, get: function () { return analytics_cron_1.meliEnrichInventoryVelocity; } });
Object.defineProperty(exports, "meliEnrichInventoryVelocityCallable", { enumerable: true, get: function () { return analytics_cron_1.meliEnrichInventoryVelocityCallable; } });
Object.defineProperty(exports, "backfillAnalytics", { enumerable: true, get: function () { return analytics_cron_1.backfillAnalytics; } });
Object.defineProperty(exports, "meliPriceScanDiag", { enumerable: true, get: function () { return analytics_cron_1.meliPriceScanDiag; } });
// ── Paid Media ────────────────────────────────────────────────────────────────
var paid_media_1 = require("./paid-media");
Object.defineProperty(exports, "syncPaidMediaSnapshots", { enumerable: true, get: function () { return paid_media_1.syncPaidMediaSnapshots; } });
Object.defineProperty(exports, "triggerPaidMediaSync", { enumerable: true, get: function () { return paid_media_1.triggerPaidMediaSync; } });
Object.defineProperty(exports, "getPaidMediaInsights", { enumerable: true, get: function () { return paid_media_1.getPaidMediaInsights; } });
// ── SEO ───────────────────────────────────────────────────────────────────────
var seo_1 = require("./seo");
Object.defineProperty(exports, "sitemapXml", { enumerable: true, get: function () { return seo_1.sitemapXml; } });
Object.defineProperty(exports, "googleShoppingFeed", { enumerable: true, get: function () { return seo_1.googleShoppingFeed; } });
Object.defineProperty(exports, "notifyIndexNow", { enumerable: true, get: function () { return seo_1.notifyIndexNow; } });
Object.defineProperty(exports, "onProductWriteIndexNow", { enumerable: true, get: function () { return seo_1.onProductWriteIndexNow; } });
// ── Invoice / Billing ─────────────────────────────────────────────────────────
var invoice_1 = require("./invoice");
Object.defineProperty(exports, "generateInvoice", { enumerable: true, get: function () { return invoice_1.generateInvoice; } });
Object.defineProperty(exports, "testMeliBilling", { enumerable: true, get: function () { return invoice_1.testMeliBilling; } });
// ── BigQuery Analytics ────────────────────────────────────────────────────────
var bq_analytics_1 = require("./bq-analytics");
Object.defineProperty(exports, "queryMetrics", { enumerable: true, get: function () { return bq_analytics_1.queryMetrics; } });
Object.defineProperty(exports, "backfillOrdersToBigQuery", { enumerable: true, get: function () { return bq_analytics_1.backfillOrdersToBigQuery; } });
// ── BQ Order Writer (used by analytics-cron) ──────────────────────────────────
var inbox_1 = require("./inbox");
Object.defineProperty(exports, "appendOrdersToBQForDate", { enumerable: true, get: function () { return inbox_1.appendOrdersToBQForDate; } });
// ── Universal Inbox Webhooks ───────────────────────────────────────────────────
var inbox_2 = require("./inbox");
Object.defineProperty(exports, "metaInboxWebhook", { enumerable: true, get: function () { return inbox_2.metaInboxWebhook; } });
Object.defineProperty(exports, "telegramInboxWebhook", { enumerable: true, get: function () { return inbox_2.telegramInboxWebhook; } });
Object.defineProperty(exports, "emailInboxWebhook", { enumerable: true, get: function () { return inbox_2.emailInboxWebhook; } });
Object.defineProperty(exports, "applyInboxChannelConfig", { enumerable: true, get: function () { return inbox_2.applyInboxChannelConfig; } });
Object.defineProperty(exports, "sendInboxReply", { enumerable: true, get: function () { return inbox_2.sendInboxReply; } });
// ── Search Analytics ──────────────────────────────────────────────────────────
var search_analytics_1 = require("./search-analytics");
Object.defineProperty(exports, "onSearchEventCreated", { enumerable: true, get: function () { return search_analytics_1.onSearchEventCreated; } });
Object.defineProperty(exports, "backfillSearchEventsToBigQuery", { enumerable: true, get: function () { return search_analytics_1.backfillSearchEventsToBigQuery; } });
Object.defineProperty(exports, "querySearchAnalytics", { enumerable: true, get: function () { return search_analytics_1.querySearchAnalytics; } });
// ── Customer Analytics ────────────────────────────────────────────────────────
var customer_analytics_1 = require("./customer-analytics");
Object.defineProperty(exports, "queryCustomerInsights", { enumerable: true, get: function () { return customer_analytics_1.queryCustomerInsights; } });
Object.defineProperty(exports, "queryCohortAnalysis", { enumerable: true, get: function () { return customer_analytics_1.queryCohortAnalysis; } });
Object.defineProperty(exports, "queryCustomerMetrics", { enumerable: true, get: function () { return customer_analytics_1.queryCustomerMetrics; } });
Object.defineProperty(exports, "queryCustomerSegmentation", { enumerable: true, get: function () { return customer_analytics_1.queryCustomerSegmentation; } });
Object.defineProperty(exports, "queryPeriodData", { enumerable: true, get: function () { return customer_analytics_1.queryPeriodData; } });
Object.defineProperty(exports, "queryGrowthMetrics", { enumerable: true, get: function () { return customer_analytics_1.queryGrowthMetrics; } });
// ── Pricing & Costs (OmniEuro) ────────────────────────────────────────────────
var pricing_1 = require("./pricing");
Object.defineProperty(exports, "processPricingUpload", { enumerable: true, get: function () { return pricing_1.processPricingUpload; } });
Object.defineProperty(exports, "commitPricingSimulation", { enumerable: true, get: function () { return pricing_1.commitPricingSimulation; } });
//# sourceMappingURL=index.js.map