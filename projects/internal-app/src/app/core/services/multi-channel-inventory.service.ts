import { Injectable, inject } from '@angular/core';
import {
    Firestore,
    collection,
    getDocs,
    query,
    where,
    orderBy,
    Timestamp,
} from '@angular/fire/firestore';

// ─── Channel constants ────────────────────────────────────────────────────────

export const CHANNELS = {
    MELI_FULL:  { id: 'MELI_FULL',  label: 'MercadoLibre Full', shortLabel: 'MeliFull',   color: '#f5a623', bgClass: 'channel-meli',   icon: 'shopping-bag' },
    AMAZON_FBA: { id: 'AMAZON_FBA', label: 'Amazon FBA',        shortLabel: 'Amazon FBA',  color: '#00a8e1', bgClass: 'channel-amazon', icon: 'package' },
    MAIN:       { id: 'MAIN',       label: 'Almacén Principal',  shortLabel: 'Principal',   color: '#10b981', bgClass: 'channel-main',   icon: 'home' },
} as const;

export type ChannelId = keyof typeof CHANNELS;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ChannelStock {
    channelId: ChannelId;
    label: string;
    shortLabel: string;
    color: string;
    bgClass: string;
    icon: string;

    // Stock
    currentStock: number;
    reserved: number;
    available: number;

    // Velocity / Sales
    salesVelocity30d: number;   // units/day over 30-day window
    salesVelocity7d: number;    // units/day over 7-day window
    unitsSold30d: number;
    unitsSold7d: number;

    // Replenishment
    reorderPoint: number;
    reorderQuantity: number;    // suggested order qty
    daysOfCoverage: number;     // days until stockout at current velocity
    projectedStockoutDate: string | null;

    // Status
    urgencyLevel: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'OK';
    reorderAlertLevel: string;

    // MeLi-specific (only for MELI_FULL)
    mlItemId?: string;
    permalink?: string;
    thumbnail?: string;
    price?: number;
}

export interface ChannelInventoryItem {
    sku: string;
    title: string;
    productId: string | null;

    channels: Partial<Record<ChannelId, ChannelStock>>;

    // Aggregated totals
    totalStock: number;
    totalSold30d: number;
    combinedVelocity30d: number;
    worstUrgency: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'OK';
    worstDaysOfCoverage: number;

    // Cost
    unitCost: number | null;
    estimatedReplenishCost: number;
}

export interface ReplenishmentSummary {
    items: ChannelInventoryItem[];
    byChannel: Record<ChannelId, { items: number; critical: number; high: number; totalReplenishCost: number }>;
    lastRefreshed: Date;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function urgencyFromDays(days: number): 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'OK' {
    if (days <= 0)   return 'CRITICAL';
    if (days < 7)    return 'CRITICAL';
    if (days < 14)   return 'HIGH';
    if (days < 30)   return 'MEDIUM';
    if (days < 60)   return 'LOW';
    return 'OK';
}

function worstUrgency(levels: ('CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'OK')[]): 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'OK' {
    const order: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, OK: 4 };
    return levels.sort((a, b) => order[a] - order[b])[0] ?? 'OK';
}

function getFieldValue(fields: Record<string, any>, key: string): any {
    const f = fields[key];
    if (!f) return undefined;
    return f.integerValue !== undefined ? Number(f.integerValue)
         : f.doubleValue  !== undefined ? Number(f.doubleValue)
         : f.stringValue  !== undefined ? f.stringValue
         : f.booleanValue !== undefined ? f.booleanValue
         : f.timestampValue !== undefined ? f.timestampValue
         : undefined;
}

// ─── Service ─────────────────────────────────────────────────────────────────

@Injectable({ providedIn: 'root' })
export class MultiChannelInventoryService {
    private firestore = inject(Firestore);

