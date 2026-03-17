const admin = require('firebase-admin');

admin.initializeApp({
  projectId: 'tiendapraxis'
});

async function check() {
  const db = admin.firestore();
  
  // MTD dates
  const today = new Date();
  const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  
  const ordersSnap = await db.collection('orders')
    .where('createdAt', '>=', admin.firestore.Timestamp.fromDate(startOfMonth))
    .get();
    
    
  let onTime = 0;
  let overdue = 0;
  let approaching = 0;
  
  const now = Date.now();
  const sixHoursFromNow = now + (6 * 60 * 60 * 1000);
  const defaultSLAHours = 48;
  
  console.log(`Analyzing ${ordersSnap.size} MTD orders...`);
  
  let i = 0;
  ordersSnap.forEach(doc => {
      const order = doc.data();
      let slaDeadline;
      
      const getTimestampMillis = (ts) => ts && ts.toMillis ? ts.toMillis() : new Date(ts).getTime();
      
      if (order.nativeSla) {
          slaDeadline = getTimestampMillis(order.nativeSla);
      } else {
          const createdAt = getTimestampMillis(order.createdAt);
          slaDeadline = createdAt + (defaultSLAHours * 60 * 60 * 1000);
      }
      
      if (i < 5) console.log(`Order ${doc.id} - Created: ${new Date(getTimestampMillis(order.createdAt)).toISOString()} - SLA: ${new Date(slaDeadline).toISOString()}`);
      i++;
      
      if (now > slaDeadline) {
          overdue++;
      } else if (slaDeadline <= sixHoursFromNow) {
          approaching++;
      } else {
          onTime++;
      }
  });
  
  console.log(`Calculated -> OnTime: ${onTime}, Approaching: ${approaching}, Overdue: ${overdue}`);

  process.exit(0);
}

check();
