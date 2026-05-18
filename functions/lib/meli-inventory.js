"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.meliSyncOrdersCron = exports.prunePriceHistory = exports.meliPriceScan = exports.meliSyncListings = exports.meliSyncFullInventory = exports.meliGetShippingLabel = exports.testMeliApi = void 0;
/**
 * meli-inventory.ts
 * MercadoLibre inventory & catalog management:
 * testMeliApi, meliGetShippingLabel, meliSyncFullInventory, meliSyncListings,
 * meliPriceScan, prunePriceHistory, meliSyncOrdersCron.
 */
const functions = require("firebase-functions");
const admin = require("firebase-admin");
const shared_1 = require("./shared");
const meli_shared_1 = require("./meli-shared"); // parseAndSaveMeliOrder also needed
exports.testMeliApi = functions.runWith({ timeoutSeconds: 120 }).https.onRequest(async (req, res) => {
    var _a, _b, _c;
    try {
        const configDoc = await shared_1.db.collection('config').doc('integrations').get();
        const meliConfig = (_a = configDoc.data()) === null || _a === void 0 ? void 0 : _a.meli;
        if (!meliConfig || !meliConfig.accessToken || !meliConfig.userId) {
            res.status(400).send('MercadoLibre not configured.');
            return;
        }
        const url = `https://api.mercadolibre.com/orders/search?seller=${meliConfig.userId}&limit=10&offset=0`;
        const mRes = await fetch(url, { headers: { 'Authorization': `Bearer ${meliConfig.accessToken}` } });
        const json = await mRes.json();
        const orders = json.results || [];
        // Return the raw shipping object from the first few orders
        const shippingSamples = orders.slice(0, 3).map((o) => ({
            order_id: o.id,
            status: o.status,
            tags: o.tags,
            shipping: o.shipping
        }));
        // Also fetch one individual shipment to check structure
        let individualShipment = null;
        if ((_c = (_b = orders[0]) === null || _b === void 0 ? void 0 : _b.shipping) === null || _c === void 0 ? void 0 : _c.id) {
            const sRes = await fetch(`https://api.mercadolibre.com/shipments/${orders[0].shipping.id}`, {
                headers: { 'Authorization': `Bearer ${meliConfig.accessToken}`, 'x-format-new': 'true' }
            });
            individualShipment = await sRes.json();
        }
        res.json({ success: true, shippingSamples, individualShipment });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// 8. Get Meli Shipping Label (Callable)
// MercadoLibre only allows getting labels for Meli Classic (merchant fulfilled) orders.
exports.meliGetShippingLabel = functions.runWith({ timeoutSeconds: 60 }).https.onCall(async (data, context) => {
    var _a;
    if (!context.auth)
        throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
    const shippingId = data.shippingId;
    if (!shippingId)
        throw new functions.https.HttpsError('invalid-argument', 'shippingId is required');
    try {
        const configDoc = await shared_1.db.collection('config').doc('integrations').get();
        const meliConfig = (_a = configDoc.data()) === null || _a === void 0 ? void 0 : _a.meli;
        if (!meliConfig || !meliConfig.accessToken) {
            throw new Error('MercadoLibre is not connected or missing tokens.');
        }
        const url = `https://api.mercadolibre.com/shipment_labels?shipment_ids=${shippingId}&response_type=pdf`;
        const res = await fetch(url, { headers: { 'Authorization': `Bearer ${meliConfig.accessToken}` } });
        if (!res.ok) {
            const errJson = await res.json();
            throw new Error(errJson.message || 'Failed to fetch shipping label from MercadoLibre.');
        }
        const arrayBuffer = await res.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const base64Pdf = buffer.toString('base64');
        return { success: true, pdfBase64: base64Pdf };
    }
    catch (err) {
        console.error('[Meli Label] Failed:', err);
        throw new functions.https.HttpsError('internal', err.message);
    }
});
// ─── MercadoLibre Full Inventory Sync ───────────────────────────────────────
exports.meliSyncFullInventory = functions.runWith({ timeoutSeconds: 300, memory: '512MB' }).https.onCall(async (data, context) => {
    var _a, _b, _c, _d, _e, _f;
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'You must be logged in to sync FBM inventory.');
    }
    try {
        const configDoc = await shared_1.db.collection('config').doc('integrations').get();
        const meliConfig = (_a = configDoc.data()) === null || _a === void 0 ? void 0 : _a.meli;
        if (!meliConfig || !meliConfig.accessToken || !meliConfig.userId) {
            throw new functions.https.HttpsError('failed-precondition', 'MercadoLibre is not connected or missing tokens.');
        }
        // 1. Fetch ALL fulfillment item IDs (paginated)
        let offset = 0;
        const limit = 50;
        const allItemIds = [];
        while (true) {
            const searchUrl = `https://api.mercadolibre.com/users/${meliConfig.userId}/items/search?logistic_type=fulfillment&limit=${limit}&offset=${offset}`;
            const searchRes = await fetch(searchUrl, { headers: { Authorization: `Bearer ${meliConfig.accessToken}` } });
            if (!searchRes.ok) {
                console.error('[Meli FBM] Search failed:', await searchRes.text());
                throw new functions.https.HttpsError('internal', 'MercadoLibre API search failed.');
            }
            const searchJson = await searchRes.json();
            if (!searchJson.results || searchJson.results.length === 0)
                break;
            allItemIds.push(...searchJson.results);
            if (searchJson.results.length < limit)
                break;
            offset += limit;
        }
        if (allItemIds.length === 0) {
            return { success: true, message: 'No FBM items found.', syncedCount: 0 };
        }
        console.log(`[Meli FBM] Found ${allItemIds.length} Full items. Fetching details + real stock...`);
        // 2. Fetch full item details in chunks of 20 (MULTIGET API limit)
        const chunkSize = 20;
        let syncedCount = 0;
        const firestoreBatch = shared_1.db.batch();
        for (let i = 0; i < allItemIds.length; i += chunkSize) {
            const chunk = allItemIds.slice(i, i + chunkSize);
            const itemsUrl = `https://api.mercadolibre.com/items?ids=${chunk.join(',')}`;
            const itemsRes = await fetch(itemsUrl, { headers: { Authorization: `Bearer ${meliConfig.accessToken}` } });
            if (!itemsRes.ok) {
                console.error(`[Meli FBM] Failed to fetch items chunk starting at ${i}`, await itemsRes.text());
                continue;
            }
            const itemsJson = await itemsRes.json();
            for (const itemObj of itemsJson) {
                if (itemObj.code !== 200 || !itemObj.body)
                    continue;
                const body = itemObj.body;
                // Extract SKU from SELLER_SKU attribute
                const skuAttr = (_b = body.attributes) === null || _b === void 0 ? void 0 : _b.find((a) => a.id === 'SELLER_SKU');
                const sku = skuAttr ? skuAttr.value_name : null;
                // Extract user_product_id — may be at root or inside first variation
                const userProductId = body.user_product_id ||
                    ((_d = (_c = body.variations) === null || _c === void 0 ? void 0 : _c[0]) === null || _d === void 0 ? void 0 : _d.user_product_id) ||
                    null;
                // 3. Query REAL Full warehouse stock via /user-products/{id}/stock
                let fullStock = body.available_quantity || 0;
                let fullStockReserved = 0;
                if (userProductId) {
                    try {
                        const stockRes = await fetch(`https://api.mercadolibre.com/user-products/${userProductId}/stock`, { headers: { Authorization: `Bearer ${meliConfig.accessToken}` } });
                        if (stockRes.ok) {
                            const stockJson = await stockRes.json();
                            const meliFacility = (stockJson.locations || []).find((l) => l.type === 'meli_facility');
                            if (meliFacility) {
                                fullStock = (_e = meliFacility.available_quantity) !== null && _e !== void 0 ? _e : fullStock;
                                fullStockReserved = (_f = meliFacility.not_available_quantity) !== null && _f !== void 0 ? _f : 0;
                            }
                        }
                        else {
                            console.warn(`[Meli FBM] Stock fetch failed for user_product_id=${userProductId}: ${stockRes.status}`);
                        }
                    }
                    catch (stockErr) {
                        console.warn(`[Meli FBM] Stock fetch error for ${userProductId}:`, stockErr);
                    }
                }
                // Firestore document IDs cannot contain forward slashes
                // Some SKUs like "80/90-17-EY..." contain them.
                const rawDocId = String(sku || body.id);
                const safeDocId = rawDocId.replace(/\//g, '_');
                const inventoryRef = shared_1.db.collection('meli_fbm_inventory').doc(safeDocId);
                firestoreBatch.set(inventoryRef, {
                    mlItemId: body.id,
                    sku: sku,
                    title: body.title,
                    status: body.status || 'active',
                    price: body.price || 0,
                    permalink: body.permalink || null,
                    thumbnail: body.thumbnail || null,
                    inventoryId: body.inventory_id || null,
                    userProductId: userProductId,
                    availableQuantity: fullStock,
                    fullStock: fullStock,
                    fullStockReserved: fullStockReserved,
                    lastUpdated: admin.firestore.FieldValue.serverTimestamp()
                }, { merge: true });
                syncedCount++;
            }
        }
        // 4. Commit batch to Firestore
        await firestoreBatch.commit();
        console.log(`[Meli FBM] Synced ${syncedCount} FBM items with real warehouse stock.`);
        return { success: true, syncedCount };
    }
    catch (e) {
        console.error('Error in meliSyncFullInventory:', e);
        throw new functions.https.HttpsError('internal', e.message || 'sync failed');
    }
});
// ─── MercadoLibre Listings Sync (Publications Price Analyzer) ────────────────
// Fetches ALL seller listings + calculates published price, MeLi fees, and net receipt.
// Results stored in meli_listings/{item_id} for the Publications tab in the Hub.
exports.meliSyncListings = functions.runWith({ timeoutSeconds: 300, memory: '512MB' }).https.onCall(async (data, context) => {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z;
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
    }
    try {
        // ── Auto-refresh token if expired or expiring soon ────────────────────────
        // MeLi tokens expire every 6h. getValidMeliToken() refreshes proactively
        // if expiry is within 30 min, so syncs never fail due to stale tokens.
        const accessToken = await (0, meli_shared_1.getValidMeliToken)();
        // Still need userId from config
        const configDoc = await shared_1.db.collection('config').doc('integrations').get();
        const meliConfig = (_a = configDoc.data()) === null || _a === void 0 ? void 0 : _a.meli;
        if (!meliConfig || !meliConfig.userId) {
            throw new functions.https.HttpsError('failed-precondition', 'MercadoLibre not connected.');
        }
        const authHeaders = { Authorization: `Bearer ${accessToken}` };
        // ── Step 1: Collect ALL item IDs via offset pagination (robust for any catalog size) ─
        const allItemIds = [];
        const pageLimit = 100;
        let offset = 0;
        let totalFromApi = 0;
        console.log('[Meli Listings] Starting item ID collection via offset pagination...');
        while (true) {
            const searchUrl = `https://api.mercadolibre.com/users/${meliConfig.userId}/items/search?limit=${pageLimit}&offset=${offset}`;
            const searchRes = await fetch(searchUrl, { headers: authHeaders });
            if (!searchRes.ok) {
                const errText = await searchRes.text();
                console.error('[Meli Listings] Search page failed:', searchRes.status, errText);
                break;
            }
            const searchJson = await searchRes.json();
            const results = searchJson.results || [];
            totalFromApi = ((_b = searchJson.paging) === null || _b === void 0 ? void 0 : _b.total) || totalFromApi;
            console.log(`[Meli Listings] Page offset=${offset}: got ${results.length} ids, total=${totalFromApi}`);
            if (results.length === 0)
                break;
            allItemIds.push(...results);
            offset += results.length;
            if (results.length < pageLimit || allItemIds.length >= totalFromApi)
                break;
            // Small rate-limit buffer between pages
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        if (allItemIds.length === 0) {
            console.warn('[Meli Listings] No item IDs found via offset pagination.');
            return { success: true, syncedCount: 0, message: 'No listings found in account.' };
        }
        console.log(`[Meli Listings] Collected ${allItemIds.length} item IDs. Fetching details + fees...`);
        // Listing type display name map (MLM)
        const listingTypeNames = {
            'gold_pro': 'Premium',
            'gold_special': 'Clásica',
            'gold': 'Oro',
            'free': 'Gratis',
            'bronze': 'Bronce',
            'silver': 'Plata',
        };
        // ── Step 2: Multiget item details in chunks of 20 ────────────────────
        const chunkSize = 20;
        const BATCH_LIMIT = 400; // Firestore max is 500; keep margin
        let syncedCount = 0;
        let currentBatch = shared_1.db.batch();
        let batchCount = 0;
        // Fee cache: key = "${listingTypeId}_${roundedPrice}_${categoryId}" → fee data
        // ⚠️ /listing_prices returns an ARRAY — one entry per listing type.
        //    We filter to find the entry matching the item's listing_type_id.
        // Fields stored:
        //   selling_fee_amount → total MeLi commission in MXN
        //   selling_fee_percent → commission % (from API, not recalculated)
        //   fixed_fee → fixed per-unit charge (often 0 in MLM)
        //   financing_fee → cost MeLi deducts when buyers pay in MSI installments
        //                    (can be 2–3% of sale price — real money!)
        const feeCache = new Map();
        for (let i = 0; i < allItemIds.length; i += chunkSize) {
            const chunk = allItemIds.slice(i, i + chunkSize);
            const itemsRes = await fetch(`https://api.mercadolibre.com/items?ids=${chunk.join(',')}`, { headers: authHeaders });
            if (!itemsRes.ok) {
                console.error(`[Meli Listings] Multiget chunk i=${i} failed:`, itemsRes.status);
                continue;
            }
            const itemsJson = await itemsRes.json();
            for (const wrapper of itemsJson) {
                if (wrapper.code !== 200 || !wrapper.body)
                    continue;
                const item = wrapper.body;
                const price = item.price || 0;
                const listingTypeId = item.listing_type_id || 'free';
                const categoryId = item.category_id || '';
                // ── Step 3: Fee lookup (cached per unique price+type+category combo) ─
                const feeCacheKey = `${Math.round(price)}_${listingTypeId}_${categoryId}`;
                let feeData = feeCache.get(feeCacheKey);
                if (!feeData) {
                    try {
                        // listing_prices requires auth for seller-specific rates and returns an ARRAY
                        let feeUrl = `https://api.mercadolibre.com/sites/MLM/listing_prices?price=${price}&listing_type_id=${listingTypeId}`;
                        if (categoryId)
                            feeUrl += `&category_id=${categoryId}`;
                        const feeRes = await fetch(feeUrl, { headers: authHeaders }); // auth for seller-specific rates
                        if (feeRes.ok) {
                            // Response is an array — find the entry for our listing_type_id
                            const feeArray = await feeRes.json();
                            const feeEntry = Array.isArray(feeArray)
                                ? feeArray.find((e) => e.listing_type_id === listingTypeId)
                                : feeArray; // fallback: treat as single object (old format)
                            if (feeEntry) {
                                // ── CONFIRMED real API response format for MLM ────────────
                                // {
                                //   "sale_fee_amount": 463.27,          ← NOTE: sale_, not selling_
                                //   "sale_fee_details": {
                                //     "percentage_fee": 16.5,           ← direct number
                                //     "fixed_fee": 0,                   ← direct number
                                //     "gross_amount": 463.27
                                //   }
                                // }
                                // ─────────────────────────────────────────────────────────
                                // Commission total in MXN — field is "sale_fee_amount" in real API
                                const commissionAmount = (_d = (_c = feeEntry.sale_fee_amount // real API field
                                ) !== null && _c !== void 0 ? _c : feeEntry.selling_fee_amount // fallback alias
                                ) !== null && _d !== void 0 ? _d : 0;
                                const rawDetails = (_e = feeEntry.sale_fee_details) !== null && _e !== void 0 ? _e : {};
                                let pct = 0;
                                let fixedFee = 0;
                                let financing = 0;
                                if (Array.isArray(rawDetails)) {
                                    // Older array format: [{name:'percentage_fee', value:16.5}, ...]
                                    const pctEntry = rawDetails.find((d) => d.name === 'percentage_fee');
                                    const fixEntry = rawDetails.find((d) => d.name === 'fixed_fee');
                                    const finEntry = rawDetails.find((d) => d.name === 'financing_add_on_fee' || d.name === 'financing_fee');
                                    pct = Number((_g = (_f = pctEntry === null || pctEntry === void 0 ? void 0 : pctEntry.percentage_fee) !== null && _f !== void 0 ? _f : pctEntry === null || pctEntry === void 0 ? void 0 : pctEntry.value) !== null && _g !== void 0 ? _g : 0);
                                    fixedFee = Number((_j = (_h = fixEntry === null || fixEntry === void 0 ? void 0 : fixEntry.amount) !== null && _h !== void 0 ? _h : fixEntry === null || fixEntry === void 0 ? void 0 : fixEntry.value) !== null && _j !== void 0 ? _j : 0);
                                    financing = Number((_l = (_k = finEntry === null || finEntry === void 0 ? void 0 : finEntry.amount) !== null && _k !== void 0 ? _k : finEntry === null || finEntry === void 0 ? void 0 : finEntry.value) !== null && _l !== void 0 ? _l : 0);
                                }
                                else if (rawDetails && typeof rawDetails === 'object') {
                                    // Current object format: {percentage_fee: 16.5, fixed_fee: 0, ...}
                                    // Values are DIRECT NUMBERS, not nested objects
                                    pct = Number((_m = rawDetails['percentage_fee']) !== null && _m !== void 0 ? _m : 0);
                                    fixedFee = Number((_o = rawDetails['fixed_fee']) !== null && _o !== void 0 ? _o : 0);
                                    financing = Number((_q = (_p = rawDetails['financing_add_on_fee']) !== null && _p !== void 0 ? _p : rawDetails['financing_fee']) !== null && _q !== void 0 ? _q : 0);
                                }
                                // If API gave us %, use it; otherwise derive from amount/price
                                const sellingFeePercent = pct > 0
                                    ? pct
                                    : (price > 0 ? Math.round((commissionAmount / price) * 1000) / 10 : 0);
                                feeData = {
                                    selling_fee_amount: commissionAmount,
                                    selling_fee_percent: sellingFeePercent,
                                    fixed_fee: fixedFee,
                                    financing_fee: financing,
                                };
                                // Log first fee lookup per sync
                                if (feeCache.size === 0) {
                                    console.log(`[Meli Listings] ✅ Fee [${listingTypeId}] @ $${price}: commission=$${commissionAmount} (${sellingFeePercent}%), fixed=$${fixedFee}, financing=$${financing}`);
                                    console.log(`[Meli Listings] Raw feeEntry:`, JSON.stringify(feeEntry).substring(0, 600));
                                }
                            }
                            else {
                                console.warn(`[Meli Listings] No fee entry for listing_type_id=${listingTypeId} in response for item ${item.id}`);
                                feeData = { selling_fee_amount: 0, selling_fee_percent: 0, fixed_fee: 0, financing_fee: 0 };
                            }
                            feeCache.set(feeCacheKey, feeData);
                        }
                        else {
                            const errText = await feeRes.text();
                            console.warn(`[Meli Listings] Fee API returned ${feeRes.status} for ${item.id}:`, errText.substring(0, 200));
                            feeData = { selling_fee_amount: 0, selling_fee_percent: 0, fixed_fee: 0, financing_fee: 0 };
                        }
                    }
                    catch (feeErr) {
                        console.warn(`[Meli Listings] Fee fetch failed for ${item.id}:`, feeErr);
                        feeData = { selling_fee_amount: 0, selling_fee_percent: 0, fixed_fee: 0, financing_fee: 0 };
                    }
                }
                // ── Step 4: Calculate net_amount ─────────────────────────────
                // NOTE on shipping:
                // The /listing_prices endpoint does NOT give us a reliable per-listing
                // shipping cost because it varies dynamically by buyer location, weight,
                // and volume. What we CAN tell is:
                //   - item.shipping.free_shipping = seller absorbs cost of shipping
                //   - item.shipping.logistic_type  = 'fulfillment' | 'me2' | 'not_specified'
                // Actual shipping cost per sale comes from /shipments/{id} (order-level).
                // Here we only include what the listing_prices API tells us for sure.
                const totalSellerCost = feeData.selling_fee_amount
                    + feeData.fixed_fee
                    + feeData.financing_fee; // financing cost if buyers use MSI
                const netAmount = Math.max(0, price - totalSellerCost);
                const netPercent = price > 0 ? Math.round((netAmount / price) * 1000) / 10 : 0;
                const feeHasData = feeData.selling_fee_amount > 0 || feeData.selling_fee_percent > 0;
                // Shipping flags from item body
                const freeShipping = ((_r = item.shipping) === null || _r === void 0 ? void 0 : _r.free_shipping) === true;
                // Local pickup only (no Mercado Envíos)
                const localPickupOnly = !freeShipping && (((_s = item.shipping) === null || _s === void 0 ? void 0 : _s.logistic_type) === 'not_specified' || !((_t = item.shipping) === null || _t === void 0 ? void 0 : _t.logistic_type));
                // Extract logistic type
                const logisticType = ((_u = item.shipping) === null || _u === void 0 ? void 0 : _u.logistic_type) || 'not_specified';
                const isFull = logisticType === 'fulfillment';
                // ── Shipping dimensions from item (set by seller at listing creation) ──
                // Format: "LxWxH,weightGrams"  e.g. "30x20x10,5000"
                // These are the physical dimensions that determine the shipping rate.
                const rawDims = (_w = (_v = item.shipping) === null || _v === void 0 ? void 0 : _v.dimensions) !== null && _w !== void 0 ? _w : null;
                let shipping_weight_g = null;
                let shipping_dims_cm = null;
                if (rawDims) {
                    const parts = rawDims.split(',');
                    const weightPart = parts[1] ? parseInt(parts[1], 10) : NaN;
                    if (!isNaN(weightPart))
                        shipping_weight_g = weightPart;
                    const dimPart = parts[0] ? parts[0].split('x').map(Number) : [];
                    if (dimPart.length === 3 && dimPart.every(n => !isNaN(n))) {
                        shipping_dims_cm = { l: dimPart[0], w: dimPart[1], h: dimPart[2] };
                    }
                }
                // Extract user_product_id
                const userProductId = item.user_product_id || ((_y = (_x = item.variations) === null || _x === void 0 ? void 0 : _x[0]) === null || _y === void 0 ? void 0 : _y.user_product_id) || null;
                // ── Kit / Combo / Bundle detection ───────────────────────────
                // Three reliable signals from MeLi (checked in priority order):
                //
                // 1. PACK_CONTENT attribute — MeLi's own classification for packs/kits.
                //    E.g. "2 llantas" or "4 piezas" written by seller explicitly.
                // 2. bundle_items array — explicit bundle components linked by MeLi.
                // 3. item_relations with type 'pack' or 'bundle' — cross-links to
                //    component items.
                const itemAttributes = item.attributes || [];
                const packContentAttr = itemAttributes.find((a) => a.id === 'PACK_CONTENT' || a.id === 'ITEM_AMOUNT');
                const hasPackAttribute = packContentAttr && packContentAttr.value_name
                    && packContentAttr.value_name !== '1';
                // ── Tire size attributes (for Price Intelligence cross-reference) ─
                const tireWidthAttr = itemAttributes.find((a) => a.id === 'TIRE_WIDTH');
                const aspectRatioAttr = itemAttributes.find((a) => a.id === 'ASPECT_RATIO');
                const rimDiameterAttr = itemAttributes.find((a) => a.id === 'RIM_DIAMETER');
                const tireWidth_pi = tireWidthAttr ? (Number(tireWidthAttr.value_name) || null) : null;
                const tireAspectRatio_pi = aspectRatioAttr ? (Number(aspectRatioAttr.value_name) || null) : null;
                const tireDiameter_pi = rimDiameterAttr ? (Number(rimDiameterAttr.value_name) || null) : null;
                const itemRelations = item.item_relations || [];
                const bundleItems = item.bundle_items || [];
                const hasBundleItems = bundleItems.length > 0;
                const hasRelations = itemRelations.some((r) => r.type === 'pack' || r.type === 'bundle' || r.type === 'PACK');
                // Explicit boolean — Firestore rejects undefined
                const isCombo = Boolean(hasBundleItems || hasRelations || hasPackAttribute);
                const bundleComponents = hasBundleItems
                    ? bundleItems.map((b) => ({ item_id: b.item_id || b.id, quantity: b.quantity || 1 }))
                    : itemRelations
                        .filter((r) => r.type === 'pack' || r.type === 'bundle' || r.type === 'PACK')
                        .map((r) => ({ item_id: r.id, quantity: r.quantity || 1 }));
                // item_type: 'kit' when MeLi bundle_items or PACK attribute,
                //            'combo' when item_relations pack,
                //            'single' otherwise
                const itemType = isCombo
                    ? (hasBundleItems || Boolean(hasPackAttribute) ? 'kit' : 'combo')
                    : 'single';
                // Pack quantity from attribute (e.g. "2" for a 2-pack) — null, never undefined
                const rawPackQty = packContentAttr ? parseInt(packContentAttr.value_name, 10) : NaN;
                const packQty = isNaN(rawPackQty) ? null : rawPackQty;
                // ── Step 5: Batch write to meli_listings/{item_id} ───────────
                const listingRef = shared_1.db.collection('meli_listings').doc(item.id);
                currentBatch.set(listingRef, {
                    id: item.id,
                    title: item.title,
                    status: item.status || 'active',
                    price: price,
                    currency_id: item.currency_id || 'MXN',
                    listing_type_id: listingTypeId,
                    listing_type_name: listingTypeNames[listingTypeId] || listingTypeId,
                    sold_quantity: item.sold_quantity || 0,
                    available_quantity: item.available_quantity || 0,
                    health: (_z = item.health) !== null && _z !== void 0 ? _z : null,
                    logistic_type: logisticType,
                    is_full: isFull,
                    // ── Shipping info ────────────────────────────────────────
                    // free_shipping: true = seller absorbs shipping cost (envío gratis al comprador)
                    // logistic_type: 'fulfillment' | 'me2' | 'not_specified'
                    // dimensions: physical size/weight set by seller — determines shipping rate
                    free_shipping: freeShipping,
                    local_pickup_only: localPickupOnly,
                    shipping_dims_raw: rawDims,
                    shipping_weight_g: shipping_weight_g,
                    shipping_dims_cm: shipping_dims_cm,
                    // avg_shipping_cost: populated after order sync (see aggregation step)
                    user_product_id: userProductId,
                    category_id: categoryId,
                    seller_custom_field: item.seller_custom_field || null,
                    permalink: item.permalink || null,
                    thumbnail: item.thumbnail || null,
                    // ── Fee breakdown from /sites/MLM/listing_prices (with auth) ────
                    selling_fee_amount: feeData.selling_fee_amount,
                    selling_fee_percent: feeData.selling_fee_percent,
                    fixed_fee: feeData.fixed_fee,
                    financing_fee: feeData.financing_fee,
                    net_amount: netAmount,
                    net_percent: netPercent,
                    fee_has_data: feeHasData,
                    // ── Kit / Combo / Bundle ─────────────────────────────────
                    item_type: itemType,
                    is_combo: isCombo,
                    pack_qty: packQty,
                    bundle_components: bundleComponents,
                    // ── Tire size for Price Intelligence (auto cross-reference) ─
                    tireWidth: tireWidth_pi,
                    tireAspectRatio: tireAspectRatio_pi,
                    tireDiameter: tireDiameter_pi,
                    lastSync: admin.firestore.FieldValue.serverTimestamp()
                }, { merge: true });
                syncedCount++;
                batchCount++;
                // Commit if approaching Firestore batch limit
                if (batchCount >= BATCH_LIMIT) {
                    await currentBatch.commit();
                    console.log(`[Meli Listings] Committed batch of ${batchCount} docs (total so far: ${syncedCount})`);
                    currentBatch = shared_1.db.batch();
                    batchCount = 0;
                }
            }
            // Rate limit buffer between chunks
            if (i + chunkSize < allItemIds.length) {
                await new Promise(resolve => setTimeout(resolve, 150));
            }
        }
        // Commit any remaining docs
        if (batchCount > 0) {
            await currentBatch.commit();
        }
        console.log(`[Meli Listings] Synced ${syncedCount} listings. Unique fee combos cached: ${feeCache.size}.`);
        return { success: true, syncedCount, featureCombos: feeCache.size };
    }
    catch (e) {
        console.error('[Meli Listings] Sync failed:', e);
        throw new functions.https.HttpsError('internal', e.message || 'listings sync failed');
    }
});
// ─── Price Intelligence: Competitor Market Scan via ML Official API ───────────
//
// Callable from Angular: httpsCallable(functions, 'meliPriceScan')
// Input:  { width: number, aspectRatio: number, diameter: number, categoryId?: string, force?: boolean }
// Output: { cached: boolean, fingerprint: string, stats: object, count: number }
//
// Strategy: Uses ML attribute-based search (TIRE_WIDTH, ASPECT_RATIO, RIM_DIAMETER)
// to retrieve all competitor listings for an exact tire size — no URL management,
// no scraping. Results are cached in Firestore (price_intelligence/{fingerprint})
// with a 4-hour TTL to minimize API calls.
//
exports.meliPriceScan = functions.runWith({ timeoutSeconds: 120, memory: '512MB' }).https.onCall(async (data, context) => {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z, _0, _1, _2, _3, _4, _5, _6, _7, _8, _9, _10;
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
    }
    const { width, aspectRatio, diameter, force = false } = data;
    // competitorItemIds: pre-populated by the client (browser-side ML search, not blocked)
    const clientCompetitorIds = Array.isArray(data.competitorItemIds)
        ? data.competitorItemIds.slice(0, 100)
        : [];
    let categoryId = (_a = data.categoryId) !== null && _a !== void 0 ? _a : 'MLM169975'; // may be overridden by autodiscovery below
    if (!width || !aspectRatio || !diameter) {
        throw new functions.https.HttpsError('invalid-argument', 'width, aspectRatio, and diameter are required.');
    }
    const fingerprint = `${width}_${aspectRatio}_R${diameter}`;
    console.log(`[PriceIntel] Scan requested: ${fingerprint} (category: ${categoryId}, force: ${force})`);
    // ── 1. Check Firestore cache (4-hour TTL) ─────────────────────────────────
    if (!force) {
        const cacheDoc = await shared_1.db.collection('price_intelligence').doc(fingerprint).get();
        if (cacheDoc.exists) {
            const lastScanned = (_d = (_c = (_b = cacheDoc.data()) === null || _b === void 0 ? void 0 : _b.lastScanned) === null || _c === void 0 ? void 0 : _c.toDate) === null || _d === void 0 ? void 0 : _d.call(_c);
            const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000);
            if (lastScanned && lastScanned > fourHoursAgo) {
                console.log(`[PriceIntel] Cache HIT for ${fingerprint}`);
                return {
                    cached: true,
                    fingerprint,
                    stats: (_f = (_e = cacheDoc.data()) === null || _e === void 0 ? void 0 : _e.stats) !== null && _f !== void 0 ? _f : null,
                    count: ((_h = (_g = cacheDoc.data()) === null || _g === void 0 ? void 0 : _g.listings) !== null && _h !== void 0 ? _h : []).length
                };
            }
        }
    }
    // ── 2. Get ML access tokens ───────────────────────────────────────────────
    // userToken  → for seller-specific ops (our listings, mutations)
    // appToken   → for marketplace reads (search, item details)
    //              client_credentials grant; NOT blocked by ML's GCP IP filter
    const accessToken = await (0, meli_shared_1.getValidMeliToken)();
    const appToken = await (0, meli_shared_1.getAppLevelToken)();
    const authHeaders = { 'Authorization': `Bearer ${accessToken}` };
    const appAuthHeaders = { 'Authorization': `Bearer ${appToken}` };
    // ── 3. Get our seller ID ──────────────────────────────────────────────────
    const configDoc = await shared_1.db.collection('config').doc('integrations').get();
    const meliConfig = (_j = configDoc.data()) === null || _j === void 0 ? void 0 : _j.meli;
    const sellerId = (meliConfig === null || meliConfig === void 0 ? void 0 : meliConfig.userId) ? String(meliConfig.userId) : null;
    if (!sellerId) {
        throw new functions.https.HttpsError('failed-precondition', 'MercadoLibre not connected.');
    }
    // ── 4. Get product catalog IDs (used in Tier 2 below) ────────────────────
    // /products/search gives us catalog product IDs which we can then use to
    // query /sites/MLM/search?catalog_product_id= for exact product matches.
    // NOTE: The keyword formatted as "{width}/{aspectRatio}-{diameter}" covers
    // both metric and inch-style representations on MeLi.
    const keyword = `${width}/${aspectRatio}-${diameter}`;
    const keywordAlt = `${width}/${aspectRatio}R${diameter}`;
    let productIds = [];
    try {
        const prodRes = await fetch(`https://api.mercadolibre.com/products/search?site_id=MLM&q=${encodeURIComponent(keywordAlt)}&category=${categoryId}&limit=15`, { headers: authHeaders });
        if (prodRes.ok) {
            const prodData = await prodRes.json();
            productIds = (prodData.results || []).map((p) => p.id).filter(Boolean).slice(0, 10);
            console.log(`[PriceIntel] Found ${productIds.length} product catalog entries`);
        }
        else {
            console.warn(`[PriceIntel] Products search returned ${prodRes.status} — will rely on keyword search only`);
        }
    }
    catch (err) {
        console.warn('[PriceIntel] Products search failed (non-fatal):', err.message);
    }
    // ── 5. Fetch our own seller's listed items for this size ──────────────────
    // /users/{id}/items/search returns ALL our active item IDs. We then bulk-fetch
    // their details via /items?ids= to get price and other metadata.
    let ourItemIds = new Set();
    let ourItemDetailsMap = new Map();
    try {
        // Paginate our seller items (up to 200 total to keep within timeout)
        const ourItemsRes = await fetch(`https://api.mercadolibre.com/users/${sellerId}/items/search?status=active&limit=100`, { headers: authHeaders });
        if (ourItemsRes.ok) {
            const ourItemsData = await ourItemsRes.json();
            const allOurIds = ourItemsData.results || [];
            const total = (_l = (_k = ourItemsData.paging) === null || _k === void 0 ? void 0 : _k.total) !== null && _l !== void 0 ? _l : allOurIds.length;
            console.log(`[PriceIntel] Seller has ${total} active items total (first page: ${allOurIds.length})`);
            // Fetch second page if there are more than 100 items
            if (total > 100) {
                try {
                    const page2Res = await fetch(`https://api.mercadolibre.com/users/${sellerId}/items/search?status=active&limit=100&offset=100`, { headers: authHeaders });
                    if (page2Res.ok) {
                        const page2Data = await page2Res.json();
                        allOurIds.push(...(page2Data.results || []));
                    }
                }
                catch ( /* non-fatal */_11) { /* non-fatal */ }
            }
            console.log(`[PriceIntel] Total our item IDs to check: ${allOurIds.length}`);
            // Bulk-fetch details in batches of 20
            for (let i = 0; i < allOurIds.length; i += 20) {
                const batch = allOurIds.slice(i, i + 20);
                const detailsRes = await fetch(`https://api.mercadolibre.com/items?ids=${batch.join(',')}&attributes=id,title,price,category_id,attributes,status,catalog_product_id,sold_quantity,listing_type_id,shipping,permalink,thumbnail`, { headers: authHeaders });
                if (detailsRes.ok) {
                    const details = await detailsRes.json();
                    for (const entry of details) {
                        if (entry.code === 200 && entry.body) {
                            const item = entry.body;
                            // ML-confirmed attribute IDs (from category MLM169975 attrs step):
                            const attrs = item.attributes || [];
                            const atWidth = (_m = attrs.find((a) => ['SECTION_WIDTH', 'TIRE_WIDTH', 'TIRE_SIZE_WIDTH'].includes(a.id))) === null || _m === void 0 ? void 0 : _m.value_name;
                            const atAR = (_o = attrs.find((a) => ['AUTOMOTIVE_TIRE_ASPECT_RATIO', 'ASPECT_RATIO', 'TIRE_ASPECT_RATIO'].includes(a.id))) === null || _o === void 0 ? void 0 : _o.value_name;
                            const atDiam = (_p = attrs.find((a) => ['RIM_DIAMETER', 'TIRE_RIM_DIAMETER'].includes(a.id))) === null || _p === void 0 ? void 0 : _p.value_name;
                            const titleHasWidth = (_q = item.title) === null || _q === void 0 ? void 0 : _q.includes(String(width));
                            const titleHasAR = (_r = item.title) === null || _r === void 0 ? void 0 : _r.includes(String(aspectRatio));
                            const titleHasDiam = ((_s = item.title) === null || _s === void 0 ? void 0 : _s.includes(String(diameter))) ||
                                ((_t = item.title) === null || _t === void 0 ? void 0 : _t.toLowerCase().includes(`r${diameter}`)) ||
                                ((_u = item.title) === null || _u === void 0 ? void 0 : _u.toLowerCase().includes(`-${diameter}`));
                            const titleMatch = titleHasWidth && titleHasAR && titleHasDiam;
                            const attrsMatch = atWidth && String(atWidth) === String(width) &&
                                atAR && String(atAR) === String(aspectRatio) &&
                                atDiam && String(atDiam) === String(diameter);
                            if (attrsMatch || titleMatch) {
                                ourItemIds.add(item.id);
                                ourItemDetailsMap.set(item.id, item);
                                console.log(`[PriceIntel] Our item matches ${fingerprint}: ${item.id} "${item.title}" (cat: ${item.category_id})`);
                                // ── Category autodiscovery ──────────────────────────────
                                // Use the REAL category from our own listing instead of
                                // the hardcoded constant (ML sometimes changes mappings).
                                if (item.category_id && item.category_id !== categoryId) {
                                    console.log(`[PriceIntel] ⚠️  Category override: ${categoryId} → ${item.category_id} (from our item)`);
                                    categoryId = item.category_id;
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    catch (err) {
        console.warn('[PriceIntel] Could not fetch our seller items:', err.message);
        // Non-fatal — continue without "our listing" identification
    }
    // Also check meli_listings in Firestore (already synced with tire attributes)
    const ourListingsSnap = await shared_1.db.collection('meli_listings')
        .where('tireWidth', '==', width)
        .where('tireAspectRatio', '==', aspectRatio)
        .where('tireDiameter', '==', diameter)
        .get();
    for (const doc of ourListingsSnap.docs) {
        ourItemIds.add(doc.id);
    }
    console.log(`[PriceIntel] Total our item IDs for ${fingerprint}: ${ourItemIds.size}`);
    // ── 6. Find which of our own items match this tire size ────────────────────
    const ourMatchingItems = [];
    for (const [, item] of ourItemDetailsMap) {
        ourMatchingItems.push(item);
    }
    console.log(`[PriceIntel] ${ourMatchingItems.length} of our items match ${fingerprint}`);
    console.log(`[PriceIntel] ${clientCompetitorIds.length} competitor IDs received from browser/client`);
    // NOTE: We do NOT return early here on 0 matching items anymore.
    // price_to_win (step 7) will run for our items and the ScraperAPI path
    // (step 6b) will attempt to find competitors. Both need to run regardless.
    // Only bail out completely if the seller has zero active items at all.
    const sellerHasActiveItems = ourItemDetailsMap.size > 0 || ourListingsSnap.size > 0;
    if (!sellerHasActiveItems && clientCompetitorIds.length === 0) {
        console.log(`[PriceIntel] No active items found for seller and no client IDs — returning noListing`);
        return {
            cached: false,
            fingerprint,
            noListing: true,
            stats: null,
            count: 0,
            message: `No publicación activa en ML ni competidores para ${fingerprint}.`,
        };
    }
    // ── 6b. Server-side competitor discovery via ScraperAPI proxy ─────────────
    // ML's /sites/MLM/search returns 403 from GCP datacenter IPs (WAF block).
    // ScraperAPI routes the request through residential IPs that ML does not block.
    // Sign up free at scraperapi.com (5,000 requests/month free tier).
    // Set the key: firebase functions:config:set scraperapi.key="YOUR_KEY"
    //
    // The clientCompetitorIds from the browser are used as a supplement if present.
    const competitorRawItems = [];
    const scraperApiKey = (_w = ((_v = functions.config().scraperapi) === null || _v === void 0 ? void 0 : _v.key)) !== null && _w !== void 0 ? _w : '';
    // Collect competitor IDs from all sources
    const competitorIdSet = new Set(clientCompetitorIds.filter(id => !ourItemIds.has(id)));
    if (scraperApiKey) {
        // ── ScraperAPI path: residential-IP ML search ─────────────────────────
        const searchQueries = [
            `${width}/${aspectRatio}R${diameter}`,
            `llanta moto ${width}/${aspectRatio}r${diameter}`,
        ];
        for (const q of searchQueries) {
            try {
                const mlSearchUrl = `https://api.mercadolibre.com/sites/MLM/search?q=${encodeURIComponent(q)}&category=${categoryId}&limit=50&sort=price_asc`;
                const proxyUrl = `https://api.scraperapi.com?api_key=${scraperApiKey}&url=${encodeURIComponent(mlSearchUrl)}`;
                const searchRes = await fetch(proxyUrl, {
                    signal: AbortSignal.timeout(25000),
                });
                if (searchRes.ok) {
                    const searchData = await searchRes.json();
                    const results = (_x = searchData.results) !== null && _x !== void 0 ? _x : [];
                    console.log(`[PriceIntel] ScraperAPI search "${q}": ${results.length} hits`);
                    results.forEach((item) => {
                        if (item.id && !ourItemIds.has(item.id)) {
                            competitorIdSet.add(item.id);
                        }
                    });
                }
                else {
                    const errText = await searchRes.text().catch(() => '');
                    console.warn(`[PriceIntel] ScraperAPI HTTP ${searchRes.status} for "${q}":`, errText.slice(0, 200));
                }
            }
            catch (err) {
                console.warn(`[PriceIntel] ScraperAPI error for query "${q}":`, err.message);
            }
        }
        console.log(`[PriceIntel] Total competitor candidates after proxy search: ${competitorIdSet.size}`);
    }
    else {
        console.warn('[PriceIntel] No ScraperAPI key configured. Set with: firebase functions:config:set scraperapi.key="YOUR_KEY"');
        console.log(`[PriceIntel] Falling back to ${competitorIdSet.size} browser-provided IDs`);
    }
    const filteredCompetitorIds = [...competitorIdSet];
    if (filteredCompetitorIds.length > 0) {
        // ── Enrich competitor IDs → full item data (/items?ids=...) ─────────────
        // This endpoint works fine from GCP — only search is blocked.
        console.log(`[PriceIntel] Enriching ${filteredCompetitorIds.length} competitor IDs`);
        for (let i = 0; i < filteredCompetitorIds.length; i += 20) {
            const batch = filteredCompetitorIds.slice(i, i + 20);
            try {
                const detRes = await fetch(`https://api.mercadolibre.com/items?ids=${batch.join(',')}&attributes=id,title,price,seller_id,listing_type_id,sold_quantity,shipping,permalink,thumbnail,attributes`, { headers: appAuthHeaders });
                if (detRes.ok) {
                    const details = await detRes.json();
                    for (const entry of details) {
                        if (entry.code === 200 && entry.body) {
                            competitorRawItems.push(entry.body);
                        }
                    }
                }
            }
            catch (err) {
                console.warn('[PriceIntel] Competitor enrich batch failed:', err.message);
            }
        }
        console.log(`[PriceIntel] Enriched ${competitorRawItems.length} competitor details`);
        // Seller nicknames (up to 15 unique sellers)
        const sellerIds = [...new Set(competitorRawItems.map((i) => String(i.seller_id)).filter(Boolean))].slice(0, 15);
        const sellerMap = new Map();
        for (const sid of sellerIds) {
            try {
                const sRes = await fetch(`https://api.mercadolibre.com/users/${sid}?attributes=id,nickname`, { headers: appAuthHeaders });
                if (sRes.ok) {
                    const sData = await sRes.json();
                    sellerMap.set(sid, (_y = sData.nickname) !== null && _y !== void 0 ? _y : sid);
                }
            }
            catch ( /* non-fatal */_12) { /* non-fatal */ }
        }
        for (const item of competitorRawItems) {
            item._sellerNickname = (_z = sellerMap.get(String(item.seller_id))) !== null && _z !== void 0 ? _z : null;
        }
    }
    // ── 7. Call GET /items/{id}/price_to_win for each of our matching items ───
    //
    // This is the OFFICIAL documented ML endpoint for competitive pricing intel:
    //   https://developers.mercadolibre.com (Precios competitivos > precio_para_ganar)
    // It returns ML's own buy-box analysis: what price we need to set to win,
    // what the current winning price is, and whether we are currently winning.
    // Requires the SELLER user token (not the app token).
    //
    const priceToWinResults = [];
    for (const item of ourMatchingItems) {
        try {
            const ptwRes = await fetch(`https://api.mercadolibre.com/items/${item.id}/price_to_win`, { headers: authHeaders } // must be seller user token
            );
            const ptwData = await ptwRes.json();
            if (ptwRes.ok) {
                priceToWinResults.push({
                    itemId: item.id,
                    title: item.title,
                    ourPrice: item.price,
                    status: (_0 = ptwData.status) !== null && _0 !== void 0 ? _0 : 'unknown',
                    priceToWin: (_1 = ptwData.price_to_win) !== null && _1 !== void 0 ? _1 : null,
                    catalogProductId: (_3 = (_2 = item.catalog_product_id) !== null && _2 !== void 0 ? _2 : ptwData.catalog_product_id) !== null && _3 !== void 0 ? _3 : null,
                    actions: (_4 = ptwData.actions) !== null && _4 !== void 0 ? _4 : [],
                    raw: ptwData,
                });
                console.log(`[PriceIntel] price_to_win ${item.id}: status=${ptwData.status}, ptw=${ptwData.price_to_win}`);
            }
            else {
                console.warn(`[PriceIntel] price_to_win ${item.id} HTTP ${ptwRes.status}:`, JSON.stringify(ptwData).slice(0, 200));
                priceToWinResults.push({
                    itemId: item.id,
                    title: item.title,
                    ourPrice: item.price,
                    status: 'api_error',
                    priceToWin: null,
                    catalogProductId: (_5 = item.catalog_product_id) !== null && _5 !== void 0 ? _5 : null,
                    raw: ptwData,
                });
            }
        }
        catch (err) {
            console.warn(`[PriceIntel] price_to_win error for ${item.id}:`, err.message);
        }
    }
    // ── 8. Enrich via catalog: get buy-box winner for each catalog product ─────
    //
    // For items that belong to a catalog product, GET /products/{catalog_product_id}
    // is a documented endpoint that returns the buy_box_winner item.
    // This gives us the actual winning competitor listing we can display in the table.
    //
    const catalogProductIds = new Set(priceToWinResults.map(r => r.catalogProductId).filter(Boolean));
    const competitorListingsMap = new Map();
    for (const cpId of catalogProductIds) {
        try {
            const cpRes = await fetch(`https://api.mercadolibre.com/products/${cpId}`, { headers: appAuthHeaders });
            if (!cpRes.ok) {
                console.warn(`[PriceIntel] /products/${cpId} → HTTP ${cpRes.status}`);
                continue;
            }
            const cpData = await cpRes.json();
            const bbWinner = cpData.buy_box_winner;
            if ((bbWinner === null || bbWinner === void 0 ? void 0 : bbWinner.item_id) && !ourItemIds.has(bbWinner.item_id)) {
                // Fetch the winner's item details
                try {
                    const bbRes = await fetch(`https://api.mercadolibre.com/items/${bbWinner.item_id}?attributes=id,title,price,seller_id,listing_type_id,sold_quantity,shipping,permalink,thumbnail`, { headers: appAuthHeaders });
                    if (bbRes.ok) {
                        const bbItem = await bbRes.json();
                        // Fetch seller nickname
                        let sellerNickname = null;
                        try {
                            const sRes = await fetch(`https://api.mercadolibre.com/users/${bbItem.seller_id}?attributes=id,nickname,seller_reputation`, { headers: appAuthHeaders });
                            if (sRes.ok) {
                                const sData = await sRes.json();
                                sellerNickname = (_6 = sData.nickname) !== null && _6 !== void 0 ? _6 : null;
                            }
                        }
                        catch ( /* non-fatal */_13) { /* non-fatal */ }
                        competitorListingsMap.set(bbWinner.item_id, {
                            itemId: bbItem.id,
                            title: bbItem.title || '',
                            price: bbItem.price || 0,
                            sellerId: String((_7 = bbItem.seller_id) !== null && _7 !== void 0 ? _7 : ''),
                            sellerNickname,
                            sellerReputation: 'unknown',
                            soldQuantity: bbItem.sold_quantity || 0,
                            listingType: bbItem.listing_type_id || 'free',
                            isFreeShipping: ((_8 = bbItem.shipping) === null || _8 === void 0 ? void 0 : _8.free_shipping) === true,
                            isOurListing: false,
                            isBuyBoxWinner: true,
                            permalink: bbItem.permalink || '',
                            thumbnail: bbItem.thumbnail || '',
                            rank: 1,
                            scrapedAt: new Date(),
                        });
                        console.log(`[PriceIntel] Buy-box winner for catalog ${cpId}: ${bbItem.id} @ $${bbItem.price}`);
                    }
                }
                catch ( /* non-fatal */_14) { /* non-fatal */ }
            }
        }
        catch (err) {
            console.warn(`[PriceIntel] /products/${cpId} failed:`, err.message);
        }
    }
    // ── 9. Build listings table ────────────────────────────────────────────────
    const ourListingsForDb = ourMatchingItems.map((item, idx) => {
        var _a, _b;
        const ptw = priceToWinResults.find(r => r.itemId === item.id);
        return {
            itemId: item.id,
            title: item.title || '',
            price: item.price || 0,
            sellerId: sellerId,
            sellerNickname: 'PRAXIS MEXICO',
            sellerReputation: 'unknown',
            soldQuantity: item.sold_quantity || 0,
            listingType: item.listing_type_id || 'free',
            isFreeShipping: ((_a = item.shipping) === null || _a === void 0 ? void 0 : _a.free_shipping) === true,
            isOurListing: true,
            isWinner: (ptw === null || ptw === void 0 ? void 0 : ptw.status) === 'winner',
            priceToWin: (_b = ptw === null || ptw === void 0 ? void 0 : ptw.priceToWin) !== null && _b !== void 0 ? _b : null,
            permalink: item.permalink || '',
            thumbnail: item.thumbnail || '',
            rank: idx + 1,
            scrapedAt: new Date(),
        };
    });
    // Catalog buy-box competitors (from /products/{id})
    const catalogCompetitorListings = [...competitorListingsMap.values()];
    // Browser-search competitors (main source — real competitor data from ML search)
    const browserCompetitorListings = competitorRawItems
        .filter(item => !ourItemIds.has(item.id))
        .map((item, idx) => {
        var _a, _b, _c;
        return ({
            itemId: item.id,
            title: item.title || '',
            price: item.price || 0,
            sellerId: String((_a = item.seller_id) !== null && _a !== void 0 ? _a : ''),
            sellerNickname: (_b = item._sellerNickname) !== null && _b !== void 0 ? _b : null,
            sellerReputation: 'unknown',
            soldQuantity: item.sold_quantity || 0,
            listingType: item.listing_type_id || 'free',
            isFreeShipping: ((_c = item.shipping) === null || _c === void 0 ? void 0 : _c.free_shipping) === true,
            isOurListing: false,
            isBuyBoxWinner: false,
            permalink: item.permalink || '',
            thumbnail: item.thumbnail || '',
            rank: idx + 1,
            scrapedAt: new Date(),
        });
    });
    const allListings = [...ourListingsForDb, ...browserCompetitorListings, ...catalogCompetitorListings]
        .filter(l => l.price > 0)
        .sort((a, b) => a.price - b.price)
        .map((l, i) => (Object.assign(Object.assign({}, l), { rank: i + 1 })));
    const totalCompetitorCount = browserCompetitorListings.length + catalogCompetitorListings.length;
    console.log(`[PriceIntel] ${allListings.length} total listings (${ourListingsForDb.length} ours, ${browserCompetitorListings.length} browser, ${catalogCompetitorListings.length} catalog)`);
    // ── 10. Compute market statistics ─────────────────────────────────────────
    const ourPrices = ourMatchingItems.map(i => i.price).filter(p => p > 0);
    const ourPrice = ourPrices.length > 0 ? Math.min(...ourPrices) : null;
    // Competitor prices: browser search is primary; ptw & catalog are supplementary
    const eligiblePtw = priceToWinResults.filter(r => r.priceToWin && r.priceToWin > 0).map(r => r.priceToWin);
    const catalogPrices = catalogCompetitorListings.map(l => l.price).filter(p => p > 0);
    const browserPrices = browserCompetitorListings.map(l => l.price).filter(p => p > 0);
    const allCompetitorPrices = [...browserPrices, ...catalogPrices, ...eligiblePtw];
    const marketFloor = allCompetitorPrices.length > 0 ? Math.min(...allCompetitorPrices) : 0;
    const marketMax = allCompetitorPrices.length > 0 ? Math.max(...allCompetitorPrices) : 0;
    const marketMid = allCompetitorPrices.length > 0
        ? allCompetitorPrices.reduce((s, v) => s + v, 0) / allCompetitorPrices.length
        : 0;
    // Win status: true if our price ≤ market floor OR price_to_win says 'winner'
    const isWinning = priceToWinResults.some(r => r.status === 'winner') ||
        (ourPrice !== null && marketFloor > 0 && ourPrice <= marketFloor);
    const positionInMarket = isWinning ? 1 : (ourPrice !== null ? 2 : null);
    const stats = {
        lowestPrice: marketFloor,
        medianPrice: Math.round(marketMid * 100) / 100,
        highestPrice: marketMax || (ourPrice !== null && ourPrice !== void 0 ? ourPrice : 0),
        ourPrice,
        positionInMarket,
        totalCompetitors: totalCompetitorCount,
        priceToWin: marketFloor || ((_10 = (_9 = priceToWinResults.find(r => r.priceToWin)) === null || _9 === void 0 ? void 0 : _9.priceToWin) !== null && _10 !== void 0 ? _10 : null),
        isWinning,
        // dataSource tells the UI what drove the competitive intelligence:
        // 'price_to_win_api'  → only ML's own endpoint was used (no proxy/scraper)
        // 'catalog_buy_box'   → catalog product buy-box winner enrichment
        // 'scraper_search'    → ScraperAPI / Apify returned real search results
        dataSource: (browserCompetitorListings.length > 0 ? 'scraper_search' :
            catalogCompetitorListings.length > 0 ? 'catalog_buy_box' :
                priceToWinResults.some(r => r.priceToWin) ? 'price_to_win_api' :
                    'own_listings_only'),
        priceToWinDetails: priceToWinResults.map(r => ({
            itemId: r.itemId,
            ourPrice: r.ourPrice,
            status: r.status,
            priceToWin: r.priceToWin,
        })),
    };
    console.log(`[PriceIntel] Stats for ${fingerprint}:`, JSON.stringify(stats));
    // ── 11. Write live snapshot to Firestore ──────────────────────────────────
    const docRef = shared_1.db.collection('price_intelligence').doc(fingerprint);
    await docRef.set({
        fingerprint,
        tireSize: { width, aspectRatio, diameter },
        lastScanned: admin.firestore.FieldValue.serverTimestamp(),
        listings: allListings,
        stats,
        priceToWinDetails: priceToWinResults, // raw per-item API data
    }, { merge: false });
    // ── 12. Write daily history snapshot ──────────────────────────────────────
    const today = new Date().toISOString().slice(0, 10);
    const historyRef = docRef.collection('history').doc(today);
    const existingHistoryCount = await docRef.collection('history').count().get();
    const isBaseline = existingHistoryCount.data().count === 0;
    await historyRef.set(Object.assign({ date: today, scannedAt: admin.firestore.FieldValue.serverTimestamp(), stats, listingCount: allListings.length }, (isBaseline ? { isBaseline: true } : {})), { merge: true });
    if (isBaseline)
        console.log(`[PriceIntel] 📌 Baseline established for ${fingerprint} on ${today}`);
    // ── 13. Generate price alert if we're not winning ─────────────────────────
    if (!isWinning && ourPrice !== null && marketFloor > 0 && marketFloor < ourPrice * 0.95) {
        const gapPct = ((marketFloor - ourPrice) / ourPrice * 100);
        await shared_1.db.collection('price_alerts').add({
            tireSize: fingerprint,
            ourPrice,
            competitorPrice: marketFloor,
            gap: `${gapPct.toFixed(1)}%`,
            alertType: 'undercut',
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            isRead: false,
        });
        console.log(`[PriceIntel] 🚨 Alert: ${fingerprint} market floor $${marketFloor} vs ours $${ourPrice} (${gapPct.toFixed(1)}%)`);
    }
    return {
        cached: false,
        fingerprint,
        stats,
        count: allListings.length,
        isBaseline,
    };
});
// ─── Price History Cleanup: Delete daily snapshots older than 90 days ─────────
//
// Scheduled: every day at 04:00 UTC.
// Iterates all price_intelligence documents, queries their history subcollection
// for docs with date < 90 days ago, and deletes them in batched writes.
// This keeps the collection size bounded at ~3,600 docs/year per size.
//
exports.prunePriceHistory = functions
    .runWith({ timeoutSeconds: 300, memory: '256MB' })
    .pubsub
    .schedule('0 4 * * *') // cron: daily at 04:00 UTC
    .timeZone('America/Mexico_City')
    .onRun(async (_ctx) => {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 90);
    const cutoffStr = cutoffDate.toISOString().slice(0, 10); // "YYYY-MM-DD"
    console.log(`[PruneHistory] Pruning history docs older than ${cutoffStr}`);
    const fpSnap = await shared_1.db.collection('price_intelligence').get();
    let totalDeleted = 0;
    for (const fpDoc of fpSnap.docs) {
        const historyRef = fpDoc.ref.collection('history');
        const oldDocs = await historyRef
            .where('date', '<', cutoffStr)
            .limit(500)
            .get();
        if (oldDocs.empty)
            continue;
        // Batch delete in chunks of 400 (safe under 500 limit)
        for (let i = 0; i < oldDocs.docs.length; i += 400) {
            const batch = shared_1.db.batch();
            oldDocs.docs.slice(i, i + 400).forEach(d => batch.delete(d.ref));
            await batch.commit();
            totalDeleted += Math.min(400, oldDocs.docs.length - i);
        }
        console.log(`[PruneHistory] ${fpDoc.id}: deleted ${oldDocs.size} old docs`);
    }
    console.log(`[PruneHistory] Done. Total deleted: ${totalDeleted}`);
});
// 12. Automated Sync: Cron Sweep (Catch-all for missed webhooks)
exports.meliSyncOrdersCron = functions.pubsub.schedule('every 30 minutes').onRun(async (_ctx) => {
    var _a, _b, _c, _d;
    try {
        const configDoc = await shared_1.db.collection('config').doc('integrations').get();
        const meliConfig = (_a = configDoc.data()) === null || _a === void 0 ? void 0 : _a.meli;
        if (!meliConfig || !meliConfig.accessToken || !meliConfig.userId) {
            console.log('[Meli Cron] Not connected. Skipping.');
            return;
        }
        const lastSyncDate = meliConfig.lastSyncDate
            ? new Date(meliConfig.lastSyncDate)
            : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        // 2-hour safety overlap so late-arriving payment confirmations are never missed
        const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
        const sweepFrom = new Date(lastSyncDate.getTime() - TWO_HOURS_MS);
        const dateFrom = sweepFrom.toISOString().replace('.000Z', '.000-00:00');
        console.log(`[Meli Cron] Sweeping orders since: ${dateFrom} (2h overlap from ${lastSyncDate.toISOString()})`);
        // ── Full Pagination ─────────────────────────────────────────────────────
        // The previous code used limit=50 with NO loop. At high order volume this
        // silently dropped every order beyond the first 50 in the window.
        // Now we loop through ALL pages before advancing the cursor.
        const PAGE_SIZE = 50;
        let offset = 0;
        let hasMore = true;
        let importedCount = 0;
        const cronHeaders = { 'Authorization': `Bearer ${meliConfig.accessToken}` };
        while (hasMore) {
            const url = `https://api.mercadolibre.com/orders/search?seller=${meliConfig.userId}&sort=date_asc&limit=${PAGE_SIZE}&offset=${offset}&order.date_created.from=${encodeURIComponent(dateFrom)}`;
            const res = await fetch(url, { headers: cronHeaders });
            if (!res.ok) {
                const errJson = await res.json();
                throw new Error(JSON.stringify(errJson));
            }
            const json = await res.json();
            const meliOrders = json.results || [];
            const total = (_c = (_b = json.paging) === null || _b === void 0 ? void 0 : _b.total) !== null && _c !== void 0 ? _c : 0;
            console.log(`[Meli Cron] Page offset=${offset}: ${meliOrders.length} orders (total=${total})`);
            if (meliOrders.length === 0)
                break;
            const shipmentsMap = {};
            const billingMap = {};
            await Promise.all(meliOrders.map(async (mo) => {
                var _a, _b, _c;
                try {
                    if ((_a = mo.shipping) === null || _a === void 0 ? void 0 : _a.id) {
                        const sRes = await fetch(`https://api.mercadolibre.com/shipments/${mo.shipping.id}`, {
                            headers: Object.assign(Object.assign({}, cronHeaders), { 'x-format-new': 'true' })
                        });
                        if (sRes.ok) {
                            shipmentsMap[mo.shipping.id] = await sRes.json();
                        }
                        else {
                            console.warn(`[Meli Cron] Shipment ${mo.shipping.id} fetch failed: ${sRes.status} — fulfillmentType may be wrong`);
                            shipmentsMap[mo.shipping.id] = { _fetchFailed: true, logistic_type: (_c = (_b = mo.shipping) === null || _b === void 0 ? void 0 : _b.logistic_type) !== null && _c !== void 0 ? _c : null };
                        }
                    }
                    const bRes = await fetch(`https://api.mercadolibre.com/orders/${mo.id}/billing_info`, {
                        headers: Object.assign(Object.assign({}, cronHeaders), { 'x-version': '2' })
                    });
                    if (bRes.ok)
                        billingMap[mo.id] = await bRes.json();
                    else {
                        const bRes1 = await fetch(`https://api.mercadolibre.com/orders/${mo.id}/billing_info`, { headers: cronHeaders });
                        if (bRes1.ok)
                            billingMap[mo.id] = await bRes1.json();
                    }
                }
                catch (e) { /* skip */ }
            }));
            // Pre-fetch existing originalNames in parallel to protect against ML name anonymization
            const cronOrigNames = new Map();
            await Promise.all(meliOrders.map(async (mo) => {
                var _a, _b;
                try {
                    const snap = await shared_1.db.collection('orders').doc(`meli_${mo.id}`).get();
                    const orig = (_b = (_a = snap.data()) === null || _a === void 0 ? void 0 : _a.customer) === null || _b === void 0 ? void 0 : _b.originalName;
                    if (orig)
                        cronOrigNames.set(String(mo.id), orig);
                }
                catch (_) { /* skip */ }
            }));
            for (const mo of meliOrders) {
                const orderRef = shared_1.db.collection('orders').doc(`meli_${mo.id}`);
                const shipData = ((_d = mo.shipping) === null || _d === void 0 ? void 0 : _d.id) ? shipmentsMap[mo.shipping.id] : null;
                const newOrder = (0, meli_shared_1.parseAndSaveMeliOrder)(mo, shipData, billingMap[mo.id]);
                const isAnonC = (s) => !!s && s.length >= 6 && /^[A-Z0-9]{6,}$/.test(s);
                const preservedCron = cronOrigNames.get(String(mo.id));
                if (preservedCron && !isAnonC(preservedCron)) {
                    newOrder.customer.originalName = preservedCron;
                }
                else if (preservedCron && isAnonC(preservedCron) && !isAnonC(newOrder.customer.originalName)) {
                    // Upgrade: stored was anonymized, new is readable
                }
                else if (preservedCron) {
                    newOrder.customer.originalName = preservedCron;
                }
                await orderRef.set(newOrder, { merge: true });
                importedCount++;
            }
            offset += PAGE_SIZE;
            hasMore = offset < total;
        }
        // Advance cursor ONLY after all pages succeed.
        // If anything threw above, we skip this so the NEXT run retries the same window.
        await shared_1.db.collection('config').doc('integrations').set({
            meli: { lastSyncDate: new Date().toISOString() }
        }, { merge: true });
        console.log(`[Meli Cron] ✅ Done. Upserted ${importedCount} orders across ${Math.ceil((offset || 1) / PAGE_SIZE)} page(s).`);
    }
    catch (err) {
        console.error('[Meli Cron] Failed:', err);
        // NOTE: lastSyncDate is NOT advanced on failure — next run retries the same window.
    }
});
// 13. Automated Sync: Webhook (Real-Time push)
//# sourceMappingURL=meli-inventory.js.map