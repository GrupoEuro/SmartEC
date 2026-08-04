import { Injectable, inject } from '@angular/core';
import {
    Firestore, collection, collectionData, doc, docData,
    query, where, orderBy, limit, updateDoc, serverTimestamp,
    addDoc, getDocs, getDoc, Timestamp, deleteDoc
} from '@angular/fire/firestore';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Auth } from '@angular/fire/auth';
import { Observable, of, switchMap, map } from 'rxjs';
import { UserProfile } from '../../../core/models/user.model';

// ── Types ─────────────────────────────────────────────────────────────────────

export type Channel = 'whatsapp' | 'instagram' | 'facebook' | 'telegram' | 'email' | 'tiktok' | 'website' | 'mercadolibre';
export type ConversationStatus = 'open' | 'pending' | 'resolved' | 'snoozed';

export interface Conversation {
    id: string;
    channel: Channel;
    channelConversationId: string;
    customerName:   string;
    customerHandle: string;
    customerAvatar?: string;
    customerId?:    string;
    status:     ConversationStatus;
    priority:   'low' | 'normal' | 'high' | 'urgent';
    assignedTo?: string;
    tags:        string[];
    unreadCount: number;
    firstResponseMs?: number;
    resolvedMs?:      number;
    lastMessage: {
        text:      string;
        direction: 'inbound' | 'outbound';
        timestamp: Timestamp;
        agentName?: string;
    };
    createdAt:   Timestamp;
    updatedAt:   Timestamp;
    resolvedAt?: Timestamp;
    snoozedUntil?: Timestamp;
}

export interface Message {
    id: string;
    direction:  'inbound' | 'outbound';
    type:       'text' | 'image' | 'video' | 'audio' | 'document' | 'template' | 'comment';
    content:    string;
    mediaUrl?:  string;
    mediaType?: string;
    sentBy?:    string;
    sentByName?: string;
    platformMessageId: string;
    status: 'received' | 'sent' | 'delivered' | 'read' | 'failed';
    errorReason?: string;
    timestamp: Timestamp;
}

// ── Service ───────────────────────────────────────────────────────────────────

@Injectable({ providedIn: 'root' })
export class InboxService {
    private readonly fs   = inject(Firestore);
    private readonly fns  = inject(Functions);
    private readonly auth = inject(Auth);

    // ── Conversations ──────────────────────────────────────────────────────────

    /** Real-time stream of conversations by status (and optional channel filter) */
    getConversations(
        status: ConversationStatus | 'all' = 'open',
        channel?: Channel,
        limitCount = 50,
        assignment: 'all' | 'mine' | 'unassigned' = 'all',
        agentUid?: string
    ): Observable<Conversation[]> {
        const ref = collection(this.fs, 'customer_conversations');
        const constraints: any[] = [];

        if (status !== 'all') constraints.push(where('status', '==', status));
        if (channel)          constraints.push(where('channel', '==', channel));

        if (assignment === 'mine' && agentUid) {
            constraints.push(where('assignedTo', '==', agentUid));
        } else if (assignment === 'unassigned') {
            constraints.push(where('assignedTo', '==', null));
        }

        constraints.push(orderBy('updatedAt', 'desc'));
        constraints.push(limit(limitCount));

        return collectionData(
            query(ref, ...constraints),
            { idField: 'id' }
        ) as Observable<Conversation[]>;
    }

    /** Real-time stream of messages in a conversation */
    getMessages(conversationId: string): Observable<Message[]> {
        const ref = collection(this.fs, `customer_conversations/${conversationId}/messages`);
        return collectionData(
            query(ref, orderBy('timestamp', 'asc')),
            { idField: 'id' }
        ) as Observable<Message[]>;
    }

    /** Single conversation doc (real-time) */
    getConversation(id: string): Observable<Conversation | undefined> {
        return docData(
            doc(this.fs, `customer_conversations/${id}`),
            { idField: 'id' }
        ) as Observable<Conversation | undefined>;
    }

