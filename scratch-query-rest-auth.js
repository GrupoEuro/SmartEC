const { OAuth2Client } = require('google-auth-library');
const https = require('https');
const path = require('path');
const os = require('os');
const fs = require('fs');

const PROJECT_ID = 'tiendapraxis';

const configPath = path.join(os.homedir(), '.config/configstore/firebase-tools.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const tokens = config.tokens;

const client = new OAuth2Client(
  '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com',
  'j9iVZfS8kkqWEntmZJbEhFZQ',
  'urn:ietf:wg:oauth:2.0:oob'
);
client.setCredentials({ refresh_token: tokens.refresh_token, access_token: tokens.access_token });

function request(method, urlPath, body, token) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'firestore.googleapis.com',
      path: urlPath,
      method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {})
      }
    };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(JSON.parse(data));
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function main() {
  console.log('Refreshing token using OAuth2Client with correct client secret...');
  const { token } = await client.getAccessToken();
  console.log('✅ Access token obtained successfully.');

  // Let's get the order
  try {
      const order = await request('GET', `/v1/projects/${PROJECT_ID}/databases/(default)/documents/orders/meli_2000016528011810`, null, token);
      console.log('Order:');
      console.log(JSON.stringify(order, null, 2));
  } catch (e) {
      console.error('Error fetching order:', e.message);
  }
}

main().catch(console.error);
