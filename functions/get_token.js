const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

// Trying to find any service account or just use the local application default
try {
  admin.initializeApp();
} catch (e) {
  console.log("Initialize error", e);
}
const db = admin.firestore();

async function run() {
  try {
    const configDoc = await db.collection('config').doc('integrations').get();
    const token = configDoc.data().meli.accessToken;
    const sellerId = configDoc.data().meli.sellerId;
    console.log("TOKEN:", token ? "FOUND" : "NOT FOUND");
    
    // Fetch from MeLi manually
    const headers = { 'Authorization': `Bearer ${token}` };
    
    // Test the messages endpoint (to see if we have permissions and if there are messages)
    // We need pack_id to get messages, so let's get a recent order
    const ordersRes = await fetch(`https://api.mercadolibre.com/orders/search?seller=${sellerId}&limit=5`, { headers });
    const ordersData = await ordersRes.json();
    
    console.log("Recent Orders count:", ordersData.results ? ordersData.results.length : 0);
    
    if (ordersData.results && ordersData.results.length > 0) {
       for (const o of ordersData.results) {
          const packId = o.pack_id || o.id;
          console.log(`Checking messages for pack/order ${packId}`);
          const msgRes = await fetch(`https://api.mercadolibre.com/messages/packs/${packId}/sellers/${sellerId}?mark_as_read=false`, { headers });
          if (msgRes.ok) {
             const msgData = await msgRes.json();
             console.log(`Messages for ${packId}:`, msgData.messages ? msgData.messages.length : 0);
             if (msgData.messages && msgData.messages.length > 0) {
                 console.log("Example message structure:", JSON.stringify(msgData.messages[0]).substring(0, 200));
             }
          } else {
             console.log(`Failed to fetch messages for ${packId}: ${msgRes.status} ${await msgRes.text()}`);
          }
       }
    }
  } catch(e) {
    console.error(e);
  }
}
run();
