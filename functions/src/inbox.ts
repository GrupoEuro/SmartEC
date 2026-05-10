/**
 * inbox.ts
 * Universal Inbox webhooks and management: Meta/WhatsApp/Instagram/Facebook,
 * Telegram, Email, applyInboxChannelConfig, sendInboxReply.
 */
import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { db, bigquery } from './shared';
import { ensureBQSchema, BQ_DATASET, BQ_LOCATION } from './bq-analytics';

type InboxChannel = 'whatsapp' | 'instagram' | 'facebook' | 'telegram' | 'email' | 'website';

/**
 * Upsert a conversation keyed by (channel + channelConversationId).
 * Returns the Firestore document ID.
 */
async function upsertConversation(data: {
    channel: InboxChannel;
    channelConversationId: string;
    customerName: string;
    customerHandle: string;
    customerAvatar?: string;
}): Promise<string> {
    const snap = await db.collection('customer_conversations')
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

    const ref = await db.collection('customer_conversations').add({
        ...data,
        status: 'open',
        priority: 'normal',
        tags: [],
        unreadCount: 0,
        lastMessage: { text: '', direction: 'inbound', timestamp: admin.firestore.Timestamp.now() },
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return ref.id;
}

/** Add a message to a conversation's subcollection and update the parent's lastMessage preview. */
async function addMessage(conversationId: string, msg: {
    direction: 'inbound' | 'outbound';
    type: 'text' | 'image' | 'video' | 'audio' | 'document' | 'template' | 'comment';
    content: string;
    mediaUrl?: string;
    platformMessageId: string;
    status: 'received' | 'sent' | 'delivered' | 'read' | 'failed';
    sentBy?: string;
    sentByName?: string;
    errorReason?: string;
}): Promise<void> {
    const now = admin.firestore.FieldValue.serverTimestamp();
    const msgRef = db.collection(`customer_conversations/${conversationId}/messages`).doc();
    await msgRef.set({ ...msg, timestamp: now });

    const preview = msg.content.length > 80 ? msg.content.slice(0, 80) + '…' : msg.content;
    await db.collection('customer_conversations').doc(conversationId).update({
        lastMessage: {
            text: preview || (msg.type !== 'text' ? `[${msg.type}]` : ''),
            direction: msg.direction,
            timestamp: admin.firestore.Timestamp.now(),
            agentName: msg.sentByName ?? null,
        },
        unreadCount: msg.direction === 'inbound'
            ? admin.firestore.FieldValue.increment(1)
            : 0,
        updatedAt: now,
    });
}

/** Resolve a Meta media URL to a public download link. */
async function resolveMetaMedia(mediaId: string, accessToken: string): Promise<string | undefined> {
    try {
        const r = await fetch(`https://graph.facebook.com/v19.0/${mediaId}`, {
            headers: { Authorization: `Bearer ${accessToken}` }
        });
        const data = await r.json() as any;
        return data?.url;
    } catch { return undefined; }
}

// ── Meta Webhook (WhatsApp + Instagram + Facebook Messenger) ─────────────────
// Single endpoint for all Meta platforms. Meta distinguishes them via `object` field.
// Webhook URL: https://us-central1-tiendapraxis.cloudfunctions.net/metaInboxWebhook
// Verify token: set in firebase functions:config:set meta.verify_token="..."

export const metaInboxWebhook = functions.https.onRequest(async (req, res) => {
    // ── Verification handshake (GET) ──────────────────────────────────────────
    if (req.method === 'GET') {
        const verifyToken = functions.config().meta?.verify_token ?? process.env.META_VERIFY_TOKEN;
        if (req.query['hub.verify_token'] === verifyToken) {
            res.send(req.query['hub.challenge']);
        } else {
            res.sendStatus(403);
        }
        return;
    }

    // ── ACK immediately — Meta requires response < 5 s ───────────────────────
    res.sendStatus(200);

    const body = req.body;
    if (!body?.object) return;

    const waToken = functions.config().meta?.wa_token ?? process.env.WA_TOKEN ?? '';

    try {
        if (body.object === 'whatsapp_business_account') {
            for (const entry of body.entry ?? []) {
                for (const change of entry.changes ?? []) {
                    const value = change.value;
                    for (const msg of value?.messages ?? []) {
                        const phone = msg.from as string;
                        const contactName = (value.contacts?.[0]?.profile?.name as string) ?? phone;

                        const convId = await upsertConversation({
                            channel: 'whatsapp',
                            channelConversationId: phone,
                            customerHandle: phone,
                            customerName: contactName,
                        });

                        let mediaUrl: string | undefined;
                        if (msg.image?.id) mediaUrl = await resolveMetaMedia(msg.image.id, waToken);
                        if (msg.document?.id) mediaUrl = await resolveMetaMedia(msg.document.id, waToken);
                        if (msg.audio?.id) mediaUrl = await resolveMetaMedia(msg.audio.id, waToken);
                        if (msg.video?.id) mediaUrl = await resolveMetaMedia(msg.video.id, waToken);

                        await addMessage(convId, {
                            direction: 'inbound',
                            type: msg.image ? 'image' : msg.document ? 'document' : msg.audio ? 'audio' : msg.video ? 'video' : 'text',
                            content: msg.text?.body ?? msg.caption ?? '',
                            mediaUrl,
                            platformMessageId: msg.id,
                            status: 'received',
                        });
                    }
                }
            }
        } else if (body.object === 'instagram') {
            for (const entry of body.entry ?? []) {
                for (const msgEvent of entry.messaging ?? []) {
                    const senderId = String(msgEvent.sender?.id ?? '');
                    const senderName = msgEvent.sender?.name ?? `IG ${senderId}`;
                    if (!senderId) continue;

                    const convId = await upsertConversation({
                        channel: 'instagram',
                        channelConversationId: senderId,
                        customerHandle: senderId,
                        customerName: senderName,
                    });

                    await addMessage(convId, {
                        direction: 'inbound',
                        type: msgEvent.message?.attachments?.[0]?.type === 'image' ? 'image' : 'text',
                        content: msgEvent.message?.text ?? '',
                        mediaUrl: msgEvent.message?.attachments?.[0]?.payload?.url,
                        platformMessageId: msgEvent.message?.mid ?? `ig_${Date.now()}`,
                        status: 'received',
                    });
                }
            }
        } else if (body.object === 'page') {
            for (const entry of body.entry ?? []) {
                for (const msgEvent of entry.messaging ?? []) {
                    const senderId = String(msgEvent.sender?.id ?? '');
                    if (!senderId) continue;

                    const convId = await upsertConversation({
                        channel: 'facebook',
                        channelConversationId: senderId,
                        customerHandle: senderId,
                        customerName: `FB ${senderId}`,
                    });

                    await addMessage(convId, {
                        direction: 'inbound',
                        type: msgEvent.message?.attachments?.[0]?.type === 'image' ? 'image' : 'text',
                        content: msgEvent.message?.text ?? '',
                        mediaUrl: msgEvent.message?.attachments?.[0]?.payload?.url,
                        platformMessageId: msgEvent.message?.mid ?? `fb_${Date.now()}`,
                        status: 'received',
                    });
                }
            }
        }
    } catch (err) {
        console.error('[metaInboxWebhook] Error processing payload:', err);
    }
});

// ── Telegram Webhook ─────────────────────────────────────────────────────────
// Telegram Bot API — set webhook via:
// curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://us-central1-tiendapraxis.cloudfunctions.net/telegramInboxWebhook"
// No approval needed — create bot instantly with @BotFather.

export const telegramInboxWebhook = functions.https.onRequest(async (req, res) => {
    res.sendStatus(200);

    const update = req.body;
    const msg = update.message || update.channel_post;
    if (!msg) return;

    const chatId = String(msg.chat.id);
    const firstName = msg.from?.first_name ?? '';
    const lastName = msg.from?.last_name ?? '';
    const senderName = `${firstName} ${lastName}`.trim() || `Telegram ${chatId}`;
    const username = msg.from?.username ? `@${msg.from.username}` : chatId;

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
            content: msg.text ?? msg.caption ?? '',
            platformMessageId: String(msg.message_id),
            status: 'received',
        });
    } catch (err) {
        console.error('[telegramInboxWebhook] Error:', err);
    }
});

