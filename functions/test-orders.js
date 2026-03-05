const admin = require('firebase-admin');
var serviceAccount = require("./serviceAccountKey.json");

admin.initializeApp({
  // Use ADC or fallback to default
  credential: admin.credential.applicationDefault()
});

const db = admin.firestore();

async function check() {
  const snapshot = await db.collection('orders').where('sourceChannel', '==', 'mercadolibre').get();
  let fullCount = 0;
  let classicCount = 0;
  let unknownCount = 0;

  snapshot.forEach(doc => {
    const data = doc.data();
    if (data.fulfillmentType === 'platform') fullCount++;
    else if (data.fulfillmentType === 'merchant') classicCount++;
    else unknownCount++;
  });

  console.log(`Meli Full Orders: ${fullCount}`);
  console.log(`Meli Classic Orders: ${classicCount}`);
  console.log(`Unknown Type Orders: ${unknownCount}`);
  console.log(`Total Meli Orders: ${snapshot.size}`);
}

check().catch(console.error);
