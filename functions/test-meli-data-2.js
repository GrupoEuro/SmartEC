const admin = require('firebase-admin');
admin.initializeApp();
const db = admin.firestore();

async function check() {
  try {
    const snap = await db.collection('orders')
      .where('sourceChannel', '==', 'mercadolibre')
      .orderBy('createdAt', 'desc')
      .limit(50)
      .get();
    
    let count = 0;
    snap.docs.forEach(d => {
      const data = d.data();
      if(data.meliInvoice && data.meliInvoice.isGenericRfc === false) {
        console.log('--- Order ID:', d.id, '---');
        console.log(JSON.stringify(data.meliInvoice, null, 2));
        count++;
      }
    });
    console.log(`Found ${count} nominal invoices.`);
  } catch (e) {
    console.error('Error querying firestore:', e);
  }
}

check().then(()=>process.exit(0)).catch(e => {
  console.error(e);
  process.exit(1);
});
