/**
 * shared.ts
 * Single source of truth for module-level singletons used across all functions modules.
 *
 * IMPORTANT: admin.initializeApp() is called in index.ts BEFORE any module is imported.
 * This file must NOT call initializeApp(). It only reads the already-initialized instance.
 */

import * as admin from 'firebase-admin';
import { BigQuery } from '@google-cloud/bigquery';

/** Firestore database reference — shared across all modules */
export const db = admin.firestore();

/** BigQuery client — shared across analytics modules */
export const bigquery = new BigQuery();

// ── Config cache ───────────────────────────────────────────────────────────────
// Prevents config/integrations from being read on every function invocation.
// Module-level variables persist across warm invocations within the same instance.

let _cachedIntegrations: any = null;
let _cacheExpiresAt = 0;
const CONFIG_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/** Returns config/integrations with 5-minute in-memory caching */
export async function getIntegrationsConfig(): Promise<any> {
    if (_cachedIntegrations && Date.now() < _cacheExpiresAt) {
        return _cachedIntegrations;
    }
    const snap = await db.collection('config').doc('integrations').get();
    _cachedIntegrations = snap.data() ?? {};
    _cacheExpiresAt = Date.now() + CONFIG_CACHE_TTL_MS;
    return _cachedIntegrations;
}

/** Invalidate cache after writes that mutate config/integrations */
export function invalidateIntegrationsCache() {
    _cachedIntegrations = null;
    _cacheExpiresAt = 0;
}
