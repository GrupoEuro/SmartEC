import { Component, HostListener, Inject, OnInit, PLATFORM_ID, signal, inject, effect } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { Router } from '@angular/router';
import { CartService } from '../../core/services/cart.service';
import { AuthService } from '../../core/services/auth.service';
import { AttributionService, stripUndefined } from '../../core/services/attribution.service';
import { Firestore, collection, addDoc, Timestamp } from '@angular/fire/firestore';

@Component({
  selector: 'app-chat-widget',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './chat-widget.component.html',
  styleUrls: ['./chat-widget.component.css']
})
export class ChatWidgetComponent implements OnInit {
  isVisible = signal(false);
  private hasScrolled = false;
  private router         = inject(Router);
  private cartService    = inject(CartService);
  private authService    = inject(AuthService);
  private attributionSvc = inject(AttributionService);
  private firestore      = inject(Firestore);

  constructor(@Inject(PLATFORM_ID) private platformId: Object) {
    // Effect to auto-hide chat when Cart Drawer is open
    effect(() => {
      if (this.cartService.isDrawerOpen()) {
        this.isVisible.set(false);
      } else {
        // Re-evaluate visibility based on scroll/route when drawer closes
        this.onWindowScroll();
      }
    }, { allowSignalWrites: true });
  }

  ngOnInit() {
    if (isPlatformBrowser(this.platformId)) {
      this.checkRouteAndInit();
    }
  }

  // ... (rest of methods)

  private checkRouteAndInit() {
    // If we are NOT on a strict footer route (catalog/product), behave normally
    if (!this.isStrictFooterRoute()) {
      setTimeout(() => {
        this.isVisible.set(true);
      }, 5000);
    }
  }

  private isStrictFooterRoute(): boolean {
    const url = this.router.url;
    // Purchase process routes where whatsapp should not obscure content
    return url.includes('/catalog') ||
      url.includes('/product/') ||
      url.includes('/checkout') ||
      url.includes('/order-confirmation');
  }

  @HostListener('window:scroll', [])
  onWindowScroll() {
    if (!isPlatformBrowser(this.platformId)) return;

    if (this.isStrictFooterRoute()) {
      // Strict Footer Logic for Catalog & Product Detail
      // Check if user is near the bottom of the page
      const scrollPosition = window.innerHeight + window.scrollY;
      const bodyHeight = document.body.offsetHeight;

      // Show if within 150px of bottom (footer area)
      if (bodyHeight - scrollPosition < 150) {
        this.isVisible.set(true);
      } else {
        this.isVisible.set(false);
      }
    } else {
      // Normal Behavior for other pages
      if (!this.hasScrolled) {
        const scrollPosition = window.scrollY || document.documentElement.scrollTop || 0;
        if (scrollPosition > 100) {
          this.isVisible.set(true);
          this.hasScrolled = true;
        }
      }
    }
  }

  async openChat() {
    const attr      = this.attributionSvc.get();
    const url       = this.router.url;
    const cartItems = this.cartService.cartItems();
    const cartValue = this.cartService.cartSubtotal();
    const sessionId = isPlatformBrowser(this.platformId)
        ? (sessionStorage.getItem('cart_session_id') || null)
        : null;

    // ── Build context-aware pre-filled message ────────────────────────────
    let message = '¡Hola! Me gustaría obtener más información.';

    if (url.includes('/product/')) {
      // Extract product slug from URL for context
      const slug = url.split('/product/')[1]?.split('?')[0] ?? '';
      message = `¡Hola! Estoy viendo el producto ${decodeURIComponent(slug)} y tengo una pregunta.`;
    } else if (cartItems.length > 0) {
      const names = cartItems.slice(0, 2).map(i => i.product.name?.es || i.product.name?.en || 'producto').join(', ');
      message = `¡Hola! Tengo ${cartItems.length} producto(s) en mi carrito (${names}) y necesito ayuda.`;
    } else if (url.includes('/catalog')) {
      message = '¡Hola! Estoy buscando llantas y me gustaría recibir asesoría.';
    }

    // ── Log click to Firestore (fire-and-forget) ──────────────────────────
    if (isPlatformBrowser(this.platformId)) {
      const userId = this.authService.currentUser()?.uid ?? null;
      addDoc(collection(this.firestore, 'whatsappClicks'), stripUndefined({
        clickedAt:    Timestamp.now(),
        page:         url,
        sessionId,
        userId:       userId ?? undefined,   // written when authenticated
        cartValue:    cartValue > 0 ? cartValue : undefined,
        cartItems:    cartItems.length > 0 ? cartItems.length : undefined,
        geo:          attr?.geo         ?? undefined,
        device:       attr?.device      ?? undefined,
        utm:          attr?.utm         ?? undefined,
        campaignId:   attr?.campaignId  ?? undefined,
        campaignName: attr?.campaignName ?? undefined,
        referrer:     attr?.referrer    ?? undefined,
      })).catch(() => {}); // Non-critical — never block the click
    }

    // ── Open WhatsApp with pre-filled message ─────────────────────────────
    const encoded = encodeURIComponent(message);
    window.open(`https://wa.me/5214442004677?text=${encoded}`, '_blank');
  }
}