// ── SendGrid Inbound Parse Webhook (Email) ────────────────────────────────────
// Configure SendGrid: Settings → Inbound Parse → Add Host & URL
// URL: https://us-central1-tiendapraxis.cloudfunctions.net/emailInboxWebhook
// Threads emails by sender address.

export const emailInboxWebhook = functions.https.onRequest(async (req, res) => {
    res.sendStatus(200);

    try {
        const from = String(req.body.from ?? '');
        const subject = String(req.body.subject ?? '(Sin asunto)');
        const text = String(req.body.text ?? req.body.html ?? '');
        const envelope = JSON.parse(req.body.envelope || '{}');
        const fromEmail = String(envelope.from ?? from);

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
            platformMessageId: String(req.body['message-id'] ?? `email_${Date.now()}`),
            status: 'received',
        });
    } catch (err) {
        console.error('[emailInboxWebhook] Error:', err);
    }
});

// ── Apply Inbox Channel Config ────────────────────────────────────────────────
// Callable: receives channel credentials from the admin UI and stores them
// securely in Firestore (admin-only collection) so the webhook functions can
// read them at runtime. This removes the need for CLI-based config:set.

export const applyInboxChannelConfig = functions.https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Login required.');

    // Only SUPER_ADMIN / ADMIN can apply channel configs
    const profileSnap = await db.collection('users').doc(context.auth.uid).get();
    const role = profileSnap.data()?.role ?? '';
    if (!['SUPER_ADMIN', 'ADMIN'].includes(role)) {
        throw new functions.https.HttpsError('permission-denied', 'Admin role required.');
    }

    const { channel, creds } = data ?? {};
    if (!channel || typeof creds !== 'object') {
        throw new functions.https.HttpsError('invalid-argument', 'channel and creds required.');
    }

    // Store credentials in a secure admin-only Firestore document
    // (protected by Firestore rules — only service account can read)
    await db.collection('config').doc('inbox_credentials').set(
        { [channel]: creds, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
        { merge: true }
    );

    // For Telegram: auto-register the webhook immediately using the provided bot token
    if (channel === 'telegram' && creds.botToken) {
        const webhookUrl = `https://us-central1-tiendapraxis.cloudfunctions.net/telegramInboxWebhook`;
        try {
            const res = await fetch(
                `https://api.telegram.org/bot${creds.botToken}/setWebhook?url=${encodeURIComponent(webhookUrl)}`
            );
            const json = await res.json() as any;
            if (!json.ok) {
                console.warn('[applyInboxChannelConfig] Telegram setWebhook warning:', json.description);
            } else {
                console.log('[applyInboxChannelConfig] Telegram webhook registered successfully.');
            }
        } catch (err) {
            console.error('[applyInboxChannelConfig] Telegram setWebhook error:', err);
            // Don't throw — creds are saved even if webhook registration fails
        }
    }

    return { success: true, channel };
});

