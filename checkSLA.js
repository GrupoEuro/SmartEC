const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const serviceAccount = require('./serviceAccountKey.json');

initializeApp({
  credential: cert(serviceAccount)
});

const db = getFirestore();

async function checkOrders() {
    const ordersSnap = await db.collection('orders').limit(100).get();
    
    let now = Date.now();
    let onTime = 0, overdue = 0, approaching = 0, platform = 0;
    
    ordersSnap.forEach(doc => {
        const order = doc.data();
        
        if (['cancelled', 'refunded', 'returned'].includes(order.status)) {
            return;
        }
        
        // SLA DEADLINE
        let slaDeadline;
        if (order.nativeSla) {
            slaDeadline = order.nativeSla.toMillis ? order.nativeSla.toMillis() : order.nativeSla;
        } else {
            const defaultSLAHours = order.priorityLevel === 'rush' ? 24 : (order.priorityLevel === 'express' ? 48 : 72);
            const createdAt = order.createdAt.toMillis ? order.createdAt.toMillis() : order.createdAt;
            slaDeadline = createdAt + (defaultSLAHours * 60 * 60 * 1000);
        }
        
        // COMPLETION TIME
        let completionTime;
        if (['shipped', 'delivered'].includes(order.status)) {
            // Find when it was shipped in history
            let shippedEvent = null;
            if (order.history && Array.isArray(order.history)) {
                shippedEvent = order.history.find(h => h.status === 'shipped' || h.status === 'delivered');
            }
            
            if (shippedEvent && shippedEvent.timestamp) {
                completionTime = shippedEvent.timestamp.toMillis ? shippedEvent.timestamp.toMillis() : shippedEvent.timestamp;
            } else {
                completionTime = order.updatedAt.toMillis ? order.updatedAt.toMillis() : order.updatedAt;
            }
            
            if (completionTime > slaDeadline) {
                if (order.fulfillmentType === 'platform') platform++;
                else {
                    console.log(`OVERDUE: ${order.orderNumber} | Created: ${new Date(order.createdAt.toMillis()).toISOString()} | SLA: ${new Date(slaDeadline).toISOString()} | Completed: ${new Date(completionTime).toISOString()} | Source: ${order.sourceChannel} | Full: ${order.fulfillmentType}`);
                    overdue++;
                }
            } else {
                onTime++;
            }
        } else {
             if (now > slaDeadline) overdue++;
             else approaching++;
        }
    });
    
    console.log(`Total: ${ordersSnap.size}`);
    console.log(`OnTime: ${onTime}, Overdue: ${overdue}, Approaching: ${approaching}, Platform Overdue: ${platform}`);
}

checkOrders().catch(console.error);
