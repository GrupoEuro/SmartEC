/**
 * sku-audit.js
 * Scans all Firestore meli_ orders and reports SKU coverage.
 * Run: node scripts/sku-audit.js
 */

const admin = require('firebase-admin');
const serviceAccount = require('../service-account.json');

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

async function main() {
    console.log('🔍 Scanning Firestore meli_ orders for SKU coverage...\n');

    const snap = await db.collection('orders')
        .where('sourceChannel', '==', 'mercadolibre')
        .orderBy('createdAt', 'desc')
        .limit(2000)
        .get();

    console.log(`📦 Total MeLi orders scanned: ${snap.size}\n`);

    let totalItems    = 0;
    let withSku       = 0;
    let withoutSku    = 0;

    const skuMap      = new Map(); // sku → { count, productName, productId, lastSeen }
    const emptyItems  = [];        // sample of items with no SKU
    const ordersWithSku    = new Set();
    const ordersWithoutSku = new Set();

    snap.forEach(doc => {
        const d    = doc.data();
        const items = d.items || [];
        let orderHasSku = false;

        for (const item of items) {
            totalItems++;
            const sku = (item.sku || '').trim();

            if (sku) {
                withSku++;
                orderHasSku = true;
                if (!skuMap.has(sku)) {
                    skuMap.set(sku, {
                        sku,
                        count:       0,
                        productName: item.productName || item.name || '',
                        productId:   item.productId  || '',
                        lastSeen:    d.createdAt?.toDate?.()?.toISOString?.() ?? 'unknown',
                    });
                }
                const entry = skuMap.get(sku);
                entry.count++;
            } else {
                withoutSku++;
                if (emptyItems.length < 10) {
                    emptyItems.push({
                        orderId:     doc.id,
                        productId:   item.productId || '',
                        productName: item.productName || item.name || '',
                        date:        d.createdAt?.toDate?.()?.toISOString?.().slice(0, 10) ?? '?',
                    });
                }
            }
        }

        if (orderHasSku) ordersWithSku.add(doc.id);
        else             ordersWithoutSku.add(doc.id);
    });

    // ── Summary ────────────────────────────────────────────────────────────────
    const skuPct = totalItems ? Math.round(withSku / totalItems * 100) : 0;
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`📊 ITEM-LEVEL SKU COVERAGE`);
    console.log(`   Total items          : ${totalItems}`);
    console.log(`   ✅ With SKU          : ${withSku}  (${skuPct}%)`);
    console.log(`   ❌ Without SKU       : ${withoutSku}  (${100 - skuPct}%)`);
    console.log(`   Unique SKUs found    : ${skuMap.size}`);
    console.log('');
    console.log(`🛒 ORDER-LEVEL`);
    console.log(`   Orders with ≥1 SKU  : ${ordersWithSku.size}`);
    console.log(`   Orders with 0 SKUs  : ${ordersWithoutSku.size}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // ── Top SKUs by frequency ──────────────────────────────────────────────────
    const sorted = [...skuMap.values()].sort((a, b) => b.count - a.count);
    console.log('🏆 TOP 30 SKUs BY ORDER FREQUENCY:\n');
    console.log('  SKU                          | Qty  | MeLi Listing ID   | Product Name');
    console.log('  -----------------------------|------|-------------------|---------------------------------');
    sorted.slice(0, 30).forEach(s => {
        const skuPad  = s.sku.padEnd(28);
        const cntPad  = String(s.count).padEnd(4);
        const idPad   = s.productId.padEnd(17);
        const name    = s.productName.slice(0, 50);
        console.log(`  ${skuPad} | ${cntPad} | ${idPad} | ${name}`);
    });

    // ── All unique SKUs (alphabetical) ─────────────────────────────────────────
    const alpha = [...skuMap.values()].sort((a, b) => a.sku.localeCompare(b.sku));
    console.log(`\n📋 ALL ${skuMap.size} UNIQUE SKUs (alphabetical):\n`);
    alpha.forEach(s => {
        console.log(`  [${s.sku}]  qty:${s.count}  listing:${s.productId}  "${s.productName.slice(0, 60)}"`);
    });

    // ── Sample of items with no SKU ────────────────────────────────────────────
    if (emptyItems.length) {
        console.log(`\n⚠️  SAMPLE ITEMS WITH NO SKU (first ${emptyItems.length}):\n`);
        emptyItems.forEach(e => {
            console.log(`  [${e.date}] order:${e.orderId}  listing:${e.productId}  "${e.productName.slice(0, 60)}"`);
        });
    }

    console.log('\n✅ Done.\n');
    process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
