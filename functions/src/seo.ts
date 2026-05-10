/**
 * seo.ts
 * SEO functions: XML sitemap, Google Shopping feed, IndexNow notifications.
 */
import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { db } from './shared';

// ── Sitemap ──────────────────────────────────────────────────────────────────
export const sitemapXml = functions.https.onRequest(async (req, res) => {
    const DOMAIN = 'https://importadoraeuro.com';

    try {
        const [productsSnap, blogSnap] = await Promise.all([
            db.collection('products').where('active', '==', true).get(),
            db.collection('blog_posts').where('published', '==', true).get(),
        ]);

        const now = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

        // Static pages
        const staticUrls = [
            { loc: `${DOMAIN}/`, priority: '1.0', changefreq: 'weekly' },
            // ── Catalog: /catalogo is canonical ──────────────────────────────────
            { loc: `${DOMAIN}/catalogo`, priority: '0.9', changefreq: 'daily' },
            { loc: `${DOMAIN}/catalog`, priority: '0.3', changefreq: 'monthly' }, // 301 → /catalogo
            // ── Other pages ───────────────────────────────────────────────────────
            { loc: `${DOMAIN}/praxis`, priority: '0.7', changefreq: 'monthly' },
            { loc: `${DOMAIN}/blog`, priority: '0.7', changefreq: 'weekly' },
            { loc: `${DOMAIN}/help`, priority: '0.5', changefreq: 'monthly' },
            { loc: `${DOMAIN}/terms`, priority: '0.3', changefreq: 'yearly' },
            { loc: `${DOMAIN}/privacy`, priority: '0.3', changefreq: 'yearly' },
        ];

        const urlEntries: string[] = [];

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
            const updatedAt = d.updatedAt?.toDate
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
            const publishedAt = d.publishedAt?.toDate
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
    } catch (e) {
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
export const googleShoppingFeed = functions
    .runWith({ timeoutSeconds: 30, memory: '256MB' })
    .https.onRequest(async (req, res) => {
        try {
            // Fetch all active, published products
            const snap = await db.collection('products')
                .where('active', '==', true)
                .where('inStock', '==', true)
                .limit(500)
                .get();

            const items = snap.docs.map(doc => {
                const p = doc.data();
                const id = doc.id;
                const sku = p['sku'] ?? id;
                const brand = p['brand'] ?? 'Importadora Euro';
                const price = Number(p['price'] ?? 0);
                const slug = p['slug'] ?? id;

                // Build human-readable title with size specs
                const namePart = (p['name']?.es ?? p['name'] ?? 'Llanta Motocicleta') as string;
                const specs = p['specifications'] as Record<string, any> ?? {};
                const sizePart = specs['width'] && specs['aspectRatio'] && specs['diameter']
                    ? ` ${specs['width']}/${specs['aspectRatio']}${specs['construction'] === 'radial' ? 'R' : '-'}${specs['diameter']}`
                    : '';
                const title = `${namePart}${sizePart}`.slice(0, 150);

                const description = ((p['description']?.es ?? p['description'] ?? '') as string)
                    .replace(/[<>&"']/g, ' ')
                    .slice(0, 5000);

                const imageLink = p['images']?.main ?? p['imageUrl'] ?? '';
                const productUrl = `https://importadoraeuro.com/product/${slug}`;

                // Additional product type breadcrumb
                const productTypeBreadcrumb = brand === 'Michelin'
                    ? 'Llantas para Motocicleta > Michelin'
                    : brand === 'Praxis'
                        ? 'Llantas para Motocicleta > Praxis'
                        : 'Llantas para Motocicleta';

                if (price <= 0 || !imageLink) return null; // skip incomplete products

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
        } catch (err: any) {
            console.error('[ShoppingFeed] Error:', err);
            res.status(500).send('Feed generation failed');
        }
    });

/** Escapes XML special characters for safe embedding in XML attributes/content. */
function escapeXml(str: string): string {
    return String(str ?? '')
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

export const notifyIndexNow = functions
    .runWith({ timeoutSeconds: 10 })
    .https.onCall(async (data: { urls?: string[] }, context) => {
        if (!context.auth) {
            throw new functions.https.HttpsError('unauthenticated', 'Login required.');
        }

        // Load IndexNow key from Firestore config
        const configSnap = await db.collection('config').doc('seo').get();
        const indexNowKey: string = configSnap.data()?.indexNowKey ?? '';
        if (!indexNowKey) {
            console.warn('[IndexNow] No key configured in config/seo.indexNowKey');
            return { ok: false, reason: 'No IndexNow key configured' };
        }

        // Default URLs to notify: homepage, catalog, Praxis page, Michelin page, llms.txt
        const urlsToNotify: string[] = data?.urls?.length
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
        } catch (err: any) {
            console.error('[IndexNow] Fetch failed:', err.message);
            return { ok: false, reason: err.message };
        }
    });

// ─── Auto-notify IndexNow when a product is updated ──────────────────────────
// Firestore trigger: fires when any product document is written.
// Submits the specific product URL + catalog page to IndexNow.

export const onProductWriteIndexNow = functions
    .runWith({ timeoutSeconds: 15 })
    .firestore
    .document('products/{productId}')
    .onWrite(async (change, context) => {
        // Only notify on creates and updates, not deletes
        if (!change.after.exists) return;

        const product = change.after.data()!;
        const slug = product['slug'] ?? context.params.productId;

        const configSnap = await db.collection('config').doc('seo').get();
        const indexNowKey: string = configSnap.data()?.indexNowKey ?? '';
        if (!indexNowKey) return; // Key not configured yet — skip silently

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
        } catch (err: any) {
            console.warn('[IndexNow] Auto-notify failed (non-critical):', err.message);
        }
    });

// ── MercadoLibre Universal Inbox Sync ───────────────────────────────────────
