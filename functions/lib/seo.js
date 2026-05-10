"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.onProductWriteIndexNow = exports.notifyIndexNow = exports.googleShoppingFeed = exports.sitemapXml = void 0;
/**
 * seo.ts
 * SEO functions: XML sitemap, Google Shopping feed, IndexNow notifications.
 */
const functions = require("firebase-functions");
const shared_1 = require("./shared");
// ── Sitemap ──────────────────────────────────────────────────────────────────
exports.sitemapXml = functions.https.onRequest(async (req, res) => {
    var _a, _b;
    const DOMAIN = 'https://importadoraeuro.com';
    try {
        const [productsSnap, blogSnap] = await Promise.all([
            shared_1.db.collection('products').where('active', '==', true).get(),
            shared_1.db.collection('blog_posts').where('published', '==', true).get(),
        ]);
        const now = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
        // Static pages
        const staticUrls = [
            { loc: `${DOMAIN}/`, priority: '1.0', changefreq: 'weekly' },
            // ── Catalog: /catalogo is canonical ──────────────────────────────────
            { loc: `${DOMAIN}/catalogo`, priority: '0.9', changefreq: 'daily' },
            { loc: `${DOMAIN}/catalog`, priority: '0.3', changefreq: 'monthly' },
            // ── Other pages ───────────────────────────────────────────────────────
            { loc: `${DOMAIN}/praxis`, priority: '0.7', changefreq: 'monthly' },
            { loc: `${DOMAIN}/blog`, priority: '0.7', changefreq: 'weekly' },
            { loc: `${DOMAIN}/help`, priority: '0.5', changefreq: 'monthly' },
            { loc: `${DOMAIN}/terms`, priority: '0.3', changefreq: 'yearly' },
            { loc: `${DOMAIN}/privacy`, priority: '0.3', changefreq: 'yearly' },
        ];
        const urlEntries = [];
        // Static pages
        for (const page of staticUrls) {
            urlEntries.push(`
  <url>
    <loc>${page.loc}</loc>
    <lastmod>${now}</lastmod>
    <changefreq>${page.changefreq}</changefreq>
    <priority>${page.priority}</priority>
  </url>`);
        }
        // Product pages
        for (const doc of productsSnap.docs) {
            const d = doc.data();
            const slug = d.slug || doc.id;
            const updatedAt = ((_a = d.updatedAt) === null || _a === void 0 ? void 0 : _a.toDate)
                ? d.updatedAt.toDate().toISOString().split('T')[0]
                : now;
            urlEntries.push(`
  <url>
    <loc>${DOMAIN}/product/${slug}</loc>
    <lastmod>${updatedAt}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>`);
        }
        // Blog post pages
        for (const doc of blogSnap.docs) {
            const d = doc.data();
            const slug = d.slug || doc.id;
            const publishedAt = ((_b = d.publishedAt) === null || _b === void 0 ? void 0 : _b.toDate)
                ? d.publishedAt.toDate().toISOString().split('T')[0]
                : now;
            urlEntries.push(`
  <url>
    <loc>${DOMAIN}/blog/${slug}</loc>
    <lastmod>${publishedAt}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.6</priority>
  </url>`);
        }
        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
        xsi:schemaLocation="http://www.sitemaps.org/schemas/sitemap/0.9
          http://www.sitemaps.org/schemas/sitemap/0.9/sitemap.xsd">
${urlEntries.join('')}
</urlset>`;
        res.set('Content-Type', 'application/xml; charset=utf-8');
        res.set('Cache-Control', 'public, max-age=3600'); // 1-hour cache
        res.status(200).send(xml);
    }
    catch (e) {
        console.error('[sitemapXml] Error:', e);
        res.status(500).send('Sitemap generation failed.');
    }
});
// ─── Phase 2.1 — Abandoned Cart Recovery Automation ─────────────────────────
// Triggered when cartSnapshots receives an abandoned_detected event.
// Queues a multi-step recovery sequence in recovery_queue.
// Step 1 (1 hour): WhatsApp message + cart link
// Step 2 (24 hours): WhatsApp + auto-generated 5% coupon code
// Uses provider-agnostic notification_outbox — plug in Twilio / WABA / any provider.
// ── Google Shopping Feed ──────────────────────────────────────────────────────
exports.googleShoppingFeed = functions
    .runWith({ timeoutSeconds: 30, memory: '256MB' })
    .https.onRequest(async (req, res) => {
    try {
        // Fetch all active, published products
        const snap = await shared_1.db.collection('products')
            .where('active', '==', true)
            .where('inStock', '==', true)
            .limit(500)
            .get();
        const items = snap.docs.map(doc => {
            var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p;
            const p = doc.data();
            const id = doc.id;
            const sku = (_a = p['sku']) !== null && _a !== void 0 ? _a : id;
            const brand = (_b = p['brand']) !== null && _b !== void 0 ? _b : 'Importadora Euro';
            const price = Number((_c = p['price']) !== null && _c !== void 0 ? _c : 0);
            const slug = (_d = p['slug']) !== null && _d !== void 0 ? _d : id;
            // Build human-readable title with size specs
            const namePart = ((_g = (_f = (_e = p['name']) === null || _e === void 0 ? void 0 : _e.es) !== null && _f !== void 0 ? _f : p['name']) !== null && _g !== void 0 ? _g : 'Llanta Motocicleta');
            const specs = (_h = p['specifications']) !== null && _h !== void 0 ? _h : {};
            const sizePart = specs['width'] && specs['aspectRatio'] && specs['diameter']
                ? ` ${specs['width']}/${specs['aspectRatio']}${specs['construction'] === 'radial' ? 'R' : '-'}${specs['diameter']}`
                : '';
            const title = `${namePart}${sizePart}`.slice(0, 150);
            const description = ((_l = (_k = (_j = p['description']) === null || _j === void 0 ? void 0 : _j.es) !== null && _k !== void 0 ? _k : p['description']) !== null && _l !== void 0 ? _l : '')
                .replace(/[<>&"']/g, ' ')
                .slice(0, 5000);
            const imageLink = (_p = (_o = (_m = p['images']) === null || _m === void 0 ? void 0 : _m.main) !== null && _o !== void 0 ? _o : p['imageUrl']) !== null && _p !== void 0 ? _p : '';
            const productUrl = `https://importadoraeuro.com/product/${slug}`;
            // Additional product type breadcrumb
            const productTypeBreadcrumb = brand === 'Michelin'
                ? 'Llantas para Motocicleta > Michelin'
                : brand === 'Praxis'
                    ? 'Llantas para Motocicleta > Praxis'
                    : 'Llantas para Motocicleta';
            if (price <= 0 || !imageLink)
                return null; // skip incomplete products
            return `
    <item>
      <g:id>${escapeXml(sku)}</g:id>
      <g:title>${escapeXml(title)}</g:title>
      <g:description>${escapeXml(description || title)}</g:description>
      <g:link>${escapeXml(productUrl)}</g:link>
      <g:image_link>${escapeXml(imageLink)}</g:image_link>
      <g:condition>new</g:condition>
      <g:availability>in_stock</g:availability>
      <g:price>${price.toFixed(2)} MXN</g:price>
      <g:sale_price>${specs['compareAtPrice'] ? Number(specs['compareAtPrice']).toFixed(2) + ' MXN' : ''}</g:sale_price>
      <g:brand>${escapeXml(brand)}</g:brand>
      <g:mpn>${escapeXml(sku)}</g:mpn>
      <g:product_type>${escapeXml(productTypeBreadcrumb)}</g:product_type>
      <g:google_product_category>5613</g:google_product_category>
      <g:identifier_exists>no</g:identifier_exists>
      <g:shipping>
        <g:country>MX</g:country>
        <g:service>Estándar (DHL/FedEx)</g:service>
        <g:price>0 MXN</g:price>
        <g:min_handling_time>0</g:min_handling_time>
        <g:max_handling_time>1</g:max_handling_time>
        <g:min_transit_time>1</g:min_transit_time>
        <g:max_transit_time>3</g:max_transit_time>
      </g:shipping>
      <g:return_policy_label>return_policy</g:return_policy_label>
    </item>`;
        }).filter(Boolean);
        const feedXml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
  <channel>
    <title>Importadora Eurollantas — Llantas para Motocicleta</title>
    <link>https://importadoraeuro.com</link>
    <description>Distribuidor autorizado Michelin y Praxis. Llantas de motocicleta con envío a toda la República Mexicana desde San Luis Potosí.</description>
    <language>es-MX</language>
    ${items.join('\n')}
  </channel>
</rss>`;
        res.set('Content-Type', 'application/rss+xml; charset=utf-8');
        res.set('Cache-Control', 'public, max-age=3600, s-maxage=3600'); // 1hr cache
        res.set('Access-Control-Allow-Origin', '*');
        res.status(200).send(feedXml);
        console.log(`[ShoppingFeed] Served ${items.length} products`);
    }
    catch (err) {
        console.error('[ShoppingFeed] Error:', err);
        res.status(500).send('Feed generation failed');
    }
});
/** Escapes XML special characters for safe embedding in XML attributes/content. */
function escapeXml(str) {
    return String(str !== null && str !== void 0 ? str : '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}
// ═══════════════════════════════════════════════════════════════════════════════
// ─── INDEXNOW — Instant Bing/Copilot Reindexing ───────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
//
// Pings IndexNow API when products or catalog pages are updated.
// Bing shares IndexNow data with Yandex, Seznam, Naver — one call covers all.
// Bing → feeds Microsoft Copilot citations directly.
//
// Key: stored in Firestore config/seo.indexNowKey
// Register key: bing.com/webmasters → Settings → IndexNow
//              Then serve the key at: https://importadoraeuro.com/{key}.txt
//              (add to firebase.json rewrites or just create public/{key}.txt)
// ─────────────────────────────────────────────────────────────────────────────
exports.notifyIndexNow = functions
    .runWith({ timeoutSeconds: 10 })
    .https.onCall(async (data, context) => {
    var _a, _b, _c;
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Login required.');
    }
    // Load IndexNow key from Firestore config
    const configSnap = await shared_1.db.collection('config').doc('seo').get();
    const indexNowKey = (_b = (_a = configSnap.data()) === null || _a === void 0 ? void 0 : _a.indexNowKey) !== null && _b !== void 0 ? _b : '';
    if (!indexNowKey) {
        console.warn('[IndexNow] No key configured in config/seo.indexNowKey');
        return { ok: false, reason: 'No IndexNow key configured' };
    }
    // Default URLs to notify: homepage, catalog, Praxis page, Michelin page, llms.txt
    const urlsToNotify = ((_c = data === null || data === void 0 ? void 0 : data.urls) === null || _c === void 0 ? void 0 : _c.length)
        ? data.urls
        : [
            'https://importadoraeuro.com/',
            'https://importadoraeuro.com/catalogo',
            'https://importadoraeuro.com/praxis',
            'https://importadoraeuro.com/michelin',
            'https://importadoraeuro.com/llms.txt',
            'https://importadoraeuro.com/llms-full.txt',
            'https://importadoraeuro.com/sitemap.xml',
        ];
    const payload = {
        host: 'importadoraeuro.com',
        key: indexNowKey,
        keyLocation: `https://importadoraeuro.com/${indexNowKey}.txt`,
        urlList: urlsToNotify,
    };
    try {
        const r = await fetch('https://api.indexnow.org/indexnow', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json; charset=utf-8' },
            body: JSON.stringify(payload),
        });
        console.log(`[IndexNow] Response: ${r.status} for ${urlsToNotify.length} URLs`);
        return { ok: r.ok, status: r.status, urls: urlsToNotify.length };
    }
    catch (err) {
        console.error('[IndexNow] Fetch failed:', err.message);
        return { ok: false, reason: err.message };
    }
});
// ─── Auto-notify IndexNow when a product is updated ──────────────────────────
// Firestore trigger: fires when any product document is written.
// Submits the specific product URL + catalog page to IndexNow.
exports.onProductWriteIndexNow = functions
    .runWith({ timeoutSeconds: 15 })
    .firestore
    .document('products/{productId}')
    .onWrite(async (change, context) => {
    var _a, _b, _c;
    // Only notify on creates and updates, not deletes
    if (!change.after.exists)
        return;
    const product = change.after.data();
    const slug = (_a = product['slug']) !== null && _a !== void 0 ? _a : context.params.productId;
    const configSnap = await shared_1.db.collection('config').doc('seo').get();
    const indexNowKey = (_c = (_b = configSnap.data()) === null || _b === void 0 ? void 0 : _b.indexNowKey) !== null && _c !== void 0 ? _c : '';
    if (!indexNowKey)
        return; // Key not configured yet — skip silently
    const urlsToNotify = [
        `https://importadoraeuro.com/product/${slug}`,
        'https://importadoraeuro.com/catalogo',
        'https://importadoraeuro.com/google-shopping-feed.xml',
    ];
    try {
        await fetch('https://api.indexnow.org/indexnow', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json; charset=utf-8' },
            body: JSON.stringify({
                host: 'importadoraeuro.com',
                key: indexNowKey,
                keyLocation: `https://importadoraeuro.com/${indexNowKey}.txt`,
                urlList: urlsToNotify,
            }),
        });
        console.log(`[IndexNow] Product ${slug} notified to Bing`);
    }
    catch (err) {
        console.warn('[IndexNow] Auto-notify failed (non-critical):', err.message);
    }
});
// ── MercadoLibre Universal Inbox Sync ───────────────────────────────────────
//# sourceMappingURL=seo.js.map