// ── Send Inbox Reply ─────────────────────────────────────────────────────────
// Callable from internal app. Routes the reply to the correct platform API.

export const sendInboxReply = functions.https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Login required.');
    const { conversationId, message } = data ?? {};
    if (!conversationId || !message?.trim())
        throw new functions.https.HttpsError('invalid-argument', 'conversationId and message required.');

    const convSnap = await db.collection('customer_conversations').doc(conversationId).get();
    if (!convSnap.exists) throw new functions.https.HttpsError('not-found', 'Conversation not found.');

    const conv = convSnap.data()!;
    const channel = conv.channel as InboxChannel;
    const handle = conv.customerHandle as string;
    const agentName = context.auth.token.name ?? context.auth.token.email ?? 'Soporte';
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
        await db.collection('customer_conversations').doc(conversationId).update({
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        return { ok: true };
    }

    // ── Load credentials from Firestore (saved via applyInboxChannelConfig) ──────
    let firestoreCreds: Record<string, any> = {};
    try {
        const credsSnap = await db.collection('config').doc('inbox_credentials').get();
        if (credsSnap.exists) firestoreCreds = (credsSnap.data() ?? {}) as Record<string, any>;
    } catch { /* continue with functions.config() fallback */ }

    const getCred = (channel: string, key: string, envFallback: string) =>
        firestoreCreds[channel]?.[key] ?? functions.config()[channel]?.[key] ?? process.env[envFallback] ?? '';

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
    } else if (channel === 'telegram') {
        const botToken = getCred('telegram', 'botToken', 'TELEGRAM_BOT_TOKEN') || getCred('telegram', 'bot_token', 'TELEGRAM_BOT_TOKEN');
        const r = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: handle, text: message })
        });
        sent = r.ok;
    } else if (channel === 'email') {
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
    } else if (channel === 'instagram' || channel === 'facebook') {
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
    await db.collection('customer_conversations').doc(conversationId).update({
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


export async function appendOrdersToBQForDate(dateStr: string, ordersData: Array<{
    orderId: string;
    order: any;
    channel: string;
}>): Promise<void> {
    try {
        await ensureBQSchema();

        // DELETION FIRST TO ENSURE IDEMPOTENCY (ROLLING WINDOW SYNC)
        try {
            const PROJECT = JSON.parse(process.env.FIREBASE_CONFIG || '{}').projectId || process.env.GCLOUD_PROJECT || 'importadora-euro';
            await bigquery.query({
                query: `DELETE FROM \`${PROJECT}.${BQ_DATASET}.orders\` WHERE order_date = CAST(@fromDate AS DATE)`,
                params: { fromDate: dateStr }, location: BQ_LOCATION,
            });
            await bigquery.query({
                query: `DELETE FROM \`${PROJECT}.${BQ_DATASET}.order_items\` WHERE order_date = CAST(@fromDate AS DATE)`,
                params: { fromDate: dateStr }, location: BQ_LOCATION,
            });
        } catch (delErr: any) {
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

        const orderRows: any[] = [];
        const itemRows: any[] = [];

        for (const { orderId, order, channel } of ordersData) {
            const createdAt = (order['createdAt'] as admin.firestore.Timestamp)?.toDate();
            const items: any[] = order['items'] ?? [];

            orderRows.push({
                order_id: orderId,
                order_date: dateStr,
                created_at: createdAt?.toISOString() ?? null,
                source_channel: channel,
                status: order['status'] ?? null,
                total: Number(order['total'] ?? 0),
                state: order['shippingAddress']?.state ?? null,
                city: order['shippingAddress']?.city ?? null,
                customer_id: order['customer']?.id ?? null,
                customer_name: order['customer']?.name ?? null,
                item_count: items.length,
                fulfillment_type: order['fulfillmentType'] ?? null,
                payment_method: order['paymentMethod'] ?? null,
                external_order_id: order['externalOrderId'] ?? null,
            });

            for (const item of items) {
                const unitPrice = Number(item.price ?? item.unitPrice ?? 0);
                const qty = Number(item.quantity ?? 1);
                itemRows.push({
                    order_id: orderId,
                    order_date: dateStr,
                    source_channel: channel,
                    status: order['status'] ?? null,
                    sku: item.sku ?? null,
                    product_name: item.productName ?? item.name ?? null,
                    quantity: qty,
                    unit_price: unitPrice,
                    subtotal: Number(item.subtotal ?? (unitPrice * qty)),
                    brand: item.brand ?? null,
                    product_id: item.productId ?? null,
                    asin: item.asin ?? null,
                    ml_item_id: item.mlItemId ?? null,
                });
            }
        }

        if (orderRows.length === 0) return;

        const BATCH = 500;
        const ordTable = bigquery.dataset(BQ_DATASET).table('orders');
        const itmTable = bigquery.dataset(BQ_DATASET).table('order_items');

        for (let i = 0; i < orderRows.length; i += BATCH) {
            await ordTable.insert(orderRows.slice(i, i + BATCH), { skipInvalidRows: true });
        }
        for (let i = 0; i < itemRows.length; i += BATCH) {
            await itmTable.insert(itemRows.slice(i, i + BATCH), { skipInvalidRows: true });
        }

        console.log(`[BQ Append] ${dateStr}: orders=${orderRows.length}, items=${itemRows.length}`);
    } catch (bqErr) {
        // Non-critical: BQ is analytics layer — don't let it fail the Firestore cron
        console.error('[BQ Append] Failed (non-critical):', bqErr);
    }
}


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

