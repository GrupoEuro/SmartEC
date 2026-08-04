const https  = require('https');
const fs     = require('fs');
const path   = require('path');

const configPath = path.join(process.env.HOME, '.config/configstore/firebase-tools.json');
const config     = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const tokens     = config.tokens;

const PROJECT  = 'tiendapraxis';

function refreshAccessToken(refreshToken) {
    return new Promise((resolve, reject) => {
        const body = new URLSearchParams({
            client_id:     '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com',
            client_secret: 'j9iVZfS8zyPyOgRXQE7zKoZ_',
            refresh_token: refreshToken,
            grant_type:    'refresh_token',
        }).toString();

        const options = {
            hostname: 'oauth2.googleapis.com',
            path:     '/token',
            method:   'POST',
            headers:  {
                'Content-Type':   'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(body),
            },
        };
        const req = https.request(options, res => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try   { resolve(JSON.parse(data)); }
                catch { reject(new Error('Bad token response: ' + data)); }
            });
        });
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

function firestoreQuery(token, query) {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify(query);
        const options = {
            hostname: 'firestore.googleapis.com',
            path:     `/v1/projects/${PROJECT}/databases/(default)/documents:runQuery`,
            method:   'POST',
            headers:  {
                'Authorization': `Bearer ${token}`,
                'Content-Type':  'application/json',
                'Content-Length': Buffer.byteLength(body),
            },
        };
        const req = https.request(options, res => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try   { resolve(JSON.parse(data)); }
                catch { reject(new Error('Bad query response: ' + data.slice(0, 300))); }
            });
        });
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

function parseField(f) {
    if (!f) return undefined;
    if (f.stringValue !== undefined) return f.stringValue;
    if (f.integerValue !== undefined) return parseInt(f.integerValue, 10);
    if (f.doubleValue !== undefined) return parseFloat(f.doubleValue);
    if (f.booleanValue !== undefined) return f.booleanValue;
    if (f.timestampValue !== undefined) return f.timestampValue;
    if (f.mapValue !== undefined) {
        const res = {};
        const m = f.mapValue.fields || {};
        for (const k in m) res[k] = parseField(m[k]);
        return res;
    }
    if (f.arrayValue !== undefined) {
        return (f.arrayValue.values || []).map(parseField);
    }
    return JSON.stringify(f);
}

function parseDoc(doc) {
    if (!doc || !doc.fields) return null;
    const res = { id: doc.name.split('/').pop(), fullPath: doc.name };
    for (const key in doc.fields) {
        res[key] = parseField(doc.fields[key]);
    }
    return res;
}

async function main() {
    const tokenRes = await refreshAccessToken(tokens.refresh_token);
    const token = tokenRes.access_token;
    console.log('Token refreshed successfully.');

    const collectionsToTry = [
        'orders',
        'carts',
        'guestCarts',
        'cartSnapshots',
        'users',
        'sales',
        'meli_orders',
        'abandoned_carts',
        'config'
    ];

    for (const col of collectionsToTry) {
        const res = await firestoreQuery(token, {
            structuredQuery: {
                from: [{ collectionId: col }],
                limit: 5
            }
        });
        const docs = Array.isArray(res) ? res.filter(r => r.document) : [];
        console.log(`\nCollection '${col}': found ${docs.length} documents.`);
        docs.forEach(d => {
            const p = parseDoc(d.document);
            console.log(`  - Doc ID: ${p.id} | Path: ${p.fullPath}`);
        });
    }
}

main().catch(console.error);
