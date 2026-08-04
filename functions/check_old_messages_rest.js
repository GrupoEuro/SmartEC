/**
 * Queries Firestore via REST API using Firebase CLI token.
 * Run: node check_old_messages_rest.js
 */

const https = require('https');
const path  = require('path');

const cfg = require(process.env.HOME + '/.config/configstore/firebase-tools.json');
const refreshToken = cfg.tokens?.refresh_token;
const PROJECT = 'tiendapraxis';
const CUTOFF  = new Date('2026-07-02T00:00:00Z');

async function getAccessToken() {
    return new Promise((resolve, reject) => {
        const body = `grant_type=refresh_token&client_id=563584335869-fgusjuh08vcd5r5h6vq3oat02o73f6bh.apps.googleusercontent.com&client_secret=j9iVZfS8vu8p3fAMFpFnPFJW&refresh_token=${encodeURIComponent(refreshToken)}`;
        const req = https.request({
            hostname: 'oauth2.googleapis.com',
            path: '/token',
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) }
        }, res => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try { resolve(JSON.parse(data).access_token); } catch { reject(new Error('Parse error: ' + data)); }
            });
        });
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

async function firestorePost(token, body) {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify(body);
        const req = https.request({
            hostname: 'firestore.googleapis.com',
            path: `/v1/projects/${PROJECT}/databases/(default)/documents:runQuery`,
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
        }, res => {
            let out = '';
            res.on('data', chunk => out += chunk);
            res.on('end', () => {
                try { resolve(JSON.parse(out)); } catch { reject(new Error('Parse error: ' + out.slice(0, 200))); }
            });
        });
        req.on('error', reject);
        req.write(data);
        req.end();
    });
}

function parseFirestoreDate(firestoreVal) {
    if (!firestoreVal) return null;
    const s = firestoreVal.timestampValue || firestoreVal.stringValue;
    return s ? new Date(s) : null;
}

async function main() {
    console.log('Getting access token...');
    const token = await getAccessToken();
    console.log('Token acquired.\n');

    // Query all customer_conversations
    const convQuery = {
        structuredQuery: {
            from: [{ collectionId: 'customer_conversations' }],
            select: { fields: [{ fieldPath: 'createdAt' }, { fieldPath: 'updatedAt' }, { fieldPath: 'channel' }, { fieldPath: 'customerName' }, { fieldPath: 'lastMessage' }] },
            limit: 1000
        }
    };

    console.log('Querying customer_conversations...');
    const convResults = await firestorePost(token, convQuery);

    let olderConvsCount = 0;
    let totalConvsCount = 0;
    let oldestConvDate = null;
    let newestConvDate = null;

    for (const row of convResults) {
        if (!row.document) continue;
        totalConvsCount++;
        const fields = row.document.fields || {};
        const dateVal = parseFirestoreDate(fields.createdAt);
        if (dateVal) {
            if (!oldestConvDate || dateVal < oldestConvDate) oldestConvDate = dateVal;
            if (!newestConvDate || dateVal > newestConvDate) newestConvDate = dateVal;
            if (dateVal < CUTOFF) olderConvsCount++;
        }
    }

    console.log(`Total conversations found: ${totalConvsCount}`);
    console.log(`Conversations before Jul 2, 2026: ${olderConvsCount}`);
    console.log(`Oldest: ${oldestConvDate?.toISOString() ?? 'N/A'}`);
    console.log(`Newest: ${newestConvDate?.toISOString() ?? 'N/A'}`);

    // Query messages (collectionGroup) — limited to 500 to avoid timeout
    const msgQuery = {
        structuredQuery: {
            from: [{ collectionId: 'messages', allDescendants: true }],
            select: { fields: [{ fieldPath: 'timestamp' }, { fieldPath: 'text' }, { fieldPath: 'direction' }, { fieldPath: 'channel' }] },
            orderBy: [{ field: { fieldPath: 'timestamp' }, direction: 'ASCENDING' }],
            limit: 500
        }
    };

    console.log('\nQuerying messages (oldest 500)...');
    const msgResults = await firestorePost(token, msgQuery);

    let olderMsgsCount = 0;
    let totalMsgs = 0;
    let oldestMsgDate = null;
    let newestMsgDate = null;
    const samples = [];

    for (const row of msgResults) {
        if (!row.document) continue;
        totalMsgs++;
        const fields = row.document.fields || {};
        const dateVal = parseFirestoreDate(fields.timestamp);
        if (dateVal) {
            if (!oldestMsgDate || dateVal < oldestMsgDate) oldestMsgDate = dateVal;
            if (!newestMsgDate || dateVal > newestMsgDate) newestMsgDate = dateVal;
            if (dateVal < CUTOFF) {
                olderMsgsCount++;
                if (samples.length < 5) {
                    samples.push({
                        timestamp: dateVal.toISOString(),
                        text: (fields.text?.stringValue || '').slice(0, 60),
                        direction: fields.direction?.stringValue,
                        path: row.document.name
                    });
                }
            }
        }
    }

    console.log(`\nMessages checked (oldest batch of ${totalMsgs}):`);
    console.log(`Messages before Jul 2, 2026: ${olderMsgsCount}`);
    console.log(`Oldest message: ${oldestMsgDate?.toISOString() ?? 'N/A'}`);
    console.log(`Newest message in batch: ${newestMsgDate?.toISOString() ?? 'N/A'}`);

    if (samples.length) {
        console.log('\nSample old messages:');
        samples.forEach(s => console.log(` - [${s.timestamp}] (${s.direction}) "${s.text}"`));
    } else {
        console.log('\nNo messages found older than July 2, 2026.');
    }
}

main().catch(err => { console.error('Error:', err.message); process.exit(1); });
