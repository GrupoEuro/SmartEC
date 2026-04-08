const admin = require('firebase-admin');

// Uses Application Default Credentials (firebase login --reauth sets these up)
admin.initializeApp({ projectId: 'tiendapraxis' });
const db = admin.firestore();

async function run() {
    const snap = await db.collection('products').orderBy('createdAt', 'asc').get();
    console.log('Total products:', snap.size, '\n');

    const rows = [];
    snap.forEach(doc => {
        const d = doc.data();
        const date = d.createdAt?.toDate?.() ?? new Date(0);
        const dateStr = date instanceof Date ? date.toISOString().slice(0, 10) : 'N/A';
        rows.push({
            id: doc.id,
            date: dateStr,
            sku: d.sku || 'NO-SKU',
            brand: d.brand || '',
            active: d.active === undefined ? 'UNDEFINED' : String(d.active),
            name: (d.name?.es || d.name?.en || '').substring(0, 40),
            publishStatus: d.publishStatus || 'N/A',
            tags: Array.isArray(d.tags) ? d.tags.join(',') : ''
        });
    });

    // Group by date
    const byDate = {};
    rows.forEach(r => {
        if (!byDate[r.date]) byDate[r.date] = [];
        byDate[r.date].push(r);
    });

    Object.keys(byDate).sort().forEach(date => {
        console.log(`\n=== ${date} (${byDate[date].length} products) ===`);
        byDate[date].forEach(r => {
            const activeFlag = r.active === 'UNDEFINED' ? '⚠ NO-FIELD' : r.active === 'false' ? '✗ FALSE' : '✓ true';
            console.log(`  [${activeFlag}] ${r.sku.padEnd(24)} ${r.brand.padEnd(14)} "${r.name}"`);
            if (r.tags.includes('stub') || r.tags.includes('test') || r.tags.includes('seed')) {
                console.log(`               ⚑ TAGS: ${r.tags}`);
            }
        });
    });

    // Summary
    const hasNoActive = rows.filter(r => r.active === 'UNDEFINED');
    const hasTrue     = rows.filter(r => r.active === 'true');
    const hasFalse    = rows.filter(r => r.active === 'false');
    console.log('\n=== SUMMARY ===');
    console.log(`  active: true      → ${hasTrue.length} products`);
    console.log(`  active: false     → ${hasFalse.length} products`);
    console.log(`  active: MISSING   → ${hasNoActive.length} products (legacy, treated as active in storefront)`);
}

run().catch(console.error).finally(() => process.exit(0));
