const admin = require("firebase-admin");
const serviceAccount = require("/Users/SaulFigueroa/firebase-service-account.json");
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();

async function run() {
  const snap = await db.collection('orders').get();
  const results = {};
  snap.docs.forEach(doc => {
    const d = doc.data();
    if (d.sourceChannel && d.sourceChannel.toUpperCase().startsWith('MELI')) {
        const dStr = d.createdAt ? d.createdAt.toDate().toISOString().substring(0, 7) : 'Unknown';
        const ch = d.sourceChannel.toUpperCase();
        const key = dStr + '|' + ch;
        results[key] = (results[key] || 0) + 1;
    }
  });
  console.log(results);
}
run();
