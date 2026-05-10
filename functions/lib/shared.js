"use strict";
/**
 * shared.ts
 * Single source of truth for module-level singletons used across all functions modules.
 *
 * IMPORTANT: admin.initializeApp() is called in index.ts BEFORE any module is imported.
 * This file must NOT call initializeApp(). It only reads the already-initialized instance.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.invalidateIntegrationsCache = exports.getIntegrationsConfig = exports.bigquery = exports.db = void 0;
const admin = require("firebase-admin");
const bigquery_1 = require("@google-cloud/bigquery");
/** Firestore database reference — shared across all modules */
exports.db = admin.firestore();
/** BigQuery client — shared across analytics modules */
exports.bigquery = new bigquery_1.BigQuery();
// ── Config cache ───────────────────────────────────────────────────────────────
// Prevents config/integrations from being read on every function invocation.
// Module-level variables persist across warm invocations within the same instance.
let _cachedIntegrations = null;
let _cacheExpiresAt = 0;
const CONFIG_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
/** Returns config/integrations with 5-minute in-memory caching */
async function getIntegrationsConfig() {
    var _a;
    if (_cachedIntegrations && Date.now() < _cacheExpiresAt) {
        return _cachedIntegrations;
    }
    const snap = await exports.db.collection('config').doc('integrations').get();
    _cachedIntegrations = (_a = snap.data()) !== null && _a !== void 0 ? _a : {};
    _cacheExpiresAt = Date.now() + CONFIG_CACHE_TTL_MS;
    return _cachedIntegrations;
}
exports.getIntegrationsConfig = getIntegrationsConfig;
/** Invalidate cache after writes that mutate config/integrations */
function invalidateIntegrationsCache() {
    _cachedIntegrations = null;
    _cacheExpiresAt = 0;
}
exports.invalidateIntegrationsCache = invalidateIntegrationsCache;
//# sourceMappingURL=shared.js.map