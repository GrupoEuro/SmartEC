const admin = require('firebase-admin');
const { getFirestore } = require('firebase-admin/firestore');
admin.initializeApp({ projectId: 'importadora-euro' });
const db = getFirestore();
db.collection('meli_fbm_inventory').get().then(snap => {
  console.log(`Inventory count: ${snap.docs.length}`);
  if (snap.docs.length > 0) {
    console.log(snap.docs[0].data());
  }
}).catch(console.error);
