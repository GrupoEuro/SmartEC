import { APP_BASE_HREF } from '@angular/common';
import { CommonEngine } from '@angular/ssr';
import express from 'express';
import compression from 'compression';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import bootstrap from './src/main.server';

// The Express app is exported so that it can be used by serverless Functions.
export function app(): express.Express {
  const server = express();
  server.use(compression());
  const serverDistFolder = dirname(fileURLToPath(import.meta.url));
  const browserDistFolder = resolve(serverDistFolder, '../browser');
  const indexHtml = join(serverDistFolder, 'index.server.html');

  const commonEngine = new CommonEngine();

  server.set('view engine', 'html');
  server.set('views', browserDistFolder);

  // Example Express Rest API endpoints
  // server.get('/api/**', (req, res) => { });
  // Serve static files from /browser
  server.get('*.*', express.static(browserDistFolder, {
    maxAge: '1y'
  }));

  // Dynamic Sitemap
  server.get('/sitemap.xml', async (req, res) => {
    try {
      res.header('Content-Type', 'application/xml');

      // Basic static URLs
      const baseUrl = 'https://importadora-euro.com';
      const staticUrls = [
        `${baseUrl}/`,
        `${baseUrl}/catalog`,
        `${baseUrl}/blog`,
        `${baseUrl}/biblioteca`,
        `${baseUrl}/help`
      ];

      // Initialize Firebase Admin if not already initialized
      const { getApps, initializeApp } = await import('firebase-admin/app');
      const { getFirestore } = await import('firebase-admin/firestore');

      if (getApps().length === 0) {
        try {
          initializeApp();
        } catch (e) {
          console.warn('Firebase Admin init failed. returning static map.');
        }
      }

      let blogUrls: string[] = [];

      if (getApps().length > 0) {
        try {
          const db = getFirestore();

          // Blog Posts
          const postsSnapshot = await db.collection('blog_posts').get();
          blogUrls = postsSnapshot.docs.map(doc => {
            const data = doc.data();
            const slug = data['slug'] || doc.id;
            return `${baseUrl}/blog/${slug}`;
          });
        } catch (dbError) {
          console.error('Error fetching data for sitemap:', dbError);
        }
      }

      const allUrls = [...staticUrls, ...blogUrls];

      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${allUrls.map(url => `  <url>
    <loc>${url}</loc>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>`).join('\n')}
</urlset>`;

      res.send(xml);

    } catch (e) {
      console.error('Sitemap generation error:', e);
      res.status(500).end();
    }
  });

  // All regular routes use the Angular engine
  server.get('*', (req, res, next) => {
    const { protocol, originalUrl, baseUrl, headers } = req;

    commonEngine
      .render({
        bootstrap,
        documentFilePath: indexHtml,
        url: `${protocol}://${headers.host}${originalUrl}`,
        publicPath: browserDistFolder,
        providers: [{ provide: APP_BASE_HREF, useValue: baseUrl }],
      })
      .then((html) => res.send(html))
      .catch((err) => next(err));
  });

  return server;
}

function run(): void {
  const port = process.env['PORT'] || 4000;

  // Start up the Node server
  const server = app();
  server.listen(port, () => {
    console.log(`Node Express server listening on http://localhost:${port}`);
  });
}

run();
