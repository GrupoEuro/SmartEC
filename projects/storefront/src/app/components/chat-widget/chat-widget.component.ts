import {
    Component, HostListener, Inject, OnInit, OnDestroy,
    PLATFORM_ID, signal, inject, effect
} from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { CartService } from '../../core/services/cart.service';
import { AuthService } from '../../core/services/auth.service';
import { AttributionService, stripUndefined } from '../../core/services/attribution.service';
import { WebChatService, WebChatMessage, WebChatConversationStatus } from '../../core/services/web-chat.service';
import { Firestore, collection, addDoc, Timestamp } from '@angular/fire/firestore';

type WidgetView = 'closed' | 'launcher' | 'preform' | 'chat';

@Component({
  selector: 'app-chat-widget',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './chat-widget.component.html',
  styleUrls: ['./chat-widget.component.css']
})
export class ChatWidgetComponent implements OnInit, OnDestroy {
    // ── Visibility ────────────────────────────────────────────────────────────
    isVisible     = signal(false);
    private hasScrolled = false;

    // ── Widget state ─────────────────────────────────────────────────────────
    view          = signal<WidgetView>('closed');
    isSending     = signal(false);
    messages      = signal<WebChatMessage[]>([]);
    convId        = signal<string | null>(null);

    // ── Pre-form fields ───────────────────────────────────────────────────────
    visitorName   = '';
    visitorEmail  = '';
    firstMessage  = '';

    // ── In-chat compose ───────────────────────────────────────────────────────
    replyText     = '';

    // ── AI Agent state ────────────────────────────────────────────────────────
    aiHandled     = signal(false);      // conversation currently served by AI
    aiAgentName   = signal<string>(''); // e.g. 'EuroBot'
    aiAgentEmoji  = signal<string>('🤖');
    isHandingOff  = signal(false);      // transitioning AI → human
    isAiTyping    = signal(false);      // AI typing indicator

    private msgSub?:    Subscription;
    private statusSub?: Subscription;

    // ── DI ───────────────────────────────────────────────────────────────────
    private router         = inject(Router);
    private cartService    = inject(CartService);
    private authService    = inject(AuthService);
    private attributionSvc = inject(AttributionService);
    private chatSvc        = inject(WebChatService);
    private firestore      = inject(Firestore);

    constructor(@Inject(PLATFORM_ID) private platformId: Object) {
        effect(() => {
            if (this.cartService.isDrawerOpen()) {
                this.isVisible.set(false);
            } else {
                this.onWindowScroll();
            }
        }, { allowSignalWrites: true });
    }

    ngOnInit() {
        if (!isPlatformBrowser(this.platformId)) return;
        this.checkRouteAndInit();

        // Pre-fill name/email from auth
        const profile = this.authService.currentUser?.();
        if (profile?.displayName) this.visitorName  = profile.displayName;
        if (profile?.email)       this.visitorEmail = profile.email;

        // Resume existing session
        const existingConv = this.chatSvc.currentConversationId;
        if (existingConv) {
            this.convId.set(existingConv);
            this.subscribeMessages(existingConv);
            // go directly to chat view (launcher will show)
        }
    }

    ngOnDestroy() {
        this.msgSub?.unsubscribe();
        this.statusSub?.unsubscribe();
    }

    // ── Route / scroll logic ─────────────────────────────────────────────────

    private checkRouteAndInit() {
        if (!this.isStrictFooterRoute()) {
            setTimeout(() => this.isVisible.set(true), 5000);
        }
    }

    private isStrictFooterRoute(): boolean {
        const url = this.router.url;
        return url.includes('/checkout') || url.includes('/order-confirmation');
    }

    @HostListener('window:scroll', [])
    onWindowScroll() {
        if (!isPlatformBrowser(this.platformId)) return;
        if (this.isStrictFooterRoute()) {
            const scrollPosition = window.innerHeight + window.scrollY;
            const bodyHeight     = document.body.offsetHeight;
            this.isVisible.set(bodyHeight - scrollPosition < 150);
        } else if (!this.hasScrolled) {
            if ((window.scrollY || document.documentElement.scrollTop || 0) > 100) {
                this.isVisible.set(true);
                this.hasScrolled = true;
            }
        }
    }

    // ── FAB click: open launcher ─────────────────────────────────────────────

    toggleWidget() {
        if (this.view() === 'closed') {
            // If already chatting, go straight to chat thread
            this.view.set(this.convId() ? 'chat' : 'launcher');
        } else {
            this.view.set('closed');
        }
    }

    // ── Launcher: user picks live chat vs WhatsApp ───────────────────────────

    chooseLiveChat() {
        this.view.set(this.convId() ? 'chat' : 'preform');
    }

    openWhatsApp() {
        const message = this.buildWaMessage();
        const encoded = encodeURIComponent(message);
        window.open(`https://wa.me/524441946502?text=${encoded}`, '_blank');
        this.view.set('closed');
        this.logWhatsAppClick();
    }

