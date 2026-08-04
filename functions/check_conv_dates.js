/**
 * Checks actual conversation and message date ranges in Firestore.
 * Run: node check_conv_dates.js
 */

const https = require('https');
const cfg = require(process.env.HOME + '/.config/configstore/firebase-tools.json');
const refreshToken = cfg.tokens?.refresh_token;
const PROJECT = 'tiendapraxis';

async function getAccessToken() {
    return new Promise((resolve, reject) => {
        const body = `grant_type=refresh_token&client_id=563584335869-fgusjuh08vcd5r5h6vq3oat02o73f6bh.apps.googleusercontent.com&client_secret=j9iVZfS8vu8p3fAMFpFnPFJW&refresh_token=${encodeURIComponent(refreshToken)}`;
        const req = https.request({
            hostname: 'oauth2.googleapis.com',
            path: '/token',
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) }
        }, res => {
            let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve(JSON.parse(d).access_token); } catch { reject(new Error(d)); } });
        });
        req.on('error', reject); req.write(body); req.end();
    });
}

async function restGet(token, path) {
    return new Promise((resolve, reject) => {
        const req = https.request({
            hostname: 'firestore.googleapis.com',
            path,
            method: 'GET',
            headers: { 'Authorization': `Bearer ${token}` }
        }, res => {
            let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve(JSON.parse(d)); } catch { reject(new Error(d.slice(0, 300))); } });
        });
        req.on('error', reject); req.end();
    });
}

function getDate(fields, ...keys) {
    for (const k of keys) {
        const v = fields?.[k];
        if (v?.timestampValue) return new Date(v.timestampValue);
        if (v?.stringValue) return new Date(v.stringValue);
    }
    return null;
}

async function main() {
    const token = await getAccessToken();
    console.log('Access token acquired.\n');

    // List conversations with pagination
    let pageToken = '';
    let total = 0;
    let oldest = null, newest = null;
    const CUTOFF = new Date('2026-07-02T00:00:00Z');
    let beforeCutoff = 0;

    console.log('Scanning customer_conversations...');
    do {
        const url = `/v1/projects/${PROJECT}/databases/(default)/documents/customer_conversations?pageSize=200${pageToken ? '&pageToken=' + pageToken : ''}`;
        const result = await restGet(token, url);

        const docs = result.documents || [];
        for (const doc of docs) {
            total++;
            const d = getDate(doc.fields, 'createdAt', 'updatedAt');
            if (d) {
                if (!oldest || d < oldest) oldest = d;
                if (!newest || d > newest) newest = d;
                if (d < CUTOFF) beforeCutoff++;
            }
        }
        pageToken = result.nextPageToken || '';
        process.stdout.write(`\r  Found ${total} conversations so far...`);
    } while (pageToken);

    console.log(`\n\nTotal conversations: ${total}`);
    console.log(`Before July 2, 2026: ${beforeCutoff}`);
    console.log(`Oldest: ${oldest?.toISOString() ?? 'N/A'}`);
    console.log(`Newest: ${newest?.toISOString() ?? 'N/A'}`);

    // Now get a sample conversation to check message format
    if (total > 0) {
        const sampleUrl = `/v1/projects/${PROJECT}/databases/(default)/documents/customer_conversations?pageSize=1`;
        const sample = await restGet(token, sampleUrl);
        const sampleDoc = sample.documents?.[0];
        if (sampleDoc) {
            const convId = sampleDoc.name.split('/').pop();
            console.log(`\nSample conversation ID: ${convId}`);
            console.log('Fields:', Object.keys(sampleDoc.fields || {}).join(', '));

            // Get messages for that conversation
            const msgsUrl = `/v1/projects/${PROJECT}/databases/(default)/documents/customer_conversations/${convId}/messages?pageSize=5`;
            const msgsResult = await restGet(token, msgsUrl);
            const msgs = msgsResult.documents || [];
            console.log(`Messages in sample: ${msgs.length}`);
            if (msgs[0]) {
                console.log('Message fields:', Object.keys(msgs[0].fields || {}).join(', '));
                const ts = getDate(msgs[0].fields, 'timestamp', 'createdAt');
                console.log('First message timestamp:', ts?.toISOString() ?? 'N/A');
            }
        }
    }
}

main().catch(err => { console.error('Error:', err.message || err); process.exit(1); });
