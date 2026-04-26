const admin = require('./node_modules/firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function checkInvoiceData() {
  const snapshot = await db.collection('orders')
    .where('sourceChannel', '==', 'mercadolibre')
    .orderBy('createdAt', 'desc')
    .limit(100)
    .get();

  const orders = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  
  // Find orders where we consider they asked for an invoice (isGenericRfc is false)
  const invoicedOrders = orders.filter(o => 
    o.meliInvoice && o.meliInvoice.isGenericRfc === false
  );

  console.log(`Out of 100 recent MeLi orders, ${invoicedOrders.length} requested a nominal invoice.`);
  
  let validCount = 0;
  let invalidCount = 0;

  const rfcRegex = /^[A-Z&Ñ]{3,4}\d{6}[A-V1-9][A-Z1-9][0-9A]$/i;

  for (const o of invoicedOrders) {
      const inv = o.meliInvoice;
      const isValidRfc = inv.rfc && rfcRegex.test(inv.rfc);
      const hasZip = !!(inv.billingAddress && inv.billingAddress.zipCode);
      const hasRegimen = !!inv.taxpayerType;

      if (isValidRfc && hasZip && hasRegimen) {
          validCount++;
      } else {
          invalidCount++;
          console.log(`\n--- INCOMPLETE DATA ORDER: ${o.id} ---`);
          console.log(`Name: ${inv.name}`);
          console.log(`RFC: '${inv.rfc}' (Valid format: ${isValidRfc})`);
          console.log(`Regimen: ${inv.taxpayerType}`);
          console.log(`Zip: ${inv.billingAddress?.zipCode}`);
          console.log(`Raw Object:`, inv);
      }
  }

  console.log(`\nSummary: ${validCount} fully valid, ${invalidCount} incomplete/invalid.`);
}

checkInvoiceData().then(() => process.exit(0)).catch(err => {
    console.error(err);
    process.exit(1);
});
