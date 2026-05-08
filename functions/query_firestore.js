const admin = require('firebase-admin');
const db = admin.firestore();
db.collection('meli_fbm_inventory').get().then(s => console.log('INVENTORY COUNT:', s.docs.length));
