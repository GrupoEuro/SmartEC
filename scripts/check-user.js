const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');

// Initialize Firebase Admin
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

const email = 'saull@test.com';

async function checkUser() {
    console.log(`Checking user: ${email}...`);
    try {
        const userRecord = await admin.auth().getUserByEmail(email);
        console.log('--- Auth Record ---');
        console.log(`UID: ${userRecord.uid}`);
        console.log(`Custom Claims:`, userRecord.customClaims);
        
        console.log('\n--- Firestore Users Collection ---');
        const db = admin.firestore();
        const doc = await db.collection('users').doc(userRecord.uid).get();
        if (doc.exists) {
            console.log(doc.data());
        } else {
            console.log('No user document found in Firestore collections/users.');
        }
    } catch (error) {
        console.error('Error fetching user:', error.message);
        
        console.log('\nLet\'s search the users collection just in case...');
        const db = admin.firestore();
        const snapshot = await db.collection('users').where('email', '==', email).get();
        if (snapshot.empty) {
            console.log('No users found in Firestore with that email.');
        } else {
            snapshot.forEach(doc => {
                console.log(doc.id, '=>', doc.data());
            });
        }
    } finally {
        process.exit(0);
    }
}

checkUser();