    // ── Mutations ──────────────────────────────────────────────────────────────
    
    /** Fetch historical conversations for the data grid */
    async getConversationsHistory(filters: {
        status?: ConversationStatus | 'all';
        channel?: Channel | 'all';
        dateStart?: Date;
        dateEnd?: Date;
    }): Promise<Conversation[]> {
        const ref = collection(this.fs, 'customer_conversations');
        let q = query(ref);

        if (filters.status && filters.status !== 'all') {
            q = query(q, where('status', '==', filters.status));
        }
        if (filters.channel && filters.channel !== 'all') {
            q = query(q, where('channel', '==', filters.channel));
        }
        
        // Note: Firestore requires ordering by the inequality field first.
        // If date ranges are provided, we must order by createdAt.
        // Otherwise, order by updatedAt desc.
        if (filters.dateStart || filters.dateEnd) {
            if (filters.dateStart) {
                q = query(q, where('createdAt', '>=', filters.dateStart));
            }
            if (filters.dateEnd) {
                q = query(q, where('createdAt', '<=', filters.dateEnd));
            }
            q = query(q, orderBy('createdAt', 'desc'));
        } else {
            q = query(q, orderBy('updatedAt', 'desc'));
        }

        q = query(q, limit(500)); // Cap for safety in the grid

        const snap = await getDocs(q);
        return snap.docs.map(d => ({ id: d.id, ...d.data() } as Conversation));
    }

    // ── Mutations ──────────────────────────────────────────────────────────────

    async updateStatus(id: string, status: ConversationStatus): Promise<void> {
        const ref = doc(this.fs, `customer_conversations/${id}`);
        const update: any = { status, updatedAt: serverTimestamp() };
        if (status === 'resolved') update['resolvedAt'] = serverTimestamp();
        await updateDoc(ref, update);
    }

    async assign(id: string, agentUid: string | null): Promise<void> {
        await updateDoc(doc(this.fs, `customer_conversations/${id}`), {
            assignedTo: agentUid,
            updatedAt:  serverTimestamp(),
        });
    }

    async linkCustomer(id: string, customerId: string, customerName?: string): Promise<void> {
        const updatePayload: any = {
            customerId,
            updatedAt: serverTimestamp(),
        };
        if (customerName) {
            updatePayload['customerName'] = customerName;
        }
        await updateDoc(doc(this.fs, `customer_conversations/${id}`), updatePayload);
    }

    // ── Customer 360 ───────────────────────────────────────────────────────────

    getCustomerProfile(customerId: string): Observable<UserProfile | undefined> {
        return docData(
            doc(this.fs, `users/${customerId}`),
            { idField: 'uid' }
        ) as Observable<UserProfile | undefined>;
    }

    getCustomerOrders(customerId: string, phone?: string, email?: string): Observable<any[]> {
        const ref = collection(this.fs, 'orders');
        return (collectionData(
            query(ref, orderBy('createdAt', 'desc'), limit(100)),
            { idField: 'id' }
        ) as Observable<any[]>).pipe(
            map(orders => {
                const cleanPhone = (phone || '').replace(/\D/g, '').slice(-10);
                const cleanEmail = (email || '').toLowerCase().trim();
                return orders.filter(o => {
                    const uId = o['userId'];
                    const cId = o['customer']?.id;
                    const oPhone = (o['customer']?.phone || o['phone'] || '').replace(/\D/g, '').slice(-10);
                    const oEmail = (o['customer']?.email || o['email'] || '').toLowerCase().trim();

                    if (customerId && (uId === customerId || cId === customerId || cId === `ml_${customerId}`)) return true;
                    if (cleanPhone && cleanPhone.length === 10 && oPhone === cleanPhone) return true;
                    if (cleanEmail && cleanEmail.includes('@') && !cleanEmail.endsWith('@mail.mercadolibre.com') && oEmail === cleanEmail) return true;
                    return false;
                });
            })
        );
    }

