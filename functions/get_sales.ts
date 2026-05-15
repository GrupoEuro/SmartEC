import * as admin from 'firebase-admin';

admin.initializeApp();
const db = admin.firestore();

async function getSales(month, year) {
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 1);
    
    const snapshot = await db.collection('orders')
        .where('createdAt', '>=', startDate)
        .where('createdAt', '<', endDate)
        .get();
        
    const dailyData = {};
    snapshot.forEach(doc => {
        const data = doc.data();
        if (data.status !== 'cancelled' && data.status !== 'payment_failed') {
            const date = data.createdAt.toDate();
            const day = date.getDate();
            const revenue = data.total || data.revenue || data.totalAmount || 0;
            if (!dailyData[day]) dailyData[day] = 0;
            dailyData[day] += revenue;
        }
    });
    console.log(`Sales for ${month}/${year}:`, dailyData);
}

getSales(4, 2026).then(() => getSales(5, 2026)).catch(console.error);
