const admin = require('firebase-admin');
admin.initializeApp({
  projectId: 'tiendapraxis'
});
const db = admin.firestore();
db.collection('orders').limit(1).get()
  .then(s => console.log('Docs found:', s.docs.length))
  .catch(e => console.error('Error:', e.message));
