const { initializeApp } = require('firebase/app');
const { getFirestore, collection, query, where, getDocs } = require('firebase/firestore');

const firebaseConfig = {
    apiKey: "AIzaSyBL1qo-Ta4pW9sgx-CucJ4Uj9c_Bjef3a4",
    authDomain: "tiendapraxis.firebaseapp.com",
    projectId: "tiendapraxis",
    storageBucket: "tiendapraxis.firebasestorage.app",
    messagingSenderId: "320158502362",
    appId: "1:320158502362:web:e485f992f130d318bb04e3",
    measurementId: "G-LTEXCRY0J5"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function inspectPending() {
    const ordersRef = collection(db, 'orders');
    const q1 = query(ordersRef, 
        where('sourceChannel', '==', 'mercadolibre'),
        where('fulfillmentType', '==', 'merchant'),
        where('status', 'in', ['pending', 'processing'])
    );
    
    const snap = await getDocs(q1);
    console.log(`Found ${snap.size} pending/processing classic Meli orders.`);
    
    snap.forEach(doc => {
        const o = doc.data();
        const createdDate = o.createdAt.toDate ? o.createdAt.toDate().toISOString() : new Date(o.createdAt).toISOString();
        console.log(`ID: ${o.id} | Status: ${o.status} | items: ${o.items?.length} | ML Pack: ${o.meliPackId} | Created: ${createdDate}`);
        if(o.history && o.history.length > 0) {
           console.log(`   Latest history status: ${o.history[o.history.length-1].status}`);
        }
    });
    process.exit(0);
}

inspectPending().catch(console.error);
