import { Injectable, inject } from '@angular/core';
import {
    Firestore,
    collection, doc, addDoc, updateDoc, onSnapshot,
    query, orderBy, serverTimestamp, Timestamp, where,
    getDocs, limit, setDoc,
} from '@angular/fire/firestore';
import { Observable, Subject } from 'rxjs';

export interface WebChatMessage {
    id:              string;
    direction:       'inbound' | 'outbound';
    content:         string;
    sentByName?:     string;
    timestamp:       Timestamp;
    status:          'received' | 'sent' | 'delivered' | 'read';
    isAiGenerated?:  boolean;   // set by agentOrchestrator Cloud Function
    agentEmoji?:     string;    // e.g. '🤖'
    isHandoffMsg?:   boolean;   // system message marking the handoff
}

export interface WebChatConversationStatus {
    status:          string;    // 'open' | 'ai_handled' | 'pending_human' | 'resolved'
    aiHandled?:      boolean;
    aiAgentName?:    string;
    aiAgentEmoji?:   string;
    assignedTo?:     string | null;
}

@Injectable({ providedIn: 'root' })
export class WebChatService {
    private fs = inject(Firestore);

    // ── Session state ──────────────────────────────────────────────────────────
    /** Active conversation ID stored in sessionStorage so refreshes resume */
    private get sessionConvId(): string | null {
        return sessionStorage.getItem('wc_conv_id');
    }
    private set sessionConvId(v: string | null) {
        if (v) sessionStorage.setItem('wc_conv_id', v);
        else    sessionStorage.removeItem('wc_conv_id');
    }

    // ── Start or resume a conversation ─────────────────────────────────────────
    async startConversation(opts: {
        customerName: string;
        customerEmail?: string;
        initialMessage: string;
        pageUrl: string;
    }): Promise<string> {
        // If there's an existing session conversation, re-use it
        if (this.sessionConvId) {
            // Verify it still exists and is not resolved
            const existing = await getDocs(
                query(
                    collection(this.fs, 'customer_conversations'),
                    where('__name__', '==', this.sessionConvId),
                    limit(1)
                )
            );
            if (!existing.empty) {
                const data = existing.docs[0].data() as any;
                if (data.status !== 'resolved') {
                    // Resume: just add the new message
                    await this.sendMessage(this.sessionConvId, opts.initialMessage, opts.customerName);
                    return this.sessionConvId;
                }
            }
            // Resolved or missing → start fresh
            this.sessionConvId = null;
        }

        // ── Create new conversation ────────────────────────────────────────────
        const convRef = await addDoc(collection(this.fs, 'customer_conversations'), {
            channel:               'website',
            channelConversationId: `web_${Date.now()}`,
            customerName:          opts.customerName,
            customerHandle:        opts.customerEmail || 'visitante',
            customerId:            null,
            status:                'open',
            priority:              'normal',
            assignedTo:            null,
            tags:                  ['web-chat'],
            unreadCount:           1,
            metadata: {
                pageUrl:  opts.pageUrl,
                source:   'web-widget',
            },
            lastMessage: {
                text:      opts.initialMessage,
                direction: 'inbound',
                timestamp: serverTimestamp(),
            },
            createdAt:  serverTimestamp(),
            updatedAt:  serverTimestamp(),
        });

        this.sessionConvId = convRef.id;

        // Write first message to subcollection
        await addDoc(
            collection(this.fs, `customer_conversations/${convRef.id}/messages`),
            {
                direction:         'inbound',
                type:              'text',
                content:           opts.initialMessage,
                platformMessageId: `web_${Date.now()}`,
                sentByName:        opts.customerName,
                status:            'received',
                timestamp:         serverTimestamp(),
            }
        );

        return convRef.id;
    }

    // ── Send a follow-up message ───────────────────────────────────────────────
    async sendMessage(conversationId: string, content: string, senderName: string): Promise<void> {
        await addDoc(
            collection(this.fs, `customer_conversations/${conversationId}/messages`),
            {
                direction:         'inbound',
                type:              'text',
                content,
                platformMessageId: `web_${Date.now()}`,
                sentByName:        senderName,
                status:            'received',
                timestamp:         serverTimestamp(),
            }
        );
        await updateDoc(doc(this.fs, `customer_conversations/${conversationId}`), {
            lastMessage: {
                text:      content,
                direction: 'inbound',
                timestamp: serverTimestamp(),
            },
            unreadCount: (await this.getUnreadCount(conversationId)) + 1,
            updatedAt:   serverTimestamp(),
        });
    }

    // ── Real-time message stream ───────────────────────────────────────────────
    streamMessages(conversationId: string): Observable<WebChatMessage[]> {
        return new Observable(observer => {
            const ref = collection(this.fs, `customer_conversations/${conversationId}/messages`);
            const q   = query(ref, orderBy('timestamp', 'asc'));
            const unsub = onSnapshot(q, snap => {
                const msgs: WebChatMessage[] = snap.docs.map(d => ({
                    id:             d.id,
                    direction:      d.data()['direction'],
                    content:        d.data()['content'],
                    sentByName:     d.data()['sentByName'],
                    timestamp:      d.data()['timestamp'],
                    status:         d.data()['status'],
                    isAiGenerated:  d.data()['isAiGenerated'] ?? false,
                    agentEmoji:     d.data()['agentEmoji'],
                    isHandoffMsg:   d.data()['isHandoffMsg'] ?? false,
                }));
                observer.next(msgs);
            }, err => observer.error(err));
            return () => unsub();
        });
    }

    // ── Real-time conversation status (for handoff detection) ─────────────────
    streamConversationStatus(conversationId: string): Observable<WebChatConversationStatus> {
        return new Observable(observer => {
            const ref  = doc(this.fs, `customer_conversations/${conversationId}`);
            const unsub = onSnapshot(ref, snap => {
                if (!snap.exists()) return;
                const d = snap.data() as any;
                observer.next({
                    status:       d['status'],
                    aiHandled:    d['aiHandled']    ?? false,
                    aiAgentName:  d['aiAgentName']  ?? null,
                    aiAgentEmoji: d['aiAgentEmoji'] ?? null,
                    assignedTo:   d['assignedTo']   ?? null,
                });
            }, err => observer.error(err));
            return () => unsub();
        });
    }

    get currentConversationId(): string | null {
        return this.sessionConvId;
    }

    clearSession(): void {
        this.sessionConvId = null;
    }

    private async getUnreadCount(convId: string): Promise<number> {
        const snap = await getDocs(
            query(collection(this.fs, 'customer_conversations'), where('__name__', '==', convId), limit(1))
        );
        return snap.empty ? 0 : (snap.docs[0].data()['unreadCount'] ?? 0);
    }
}
