const admin = require("firebase-admin");
const serviceAccount = require("/Users/SaulFigueroa/firebase-service-account.json");
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();

async function run() {
  const snap = await db.collection('orders')
    .orderBy('createdAt', 'desc')
    .limit(200)
    .get();

  let counts = {};
  snap.docs.forEach(d => {
    let sc = d.data().sourceChannel || 'none';
    counts[sc] = (counts[sc] || 0) + 1;
  });
  console.log("Source Channels in last 200 orders:", counts);
}

run().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
