"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.backfillMeliToInbox = exports.syncMeliToInbox = void 0;
/**
 * meli-inbox-sync.ts
 * MercadoLibre ↔ Universal Inbox conversation sync:
 * syncMeliToInbox (scheduled), backfillMeliToInbox (callable).
 */
const functions = require("firebase-functions");
const admin = require("firebase-admin");
const shared_1 = require("./shared");
exports.syncMeliToInbox = functions
    .runWith({ timeoutSeconds: 60 })
    .firestore
    .document('meli_communications/{docId}')
    .onWrite(async (change, context) => {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j;
    if (!change.after.exists)
        return; // Ignore deletes
    const commData = change.after.data();
    const topic = commData.topic; // 'messages' or 'questions'
    const rawData = commData.data;
    if (!rawData)
        return;
    let conversationId = '';
    let channelConversationId = '';
    let customerName = 'Cliente ML';
    let customerHandle = '';
    let messageText = '';
    let platformMessageId = '';
    let msgTimestamp = admin.firestore.FieldValue.serverTimestamp();
    let tag = '';
    if (topic === 'messages') {
        // Post-sale message
        const packId = ((_a = rawData.message_attachments) === null || _a === void 0 ? void 0 : _a.pack_id) || ((_b = rawData.message_attachments) === null || _b === void 0 ? void 0 : _b.order_id) || rawData.resource_id;
        const senderId = ((_c = rawData.from) === null || _c === void 0 ? void 0 : _c.user_id) || ((_d = rawData.from) === null || _d === void 0 ? void 0 : _d.id) || rawData.sender_id;
        // To prevent errors if payload is missing key IDs
        if (!packId || !senderId)
            return;
        conversationId = `meli_msg_${packId}`;
        channelConversationId = String(packId);
        customerHandle = String(senderId);
        customerName = ((_e = rawData.from) === null || _e === void 0 ? void 0 : _e.name) || 'Cliente ML';
        messageText = ((_f = rawData.text) === null || _f === void 0 ? void 0 : _f.plain) || rawData.text || '';
        platformMessageId = rawData.id || `msg_${Date.now()}`;
        if ((_g = rawData.message_date) === null || _g === void 0 ? void 0 : _g.created) {
            msgTimestamp = admin.firestore.Timestamp.fromDate(new Date(rawData.message_date.created));
        }
        else if (rawData.date_created) {
            msgTimestamp = admin.firestore.Timestamp.fromDate(new Date(rawData.date_created));
        }
        tag = 'Post-Venta';
    }
    else if (topic === 'questions') {
        // Pre-sale question
        const itemId = rawData.item_id;
        const senderId = (_h = rawData.from) === null || _h === void 0 ? void 0 : _h.id;
        if (!itemId || !senderId)
            return;
        conversationId = `meli_q_${itemId}_${senderId}`;
        channelConversationId = `${itemId}_${senderId}`;
        customerHandle = String(senderId);
        messageText = rawData.text || '';
        platformMessageId = rawData.id || `q_${Date.now()}`;
        if (rawData.date_created) {
            msgTimestamp = admin.firestore.Timestamp.fromDate(new Date(rawData.date_created));
        }
        tag = 'Pre-Venta';
    }
    else {
        return; // Not a message or question
    }
    if (!messageText)
        return;
    const convRef = shared_1.db.collection('customer_conversations').doc(conversationId);
    // Upsert conversation
    await convRef.set({
        id: conversationId,
        channel: 'mercadolibre',
        channelConversationId,
        customerName,
        customerHandle,
        status: 'open',
        priority: 'normal',
        unreadCount: admin.firestore.FieldValue.increment(1),
        tags: admin.firestore.FieldValue.arrayUnion(tag),
        lastMessage: {
            text: messageText,
            direction: 'inbound',
            timestamp: msgTimestamp
        },
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    // Check if createdAt is missing
    const convSnap = await convRef.get();
    if (convSnap.exists && !((_j = convSnap.data()) === null || _j === void 0 ? void 0 : _j.createdAt)) {
        await convRef.set({ createdAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    }
    // Insert message
    const msgRef = convRef.collection('messages').doc(String(platformMessageId));
    await msgRef.set({
        id: String(platformMessageId),
        direction: 'inbound',
        type: 'text',
        content: messageText,
        platformMessageId: String(platformMessageId),
        status: 'delivered',
        timestamp: msgTimestamp
    });
    console.log(`[syncMeliToInbox] Synced ${topic} into Universal Inbox: ${conversationId}`);
});
// ── Temporary MercadoLibre Backfill ─────────────────────────────────────────
exports.backfillMeliToInbox = functions
    .runWith({ timeoutSeconds: 540, memory: '1GB' })
    .https.onRequest(async (req, res) => {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j;
    try {
        const snapshot = await shared_1.db.collection('meli_communications').get();
        let count = 0;
        for (const doc of snapshot.docs) {
            const commData = doc.data();
            const topic = commData.topic;
            const rawData = commData.data;
            if (!rawData)
                continue;
            let conversationId = '';
            let channelConversationId = '';
            let customerName = 'Cliente ML';
            let customerHandle = '';
            let messageText = '';
            let platformMessageId = '';
            let msgTimestamp = admin.firestore.FieldValue.serverTimestamp();
            let tag = '';
            if (topic === 'messages') {
                const packId = ((_a = rawData.message_attachments) === null || _a === void 0 ? void 0 : _a.pack_id) || ((_b = rawData.message_attachments) === null || _b === void 0 ? void 0 : _b.order_id) || rawData.resource_id;
                const senderId = ((_c = rawData.from) === null || _c === void 0 ? void 0 : _c.user_id) || ((_d = rawData.from) === null || _d === void 0 ? void 0 : _d.id) || rawData.sender_id;
                if (!packId || !senderId)
                    continue;
                conversationId = `meli_msg_${packId}`;
                channelConversationId = String(packId);
                customerHandle = String(senderId);
                customerName = ((_e = rawData.from) === null || _e === void 0 ? void 0 : _e.name) || 'Cliente ML';
                messageText = ((_f = rawData.text) === null || _f === void 0 ? void 0 : _f.plain) || rawData.text || '';
                platformMessageId = rawData.id || `msg_${Date.now()}`;
                if ((_g = rawData.message_date) === null || _g === void 0 ? void 0 : _g.created) {
                    msgTimestamp = admin.firestore.Timestamp.fromDate(new Date(rawData.message_date.created));
                }
                else if (rawData.date_created) {
                    msgTimestamp = admin.firestore.Timestamp.fromDate(new Date(rawData.date_created));
                }
                tag = 'Post-Venta';
            }
            else if (topic === 'questions') {
                const itemId = rawData.item_id;
                const senderId = (_h = rawData.from) === null || _h === void 0 ? void 0 : _h.id;
                if (!itemId || !senderId)
                    continue;
                conversationId = `meli_q_${itemId}_${senderId}`;
                channelConversationId = `${itemId}_${senderId}`;
                customerHandle = String(senderId);
                messageText = rawData.text || '';
                platformMessageId = rawData.id || `q_${Date.now()}`;
                if (rawData.date_created) {
                    msgTimestamp = admin.firestore.Timestamp.fromDate(new Date(rawData.date_created));
                }
                tag = 'Pre-Venta';
            }
            else {
                continue;
            }
            if (!messageText)
                continue;
            const convRef = shared_1.db.collection('customer_conversations').doc(conversationId);
            await convRef.set({
                id: conversationId,
                channel: 'mercadolibre',
                channelConversationId,
                customerName,
                customerHandle,
                status: 'open',
                priority: 'normal',
                unreadCount: admin.firestore.FieldValue.increment(1),
                tags: admin.firestore.FieldValue.arrayUnion(tag),
                lastMessage: {
                    text: messageText,
                    direction: 'inbound',
                    timestamp: msgTimestamp
                },
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
            const convSnap = await convRef.get();
            if (convSnap.exists && !((_j = convSnap.data()) === null || _j === void 0 ? void 0 : _j.createdAt)) {
                await convRef.set({ createdAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
            }
            const msgRef = convRef.collection('messages').doc(String(platformMessageId));
            await msgRef.set({
                id: String(platformMessageId),
                direction: 'inbound',
                type: 'text',
                content: messageText,
                platformMessageId: String(platformMessageId),
                status: 'delivered',
                timestamp: msgTimestamp
            });
            count++;
        }
        res.status(200).send(`Successfully backfilled ${count} communications!`);
    }
    catch (error) {
        console.error(error);
        res.status(500).send(error.message);
    }
});
// ═══════════════════════════════════════════════════════════════════════════════
// ── BigQuery Analytics Functions ─────────────────────────────────────────────
// These replace direct Firestore collection scans for heavy analytics queries.
// BigQuery is billed by data scanned (not reads), and is ~100x more efficient
// for aggregations over thousands of rows.
//
// Each function:
//   1. Checks a short-lived Firestore result cache (5 min) to avoid BQ costs on
//      repeated identical requests.
//   2. Runs the BQ query.
//   3. Writes the result back to the cache.
// ═══════════════════════════════════════════════════════════════════════════════
const BQ_RESULT_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
async function getBQCache(cacheKey) {
    var _a, _b, _c;
    try {
        const ref = shared_1.db.collection('_bq_cache').doc(cacheKey);
        const snap = await ref.get();
        if (!snap.exists)
            return null;
        const data = snap.data();
        const age = Date.now() - ((_c = (_b = (_a = data.cachedAt) === null || _a === void 0 ? void 0 : _a.toMillis) === null || _b === void 0 ? void 0 : _b.call(_a)) !== null && _c !== void 0 ? _c : 0);
        if (age > BQ_RESULT_CACHE_TTL_MS)
            return null;
        return data.result;
    }
    catch (_d) {
        return null;
    }
}
async function setBQCache(cacheKey, result) {
    try {
        await shared_1.db.collection('_bq_cache').doc(cacheKey).set({
            result,
            cachedAt: admin.firestore.FieldValue.serverTimestamp()
        });
    }
    catch ( /* non-critical */_a) { /* non-critical */ }
}
// ── 1. Customer Insights ──────────────────────────────────────────────────────
//# sourceMappingURL=meli-inbox-sync.js.map