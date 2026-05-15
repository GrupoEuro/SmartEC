const admin = require('firebase-admin');

admin.initializeApp();
const db = admin.firestore();

async function getSales(month, year) {
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 1);
    
    const snapshot = await db.collection('orders')
        .where('createdAt', '>=', startDate)
        .where('createdAt', '<', endDate)
        .get();
        
    let total = 0;
    let firstHalf = 0; // 1-14
    let secondHalf = 0; // 15-end
    const dailyData = {};
    
    snapshot.forEach(doc => {
        const data = doc.data();
        if (data.status !== 'cancelled' && data.status !== 'payment_failed') {
            const date = data.createdAt.toDate();
            const day = date.getDate();
            const revenue = data.total || data.revenue || data.totalAmount || 0;
            
            if (!dailyData[day]) dailyData[day] = 0;
            dailyData[day] += revenue;
            total += revenue;
            if (day <= 14) firstHalf += revenue;
            else secondHalf += revenue;
        }
    });
    console.log(`\n--- ${month}/${year} ---`);
    console.log(`Total: $${total.toFixed(2)}`);
    console.log(`Days 1-14: $${firstHalf.toFixed(2)}`);
    console.log(`Days 15-End: $${secondHalf.toFixed(2)}`);
    console.log(`Multiplier (SecondHalf / FirstHalf): ${(secondHalf/firstHalf).toFixed(2)}x`);
}

getSales(4, 2026).then(() => getSales(5, 2026)).then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
