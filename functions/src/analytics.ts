import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

export const snapshotProjections = functions
    .pubsub.schedule('55 23 * * *')
    .timeZone('America/Mexico_City')
    .onRun(async () => {
        const db = admin.firestore();
        const now = new Date();
        const mxNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/Mexico_City' }));
        
        const year = mxNow.getFullYear();
        const month = String(mxNow.getMonth() + 1).padStart(2, '0');
        const currentDay = String(mxNow.getDate()).padStart(2, '0');
        
        const currentDocRef = db.collection('monthly_stats').doc(`${year}-${month}`);
        const currentDoc = await currentDocRef.get();
        if (!currentDoc.exists) {
            console.log(`[snapshotProjections] No monthly_stats for ${year}-${month}`);
            return;
        }
        
        const data = currentDoc.data() || {};
        const mtdSales = data.sales || 0;
        const mtdPieces = data.pieces || 0;
        const mtdOrders = data.orders || 0;

        if (mtdSales <= 0) {
            console.log(`[snapshotProjections] No sales to project for ${year}-${month}-${currentDay}`);
            return;
        }

        // Last Year Pattern
        const lyYear = year - 1;
        const totalDaysInMonth = new Date(year, mxNow.getMonth() + 1, 0).getDate();
        
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

        const todayIdx = mxNow.getDate() - 1;
        const fractionalDay = todayIdx + (mxNow.getHours() / 24) + (mxNow.getMinutes() / 1440);
        
        let projectedSales = 0;
        let projectedPieces = 0;
        let projectedOrders = 0;

        if (hasLyData && lyDailySales.length === totalDaysInMonth) {
            let lySalesMTD = 0;
            for (let i = 0; i < todayIdx; i++) lySalesMTD += lyDailySales[i];
            
            const fractionalDayPart = (mxNow.getHours() / 24) + (mxNow.getMinutes() / 1440);
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

        const snapshotRef = currentDocRef.collection('projections').doc(currentDay);
        await snapshotRef.set({
            predictedSales: projectedSales,
            predictedPieces: projectedPieces,
            predictedOrders: projectedOrders,
            actualSalesAtSnapshot: mtdSales,
            fractionalDay: fractionalDay,
            timestamp: admin.firestore.FieldValue.serverTimestamp()
        });

        console.log(`[snapshotProjections] Saved EOM projection for ${year}-${month}-${currentDay}: $${projectedSales}`);
    });
