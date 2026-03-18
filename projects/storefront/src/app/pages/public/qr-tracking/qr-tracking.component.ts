import { Component, inject, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { CouponService } from '../../../core/services/coupon.service';

@Component({
  selector: 'app-qr-tracking',
  standalone: true,
  template: `
  <div class="h-screen w-screen flex flex-col items-center justify-center bg-zinc-950 text-zinc-100 font-sans fixed inset-0 z-50">
    <div class="animate-pulse flex flex-col items-center space-y-6">
        <div class="w-16 h-16 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
        <p class="text-sm tracking-widest text-zinc-400 uppercase font-semibold">Applying Promo Code...</p>
    </div>
  </div>
  `
})
export class QrTrackingComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private couponService = inject(CouponService);

  ngOnInit() {
    const code = this.route.snapshot.paramMap.get('code');
    
    if (code) {
      // Save code locally to apply it at checkout implicitly
      if (typeof window !== 'undefined' && window.localStorage) {
         localStorage.setItem('active_promo_code', code.toUpperCase());
      }
      
      // Increment scan count and fetch destination
      this.couponService.incrementScanCount(code).then((redirectUrl) => {
          setTimeout(() => {
              if (redirectUrl) {
                  if (redirectUrl.startsWith('http')) {
                      window.location.href = redirectUrl;
                  } else {
                      this.router.navigateByUrl(redirectUrl);
                  }
              } else {
                  this.router.navigate(['/catalog']);
              }
          }, 1500);
      }).catch((err: any) => {
        console.error('Failed to register scan', err);
        setTimeout(() => this.router.navigate(['/catalog']), 1500);
      });
    } else {
        setTimeout(() => this.router.navigate(['/catalog']), 1500);
    }
  }
}
