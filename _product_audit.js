/**
 * FULL PRODUCT AUDIT — Admin vs Storefront Catalog Discrepancy
 * Run: firebase login  (if not authenticated)
 *      node _product_audit.js
 *
 * Replicates the exact filter in catalog-v2.component.ts buildPipeline():
 *   p.active !== false
 *   && (!p.publishStatus || p.publishStatus === 'published')
 *   && (!p.visibility   || p.visibility   === 'public')
 */
const admin = require('firebase-admin');

// Try Application Default Credentials first, then fall back to firebase-tools token
let db;
try {
  admin.initializeApp({ projectId: 'tiendapraxis' });
  db = admin.firestore();
} catch(e) {
  console.error('Could not init firebase-admin:', e.message);
  process.exit(1);
}

const pname = p => {
  const n = p.name || {};
  if (typeof n === 'object') return (n.es || n.en || '?').slice(0, 40);
  return String(n).slice(0, 40);
};

const isVisible = p =>
  p.active !== false &&
  (!p.publishStatus || p.publishStatus === 'published') &&
  (!p.visibility    || p.visibility   === 'public');

async function run() {
  console.log('='.repeat(72));
  console.log('  PRODUCT AUDIT: Admin vs Storefront Catalog Discrepancy');
  console.log('='.repeat(72));

  const snap = await db.collection('products').get();
  const all = [];
  snap.forEach(doc => all.push({ _id: doc.id, ...doc.data() }));

  const visible = all.filter(isVisible);
  const hidden  = all.filter(p => !isVisible(p));
  const byAct   = all.filter(p => p.active === false);
  const byPub   = all.filter(p => p.publishStatus && p.publishStatus !== 'published');
  const byVis   = all.filter(p => p.visibility    && p.visibility    !== 'public');

  console.log(`\n📦 Total in Firestore (admin view): ${all.length}`);
  console.log(`👁️  Visible in storefront catalog:  ${visible.length}`);
  console.log(`🚫 Hidden by filter rules:          ${hidden.length}`);

  console.log('\n─── WHY HIDDEN ──────────────────────────────────────────────────────────');
  console.log(`  active === false:              ${byAct.length}`);
  byAct.forEach(p => console.log(`    • SKU=${(p.sku||p._id).padEnd(24)} pub=${p.publishStatus} vis=${p.visibility} "${pname(p)}"`));

  console.log(`  publishStatus != 'published': ${byPub.length}`);
  byPub.forEach(p => console.log(`    • SKU=${(p.sku||p._id).padEnd(24)} pub=${p.publishStatus} active=${p.active} vis=${p.visibility} "${pname(p)}"`));

  console.log(`  visibility != 'public':       ${byVis.length}`);
  byVis.forEach(p => console.log(`    • SKU=${(p.sku||p._id).padEnd(24)} vis=${p.visibility} active=${p.active} pub=${p.publishStatus} "${pname(p)}"`));

  // Distributions
  const dist = field => {
    const d = {};
    all.forEach(p => { const k = String(p[field] ?? '(undefined)'); d[k] = (d[k] || 0) + 1; });
    return d;
  };

  for (const [field, label] of [['publishStatus','publishStatus'], ['visibility','visibility'], ['active','active'], ['productType','productType'], ['inStock','inStock']]) {
    console.log(`\n─── ${label} distribution ─────────────────────────────────────────────`);
    Object.entries(dist(field)).sort().forEach(([k, v]) => console.log(`  ${k.padEnd(22)}: ${v}`));
  }

  // Data quality
  console.log('\n─── DATA QUALITY (all products) ─────────────────────────────────────────');
  const checks = [
    [p => !p.productType,      'Missing productType'],
    [p => !p.brand,            'Missing brand'],
    [p => !p.categoryId,       'Missing categoryId'],
    [p => p.inStock === false, 'inStock === false'],
    [p => !p.price || p.price === 0, 'price 0 or missing'],
    [p => !(p.images || {}).main,    'No main image'],
  ];
  checks.forEach(([fn, label]) => {
    const r = all.filter(fn);
    console.log(`  ${label.padEnd(25)}: ${r.length}`);
    r.forEach(p => console.log(`    • SKU=${(p.sku||p._id).padEnd(24)} "${pname(p)}"`));
  });

  // Full table
  console.log('\n─── FULL PRODUCT TABLE ──────────────────────────────────────────────────');
  console.log(`${'#'.padStart(3)} | 👁  | ${'active'.padEnd(7)} | ${'publishStatus'.padEnd(17)} | ${'visibility'.padEnd(12)} | ${'inStock'.padEnd(7)} | SKU / Name`);
  console.log('─'.repeat(100));
  all.forEach((p, i) => {
    const eye = isVisible(p) ? '✅' : '❌';
    const act = String(p.active ?? '?').padEnd(7);
    const pub = (p.publishStatus || '(none)').padEnd(17);
    const vis = (p.visibility    || '(none)').padEnd(12);
    const stk = String(p.inStock ?? '?').padEnd(7);
    const sku = (p.sku || p._id.slice(0, 18)).padEnd(22);
    const nm  = pname(p).slice(0, 28);
    console.log(`${String(i+1).padStart(3)} | ${eye} | ${act}| ${pub}| ${vis}| ${stk}| ${sku} "${nm}"`);
  });

  // Final summary
  console.log('\n' + '='.repeat(72));
  console.log('  FINAL SUMMARY');
  console.log('='.repeat(72));
  console.log(`  Total in Firestore (admin view):    ${all.length}`);
  console.log(`  Visible in storefront catalog:      ${visible.length}`);
  console.log(`  Hidden (unique, any filter fails):  ${hidden.length}`);
  console.log();
  console.log('  Per-rule breakdown (may overlap):');
  console.log(`    active = false:               ${byAct.length}`);
  console.log(`    publishStatus != published:   ${byPub.length}`);
  console.log(`    visibility != public:         ${byVis.length}`);
  if (hidden.length > 0) {
    console.log('\n  All hidden product SKUs:');
    hidden.forEach(p => {
      const flags = [];
      if (p.active === false) flags.push('active=false');
      if (p.publishStatus && p.publishStatus !== 'published') flags.push(`pub=${p.publishStatus}`);
      if (p.visibility    && p.visibility    !== 'public')   flags.push(`vis=${p.visibility}`);
      console.log(`    • SKU=${(p.sku||p._id).padEnd(24)} (${flags.join(', ')}) "${pname(p)}"`);
    });
  }
  console.log('='.repeat(72));
}

run().catch(console.error).finally(() => process.exit(0));
