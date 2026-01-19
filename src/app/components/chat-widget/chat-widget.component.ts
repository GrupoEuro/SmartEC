import { Component, HostListener, Inject, OnInit, PLATFORM_ID, signal, inject } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { Router } from '@angular/router';

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

  constructor(@Inject(PLATFORM_ID) private platformId: Object) { }

  ngOnInit() {
    if (isPlatformBrowser(this.platformId)) {
      this.checkRouteAndInit();
    }
  }

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
    return url.includes('/catalog') || url.includes('/product/');
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
