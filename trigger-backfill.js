/**
 * One-time backfill trigger script.
 * Calls backfillMonthlyStats via Admin SDK to avoid needing user auth.
 * Run: node trigger-backfill.js
 */
const admin = require('firebase-admin');

admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    projectId: 'tiendapraxis'
});
const db = admin.firestore();

async function backfill(fromMonth, toMonth) {
    const months = [];
    let [year, mon] = fromMonth.split('-').map(Number);
    const [toYear, toMon] = toMonth.split('-').map(Number);
    while (year < toYear || (year === toYear && mon <= toMon)) {
        months.push(`${year}-${String(mon).padStart(2, '0')}`);
        mon++;
        if (mon > 12) { mon = 1; year++; }
    }

    for (const monthStr of months) {
        const [y, m] = monthStr.split('-').map(Number);
        const startDate = new Date(y, m - 1, 1, 0, 0, 0, 0);
        const endDate   = new Date(y, m,     0, 23, 59, 59, 999);

        console.log(`\n── Processing ${monthStr} (${startDate.toDateString()} → ${endDate.toDateString()}) ──`);

        const snap = await db.collection('orders')
            .where('createdAt', '>=', admin.firestore.Timestamp.fromDate(startDate))
            .where('createdAt', '<=', admin.firestore.Timestamp.fromDate(endDate))
            .get();

        console.log(`  Found ${snap.size} documents`);

        const dayMap = {};
        let monthSales = 0, monthOrders = 0, monthPieces = 0;

        snap.docs.forEach(docSnap => {
            const order = docSnap.data();
            if (['cancelled', 'refunded', 'returned'].includes(order.status)) return;

            const orderDate = order.createdAt?.toDate?.() ?? new Date();
            const dayKey = String(orderDate.getDate()).padStart(2, '0');
            const total  = Number(order.total ?? 0);
            const pieces = (order.items ?? []).reduce((s, item) => s + (Number(item.quantity) || 1), 0);

            if (!dayMap[dayKey]) dayMap[dayKey] = { sales: 0, orders: 0, pieces: 0 };
            dayMap[dayKey].sales  += total;
            dayMap[dayKey].orders += 1;
            dayMap[dayKey].pieces += pieces;
            monthSales  += total;
            monthOrders += 1;
            monthPieces += pieces;
        });

        const monthRef = db.collection('monthly_stats').doc(monthStr);
        const batch = db.batch();

        batch.set(monthRef, {
            month: monthStr,
            sales: monthSales,
            orders: monthOrders,
            pieces: monthPieces,
            backfilled: true,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });

        for (const [day, data] of Object.entries(dayMap)) {
            const dayRef = monthRef.collection('days').doc(day);
            batch.set(dayRef, {
                day, month: monthStr,
                sales: data.sales, orders: data.orders, pieces: data.pieces,
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
        }

        await batch.commit();
        console.log(`  ✅ ${monthStr}: ${monthOrders} orders | $${monthSales.toFixed(0)} MXN | ${Object.keys(dayMap).length} days`);
    }
    console.log('\n🎉 Backfill complete!');
}

backfill('2025-01', '2025-04').catch(err => {
    console.error('❌ Backfill failed:', err);
    process.exit(1);
}).finally(() => process.exit(0));
