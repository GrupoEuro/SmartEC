const { OAuth2Client } = require('google-auth-library');
const { Firestore, FieldValue } = require('@google-cloud/firestore');
const fs   = require('fs');
const path = require('path');
const os   = require('os');

const PROJECT_ID = 'tiendapraxis';

// Use firebase-tools stored refresh token + correct client credentials
const config = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.config/configstore/firebase-tools.json'), 'utf8'));
const oauth2  = new OAuth2Client(
    '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com',
    'j9iVZfS8kkCEFUPaAeJV0sAi',
    'urn:ietf:wg:oauth:2.0:oob'
);
oauth2.setCredentials({ refresh_token: config.tokens.refresh_token });

let db; // initialized after token refresh

async function backfillMonth(monthStr) {
    const [y, m] = monthStr.split('-').map(Number);
    const startDate = new Date(y, m - 1, 1, 0, 0, 0, 0);
    const endDate   = new Date(y, m, 0, 23, 59, 59, 999); // last ms of month

    console.log(`\n📦  Querying orders for ${monthStr}...`);
    console.log(`    from: ${startDate.toISOString()}`);
    console.log(`    to:   ${endDate.toISOString()}`);

    const ordersSnap = await db.collection('orders')
        .where('createdAt', '>=', Firestore.Timestamp.fromDate(startDate))
        .where('createdAt', '<=', Firestore.Timestamp.fromDate(endDate))
        .get();

    console.log(`    Found ${ordersSnap.size} total orders (including cancelled)`);

    const dayMap = {};
    let monthSales = 0, monthOrders = 0, monthPieces = 0, skipped = 0;

    ordersSnap.docs.forEach(docSnap => {
        const order = docSnap.data();

        // Skip cancelled / refunded / returned (matches Cloud Function logic)
        if (['cancelled', 'refunded', 'returned'].includes(order['status'])) {
            skipped++;
            return;
        }

        const orderDate = order['createdAt']?.toDate?.() ?? new Date();
        const dayKey = String(orderDate.getDate()).padStart(2, '0');

        const total  = Number(order['total'] ?? 0);
        const pieces = (order['items'] ?? [])
            .reduce((s, item) => s + (Number(item.quantity) || 1), 0);

        if (!dayMap[dayKey]) dayMap[dayKey] = { sales: 0, orders: 0, pieces: 0 };
        dayMap[dayKey].sales  += total;
        dayMap[dayKey].orders += 1;
        dayMap[dayKey].pieces += pieces;

        monthSales  += total;
        monthOrders += 1;
        monthPieces += pieces;
    });

    console.log(`    Active orders: ${monthOrders}, skipped (cancelled etc): ${skipped}`);
    console.log(`    Total sales:  $${monthSales.toFixed(2)}`);
    console.log(`    Total pieces: ${monthPieces}`);
    console.log(`    Days with data: ${Object.keys(dayMap).length}`);

    if (monthOrders === 0) {
        console.log('    ⚠  No active orders found — skipping write.');
        return;
    }

    // Sanity check: pieces must be >= orders
    if (monthPieces < monthOrders) {
        console.warn(`    ⚠  DATA ISSUE: pieces (${monthPieces}) < orders (${monthOrders}). Check item.quantity fields.`);
    }

    const monthRef = db.collection('monthly_stats').doc(monthStr);
    const batch = db.batch();

    // Parent document
    batch.set(monthRef, {
        month: monthStr,
        sales:   monthSales,
        orders:  monthOrders,
        pieces:  monthPieces,
        backfilled: true,
        updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    // Daily subcollection
    for (const [day, dayData] of Object.entries(dayMap)) {
        const dayRef = monthRef.collection('days').doc(day);
        batch.set(dayRef, {
            day,
            month: monthStr,
            sales:  dayData.sales,
            orders: dayData.orders,
            pieces: dayData.pieces,
            updatedAt: FieldValue.serverTimestamp(),
        });
    }

    await batch.commit();
    console.log(`\n✅  monthly_stats/${monthStr} written successfully.`);
    console.log(`    orders: ${monthOrders} | sales: $${monthSales.toFixed(2)} | pieces: ${monthPieces}`);
}

async function run() {
    console.log('🔑 Refreshing OAuth token...');
    await oauth2.refreshAccessToken();
    db = new Firestore({ projectId: PROJECT_ID, authClient: oauth2 });
    console.log('✅ Firestore client ready.\n');

    // Backfill June 2025 (LY full month for June 2026)
    await backfillMonth('2025-06');
    process.exit(0);
}

run().catch(err => {
    console.error('❌ Error:', err.message);
    process.exit(1);
});
