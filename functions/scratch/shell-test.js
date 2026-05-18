const db = admin.firestore();
db.collection('orders').limit(1).get().then(s => {
  console.log('DOC_DATA:', s.docs.length);
  process.exit(0);
}).catch(e => {
  console.error('ERR', e);
  process.exit(1);
});
