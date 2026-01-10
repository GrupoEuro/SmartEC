import { Component, HostListener, Inject, OnInit, PLATFORM_ID, signal } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';

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

  constructor(@Inject(PLATFORM_ID) private platformId: Object) { }

  ngOnInit() {
    if (isPlatformBrowser(this.platformId)) {
      // Show after 5 seconds regardless of scroll
      setTimeout(() => {
        this.isVisible.set(true);
      }, 5000);
    }
  }

  @HostListener('window:scroll', [])
  onWindowScroll() {
    if (isPlatformBrowser(this.platformId) && !this.hasScrolled) {
      const scrollPosition = window.scrollY || document.documentElement.scrollTop || 0;
      if (scrollPosition > 100) {
        this.isVisible.set(true);
        this.hasScrolled = true; // Avoid re-triggering logic unnecessarily
      }
    }
  }

  openChat() {
    window.open('https://wa.me/5214442004677', '_blank');
  }
}