    /**
     * Main entry point — loads all channels and returns a unified replenishment view.
     */
    async loadReplenishmentData(): Promise<ReplenishmentSummary> {
        const [meliItems, balanceItems, ledgerCosts] = await Promise.all([
            this.loadMeliFbmInventory(),
            this.loadInventoryBalances(),
            this.loadAverageCostsFromLedger(),
        ]);

        // Build unified item map keyed by SKU
        const itemMap = new Map<string, ChannelInventoryItem>();

        // 1. MeliFull items (highest data quality — has real velocity)
        for (const meli of meliItems) {
            const sku = meli.sku;
            if (!itemMap.has(sku)) {
                itemMap.set(sku, this.emptyItem(sku, meli.title, null));
            }
            const item = itemMap.get(sku)!;
            item.channels['MELI_FULL'] = meli.channelStock;
        }

        // 2. Inventory balances (MAIN + AMAZON_FBA + MELI_FULL from structured collection)
        for (const bal of balanceItems) {
            const { sku, channelId, channelStock } = bal;
            const key = sku;

            if (!itemMap.has(key)) {
                itemMap.set(key, this.emptyItem(sku, sku, sku));
            }
            const item = itemMap.get(key)!;

            // Only add if channel not already populated by higher-quality source
            if (!item.channels[channelId] || channelId !== 'MELI_FULL') {
                item.channels[channelId] = channelStock;
            }
        }

        // 3. Enrich with unit costs from ledger
        for (const [productId, cost] of ledgerCosts) {
            for (const item of itemMap.values()) {
                if (item.productId === productId) {
                    item.unitCost = cost;
                }
            }
        }

        // 4. Compute aggregated fields
        const allItems: ChannelInventoryItem[] = [];
        for (const item of itemMap.values()) {
            this.computeAggregates(item);
            allItems.push(item);
        }

        // Sort: worst urgency first, then fewest days of coverage
        const urgencyOrder: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, OK: 4 };
        allItems.sort((a, b) => {
            const uDiff = urgencyOrder[a.worstUrgency] - urgencyOrder[b.worstUrgency];
            if (uDiff !== 0) return uDiff;
            return a.worstDaysOfCoverage - b.worstDaysOfCoverage;
        });

        // 5. Build per-channel summaries
        const byChannel = {} as Record<ChannelId, { items: number; critical: number; high: number; totalReplenishCost: number }>;
        for (const chId of Object.keys(CHANNELS) as ChannelId[]) {
            const chItems = allItems.filter(i => i.channels[chId]);
            byChannel[chId] = {
                items: chItems.length,
                critical: chItems.filter(i => i.channels[chId]?.urgencyLevel === 'CRITICAL').length,
                high:     chItems.filter(i => i.channels[chId]?.urgencyLevel === 'HIGH').length,
                totalReplenishCost: chItems.reduce((s, i) => {
                    const ch = i.channels[chId];
                    if (!ch || !i.unitCost) return s;
                    return s + (ch.reorderQuantity * i.unitCost);
                }, 0),
            };
        }

        return { items: allItems, byChannel, lastRefreshed: new Date() };
    }

    // ─── Private: Load MeliFull Inventory ──────────────────────────────────

    private async loadMeliFbmInventory(): Promise<{ sku: string; title: string; channelStock: ChannelStock }[]> {
        const snap = await getDocs(collection(this.firestore, 'meli_fbm_inventory'));
        const results: { sku: string; title: string; channelStock: ChannelStock }[] = [];

        snap.forEach(doc => {
            const d = doc.data();
            const sku   = d['sku']   || doc.id;
            const title = d['title'] || sku;

            const available  = Number(d['availableQuantity'] ?? d['fullStock'] ?? 0);
            const reserved   = Number(d['fullStockReserved'] ?? 0);
            const vel30d     = Number(d['salesVelocity30d']  ?? 0);
            const vel7d      = Number(d['salesVelocity7d']   ?? 0);
            const sold30d    = Number(d['unitsSold30d']      ?? 0);
            const sold7d     = Number(d['unitsSold7d']       ?? 0);
            const days       = Number(d['daysOfCoverage']    ?? (vel30d > 0 ? available / vel30d : 9999));
            const rop        = Number(d['reorderPoint']      ?? 0);
            const repQty     = Number(d['recommendedReplenishQty'] ?? 0);
            const alertRaw   = String(d['reorderAlertLevel'] ?? 'ok');
            const stockout   = d['projectedStockoutDate'] || null;
            const urgency    = urgencyFromDays(days);

            results.push({
                sku,
                title,
                channelStock: {
                    channelId: 'MELI_FULL',
                    ...CHANNELS['MELI_FULL'],
                    currentStock: available + reserved,
                    reserved,
                    available,
                    salesVelocity30d: vel30d,
                    salesVelocity7d: vel7d,
                    unitsSold30d: sold30d,
                    unitsSold7d: sold7d,
                    reorderPoint: rop,
                    reorderQuantity: repQty,
                    daysOfCoverage: days >= 9999 ? 9999 : Math.round(days),
                    projectedStockoutDate: stockout,
                    urgencyLevel: urgency,
                    reorderAlertLevel: alertRaw,
                    mlItemId:   d['mlItemId'],
                    permalink:  d['permalink'],
                    thumbnail:  d['thumbnail'],
                    price:      d['price'] ? Number(d['price']) : undefined,
                },
            });
        });

        return results;
    }

    // ─── Private: Load Inventory Balances ──────────────────────────────────

