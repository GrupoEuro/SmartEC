const { initializeApp } = require('firebase/app');
const { getFirestore, doc, getDoc, collection, query, where, getDocs } = require('firebase/firestore');

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

async function inspectOrder() {
    console.log("Searching by document ID: meli_2000016528011810");
    const docRef = doc(db, 'orders', 'meli_2000016528011810');
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
        console.log("Document found by ID!");
        console.log(JSON.stringify(docSnap.data(), null, 2));
    } else {
        console.log("Document NOT found by ID. Searching by query...");
        const ordersRef = collection(db, 'orders');
        const q = query(ordersRef, where('orderNumber', '==', 'ML-2000016528011810'));
        const snap = await getDocs(q);
        if (snap.empty) {
            console.log("No orders found by query either.");
        } else {
            snap.forEach(d => {
                console.log(`Found order by query (ID: ${d.id}):`);
                console.log(JSON.stringify(d.data(), null, 2));
            });
        }
    }
    process.exit(0);
}

inspectOrder().catch(console.error);
