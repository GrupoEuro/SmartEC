const admin = require('firebase-admin');

// We try to initialize. If ADC is set up, this works.
admin.initializeApp({
  credential: admin.credential.applicationDefault(),
  projectId: 'importadora-euro'
});

const db = admin.firestore();

async function check() {
  const ids = [
    "2000013016138417", "2000013015707735", "2000013015496997", "2000013015606685",
    "2000013015575229", "2000016464953036", "2000016464848402", "2000013015252043",
    "2000013015092237", "2000013015082785", "2000013014990817", "2000013014837113",
    "2000013014276905", "2000013011994375", "2000013014437945", "2000013014265445",
    "2000013014137811", "2000013014080669", "2000013012939025", "2000013012683941",
    "2000013012169825", "2000016461218286", "2000013011228717", "2000013011016397",
    "2000013009106217", "2000013009024761", "2000013008903867", "2000016458352966",
    "2000013008494837", "2000013008400813", "2000013008253577", "2000013008210961",
    "2000013008156733", "2000016457805736", "2000016457824314", "2000013007810349",
    "2000013007697429", "2000013007525251", "2000013007224909", "2000013007148185",
    "2000013006881413", "2000013006594753", "2000013006528517", "2000013006048273",
    "2000013005563241", "2000013004567527", "2000013004263017", "2000016453508440",
    "2000013002882757", "2000013002788741", "2000013002632889", "2000013002533561",
    "2000013002526075", "2000013002241031"
  ];
  
  let missing = [];
  let statuses = {};
  let dates = {};
  
  for (let id of ids) {
    let docRef = db.collection('orders').doc(`meli_${id}`);
    let doc = await docRef.get();
    if (!doc.exists) {
      missing.push(id);
    } else {
      let data = doc.data();
      statuses[id] = data.status;
      let d = data.createdAt ? data.createdAt.toDate() : null;
      dates[id] = d ? d.toISOString() : 'none';
    }
  }
  
  console.log('Missing Orders:', missing);
  console.log('---');
  console.log('Orders not counted in revenue (status):');
  for (let id of ids) {
     if (statuses[id] === 'cancelled' || statuses[id] === 'refunded' || statuses[id] === 'returned' || statuses[id] === 'payment_failed') {
         console.log(id, statuses[id], dates[id]);
     }
  }
  
  console.log('---');
  console.log('Orders created yesterday (UTC-6) but paid today:');
  for (let id of ids) {
     if (dates[id] && dates[id] !== 'none') {
         let d = new Date(dates[id]);
         // Get date in Mexico Time (UTC-6)
         let mxDate = new Date(d.getTime() - (6 * 60 * 60 * 1000));
         if (mxDate.getUTUTCDate && mxDate.getUTCDate() === 15) {
             console.log(id, mxDate.toISOString());
         }
     }
  }
}

check().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
