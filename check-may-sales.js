/**
 * check-may-sales.js
 * 
 * Queries raw orders for May 2026 to verify if we hit $1,000,000 MXN.
 * Uses client SDK (same auth pattern as check_recent_financials.js).
 * 
 * Run: node check-may-sales.js
 */

const { initializeApp } = require('firebase/app');
const { getFirestore, collection, query, where, getDocs, orderBy } = require('firebase/firestore');

const firebaseConfig = {
    apiKey: "AIzaSyBL1qo-Ta4pW9sgx-CucJ4Uj9c_Bjef3a4",
    authDomain: "tiendapraxis.firebaseapp.com",
    projectId: "tiendapraxis",
    storageBucket: "tiendapraxis.firebasestorage.app",
    messagingSenderId: "320158502362",
    appId: "1:320158502362:web:e485f992f130d318bb04e3"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const NON_REVENUE = ['cancelled', 'refunded', 'returned', 'pending_payment', 'refund_pending', 'payment_failed'];

function fmt(n) {
    return n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function toLocalDate(ts) {
    if (!ts) return null;
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d;
}

async function main() {
    console.log('\n══════════════════════════════════════════════════════════════════');
    console.log(' VENTAS MAYO 2026 — VERIFICACIÓN');
    console.log('══════════════════════════════════════════════════════════════════\n');

    // May 2026 in CST (UTC-6): May 1 00:00 CST = May 1 06:00 UTC
    const MAY_START = new Date('2026-05-01T06:00:00.000Z');
    const MAY_END   = new Date('2026-06-01T05:59:59.999Z');

    console.log(`Querying orders from ${MAY_START.toISOString()} to ${MAY_END.toISOString()}`);
    console.log('Fetching...\n');

    const snap = await getDocs(query(
        collection(db, 'orders'),
        where('createdAt', '>=', MAY_START),
        where('createdAt', '<=', MAY_END),
        orderBy('createdAt', 'asc')
    ));

    console.log(`Total documents fetched: ${snap.size}\n`);

    let revenue = 0, orderCount = 0, unitCount = 0;
    const byStatus  = {};
    const byChannel = {};
    const byDay     = {};

    snap.forEach(doc => {
        const o = doc.data();
        const status  = o.status || 'unknown';
        const channel = o.sourceChannel || 'storefront';
        const createdAt = toLocalDate(o.createdAt);
        // Day key in local CST
        const localStr = createdAt
            ? new Date(createdAt.getTime() - 6 * 60 * 60 * 1000).toISOString().slice(0, 10)
            : 'unknown';

        byStatus[status] = (byStatus[status] || 0) + 1;

        if (!NON_REVENUE.includes(status)) {
            const total = o.total || 0;
            revenue += total;
            orderCount++;
            if (Array.isArray(o.items)) {
                o.items.forEach(item => { unitCount += item.quantity || 0; });
            }

            if (!byChannel[channel]) byChannel[channel] = { count: 0, revenue: 0 };
            byChannel[channel].count++;
            byChannel[channel].revenue += total;

            if (!byDay[localStr]) byDay[localStr] = { count: 0, revenue: 0 };
            byDay[localStr].count++;
            byDay[localStr].revenue += total;
        }
    });

    // ── Por día ───────────────────────────────────────────────────────────────
    console.log('POR DÍA (solo revenue):');
    console.log('  Fecha         Revenue          Pedidos   Acumulado');
    console.log('  ──────────── ───────────────── ──────── ─────────────────');
    let runningTotal = 0;
    for (const day of Object.keys(byDay).sort()) {
        const d = byDay[day];
        runningTotal += d.revenue;
        const milestone = runningTotal >= 1000000 ? ' 🏆 ¡MILLÓN!' : '';
        console.log(`  ${day}  $${fmt(d.revenue).padStart(15)}  ${String(d.count).padStart(7)}  $${fmt(runningTotal)}${milestone}`);
    }
    console.log('');

    // ── Por canal ─────────────────────────────────────────────────────────────
    console.log('POR CANAL:');
    for (const [ch, d] of Object.entries(byChannel).sort((a, b) => b[1].revenue - a[1].revenue)) {
        const pct = ((d.revenue / revenue) * 100).toFixed(1);
        console.log(`  ${ch.padEnd(20)} $${fmt(d.revenue).padStart(15)}  (${pct}%)  ${d.count} pedidos`);
    }
    console.log('');

    // ── Por status ────────────────────────────────────────────────────────────
    console.log('POR STATUS (todos los documentos):');
    for (const [st, count] of Object.entries(byStatus).sort((a, b) => b[1] - a[1])) {
        const tag = NON_REVENUE.includes(st) ? ' [excluido]' : '';
        console.log(`  ${st.padEnd(22)} ${String(count).padStart(5)}${tag}`);
    }
    console.log('');

    // ── Top 5 días ────────────────────────────────────────────────────────────
    const top5 = Object.entries(byDay).sort((a, b) => b[1].revenue - a[1].revenue).slice(0, 5);
    console.log('TOP 5 DÍAS POR VENTAS:');
    for (const [day, d] of top5) {
        console.log(`  ${day}   $${fmt(d.revenue).padStart(15)}   (${d.count} pedidos)`);
    }
    console.log('');

    // ── May 31 specifically ───────────────────────────────────────────────────
    const may31 = byDay['2026-05-31'] || { count: 0, revenue: 0 };
    console.log(`Mayo 31 (último día del mes): $${fmt(may31.revenue)} | ${may31.count} pedidos`);
    console.log('');

    // ── Final verdict ─────────────────────────────────────────────────────────
    console.log('══════════════════════════════════════════════════════════════════');
    console.log(` MAYO 2026 TOTAL (neto, sin cancelados/devoluciones):`);
    console.log(` Revenue:  $${fmt(revenue)}`);
    console.log(` Pedidos:  ${orderCount}`);
    console.log(` Unidades: ${unitCount}`);
    console.log('');
    if (revenue >= 1000000) {
        console.log(` 🏆 ¡SÍ LLEGAMOS AL MILLÓN! $${fmt(revenue)} MXN`);
        console.log(`    Superamos el millón por $${fmt(revenue - 1000000)}`);
    } else {
        console.log(` ❌ No llegamos al millón. $${fmt(revenue)} MXN`);
        console.log(`    Faltaron $${fmt(1000000 - revenue)}`);
    }
    console.log('══════════════════════════════════════════════════════════════════\n');

    process.exit(0);
}

main().catch(err => {
    console.error('\nFatal error:', err.message || err);
    process.exit(1);
});
