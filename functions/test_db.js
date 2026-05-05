const admin = require("firebase-admin");
const serviceAccount = require("../service-account.json"); // Look in parent dir?

// Let's just try to initialize with the project ID and see if application default credentials exist
admin.initializeApp({
  projectId: "tiendapraxis"
});
const db = admin.firestore();

async function run() {
  try {
    const logs = await db.collection('meli_webhook_logs').limit(10).get();
    console.log("Docs found:", logs.size);
  } catch(e) {
    console.log("Error:", e.message);
  }
}
run();
