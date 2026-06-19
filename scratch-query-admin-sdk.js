const { OAuth2Client } = require('google-auth-library');
const { Firestore } = require('@google-cloud/firestore');
const path = require('path');
const os = require('os');
const fs = require('fs');

const PROJECT_ID = 'tiendapraxis';

const configPath = path.join(os.homedir(), '.config/configstore/firebase-tools.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const tokens = config.tokens;

const oauth2Client = new OAuth2Client(
  '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com',
  'j9iVZfS8kkqWEntmZJbEhFZQ',
  'urn:ietf:wg:oauth:2.0:oob'
);
oauth2Client.setCredentials({ refresh_token: tokens.refresh_token, access_token: tokens.access_token });

// Initialize Firestore directly using the oauth2Client
const db = new Firestore({
  projectId: PROJECT_ID,
  authClient: oauth2Client
});

async function main() {
  console.log("Getting order meli_2000016528011810 via @google-cloud/firestore...");
  try {
      const doc = await db.collection('orders').doc('meli_2000016528011810').get();
      if (!doc.exists) {
          console.log("Order document meli_2000016528011810 does not exist.");
          
          // Let's search by query
          console.log("Querying orders collection where orderNumber == ML-2000016528011810...");
          const snap = await db.collection('orders').where('orderNumber', '==', 'ML-2000016528011810').get();
          if (snap.empty) {
              console.log("No order found by orderNumber either.");
          } else {
              snap.forEach(d => {
                  console.log(`Found order by query (ID: ${d.id}):`);
                  console.log(JSON.stringify(d.data(), null, 2));
              });
          }
      } else {
          console.log("Order document found!");
          console.log(JSON.stringify(doc.data(), null, 2));
      }
  } catch (e) {
      console.error("Error:", e.message);
  }
}

main().catch(console.error);
