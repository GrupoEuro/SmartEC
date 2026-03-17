const admin = require('firebase-admin');

admin.initializeApp({
  projectId: 'tiendapraxis'
});

async function check() {
  const db = admin.firestore();
  
  const priorities = await db.collection('orderPriorities').get();
  console.log(`Total priority records found in DB: ${priorities.size}`);
  
  let i = 0;
  priorities.forEach(doc => {
      const data = doc.data();
      if (i < 5) console.dir(data);
      i++;
  });

  process.exit(0);
}

check();