    /** Auto-search orders to detect if an unlinked handle matches a MercadoLibre buyer via exact phone/email/ID */
    async findSuggestedCustomerMatch(handleOrPhone: string): Promise<{ customerId: string; displayName: string; email?: string; phone?: string; meliOrdersCount: number; lastChannel?: string } | null> {
        if (!handleOrPhone) return null;
        const target = handleOrPhone.trim();
        const cleanDigits = target.replace(/\D/g, '');
        const cleanPhone = cleanDigits.length >= 10 ? cleanDigits.slice(-10) : '';
        const isEmail = target.includes('@') && !target.endsWith('@mail.mercadolibre.com');
        const isMeliId = target.startsWith('ml_') || target.startsWith('usr_');

        // Do not attempt lookup if target is not a valid 10-digit phone, clean email, or explicit ID
        if (!cleanPhone && !isEmail && !isMeliId) return null;

        const ref = collection(this.fs, 'orders');
        const snap = await getDocs(query(ref, orderBy('createdAt', 'desc'), limit(100)));

        let matchingDoc: any = null;

        for (const docSnap of snap.docs) {
            const data = docSnap.data();
            const p1 = (data['customer']?.phone || '').replace(/\D/g, '').slice(-10);
            const p2 = (data['phone'] || '').replace(/\D/g, '').slice(-10);
            const oEmail = (data['customer']?.email || data['email'] || '').toLowerCase().trim();
            const cId = data['customer']?.id;
            const uId = data['userId'];

            let isMatch = false;
            if (cleanPhone && (p1 === cleanPhone || p2 === cleanPhone)) {
                isMatch = true;
            } else if (isEmail && oEmail === target.toLowerCase()) {
                isMatch = true;
            } else if (isMeliId && (cId === target || uId === target)) {
                isMatch = true;
            }

            if (isMatch) {
                matchingDoc = data;
                break;
            }
        }

        if (!matchingDoc) return null;

        const custId = matchingDoc['userId'] || matchingDoc['customer']?.id || `ml_${matchingDoc['externalOrderId'] || matchingDoc['id']}`;
        const name = matchingDoc['customer']?.name || matchingDoc['customer']?.originalName || '';

        // If name is blank or generic, do not present false match
        if (!name || name === 'Cliente ML' || name === 'Cliente' || name === 'Meli Buyer') return null;

        // Count all orders belonging to this exact matching customer
        const matchedOrders = snap.docs.filter(d => {
            const data = d.data();
            const cId = data['customer']?.id;
            const uId = data['userId'];
            const p1 = (data['customer']?.phone || '').replace(/\D/g, '').slice(-10);
            return (custId && (cId === custId || uId === custId)) || (cleanPhone && p1 === cleanPhone);
        });

        const meliCount = matchedOrders.filter(d => {
            const sc = (d.data()['sourceChannel'] || d.data()['acquisitionChannel'] || '').toLowerCase();
            return sc === 'mercadolibre' || sc === 'meli';
        }).length;

        return {
            customerId: custId,
            displayName: name,
            email: matchingDoc['customer']?.email || '',
            phone: matchingDoc['customer']?.phone || handleOrPhone,
            meliOrdersCount: meliCount || (matchingDoc['sourceChannel'] === 'mercadolibre' ? 1 : 0),
            lastChannel: matchingDoc['sourceChannel'] || 'mercadolibre'
        };
    }

    getCustomerHistory(customerId: string): Observable<Conversation[]> {
        const ref = collection(this.fs, 'customer_conversations');
        return collectionData(
            query(ref, where('customerId', '==', customerId), orderBy('updatedAt', 'desc'), limit(10)),
            { idField: 'id' }
        ) as Observable<Conversation[]>;
    }

