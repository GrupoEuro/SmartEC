const admin = require("firebase-admin");
const serviceAccount = require("/Users/SaulFigueroa/firebase-service-account.json");
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();

async function run() {
  const ids = [
    "2000013016138417", "2000013015707735", "2000013015496997", "2000013015606685",
    "2000013015575229", "2000016464953036", "2000016464848402", "2000013015252043",
    "2000013015092237", "2000013015082785", "2000013014990817", "2000013014837113",
    "2000013014276905", "2000013011994375", "2000013014437945", "2000013014265445",
    "2000013014137811", "2000013014080669", "2000013012939025", "2000013012683941",
    "2000013012169825", "2000016461218286", "2000013011228717", "2000013011016397",
    "2000013009106217", "2000013009024761", "2000013008903867", "2000016458352966",
    "2000013008494837", "2000013008400813", "2000013008253577", "2000013008210961",
    "2000013008156733", "2000016457805736", "2000016457824314", "2000013007810349",
    "2000013007697429", "2000013007525251", "2000013007224909", "2000013007148185",
    "2000013006881413", "2000013006594753", "2000013006528517", "2000013006048273",
    "2000013005563241", "2000013004567527", "2000013004263017", "2000016453508440",
    "2000013002882757", "2000013002788741", "2000013002632889", "2000013002533561",
    "2000013002526075", "2000013002241031"
  ];

  let missing = [];
  let found = [];
  let totalValidSales = 0;
  let totalMissingFromToday = 0;

  for (let id of ids) {
    const docRef = db.collection('orders').doc(`meli_${id}`);
    const doc = await docRef.get();
    if (!doc.exists) {
      missing.push(id);
    } else {
      const data = doc.data();
      let d = data.createdAt ? data.createdAt.toDate() : null;
      let mxDate = d ? new Date(d.getTime() - (6 * 60 * 60 * 1000)) : null;
      let isToday = mxDate && mxDate.getUTCFullYear() === 2026 && mxDate.getUTCMonth() === 4 && mxDate.getUTCDate() === 16;
      let isYesterday = mxDate && mxDate.getUTCFullYear() === 2026 && mxDate.getUTCMonth() === 4 && mxDate.getUTCDate() === 15;
      
      const isRevenue = !['cancelled', 'refunded', 'returned', 'pending_payment', 'refund_pending', 'payment_failed'].includes(data.status);
      
      if (isRevenue && isToday) {
         totalValidSales += (data.total || 0);
      }
      
      if (isRevenue && isYesterday) {
         totalMissingFromToday += (data.total || 0);
      }
      
      found.push({
        id,
        total: data.total || 0,
        status: data.status,
        createdAt: d ? d.toISOString() : 'N/A',
        isTodayMX: isToday,
        isYesterdayMX: isYesterday,
        countedInToday: isRevenue && isToday
      });
    }
  }

  console.log("== RESULTS ==");
  console.log(`Missing from DB entirely: ${missing.length}`);
  if (missing.length > 0) {
      console.log(missing);
  }
  
  console.log("\nFound orders:");
  found.forEach(o => {
      console.log(`- ${o.id} | $${o.total} | ${o.status} | Created: ${o.createdAt} | Counted in Hoy: ${o.countedInToday}`);
  });
  
  console.log("\n== SUMMARY ==");
  console.log(`Sum of orders from this list actually counted in "Hoy": $${totalValidSales}`);
  console.log(`Sum of orders from this list created yesterday (May 15): $${totalMissingFromToday}`);
  const overallTotal = found.reduce((acc, o) => acc + o.total, 0);
  console.log(`Gross Total of ALL these orders (including cancelled/yesterday): $${overallTotal}`);
}

run().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
