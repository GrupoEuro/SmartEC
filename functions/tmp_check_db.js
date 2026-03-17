const admin = require('firebase-admin');

admin.initializeApp({
  projectId: 'tiendapraxis'
});

async function check() {
  const db = admin.firestore();
  
  const orders = await db.collection('orders').get();
  console.log('Orders count:', orders.size);

  const priorities = await db.collection('orderPriorities').get();
  console.log('Priorities count:', priorities.size);

  process.exit(0);
}

check();