    async markRead(id: string): Promise<void> {
        await updateDoc(doc(this.fs, `customer_conversations/${id}`), {
            unreadCount: 0,
            updatedAt:   serverTimestamp(),
        });
    }

    async addTag(id: string, tags: string[]): Promise<void> {
        await updateDoc(doc(this.fs, `customer_conversations/${id}`), {
            tags,
            updatedAt: serverTimestamp(),
        });
    }

    async addInternalNote(conversationId: string, text: string, agentUid: string, agentName: string): Promise<void> {
        await addDoc(
            collection(this.fs, `customer_conversations/${conversationId}/messages`),
            {
                direction:         'outbound',
                type:              'comment',
                content:           text,
                platformMessageId: `internal_note_${Date.now()}`,
                sentBy:            agentUid,
                sentByName:        agentName,
                status:            'sent',
                timestamp:         serverTimestamp(),
            }
        );
        await updateDoc(doc(this.fs, `customer_conversations/${conversationId}`), {
            updatedAt: serverTimestamp(),
        });
    }

    /** Notes stored on the conversation itself (no customerId needed) */
    getConversationNotes(conversationId: string): Observable<any[]> {
        const ref = collection(this.fs, `customer_conversations/${conversationId}/notes`);
        return collectionData(
            query(ref, orderBy('timestamp', 'desc')),
            { idField: 'id' }
        );
    }

    async addConversationNote(conversationId: string, text: string, agentUid: string, agentName: string): Promise<void> {
        await addDoc(
            collection(this.fs, `customer_conversations/${conversationId}/notes`),
            { text, agentUid, agentName, timestamp: serverTimestamp() }
        );
    }

    async deleteConversationNote(conversationId: string, noteId: string): Promise<void> {
        await deleteDoc(doc(this.fs, `customer_conversations/${conversationId}/notes/${noteId}`));
    }

    /** @deprecated Use getConversationNotes. Legacy path kept for migration. */
    getCustomerNotes(customerId: string): Observable<any[]> {
        const ref = collection(this.fs, `users/${customerId}/notes`);
        return collectionData(
            query(ref, orderBy('timestamp', 'desc')),
            { idField: 'id' }
        );
    }

    async addCustomerNote(customerId: string, text: string, agentUid: string, agentName: string): Promise<void> {
        await addDoc(
            collection(this.fs, `users/${customerId}/notes`),
            {
                text,
                agentUid,
                agentName,
                timestamp: serverTimestamp()
            }
        );
    }

    async deleteCustomerNote(customerId: string, noteId: string): Promise<void> {
        await deleteDoc(doc(this.fs, `users/${customerId}/notes/${noteId}`));
    }

    /** Update customer info on the conversation (name, phone, email, tags) */
    async updateConversationCustomerInfo(convId: string, data: {
        customerName?: string;
        customerPhone?: string;
        customerEmail?: string;
        customerTags?: string[];
    }): Promise<void> {
        const payload: any = { updatedAt: serverTimestamp() };
        if (data.customerName  !== undefined) payload['customerName']  = data.customerName;
        if (data.customerPhone !== undefined) payload['customerPhone'] = data.customerPhone;
        if (data.customerEmail !== undefined) payload['customerEmail'] = data.customerEmail;
        if (data.customerTags  !== undefined) payload['customerTags']  = data.customerTags;
        await updateDoc(doc(this.fs, `customer_conversations/${convId}`), payload);
    }

    /** Optionally sync profile updates to the users/{uid} document */
    async updateUserProfile(uid: string, data: {
        displayName?: string;
        phone?: string;
        email?: string;
        tags?: string[];
    }): Promise<void> {
        const payload: any = { updatedAt: serverTimestamp() };
        if (data.displayName !== undefined) payload['displayName'] = data.displayName;
        if (data.phone       !== undefined) payload['phone']       = data.phone;
        if (data.email       !== undefined) payload['email']       = data.email;
        if (data.tags        !== undefined) payload['tags']        = data.tags;
        await updateDoc(doc(this.fs, `users/${uid}`), payload);
    }


