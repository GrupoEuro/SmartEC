"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.appendOrdersToBQForDate = exports.sendInboxReply = exports.applyInboxChannelConfig = exports.emailInboxWebhook = exports.telegramInboxWebhook = exports.metaInboxWebhook = void 0;
/**
 * inbox.ts
 * Universal Inbox webhooks and management: Meta/WhatsApp/Instagram/Facebook,
 * Telegram, Email, applyInboxChannelConfig, sendInboxReply.
 */
const functions = require("firebase-functions");
const admin = require("firebase-admin");
const shared_1 = require("./shared");
const bq_analytics_1 = require("./bq-analytics");
/**
 * Upsert a conversation keyed by (channel + channelConversationId).
 * Returns the Firestore document ID.
 */
async function upsertConversation(data) {
    const snap = await shared_1.db.collection('customer_conversations')
        .where('channel', '==', data.channel)
        .where('channelConversationId', '==', data.channelConversationId)
        .limit(1)
        .get();
    if (!snap.empty) {
        const ref = snap.docs[0].ref;
        // Refresh name/avatar in case they changed
        await ref.update({
            customerName: data.customerName,
            customerHandle: data.customerHandle,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        return ref.id;
    }
    const ref = await shared_1.db.collection('customer_conversations').add(Object.assign(Object.assign({}, data), { status: 'open', priority: 'normal', tags: [], unreadCount: 0, lastMessage: { text: '', direction: 'inbound', timestamp: admin.firestore.Timestamp.now() }, createdAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp() }));
    return ref.id;
}
/** Add a message to a conversation's subcollection and update the parent's lastMessage preview. */
async function addMessage(conversationId, msg) {
    var _a;
    const now = admin.firestore.FieldValue.serverTimestamp();
    const msgRef = shared_1.db.collection(`customer_conversations/${conversationId}/messages`).doc();
    await msgRef.set(Object.assign(Object.assign({}, msg), { timestamp: now }));
    const preview = msg.content.length > 80 ? msg.content.slice(0, 80) + '…' : msg.content;
    await shared_1.db.collection('customer_conversations').doc(conversationId).update({
        lastMessage: {
            text: preview || (msg.type !== 'text' ? `[${msg.type}]` : ''),
            direction: msg.direction,
            timestamp: admin.firestore.Timestamp.now(),
            agentName: (_a = msg.sentByName) !== null && _a !== void 0 ? _a : null,
        },
        unreadCount: msg.direction === 'inbound'
            ? admin.firestore.FieldValue.increment(1)
            : 0,
        updatedAt: now,
    });
}
/** Resolve a Meta media URL to a public download link. */
async function resolveMetaMedia(mediaId, accessToken) {
    try {
        const r = await fetch(`https://graph.facebook.com/v19.0/${mediaId}`, {
            headers: { Authorization: `Bearer ${accessToken}` }
        });
        const data = await r.json();
        return data === null || data === void 0 ? void 0 : data.url;
    }
    catch (_a) {
        return undefined;
    }
}
// ── Meta Webhook (WhatsApp + Instagram + Facebook Messenger) ─────────────────
// Single endpoint for all Meta platforms. Meta distinguishes them via `object` field.
// Webhook URL: https://us-central1-tiendapraxis.cloudfunctions.net/metaInboxWebhook
// Verify token: set in firebase functions:config:set meta.verify_token="..."
exports.metaInboxWebhook = functions.https.onRequest(async (req, res) => {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z, _0, _1, _2, _3, _4, _5, _6, _7, _8, _9, _10, _11, _12, _13, _14, _15, _16, _17, _18, _19, _20, _21, _22, _23, _24, _25, _26;
    // ── Verification handshake (GET) ──────────────────────────────────────────
    if (req.method === 'GET') {
        const verifyToken = (_b = (_a = functions.config().meta) === null || _a === void 0 ? void 0 : _a.verify_token) !== null && _b !== void 0 ? _b : process.env.META_VERIFY_TOKEN;
        if (req.query['hub.verify_token'] === verifyToken) {
            res.send(req.query['hub.challenge']);
        }
        else {
            res.sendStatus(403);
        }
        return;
    }
    // ── ACK immediately — Meta requires response < 5 s ───────────────────────
    res.sendStatus(200);
    const body = req.body;
    if (!(body === null || body === void 0 ? void 0 : body.object))
        return;
    const waToken = (_e = (_d = (_c = functions.config().meta) === null || _c === void 0 ? void 0 : _c.wa_token) !== null && _d !== void 0 ? _d : process.env.WA_TOKEN) !== null && _e !== void 0 ? _e : '';
    try {
        if (body.object === 'whatsapp_business_account') {
            for (const entry of (_f = body.entry) !== null && _f !== void 0 ? _f : []) {
                for (const change of (_g = entry.changes) !== null && _g !== void 0 ? _g : []) {
                    const value = change.value;
                    for (const msg of (_h = value === null || value === void 0 ? void 0 : value.messages) !== null && _h !== void 0 ? _h : []) {
                        const phone = msg.from;
                        const contactName = (_m = (_l = (_k = (_j = value.contacts) === null || _j === void 0 ? void 0 : _j[0]) === null || _k === void 0 ? void 0 : _k.profile) === null || _l === void 0 ? void 0 : _l.name) !== null && _m !== void 0 ? _m : phone;
                        const convId = await upsertConversation({
                            channel: 'whatsapp',
                            channelConversationId: phone,
                            customerHandle: phone,
                            customerName: contactName,
                        });
                        let mediaUrl;
                        if ((_o = msg.image) === null || _o === void 0 ? void 0 : _o.id)
                            mediaUrl = await resolveMetaMedia(msg.image.id, waToken);
                        if ((_p = msg.document) === null || _p === void 0 ? void 0 : _p.id)
                            mediaUrl = await resolveMetaMedia(msg.document.id, waToken);
                        if ((_q = msg.audio) === null || _q === void 0 ? void 0 : _q.id)
                            mediaUrl = await resolveMetaMedia(msg.audio.id, waToken);
                        if ((_r = msg.video) === null || _r === void 0 ? void 0 : _r.id)
                            mediaUrl = await resolveMetaMedia(msg.video.id, waToken);
                        await addMessage(convId, {
                            direction: 'inbound',
                            type: msg.image ? 'image' : msg.document ? 'document' : msg.audio ? 'audio' : msg.video ? 'video' : 'text',
                            content: (_u = (_t = (_s = msg.text) === null || _s === void 0 ? void 0 : _s.body) !== null && _t !== void 0 ? _t : msg.caption) !== null && _u !== void 0 ? _u : '',
                            mediaUrl,
                            platformMessageId: msg.id,
                            status: 'received',
                        });
                    }
                }
            }
        }
        else if (body.object === 'instagram') {
            for (const entry of (_v = body.entry) !== null && _v !== void 0 ? _v : []) {
                for (const msgEvent of (_w = entry.messaging) !== null && _w !== void 0 ? _w : []) {
                    const senderId = String((_y = (_x = msgEvent.sender) === null || _x === void 0 ? void 0 : _x.id) !== null && _y !== void 0 ? _y : '');
                    const senderName = (_0 = (_z = msgEvent.sender) === null || _z === void 0 ? void 0 : _z.name) !== null && _0 !== void 0 ? _0 : `IG ${senderId}`;
                    if (!senderId)
                        continue;
                    const convId = await upsertConversation({
                        channel: 'instagram',
                        channelConversationId: senderId,
                        customerHandle: senderId,
                        customerName: senderName,
                    });
                    await addMessage(convId, {
                        direction: 'inbound',
                        type: ((_3 = (_2 = (_1 = msgEvent.message) === null || _1 === void 0 ? void 0 : _1.attachments) === null || _2 === void 0 ? void 0 : _2[0]) === null || _3 === void 0 ? void 0 : _3.type) === 'image' ? 'image' : 'text',
                        content: (_5 = (_4 = msgEvent.message) === null || _4 === void 0 ? void 0 : _4.text) !== null && _5 !== void 0 ? _5 : '',
                        mediaUrl: (_9 = (_8 = (_7 = (_6 = msgEvent.message) === null || _6 === void 0 ? void 0 : _6.attachments) === null || _7 === void 0 ? void 0 : _7[0]) === null || _8 === void 0 ? void 0 : _8.payload) === null || _9 === void 0 ? void 0 : _9.url,
                        platformMessageId: (_11 = (_10 = msgEvent.message) === null || _10 === void 0 ? void 0 : _10.mid) !== null && _11 !== void 0 ? _11 : `ig_${Date.now()}`,
                        status: 'received',
                    });
                }
            }
        }
        else if (body.object === 'page') {
            for (const entry of (_12 = body.entry) !== null && _12 !== void 0 ? _12 : []) {
                for (const msgEvent of (_13 = entry.messaging) !== null && _13 !== void 0 ? _13 : []) {
                    const senderId = String((_15 = (_14 = msgEvent.sender) === null || _14 === void 0 ? void 0 : _14.id) !== null && _15 !== void 0 ? _15 : '');
                    if (!senderId)
                        continue;
                    const convId = await upsertConversation({
                        channel: 'facebook',
                        channelConversationId: senderId,
                        customerHandle: senderId,
                        customerName: `FB ${senderId}`,
                    });
                    await addMessage(convId, {
                        direction: 'inbound',
                        type: ((_18 = (_17 = (_16 = msgEvent.message) === null || _16 === void 0 ? void 0 : _16.attachments) === null || _17 === void 0 ? void 0 : _17[0]) === null || _18 === void 0 ? void 0 : _18.type) === 'image' ? 'image' : 'text',
                        content: (_20 = (_19 = msgEvent.message) === null || _19 === void 0 ? void 0 : _19.text) !== null && _20 !== void 0 ? _20 : '',
                        mediaUrl: (_24 = (_23 = (_22 = (_21 = msgEvent.message) === null || _21 === void 0 ? void 0 : _21.attachments) === null || _22 === void 0 ? void 0 : _22[0]) === null || _23 === void 0 ? void 0 : _23.payload) === null || _24 === void 0 ? void 0 : _24.url,
                        platformMessageId: (_26 = (_25 = msgEvent.message) === null || _25 === void 0 ? void 0 : _25.mid) !== null && _26 !== void 0 ? _26 : `fb_${Date.now()}`,
                        status: 'received',
                    });
                }
            }
        }
    }
    catch (err) {
        console.error('[metaInboxWebhook] Error processing payload:', err);
    }
});
// ── Telegram Webhook ─────────────────────────────────────────────────────────
// Telegram Bot API — set webhook via:
// curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://us-central1-tiendapraxis.cloudfunctions.net/telegramInboxWebhook"
// No approval needed — create bot instantly with @BotFather.
exports.telegramInboxWebhook = functions.https.onRequest(async (req, res) => {
    var _a, _b, _c, _d, _e, _f, _g;
    res.sendStatus(200);
    const update = req.body;
    const msg = update.message || update.channel_post;
    if (!msg)
        return;
    const chatId = String(msg.chat.id);
    const firstName = (_b = (_a = msg.from) === null || _a === void 0 ? void 0 : _a.first_name) !== null && _b !== void 0 ? _b : '';
    const lastName = (_d = (_c = msg.from) === null || _c === void 0 ? void 0 : _c.last_name) !== null && _d !== void 0 ? _d : '';
    const senderName = `${firstName} ${lastName}`.trim() || `Telegram ${chatId}`;
    const username = ((_e = msg.from) === null || _e === void 0 ? void 0 : _e.username) ? `@${msg.from.username}` : chatId;
    try {
        const convId = await upsertConversation({
            channel: 'telegram',
            channelConversationId: chatId,
            customerHandle: username,
            customerName: senderName,
        });
        await addMessage(convId, {
            direction: 'inbound',
            type: msg.photo ? 'image' : msg.document ? 'document' : msg.voice ? 'audio' : 'text',
            content: (_g = (_f = msg.text) !== null && _f !== void 0 ? _f : msg.caption) !== null && _g !== void 0 ? _g : '',
            platformMessageId: String(msg.message_id),
            status: 'received',
        });
    }
    catch (err) {
        console.error('[telegramInboxWebhook] Error:', err);
    }
});
// ── SendGrid Inbound Parse Webhook (Email) ────────────────────────────────────
// Configure SendGrid: Settings → Inbound Parse → Add Host & URL
// URL: https://us-central1-tiendapraxis.cloudfunctions.net/emailInboxWebhook
// Threads emails by sender address.
exports.emailInboxWebhook = functions.https.onRequest(async (req, res) => {
    var _a, _b, _c, _d, _e, _f;
    res.sendStatus(200);
    try {
        const from = String((_a = req.body.from) !== null && _a !== void 0 ? _a : '');
        const subject = String((_b = req.body.subject) !== null && _b !== void 0 ? _b : '(Sin asunto)');
        const text = String((_d = (_c = req.body.text) !== null && _c !== void 0 ? _c : req.body.html) !== null && _d !== void 0 ? _d : '');
        const envelope = JSON.parse(req.body.envelope || '{}');
        const fromEmail = String((_e = envelope.from) !== null && _e !== void 0 ? _e : from);
        // Extract display name: "Juan García <juan@example.com>" → "Juan García"
        const nameMatch = from.match(/^([^<]+)</);
        const displayName = nameMatch ? nameMatch[1].trim() : fromEmail;
        const convId = await upsertConversation({
            channel: 'email',
            channelConversationId: fromEmail,
            customerHandle: fromEmail,
            customerName: displayName || fromEmail,
        });
        await addMessage(convId, {
            direction: 'inbound',
            type: 'text',
            content: `**${subject}**\n\n${text.slice(0, 2000)}`,
            platformMessageId: String((_f = req.body['message-id']) !== null && _f !== void 0 ? _f : `email_${Date.now()}`),
            status: 'received',
        });
    }
    catch (err) {
        console.error('[emailInboxWebhook] Error:', err);
    }
});
// ── Apply Inbox Channel Config ────────────────────────────────────────────────
// Callable: receives channel credentials from the admin UI and stores them
// securely in Firestore (admin-only collection) so the webhook functions can
// read them at runtime. This removes the need for CLI-based config:set.
exports.applyInboxChannelConfig = functions.https.onCall(async (data, context) => {
    var _a, _b;
    if (!context.auth)
        throw new functions.https.HttpsError('unauthenticated', 'Login required.');
    // Only SUPER_ADMIN / ADMIN can apply channel configs
    const profileSnap = await shared_1.db.collection('users').doc(context.auth.uid).get();
    const role = (_b = (_a = profileSnap.data()) === null || _a === void 0 ? void 0 : _a.role) !== null && _b !== void 0 ? _b : '';
    if (!['SUPER_ADMIN', 'ADMIN'].includes(role)) {
        throw new functions.https.HttpsError('permission-denied', 'Admin role required.');
    }
    const { channel, creds } = data !== null && data !== void 0 ? data : {};
    if (!channel || typeof creds !== 'object') {
        throw new functions.https.HttpsError('invalid-argument', 'channel and creds required.');
    }
    // Store credentials in a secure admin-only Firestore document
    // (protected by Firestore rules — only service account can read)
    await shared_1.db.collection('config').doc('inbox_credentials').set({ [channel]: creds, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    // For Telegram: auto-register the webhook immediately using the provided bot token
    if (channel === 'telegram' && creds.botToken) {
        const webhookUrl = `https://us-central1-tiendapraxis.cloudfunctions.net/telegramInboxWebhook`;
        try {
            const res = await fetch(`https://api.telegram.org/bot${creds.botToken}/setWebhook?url=${encodeURIComponent(webhookUrl)}`);
            const json = await res.json();
            if (!json.ok) {
                console.warn('[applyInboxChannelConfig] Telegram setWebhook warning:', json.description);
            }
            else {
                console.log('[applyInboxChannelConfig] Telegram webhook registered successfully.');
            }
        }
        catch (err) {
            console.error('[applyInboxChannelConfig] Telegram setWebhook error:', err);
            // Don't throw — creds are saved even if webhook registration fails
        }
    }
    return { success: true, channel };
});
// ── Send Inbox Reply ─────────────────────────────────────────────────────────
// Callable from internal app. Routes the reply to the correct platform API.
exports.sendInboxReply = functions.https.onCall(async (data, context) => {
    var _a, _b, _c;
    if (!context.auth)
        throw new functions.https.HttpsError('unauthenticated', 'Login required.');
    const { conversationId, message } = data !== null && data !== void 0 ? data : {};
    if (!conversationId || !(message === null || message === void 0 ? void 0 : message.trim()))
        throw new functions.https.HttpsError('invalid-argument', 'conversationId and message required.');
    const convSnap = await shared_1.db.collection('customer_conversations').doc(conversationId).get();
    if (!convSnap.exists)
        throw new functions.https.HttpsError('not-found', 'Conversation not found.');
    const conv = convSnap.data();
    const channel = conv.channel;
    const handle = conv.customerHandle;
    const agentName = (_b = (_a = context.auth.token.name) !== null && _a !== void 0 ? _a : context.auth.token.email) !== null && _b !== void 0 ? _b : 'Soporte';
    const agentUid = context.auth.uid;
    // ── Send via platform ──────────────────────────────────────────────────────
    let sent = false;
    // ── Website channel: direct Firestore write ──────────────────────────────
    // The storefront chat widget listens in real time — no external API needed.
    if (channel === 'website') {
        await addMessage(conversationId, {
            direction: 'outbound',
            type: 'text',
            content: message,
            sentBy: agentUid,
            sentByName: agentName,
            platformMessageId: `web_reply_${Date.now()}`,
            status: 'sent',
        });
        // Keep conversation open (visitor may reply further)
        await shared_1.db.collection('customer_conversations').doc(conversationId).update({
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        return { ok: true };
    }
    // ── Load credentials from Firestore (saved via applyInboxChannelConfig) ──────
    let firestoreCreds = {};
    try {
        const credsSnap = await shared_1.db.collection('config').doc('inbox_credentials').get();
        if (credsSnap.exists)
            firestoreCreds = ((_c = credsSnap.data()) !== null && _c !== void 0 ? _c : {});
    }
    catch ( /* continue with functions.config() fallback */_d) { /* continue with functions.config() fallback */ }
    const getCred = (channel, key, envFallback) => { var _a, _b, _c, _d, _e; return (_e = (_d = (_b = (_a = firestoreCreds[channel]) === null || _a === void 0 ? void 0 : _a[key]) !== null && _b !== void 0 ? _b : (_c = functions.config()[channel]) === null || _c === void 0 ? void 0 : _c[key]) !== null && _d !== void 0 ? _d : process.env[envFallback]) !== null && _e !== void 0 ? _e : ''; };
    if (channel === 'whatsapp') {
        const waToken = getCred('whatsapp', 'waToken', 'WA_TOKEN') || getCred('meta', 'wa_token', 'WA_TOKEN');
        const waPhoneId = getCred('whatsapp', 'waPhoneId', 'WA_PHONE_ID') || getCred('meta', 'wa_phone_id', 'WA_PHONE_ID');
        const r = await fetch(`https://graph.facebook.com/v19.0/${waPhoneId}/messages`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${waToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                messaging_product: 'whatsapp',
                to: handle,
                type: 'text',
                text: { body: message }
            })
        });
        sent = r.ok;
    }
    else if (channel === 'telegram') {
        const botToken = getCred('telegram', 'botToken', 'TELEGRAM_BOT_TOKEN') || getCred('telegram', 'bot_token', 'TELEGRAM_BOT_TOKEN');
        const r = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: handle, text: message })
        });
        sent = r.ok;
    }
    else if (channel === 'email') {
        const sgKey = getCred('email', 'sendgridKey', 'SENDGRID_API_KEY') || getCred('sendgrid', 'api_key', 'SENDGRID_API_KEY');
        const replyFrom = getCred('email', 'replyFrom', 'SENDGRID_REPLY_FROM') || getCred('sendgrid', 'reply_from', 'SENDGRID_REPLY_FROM') || 'soporte@importadoraeuro.com';
        const r = await fetch('https://api.sendgrid.com/v3/mail/send', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${sgKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                personalizations: [{ to: [{ email: handle }] }],
                from: { email: replyFrom, name: 'Importadora Euro' },
                subject: 'Re: Tu consulta',
                content: [{ type: 'text/plain', value: message }]
            })
        });
        sent = r.ok;
    }
    else if (channel === 'instagram' || channel === 'facebook') {
        const pageToken = channel === 'instagram'
            ? (getCred('instagram', 'igToken', 'IG_TOKEN') || getCred('meta', 'ig_token', 'IG_TOKEN'))
            : (getCred('facebook', 'fbPageToken', 'FB_PAGE_TOKEN') || getCred('meta', 'fb_page_token', 'FB_PAGE_TOKEN'));
        const r = await fetch(`https://graph.facebook.com/v19.0/me/messages`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${pageToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                recipient: { id: handle },
                message: { text: message }
            })
        });
        sent = r.ok;
    }
    // ── Log outbound message ───────────────────────────────────────────────────
    await addMessage(conversationId, {
        direction: 'outbound',
        type: 'text',
        content: message,
        sentBy: agentUid,
        sentByName: agentName,
        platformMessageId: `out_${Date.now()}`,
        status: sent ? 'sent' : 'failed',
        errorReason: sent ? undefined : 'Platform API error',
    });
    // Move conversation to pending (awaiting customer reply)
    await shared_1.db.collection('customer_conversations').doc(conversationId).update({
        status: 'pending',
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return { ok: sent };
});
// ─── appendOrderToBigQuery — internal helper ──────────────────────────────────
//
// Called from the dailyStats cron after its Firestore writes.
// Streams today's newly created orders into BigQuery.
// This keeps BQ current without requiring manual backfills.
// ─────────────────────────────────────────────────────────────────────────────
async function appendOrdersToBQForDate(dateStr, ordersData) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z, _0, _1, _2, _3;
    try {
        await (0, bq_analytics_1.ensureBQSchema)();
        // DELETION FIRST TO ENSURE IDEMPOTENCY (ROLLING WINDOW SYNC)
        try {
            const PROJECT = JSON.parse(process.env.FIREBASE_CONFIG || '{}').projectId || process.env.GCLOUD_PROJECT || 'importadora-euro';
            await shared_1.bigquery.query({
                query: `DELETE FROM \`${PROJECT}.${bq_analytics_1.BQ_DATASET}.orders\` WHERE order_date = CAST(@fromDate AS DATE)`,
                params: { fromDate: dateStr }, location: bq_analytics_1.BQ_LOCATION,
            });
            await shared_1.bigquery.query({
                query: `DELETE FROM \`${PROJECT}.${bq_analytics_1.BQ_DATASET}.order_items\` WHERE order_date = CAST(@fromDate AS DATE)`,
                params: { fromDate: dateStr }, location: bq_analytics_1.BQ_LOCATION,
            });
        }
        catch (delErr) {
            // If the deletion fails because of the BigQuery Streaming Buffer restriction 
            // ("UPDATE or DELETE statement over table ... would modify rows in the streaming buffer")
            // we MUST return early and skip insertion to avoid duplicating data. 
            // The buffer clears after ~90 minutes, and the next cron run will succeed.
            console.warn(`[BQ Append] Deletion skipped for ${dateStr} (Likely streaming buffer or schema mismatch):`, delErr.message);
            return;
        }
        if (ordersData.length === 0) {
            console.log(`[BQ Append] ${dateStr}: orders=0, items=0 (Cleared previous data)`);
            return;
        }
        const orderRows = [];
        const itemRows = [];
        for (const { orderId, order, channel } of ordersData) {
            const createdAt = (_a = order['createdAt']) === null || _a === void 0 ? void 0 : _a.toDate();
            const items = (_b = order['items']) !== null && _b !== void 0 ? _b : [];
            orderRows.push({
                order_id: orderId,
                order_date: dateStr,
                created_at: (_c = createdAt === null || createdAt === void 0 ? void 0 : createdAt.toISOString()) !== null && _c !== void 0 ? _c : null,
                source_channel: channel,
                status: (_d = order['status']) !== null && _d !== void 0 ? _d : null,
                total: Number((_e = order['total']) !== null && _e !== void 0 ? _e : 0),
                state: (_g = (_f = order['shippingAddress']) === null || _f === void 0 ? void 0 : _f.state) !== null && _g !== void 0 ? _g : null,
                city: (_j = (_h = order['shippingAddress']) === null || _h === void 0 ? void 0 : _h.city) !== null && _j !== void 0 ? _j : null,
                customer_id: (_l = (_k = order['customer']) === null || _k === void 0 ? void 0 : _k.id) !== null && _l !== void 0 ? _l : null,
                customer_name: (_o = (_m = order['customer']) === null || _m === void 0 ? void 0 : _m.name) !== null && _o !== void 0 ? _o : null,
                item_count: items.length,
                fulfillment_type: (_p = order['fulfillmentType']) !== null && _p !== void 0 ? _p : null,
                payment_method: (_q = order['paymentMethod']) !== null && _q !== void 0 ? _q : null,
                external_order_id: (_r = order['externalOrderId']) !== null && _r !== void 0 ? _r : null,
            });
            for (const item of items) {
                const unitPrice = Number((_t = (_s = item.price) !== null && _s !== void 0 ? _s : item.unitPrice) !== null && _t !== void 0 ? _t : 0);
                const qty = Number((_u = item.quantity) !== null && _u !== void 0 ? _u : 1);
                itemRows.push({
                    order_id: orderId,
                    order_date: dateStr,
                    source_channel: channel,
                    status: (_v = order['status']) !== null && _v !== void 0 ? _v : null,
                    sku: (_w = item.sku) !== null && _w !== void 0 ? _w : null,
                    product_name: (_y = (_x = item.productName) !== null && _x !== void 0 ? _x : item.name) !== null && _y !== void 0 ? _y : null,
                    quantity: qty,
                    unit_price: unitPrice,
                    subtotal: Number((_z = item.subtotal) !== null && _z !== void 0 ? _z : (unitPrice * qty)),
                    brand: (_0 = item.brand) !== null && _0 !== void 0 ? _0 : null,
                    product_id: (_1 = item.productId) !== null && _1 !== void 0 ? _1 : null,
                    asin: (_2 = item.asin) !== null && _2 !== void 0 ? _2 : null,
                    ml_item_id: (_3 = item.mlItemId) !== null && _3 !== void 0 ? _3 : null,
                });
            }
        }
        if (orderRows.length === 0)
            return;
        const BATCH = 500;
        const ordTable = shared_1.bigquery.dataset(bq_analytics_1.BQ_DATASET).table('orders');
        const itmTable = shared_1.bigquery.dataset(bq_analytics_1.BQ_DATASET).table('order_items');
        for (let i = 0; i < orderRows.length; i += BATCH) {
            await ordTable.insert(orderRows.slice(i, i + BATCH), { skipInvalidRows: true });
        }
        for (let i = 0; i < itemRows.length; i += BATCH) {
            await itmTable.insert(itemRows.slice(i, i + BATCH), { skipInvalidRows: true });
        }
        console.log(`[BQ Append] ${dateStr}: orders=${orderRows.length}, items=${itemRows.length}`);
    }
    catch (bqErr) {
        // Non-critical: BQ is analytics layer — don't let it fail the Firestore cron
        console.error('[BQ Append] Failed (non-critical):', bqErr);
    }
}
exports.appendOrdersToBQForDate = appendOrdersToBQForDate;
// ═══════════════════════════════════════════════════════════════════════════════
// ─── SEARCH ANALYTICS — BigQuery Infrastructure ───────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
//
// Table: euro_analytics.search_events
// Partitioned by event_date (DATE), clustered by event_type then normalized_term.
//
// Real-time ingestion: onSearchEventCreated (Firestore trigger) → BQ insert
// Backfill:           backfillSearchEventsToBigQuery (callable, one-time)
// Reporting:          querySearchAnalytics (callable, 6 query types)
// ─────────────────────────────────────────────────────────────────────────────
//# sourceMappingURL=inbox.js.map