import * as admin from 'firebase-admin';

if (!admin.apps.length) {
    admin.initializeApp();
}
const db = admin.firestore();

async function backfill() {
    try {
        console.log('Starting backfill for May 1st 2026...');
        const year = 2026;
        const month = '05';
        const currentDay = '01'; // Target day for backfill
        const lyYear = 2025;

        // Fetch May 1st actuals
        const dayRef = db.collection('monthly_stats').doc(`${year}-${month}`).collection('days').doc(currentDay);
        const daySnap = await dayRef.get();
        
        let mtdSales = 0;
        let mtdPieces = 0;
        let mtdOrders = 0;

        if (daySnap.exists) {
            const data = daySnap.data();
            mtdSales = data.sales || 0;
            mtdPieces = data.pieces || 0;
            mtdOrders = data.orders || 0;
            console.log(`Found May 1st actuals: Sales $${mtdSales}, Pieces ${mtdPieces}, Orders ${mtdOrders}`);
        } else {
            console.log(`[backfill] Warning: No daily doc for ${year}-${month}/days/${currentDay}. Using current monthly_stats aggregate.`);
            const monthSnap = await db.collection('monthly_stats').doc(`${year}-${month}`).get();
            const data = monthSnap.data() || {};
            mtdSales = data.sales || 0;
            mtdPieces = data.pieces || 0;
            mtdOrders = data.orders || 0;
        }

        if (mtdSales <= 0) {
            console.log(`[backfill] No sales to project for ${year}-${month}-${currentDay}`);
            return;
        }

        // We want the projection as it would have been calculated at 23:55 on May 1st.
        // So the date context is May 1st 23:55
        const totalDaysInMonth = new Date(year, parseInt(month, 10), 0).getDate();
        
        const lyDaysRef = db.collection('monthly_stats').doc(`${lyYear}-${month}`).collection('days');
        const lyDaysSnap = await lyDaysRef.get();
        
        const lyDailySales: number[] = new Array(totalDaysInMonth).fill(0);
        let hasLyData = false;
        lyDaysSnap.forEach(doc => {
            const dayNum = parseInt(doc.id, 10);
            if (dayNum >= 1 && dayNum <= totalDaysInMonth) {
                lyDailySales[dayNum - 1] = doc.data().sales || 0;
                hasLyData = true;
            }
        });

        // todayIdx is 0 (May 1st is index 0)
        const todayIdx = 0;
        const fractionalDay = todayIdx + (23 / 24) + (55 / 1440); // exactly 23:55
        
        let projectedSales = 0;
        let projectedPieces = 0;
        let projectedOrders = 0;

        if (hasLyData && lyDailySales.length === totalDaysInMonth) {
            let lySalesMTD = 0;
            for (let i = 0; i < todayIdx; i++) lySalesMTD += lyDailySales[i];
            
            const fractionalDayPart = (23 / 24) + (55 / 1440);
            lySalesMTD += lyDailySales[todayIdx] * fractionalDayPart;

            if (lySalesMTD > 0) {
                const velocityMultiplier = mtdSales / lySalesMTD;
                let futureLySales = 0;
                futureLySales += lyDailySales[todayIdx] * (1 - fractionalDayPart);
                for (let i = todayIdx + 1; i < totalDaysInMonth; i++) {
                    futureLySales += lyDailySales[i];
                }
                projectedSales = mtdSales + (futureLySales * velocityMultiplier);
            } else {
                projectedSales = (mtdSales / fractionalDay) * totalDaysInMonth;
            }
        } else {
            projectedSales = (mtdSales / fractionalDay) * totalDaysInMonth;
        }

        if (projectedSales > 0 && mtdSales > 0) {
            const ratio = projectedSales / mtdSales;
            projectedPieces = Math.round(mtdPieces * ratio);
            projectedOrders = Math.round(mtdOrders * ratio);
        } else {
            projectedPieces = Math.round((mtdPieces / fractionalDay) * totalDaysInMonth);
            projectedOrders = Math.round((mtdOrders / fractionalDay) * totalDaysInMonth);
        }

        const snapshotRef = db.collection('monthly_stats').doc(`${year}-${month}`).collection('projections').doc(currentDay);
        await snapshotRef.set({
            predictedSales: projectedSales,
            predictedPieces: projectedPieces,
            predictedOrders: projectedOrders,
            actualSalesAtSnapshot: mtdSales,
            fractionalDay: fractionalDay,
            timestamp: admin.firestore.FieldValue.serverTimestamp()
        });

        console.log(`[backfill] Saved EOM projection for ${year}-${month}-${currentDay}: $${projectedSales}`);
        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

backfill();