    // ── Reply ──────────────────────────────────────────────────────────────────

    /**
     * Send a staff reply.
     * - website channel: write directly to Firestore (no external API needed)
     * - all other channels: call the sendInboxReply Cloud Function which routes
     *   to WhatsApp / Telegram / Email via their respective APIs.
     */
    async sendReply(conversationId: string, message: string): Promise<void> {
        const convSnap = await getDoc(doc(this.fs, `customer_conversations/${conversationId}`));
        const channel  = convSnap.exists() ? (convSnap.data() as Conversation).channel : null;

        if (channel === 'website') {
            // Direct Firestore write — the storefront widget listens in real time
            const agentName = this.auth.currentUser?.displayName || 'Asesor';
            const agentUid  = this.auth.currentUser?.uid || null;
            await addDoc(
                collection(this.fs, `customer_conversations/${conversationId}/messages`),
                {
                    direction:         'outbound',
                    type:              'text',
                    content:           message,
                    platformMessageId: `web_reply_${Date.now()}`,
                    sentBy:            agentUid,
                    sentByName:        agentName,
                    status:            'sent',
                    timestamp:         serverTimestamp(),
                }
            );
            // Update conversation lastMessage so it surfaces in the list
            await updateDoc(doc(this.fs, `customer_conversations/${conversationId}`), {
                lastMessage: {
                    text:      message,
                    direction: 'outbound',
                    timestamp: serverTimestamp(),
                    agentName,
                },
                updatedAt: serverTimestamp(),
            });
        } else {
            // External channel — route through Cloud Function
            const fn = httpsCallable<{ conversationId: string; message: string }, { ok: boolean }>(
                this.fns, 'sendInboxReply'
            );
            await fn({ conversationId, message });
        }
    }

    // ── Helpers ────────────────────────────────────────────────────────────────

    /** Human-readable time label for last message (e.g. "2m", "1h", "Ayer") */
    timeAgo(ts: any): string {
        if (!ts) return '';
        const d = typeof ts?.toDate === 'function' ? ts.toDate() : (ts instanceof Date ? ts : new Date(ts));
        if (!d || isNaN(d.getTime())) return '';
        const diff = Date.now() - d.getTime();
        const m = Math.floor(diff / 60000);
        if (m < 1)  return 'ahora';
        if (m < 60) return `${m}m`;
        const h = Math.floor(m / 60);
        if (h < 24) return `${h}h`;
        const days = Math.floor(h / 24);
        return days === 1 ? 'ayer' : `${days}d`;
    }

    channelLabel(channel: Channel): string {
        const labels: Record<Channel, string> = {
            whatsapp:  'WhatsApp',
            instagram: 'Instagram',
            facebook:  'Facebook',
            telegram:  'Telegram',
            email:     'Email',
            tiktok:    'TikTok',
            website:   'Chat Web',
            mercadolibre: 'MercadoLibre',
        };
        return labels[channel] ?? channel;
    }

    channelColor(channel: Channel): string {
        const colors: Record<Channel, string> = {
            whatsapp:  '#25d366',
            instagram: '#e1306c',
            facebook:  '#1877f2',
            telegram:  '#0088cc',
            email:     '#6366f1',
            tiktok:    '#ff0050',
            website:   '#8b5cf6',
            mercadolibre: '#ffe600',
        };
        return colors[channel] ?? '#71717a';
    }

    channelIcon(channel: Channel): string {
        const icons: Record<Channel, string> = {
            whatsapp:  'message-circle',
            instagram: 'instagram',
            facebook:  'facebook',
            telegram:  'send',
            email:     'mail',
            tiktok:    'music',
            website:   'globe',
            mercadolibre: 'shopping-bag',
        };
        return icons[channel] ?? 'message-square';
    }
}
