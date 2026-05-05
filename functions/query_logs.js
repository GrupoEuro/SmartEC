const admin = require("firebase-admin");
admin.initializeApp({
  projectId: "tiendapraxis"
});
const db = admin.firestore();

async function run() {
  try {
    const snapshot = await db.collection("meli_webhook_logs")
      .orderBy("createdAt", "desc")
      .limit(100)
      .get();
    
    let topics = new Set();
    snapshot.forEach(doc => {
      topics.add(doc.data().topic);
    });
    console.log("Topics received recently:", Array.from(topics));
  } catch(e) {
    console.error(e);
  }
}
run();
