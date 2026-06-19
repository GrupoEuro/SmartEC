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

const db = new Firestore({
  projectId: PROJECT_ID,
  authClient: oauth2Client
});

function startOfDay(d) {
    const r = new Date(d);
    r.setHours(0, 0, 0, 0);
    return r;
}

function endOfDay(d) {
    const r = new Date(d);
    r.setHours(23, 59, 59, 999);
    return r;
}

async function run() {
    const today = new Date('2026-05-21T12:48:27'); // Standardize today to current simulated date
    const startDate = new Date(today.getFullYear(), today.getMonth(), 1);
    const endDate = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);

    console.log(`Querying MTD orders between ${startDate.toISOString()} and ${endDate.toISOString()}...`);

    const snap = await db.collection('orders')
        .where('createdAt', '>=', startOfDay(startDate))
        .where('createdAt', '<=', endOfDay(endDate))
        .get();

    console.log(`Fetched ${snap.size} MTD orders from database.`);

    const orders = [];
    snap.forEach(d => {
        const data = d.data();
        orders.push({ id: d.id, ...data });
    });

    // 1. Simulating Operations Dashboard calculation (for timeframe = MTD)
    // Filtered by channelFilter
    console.log('\n=== OPERATIONS DASHBOARD SIMULATION ===');
    const channels = ['ALL', 'mercadolibre', 'storefront', 'amazon', 'pos', 'on_behalf'];
    for (const filter of channels) {
        let filteredOrders = orders;
        if (filter !== 'ALL') {
            const targetChannel = filter === 'web' ? 'storefront' : filter;
            filteredOrders = orders.filter(o => 
                o.sourceChannel === targetChannel || (!o.sourceChannel && targetChannel === 'storefront')
            );
        }

        const GHOST_STATUSES = ['payment_failed', 'pending_payment'];
        const EXCLUDED_FROM_REVENUE = ['cancelled', 'refunded', 'returned', 'pending_payment', 'refund_pending'];
        
        const countable = filteredOrders.filter(o => !GHOST_STATUSES.includes(o.status));
        let sales = 0;
        countable.forEach(o => {
            if (!EXCLUDED_FROM_REVENUE.includes(o.status)) {
                sales += o.total || 0;
            }
        });

        console.log(`Channel Filter: ${filter.padEnd(15)} | Countable Orders: ${countable.length.toString().padStart(4)} | Total Sales: $${sales.toFixed(2)} MXN`);
    }

    // 2. Simulating Income Analytics calculation (for period = mtd)
    console.log('\n=== INCOME ANALYTICS SIMULATION ===');
    const EXCLUDED = new Set(['cancelled', 'refunded', 'returned', 'pending_payment', 'refund_pending', 'payment_failed']);
    const meliOrders = orders.filter(o => {
        const ch = o.sourceChannel ?? '';
        if (!(ch === 'mercadolibre' || ch === 'MELI' || ch === 'MELI_CLASSIC' || ch === 'MELI_FULL')) return false;
        return !EXCLUDED.has(o.status);
    });

    let meliGross = 0;
    let meliNet = 0;
    meliOrders.forEach(o => {
        meliGross += o.total || 0;
        // Simple net calculation for quick check
        const comm = o.marketplaceFee || 0;
        const iva = o.retencion_iva || 0;
        const isr = o.retencion_isr || 0;
        const ship = o.shipping_seller_cost || 0;
        const refunds = o.refunded_amount || 0;
        const bonus = o.ml_bonus || 0;
        const net = Math.max(0, (o.total || 0) - comm - iva - isr - ship - refunds + bonus);
        meliNet += net;
    });

    console.log(`Meli Orders in Income Analytics: ${meliOrders.length}`);
    console.log(`Meli Gross Sales (Income Analytics): $${meliGross.toFixed(2)} MXN`);
    console.log(`Meli Net Sales (Income Analytics):   $${meliNet.toFixed(2)} MXN`);

    // 3. Print breakdown of all orders by status & channel
    console.log('\n=== BREAKDOWN BY CHANNEL AND STATUS ===');
    const breakdown = {};
    orders.forEach(o => {
        const ch = o.sourceChannel || '(undefined)';
        const st = o.status || '(undefined)';
        if (!breakdown[ch]) breakdown[ch] = {};
        if (!breakdown[ch][st]) breakdown[ch][st] = { count: 0, sales: 0 };
        breakdown[ch][st].count++;
        breakdown[ch][st].sales += o.total || 0;
    });

    console.log(JSON.stringify(breakdown, null, 2));
}

run().catch(console.error);
