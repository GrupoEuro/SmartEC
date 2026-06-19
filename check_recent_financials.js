const { initializeApp } = require('firebase/app');
const { getFirestore, collection, query, where, getDocs, limit, orderBy } = require('firebase/firestore');

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

async function inspectFinancials() {
    const ordersRef = collection(db, 'orders');
    const q = query(ordersRef, 
        where('sourceChannel', '==', 'mercadolibre'),
        orderBy('createdAt', 'desc'),
        limit(10)
    );
    
    const snap = await getDocs(q);
    console.log(`Found ${snap.size} recent Meli orders.`);
    
    snap.forEach(docSnap => {
        const o = docSnap.data();
        const createdDate = o.createdAt?.toDate ? o.createdAt.toDate().toISOString() : new Date(o.createdAt).toISOString();
        console.log(`\nID: ${o.id} (${createdDate})`);
        console.log(`  Fulfillment: ${o.fulfillmentType}`);
        console.log(`  Total: ${o.total}`);
        console.log(`  MarketplaceFee: ${o.marketplaceFee}`);
        console.log(`  IVA: ${o.retencion_iva} | ISR: ${o.retencion_isr}`);
        console.log(`  ShippingSellerCost: ${o.shipping_seller_cost}`);
        console.log(`  NetReceipt: ${o.net_receipt}`);
        console.log(`  refunded_amount: ${o.refunded_amount} | ml_bonus: ${o.ml_bonus}`);
        
        // Let's compute it ourselves using calcFinancials formula
        const total = o.total || 0;
        const comm = o.marketplaceFee || 0;
        const iva = o.retencion_iva || 0;
        const isr = o.retencion_isr || 0;
        const ship = o.shipping_seller_cost || 0;
        const refunds = o.refunded_amount || 0;
        const bonus = o.ml_bonus || 0;
        const computedNet = Math.max(0, total - comm - iva - isr - ship - refunds + bonus);
        console.log(`  Computed Net: ${computedNet}`);
        console.log(`  Difference: ${o.net_receipt - computedNet}`);
    });
    process.exit(0);
}

inspectFinancials().catch(console.error);
