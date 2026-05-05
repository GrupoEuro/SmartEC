/**
 * update-blog-og-images.js
 * Updates the 3 blog posts in Firestore to add dedicated OG images (1200x630).
 */
const { OAuth2Client } = require('google-auth-library');
const https = require('https');
const path = require('path');
const os = require('os');
const fs = require('fs');

const PROJECT_ID = 'tiendapraxis';
const configPath = path.join(os.homedir(), '.config/configstore/firebase-tools.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const client = new OAuth2Client(
  '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com',
  'j9iVZfS8kkqWEntmZJbEhFZQ',
  'urn:ietf:wg:oauth:2.0:oob'
);
client.setCredentials({ refresh_token: config.tokens.refresh_token, access_token: config.tokens.access_token });

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
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(JSON.parse(data));
        else reject(new Error(`HTTP ${res.statusCode}: ${data.substring(0, 300)}`));
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function getDocBySlug(slug, token) {
  const results = await request('POST',
    `/v1/projects/${PROJECT_ID}/databases/(default)/documents:runQuery`,
    { structuredQuery: { from: [{ collectionId: 'blog_posts' }], where: { fieldFilter: { field: { fieldPath: 'slug' }, op: 'EQUAL', value: { stringValue: slug } } }, limit: 1 } },
    token
  );
  for (const r of results) { if (r.document) return r.document.name; }
  return null;
}

const UPDATES = [
  {
    slug: 'guia-tallas-llanta-moto',
    ogImage: '/assets/blog/og-guia-tallas.jpg',
    label: 'Guía de tallas'
  },
  {
    slug: 'praxis-raptor-vs-urban',
    ogImage: '/assets/blog/og-raptor-vs-urban.jpg',
    label: 'Raptor vs Urban'
  },
  {
    slug: 'llantas-praxis-para-italika',
    ogImage: '/assets/blog/og-italika-llantas.jpg',
    label: 'Llantas para Italika'
  }
];

async function main() {
  const { token } = await client.getAccessToken();
  console.log('✅ Token obtained\n');

  for (const update of UPDATES) {
    const docName = await getDocBySlug(update.slug, token);
    if (!docName) {
      console.log(`⚠️  Not found: ${update.slug}`);
      continue;
    }

    // PATCH only the ogImage field (mask update)
    const patchUrl = `/v1/${docName}?updateMask.fieldPaths=ogImage`;
    await request('PATCH', patchUrl, {
      fields: {
        ogImage: { stringValue: update.ogImage }
      }
    }, token);

    console.log(`✅ Updated "${update.label}" → ogImage: ${update.ogImage}`);
  }

  console.log('\n🔗 OG images will appear in WhatsApp/Twitter/LinkedIn shares');
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
