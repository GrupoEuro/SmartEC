const admin = require("firebase-admin");
if (!admin.apps.length) {
    admin.initializeApp({
      projectId: "importadora-euro"
    });
}
const db = admin.firestore();

function resolveChannelBQ(order) {
    const sc = order.sourceChannel;
    const ft = order.fulfillmentType;
    if (sc === 'mercadolibre') return ft === 'platform' ? 'MELI_FULL' : 'MELI_CLASSIC';
    return null;
}

async function run() {
  const snap = await db.collection('orders').get();
  const results = {};
  
  snap.docs.forEach(doc => {
    const d = doc.data();
    // Only revenue statuses (as per bq-analytics.ts)
    const REVENUE_STATUSES = ['pending','processing','shipped','delivered','completed','in_transit','picked_up','paid','refund_pending'];
    if (!REVENUE_STATUSES.includes(d.status)) return;
    
    const channel = resolveChannelBQ(d);
    if (!channel) return;
    
    const dStr = d.createdAt ? d.createdAt.toDate().toISOString().substring(0, 7) : 'Unknown';
    const key = dStr + '|' + channel;
    
    if (!results[key]) {
        results[key] = { month_year: dStr, source_channel: channel, count: 0 };
    }
    results[key].count += 1;
  });
  
  const rows = Object.values(results);
  rows.sort((a, b) => {
      if (a.month_year !== b.month_year) return b.month_year.localeCompare(a.month_year);
      return a.source_channel.localeCompare(b.source_channel);
  });
  
  console.log("RESULTS:");
  console.table(rows);
}
run();
