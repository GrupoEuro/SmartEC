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
  'j9iVZfS8zyPyOgRXQE7zKoZ_',
  'urn:ietf:wg:oauth:2.0:oob'
);
oauth2Client.setCredentials({ refresh_token: tokens.refresh_token, access_token: tokens.access_token });

const db = new Firestore({
  projectId: PROJECT_ID,
  authClient: oauth2Client
});

async function run() {
    console.log('Testing Firestore connection via @google-cloud/firestore...');
    const snap = await db.collection('orders').limit(5).get();
    console.log(`Successfully fetched ${snap.size} orders!`);
    snap.forEach(doc => {
        const d = doc.data();
        console.log(`Doc ID: ${doc.id} | OrderNo: ${d.orderNumber || d.orderId} | Status: ${d.status} | Source: ${d.sourceChannel} | Total: $${d.total}`);
    });

    console.log('\nSearching for ot-mrv8pr24 in orders collection...');
    const targetDoc = await db.collection('orders').doc('ot-mrv8pr24').get();
    if (targetDoc.exists) {
        console.log('Found doc by ID ot-mrv8pr24:');
        console.log(JSON.stringify(targetDoc.data(), null, 2));
    } else {
        console.log('Doc with ID ot-mrv8pr24 does not exist in orders collection.');
    }

    const q1 = await db.collection('orders').where('orderId', '==', 'ot-mrv8pr24').get();
    console.log(`Found ${q1.size} docs matching orderId == ot-mrv8pr24`);
    q1.forEach(d => console.log(d.id, d.data()));

    const q2 = await db.collection('orders').where('orderNumber', '==', 'ot-mrv8pr24').get();
    console.log(`Found ${q2.size} docs matching orderNumber == ot-mrv8pr24`);
    q2.forEach(d => console.log(d.id, d.data()));
}

run().catch(console.error);
