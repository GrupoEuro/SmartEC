const admin = require('firebase-admin');

admin.initializeApp({
    projectId: 'tiendapraxis'
});
const db = admin.firestore();

async function inspectFinancials() {
    const snap = await db.collection('orders')
        .where('sourceChannel', '==', 'mercadolibre')
        .orderBy('createdAt', 'desc')
        .limit(10)
        .get();

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
