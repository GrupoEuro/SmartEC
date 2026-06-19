/**
 * scratch-cancelled-returned.js
 * 
 * Queries Firestore for all 'cancelled' and 'returned' / 'refunded' / 'refund_pending'
 * orders and produces a detailed breakdown by channel, month and reason.
 * 
 * Auth: uses /Users/SaulFigueroa/firebase-service-account.json
 */

const admin = require('firebase-admin');
const serviceAccount = require('/Users/SaulFigueroa/firebase-service-account.json');

if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}
const db = admin.firestore();

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toDate(val) {
    if (!val) return null;
    if (typeof val.toDate === 'function') return val.toDate();
    if (val._seconds !== undefined) return new Date(val._seconds * 1000);
    return new Date(val);
}

function fmtDate(d) {
    if (!d) return 'N/A';
    return d.toISOString().slice(0, 10);
}

function monthKey(d) {
    if (!d) return 'N/A';
    return d.toISOString().slice(0, 7); // YYYY-MM
}

function fmt(n) {
    return n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
    const STATUSES = ['cancelled', 'returned', 'refunded', 'refund_pending'];
    
    console.log('\n=== QUERYING CANCELLED / RETURNED / REFUNDED ORDERS ===\n');
    console.log('Statuses:', STATUSES.join(', '));
    console.log('Fetching from Firestore...\n');

    const allOrders = [];
    
    for (const status of STATUSES) {
        const snap = await db.collection('orders')
            .where('status', '==', status)
            .orderBy('createdAt', 'desc')
            .get();
        
        snap.forEach(doc => {
            allOrders.push({ id: doc.id, ...doc.data() });
        });
        console.log(`  status="${status}" → ${snap.size} orders`);
    }

    console.log(`\nTotal docs fetched: ${allOrders.length}\n`);

    // ─── Aggregate ──────────────────────────────────────────────────────────

    const byStatus  = {};
    const byChannel = {};
    const byMonth   = {};

    let grandTotal        = 0;
    let grandTotalRevenue = 0;

    for (const o of allOrders) {
        const status  = o.status || 'unknown';
        const channel = o.sourceChannel || 'storefront';
        const createdAt = toDate(o.createdAt);
        const mk        = monthKey(createdAt);
        const total     = o.total || 0;
        const reason    = o.cancellationReason || o.returnReason || o.refundReason || o.reason || '—';

        grandTotal++;
        grandTotalRevenue += total;

        if (!byStatus[status]) byStatus[status] = { count: 0, revenue: 0, orders: [] };
        byStatus[status].count++;
        byStatus[status].revenue += total;
        byStatus[status].orders.push({
            id: o.id,
            total,
            createdAt: fmtDate(createdAt),
            channel,
            reason: String(reason).slice(0, 70),
            orderNumber: o.orderNumber || o.meliOrderId || ''
        });

        if (!byChannel[channel]) byChannel[channel] = {};
        if (!byChannel[channel][status]) byChannel[channel][status] = { count: 0, revenue: 0 };
        byChannel[channel][status].count++;
        byChannel[channel][status].revenue += total;

        if (!byMonth[mk]) byMonth[mk] = {};
        if (!byMonth[mk][status]) byMonth[mk][status] = { count: 0, revenue: 0 };
        byMonth[mk][status].count++;
        byMonth[mk][status].revenue += total;
    }

    // ─── Print: Summary ─────────────────────────────────────────────────────
    console.log('══════════════════════════════════════════════════════════════════');
    console.log(' RESUMEN GENERAL');
    console.log('══════════════════════════════════════════════════════════════════');
    console.log(`  Total órdenes (cancelled + returned/refunded):  ${grandTotal}`);
    console.log(`  Valor total involucrado:                        $${fmt(grandTotalRevenue)}`);
    console.log('');

    // ─── Print: By Status ────────────────────────────────────────────────────
    console.log('──────────────────────────────────────────────────────────────────');
    console.log(' POR STATUS  (cancelado vs devuelto/reembolsado)');
    console.log('──────────────────────────────────────────────────────────────────');
    for (const [status, data] of Object.entries(byStatus).sort((a, b) => b[1].count - a[1].count)) {
        const pct = ((data.count / grandTotal) * 100).toFixed(1);
        console.log(`  ${status.padEnd(18)} ${String(data.count).padStart(5)} órdenes  (${pct}%)   $${fmt(data.revenue)}`);
    }
    console.log('');

    // ─── Print: By Channel ────────────────────────────────────────────────────
    console.log('──────────────────────────────────────────────────────────────────');
    console.log(' POR CANAL × STATUS');
    console.log('──────────────────────────────────────────────────────────────────');
    for (const [channel, statuses] of Object.entries(byChannel).sort()) {
        let channelTotal = 0;
        for (const s of Object.values(statuses)) channelTotal += s.count;
        console.log(`\n  📦 ${channel.toUpperCase()}  (${channelTotal} total)`);
        for (const [st, data] of Object.entries(statuses).sort((a, b) => b[1].count - a[1].count)) {
            console.log(`     ${st.padEnd(18)} ${String(data.count).padStart(4)}  $${fmt(data.revenue)}`);
        }
    }
    console.log('');

    // ─── Print: By Month ─────────────────────────────────────────────────────
    console.log('──────────────────────────────────────────────────────────────────');
    console.log(' POR MES (más reciente primero)');
    console.log('──────────────────────────────────────────────────────────────────');
    const sortedMonths = Object.keys(byMonth).filter(k => k !== 'N/A').sort().reverse();
    for (const mk of sortedMonths) {
        const statusMap = byMonth[mk];
        let monthTotal = 0, monthRevenue = 0;
        for (const d of Object.values(statusMap)) { monthTotal += d.count; monthRevenue += d.revenue; }

        const parts = Object.entries(statusMap)
            .sort((a, b) => b[1].count - a[1].count)
            .map(([st, d]) => `${st}=${d.count}`)
            .join('  ');

        console.log(`  ${mk}   total=${String(monthTotal).padStart(4)}  $${fmt(monthRevenue).padStart(12)}    [${parts}]`);
    }
    console.log('');

    // ─── Print: Full detail of Returns/Refunds ────────────────────────────────
    const returnStatuses = ['returned', 'refunded', 'refund_pending'];
    for (const st of returnStatuses) {
        if (!byStatus[st] || byStatus[st].count === 0) continue;
        console.log('──────────────────────────────────────────────────────────────────');
        console.log(` DETALLE COMPLETO: ${st.toUpperCase()} (${byStatus[st].count} órdenes)`);
        console.log('──────────────────────────────────────────────────────────────────');
        console.log(`  ${'ID / OrderNumber'.padEnd(38)} ${'Fecha'.padEnd(12)} ${'Canal'.padEnd(16)} ${'Total'.padStart(12)}  Razón`);
        const sorted = [...byStatus[st].orders].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        for (const o of sorted) {
            const display = (o.orderNumber || o.id).slice(0, 36);
            console.log(`  ${display.padEnd(38)} ${o.createdAt.padEnd(12)} ${o.channel.padEnd(16)} ${('$' + fmt(o.total)).padStart(12)}  ${o.reason}`);
        }
        console.log('');
    }

    // ─── Print: Cancellation reasons breakdown ─────────────────────────────────
    if (byStatus['cancelled'] && byStatus['cancelled'].count > 0) {
        console.log('──────────────────────────────────────────────────────────────────');
        console.log(` RAZONES DE CANCELACIÓN (de ${byStatus['cancelled'].count} órdenes canceladas)`);
        console.log('──────────────────────────────────────────────────────────────────');
        const reasonCounts = {};
        for (const o of byStatus['cancelled'].orders) {
            const r = String(o.reason || '(sin razón registrada)').trim();
            reasonCounts[r] = (reasonCounts[r] || 0) + 1;
        }
        const sortedReasons = Object.entries(reasonCounts).sort((a, b) => b[1] - a[1]);
        for (const [reason, count] of sortedReasons) {
            const pct = ((count / byStatus['cancelled'].count) * 100).toFixed(1);
            console.log(`  ${String(count).padStart(5)}×  (${pct.padStart(5)}%)  ${reason}`);
        }
        console.log('');

        console.log('──────────────────────────────────────────────────────────────────');
        console.log(` MUESTRA: 25 CANCELACIONES MÁS RECIENTES`);
        console.log('──────────────────────────────────────────────────────────────────');
        console.log(`  ${'ID / OrderNumber'.padEnd(38)} ${'Fecha'.padEnd(12)} ${'Canal'.padEnd(16)} ${'Total'.padStart(12)}  Razón`);
        const recentCancelled = [...byStatus['cancelled'].orders]
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
            .slice(0, 25);
        for (const o of recentCancelled) {
            const display = (o.orderNumber || o.id).slice(0, 36);
            console.log(`  ${display.padEnd(38)} ${o.createdAt.padEnd(12)} ${o.channel.padEnd(16)} ${('$' + fmt(o.total)).padStart(12)}  ${o.reason}`);
        }
    }

    console.log('\n══════════════════════════════════════════════════════════════════');
    console.log(' FIN DEL REPORTE');
    console.log('══════════════════════════════════════════════════════════════════\n');

    process.exit(0);
}

main().catch(err => {
    console.error('\nFatal error:', err.message || err);
    process.exit(1);
});
