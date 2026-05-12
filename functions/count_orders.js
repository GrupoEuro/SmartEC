const admin = require("firebase-admin");
const serviceAccount = require("/Users/SaulFigueroa/firebase-service-account.json");
if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
}
const db = admin.firestore();

async function run() {
  const countSnap = await db.collection('orders').count().get();
  console.log("Total orders:", countSnap.data().count);
  
  const snap = await db.collection('orders').limit(1).get();
  snap.forEach(doc => console.log(doc.id, doc.data()));
}
run();
