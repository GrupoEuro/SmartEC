import { Component, HostListener, Inject, OnInit, PLATFORM_ID, signal, inject, effect } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { Router } from '@angular/router';
import { CartService } from '../../core/services/cart.service';

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
  private router = inject(Router);
  private cartService = inject(CartService); // Inject Cart Service

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

  openChat() {
    window.open('https://wa.me/5214442004677', '_blank');
  }
}
