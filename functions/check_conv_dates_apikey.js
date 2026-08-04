/**
 * Checks conversation date ranges using Firebase API key (no OAuth needed).
 * Uses the Firestore REST API with the web API key for read-only access.
 * Run: node check_conv_dates_apikey.js
 */

const https = require('https');

const API_KEY  = 'AIzaSyBL1qo-Ta4pW9sgx-CucJ4Uj9c_Bjef3a4';
const PROJECT  = 'tiendapraxis';
const CUTOFF   = new Date('2026-07-02T00:00:00Z');

// First sign in anonymously to get a token
async function signInAnonymously() {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify({ returnSecureToken: true });
        const req = https.request({
            hostname: 'identitytoolkit.googleapis.com',
            path: `/v1/accounts:signUp?key=${API_KEY}`,
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
        }, res => {
            let d = ''; res.on('data', c => d += c); res.on('end', () => {
                try { const j = JSON.parse(d); resolve(j.idToken); }
                catch { reject(new Error(d.slice(0, 200))); }
            });
        });
        req.on('error', reject); req.write(body); req.end();
    });
}

async function firestoreQuery(token, body) {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify(body);
        const req = https.request({
            hostname: 'firestore.googleapis.com',
            path: `/v1/projects/${PROJECT}/databases/(default)/documents:runQuery`,
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
        }, res => {
            let d = ''; res.on('data', c => d += c); res.on('end', () => {
                try { resolve(JSON.parse(d)); } catch { reject(new Error(d.slice(0, 300))); }
            });
        });
        req.on('error', reject); req.write(data); req.end();
    });
}

function getDate(fields, ...keys) {
    for (const k of keys) {
        const v = fields?.[k];
        if (v?.timestampValue) return new Date(v.timestampValue);
        if (v?.stringValue) { const d = new Date(v.stringValue); if (!isNaN(d)) return d; }
    }
    return null;
}

async function main() {
    console.log('Signing in anonymously...');
    const token = await signInAnonymously();
    console.log('Auth token acquired.\n');

    // Query for the oldest conversations
    const oldestQuery = {
        structuredQuery: {
            from: [{ collectionId: 'customer_conversations' }],
            select: { fields: [
                { fieldPath: 'createdAt' }, { fieldPath: 'updatedAt' },
                { fieldPath: 'customerName' }, { fieldPath: 'channel' }
            ]},
            orderBy: [{ field: { fieldPath: 'createdAt' }, direction: 'ASCENDING' }],
            limit: 5
        }
    };

    // Query for the newest conversations
    const newestQuery = {
        structuredQuery: {
            from: [{ collectionId: 'customer_conversations' }],
            select: { fields: [
                { fieldPath: 'createdAt' }, { fieldPath: 'updatedAt' },
                { fieldPath: 'customerName' }, { fieldPath: 'channel' }
            ]},
            orderBy: [{ field: { fieldPath: 'createdAt' }, direction: 'DESCENDING' }],
            limit: 5
        }
    };

    // Count query
    const countQuery = {
        structuredQuery: {
            from: [{ collectionId: 'customer_conversations' }],
            select: { fields: [{ fieldPath: 'createdAt' }] },
            limit: 1000
        }
    };

    console.log('Querying oldest conversations...');
    const oldestResults = await firestoreQuery(token, oldestQuery);

    console.log('Querying newest conversations...');
    const newestResults = await firestoreQuery(token, newestQuery);

    console.log('Counting all conversations (up to 1000)...');
    const countResults = await firestoreQuery(token, countQuery);

    console.log('\n--- RESULTS ---');

    const countDocs = countResults.filter(r => r.document);
    console.log(`Total conversations counted: ${countDocs.length}${countDocs.length === 1000 ? '+' : ''}`);

    const preCutoff = countDocs.filter(r => {
        const d = getDate(r.document?.fields, 'createdAt', 'updatedAt');
        return d && d < CUTOFF;
    });
    console.log(`Conversations before July 2, 2026: ${preCutoff.length}`);

    console.log('\nOldest conversations:');
    oldestResults.filter(r => r.document).forEach(r => {
        const f = r.document.fields;
        const d = getDate(f, 'createdAt');
        console.log(`  ${d?.toISOString() ?? 'no date'} | ${f?.channel?.stringValue ?? '?'} | ${f?.customerName?.stringValue ?? '?'}`);
    });

    console.log('\nNewest conversations:');
    newestResults.filter(r => r.document).forEach(r => {
        const f = r.document.fields;
        const d = getDate(f, 'createdAt');
        console.log(`  ${d?.toISOString() ?? 'no date'} | ${f?.channel?.stringValue ?? '?'} | ${f?.customerName?.stringValue ?? '?'}`);
    });
}

main().catch(err => { console.error('\nError:', err.message || err); process.exit(1); });