    // ── Pre-form: gather name + first message ────────────────────────────────

    async startChat() {
        if (!this.firstMessage.trim() || !this.visitorName.trim()) return;
        this.isSending.set(true);
        try {
            const id = await this.chatSvc.startConversation({
                customerName:   this.visitorName.trim(),
                customerEmail:  this.visitorEmail.trim() || undefined,
                initialMessage: this.firstMessage.trim(),
                pageUrl:        this.router.url,
            });
            this.convId.set(id);
            this.subscribeMessages(id);
            this.firstMessage = '';
            this.view.set('chat');
        } catch (e) {
            console.error('[WebChat] startConversation error:', e);
        } finally {
            this.isSending.set(false);
        }
    }

    // ── In-chat: send reply ───────────────────────────────────────────────────

    async sendReply() {
        const text = this.replyText.trim();
        if (!text || !this.convId() || this.isSending()) return;
        this.isSending.set(true);
        this.replyText = '';
        try {
            await this.chatSvc.sendMessage(this.convId()!, text, this.visitorName || 'Visitante');
        } catch (e) {
            console.error('[WebChat] sendMessage error:', e);
        } finally {
            this.isSending.set(false);
        }
    }

    onEnter(event: KeyboardEvent) {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            this.sendReply();
        }
    }

    // ── Messages stream ───────────────────────────────────────────────────────

    private subscribeMessages(convId: string) {
        this.msgSub?.unsubscribe();
        this.msgSub = this.chatSvc.streamMessages(convId).subscribe(msgs => {
            // Show AI typing indicator briefly when last message was inbound (customer sent)
            const last = msgs[msgs.length - 1];
            if (last?.direction === 'inbound' && this.aiHandled()) {
                this.isAiTyping.set(true);
            } else {
                this.isAiTyping.set(false);
            }
            this.messages.set(msgs);
            setTimeout(() => {
                const el = document.getElementById('wc-messages');
                if (el) el.scrollTop = el.scrollHeight;
            }, 50);
        });

        // Stream conversation metadata for AI/handoff state
        this.statusSub?.unsubscribe();
        this.statusSub = this.chatSvc.streamConversationStatus(convId).subscribe(
            (status: WebChatConversationStatus) => {
                this.aiHandled.set(status.aiHandled ?? false);
                if (status.aiAgentName)  this.aiAgentName.set(status.aiAgentName);
                if (status.aiAgentEmoji) this.aiAgentEmoji.set(status.aiAgentEmoji);
                // Detect handoff: was AI, now pending human
                if (status.status === 'pending_human') {
                    this.isHandingOff.set(true);
                    // Clear after a few seconds once a human is assigned
                    if (status.assignedTo) {
                        setTimeout(() => this.isHandingOff.set(false), 4000);
                    }
                } else {
                    this.isHandingOff.set(false);
                }
            }
        );
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    formatTime(ts: Timestamp | null): string {
        if (!ts?.toDate) return '';
        return ts.toDate().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
    }

    private buildWaMessage(): string {
        const url       = this.router.url;
        const cartItems = this.cartService.cartItems();
        if (url.includes('/product/')) {
            const slug = url.split('/product/')[1]?.split('?')[0] ?? '';
            return `¡Hola! Estoy viendo el producto ${decodeURIComponent(slug)} y tengo una pregunta.`;
        }
        if (cartItems.length > 0) {
            const names = cartItems.slice(0, 2).map(i => i.product.name?.es || i.product.name?.en || 'producto').join(', ');
            return `¡Hola! Tengo ${cartItems.length} producto(s) en mi carrito (${names}) y necesito ayuda.`;
        }
        return '¡Hola! Me gustaría obtener más información.';
    }

    private logWhatsAppClick() {
        if (!isPlatformBrowser(this.platformId)) return;
        const attr      = this.attributionSvc.get();
        const userId    = this.authService.currentUser?.()?.uid ?? null;
        const sessionId = sessionStorage.getItem('cart_session_id') || null;
        addDoc(collection(this.firestore, 'whatsappClicks'), stripUndefined({
            clickedAt:    Timestamp.now(),
            page:         this.router.url,
            sessionId,
            userId:       userId ?? undefined,
            cartValue:    this.cartService.cartSubtotal() > 0 ? this.cartService.cartSubtotal() : undefined,
            cartItems:    this.cartService.cartItems().length > 0 ? this.cartService.cartItems().length : undefined,
            geo:          attr?.geo          ?? undefined,
            device:       attr?.device       ?? undefined,
            utm:          attr?.utm          ?? undefined,
            campaignId:   attr?.campaignId   ?? undefined,
            campaignName: attr?.campaignName ?? undefined,
            referrer:     attr?.referrer     ?? undefined,
        })).catch(() => {});
    }

    // legacy compat — keep openChat() working if called from outside
    openChat() { this.toggleWidget(); }
}