    private async loadInventoryBalances(): Promise<{ sku: string; channelId: ChannelId; channelStock: ChannelStock }[]> {
        const snap = await getDocs(collection(this.firestore, 'inventory_balances'));
        const results: { sku: string; channelId: ChannelId; channelStock: ChannelStock }[] = [];

        snap.forEach(doc => {
            const d       = doc.data();
            const prodId  = String(d['productId'] || doc.id);
            const locId   = String(d['locationId'] || '');

            // Map locationId to ChannelId
            const channelId = (locId === 'MELI_FULL' ? 'MELI_FULL' : locId === 'AMAZON_FBA' ? 'AMAZON_FBA' : locId === 'MAIN' ? 'MAIN' : null) as ChannelId | null;
            if (!channelId || !(channelId in CHANNELS)) return;

            const available  = Number(d['available'] ?? 0);
            const reserved   = Number(d['reserved']  ?? 0);
            const onHand     = Number(d['onHand']    ?? available + reserved);
            const rop        = Number(d['reorderPoint']   ?? 0);
            const repQty     = Number(d['reorderQuantity'] ?? 0);

            // For balance records we don't have velocity — derive urgency from stock vs ROP
            const days    = rop > 0 && available <= rop ? Math.round((available / Math.max(rop / 30, 0.1))) : 9999;
            const urgency = available === 0 ? 'CRITICAL' : available <= rop ? 'HIGH' : 'OK';

            results.push({
                sku: prodId,        // using productId as SKU key for balance records
                channelId,
                channelStock: {
                    channelId,
                    ...CHANNELS[channelId],
                    currentStock: onHand,
                    reserved,
                    available,
                    salesVelocity30d: 0,   // not available in balances collection
                    salesVelocity7d: 0,
                    unitsSold30d: 0,
                    unitsSold7d: 0,
                    reorderPoint: rop,
                    reorderQuantity: repQty,
                    daysOfCoverage: days,
                    projectedStockoutDate: null,
                    urgencyLevel: urgency as any,
                    reorderAlertLevel: urgency === 'CRITICAL' ? 'critical' : urgency === 'HIGH' ? 'low' : 'ok',
                },
            });
        });

        return results;
    }

    // ─── Private: Average Costs from Ledger ────────────────────────────────

    private async loadAverageCostsFromLedger(): Promise<Map<string, number>> {
        const costs = new Map<string, number>();
        try {
            const snap = await getDocs(collection(this.firestore, 'inventory_ledger'));
            // Get latest averageCostAfter per productId
            const latest = new Map<string, { date: string; cost: number }>();
            snap.forEach(doc => {
                const d = doc.data();
                const pid  = String(d['productId'] || '');
                const cost = Number(d['averageCostAfter'] ?? d['unitCost'] ?? 0);
                const date = String(d['createdAt'] || d['date'] || d['timestamp'] || '');
                if (!pid || !cost) return;
                const existing = latest.get(pid);
                if (!existing || date > existing.date) {
                    latest.set(pid, { date, cost });
                }
            });
            for (const [pid, { cost }] of latest) {
                costs.set(pid, cost);
            }
        } catch (_) { /* ledger may be empty */ }
        return costs;
    }

    // ─── Helpers ───────────────────────────────────────────────────────────

    private emptyItem(sku: string, title: string, productId: string | null): ChannelInventoryItem {
        return {
            sku, title, productId,
            channels: {},
            totalStock: 0,
            totalSold30d: 0,
            combinedVelocity30d: 0,
            worstUrgency: 'OK',
            worstDaysOfCoverage: 9999,
            unitCost: null,
            estimatedReplenishCost: 0,
        };
    }

    private computeAggregates(item: ChannelInventoryItem): void {
        const channels = Object.values(item.channels) as ChannelStock[];
        if (!channels.length) return;

        item.totalStock         = channels.reduce((s, c) => s + c.currentStock, 0);
        item.totalSold30d       = channels.reduce((s, c) => s + c.unitsSold30d, 0);
        item.combinedVelocity30d = channels.reduce((s, c) => s + c.salesVelocity30d, 0);

        const urgencies = channels.map(c => c.urgencyLevel);
        item.worstUrgency = worstUrgency(urgencies);

        const finiteDays = channels.map(c => c.daysOfCoverage).filter(d => d < 9999);
        item.worstDaysOfCoverage = finiteDays.length ? Math.min(...finiteDays) : 9999;

        if (item.unitCost) {
            const totalReplenish = channels.reduce((s, c) => s + c.reorderQuantity, 0);
            item.estimatedReplenishCost = totalReplenish * item.unitCost;
        }
    }

    // ─── Utility formatters ────────────────────────────────────────────────

    formatVelocity(vel: number): string {
        if (!vel || vel <= 0) return '—';
        if (vel < 1) return `${(vel * 30).toFixed(0)}/mes`;
        return `${vel.toFixed(2)}/día`;
    }

    formatDays(days: number): string {
        if (days >= 9999) return '∞';
        if (days <= 0) return 'AGOTADO';
        return `${days}d`;
    }

    urgencyLabel(level: string): string {
        const map: Record<string, string> = {
            CRITICAL: 'CRÍTICO', HIGH: 'ALTO', MEDIUM: 'MEDIO', LOW: 'BAJO', OK: 'OK',
        };
        return map[level] ?? level;
    }
}
