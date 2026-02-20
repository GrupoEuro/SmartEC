import { Component, Inject, OnInit, signal, effect, PLATFORM_ID } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';

@Component({
    selector: 'app-exit-intent',
    standalone: true,
    imports: [CommonModule],
    template: `
    @if (isOpen()) {
        <div class="fixed inset-0 z-[2000] flex items-center justify-center p-4 animate-in fade-in duration-200">
            <!-- Backdrop -->
            <div class="absolute inset-0 bg-black/60 backdrop-blur-sm" (click)="close()"></div>
            
            <!-- Modal -->
            <div class="relative bg-white dark:bg-slate-800 rounded-2xl shadow-2xl max-w-md w-full p-8 text-center animate-in zoom-in-95 duration-300 border border-slate-200 dark:border-slate-700">
                <button (click)="close()" class="absolute top-4 right-4 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>

                <div class="mb-6 flex justify-center">
                    <div class="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center text-3xl">
                        🎁
                    </div>
                </div>

                <h2 class="text-2xl font-bold text-slate-900 dark:text-white mb-2">Wait! Don't Go Empty Handed</h2>
                <p class="text-slate-600 dark:text-slate-400 mb-6">
                    Before you leave, here's a special gift. Use code <span class="font-bold text-blue-600">SAVE5</span> for 5% off your order today.
                </p>

                <div class="bg-slate-100 dark:bg-slate-900 p-4 rounded-lg mb-6 border border-dashed border-slate-300 dark:border-slate-700 flex items-center justify-between">
                    <code class="font-mono text-lg font-bold text-blue-600">SAVE5</code>
                    <button (click)="copyCode()" class="text-sm font-medium text-slate-500 hover:text-slate-800 underline">
                        {{ copied() ? 'Copied!' : 'Copy Code' }}
                    </button>
                </div>

                <div class="space-y-3">
                    <button (click)="close()" class="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-xl transition-colors shadow-lg shadow-blue-600/20">
                        Apply Discount & Continue Shopping
                    </button>
                    <button (click)="close()" class="w-full text-slate-400 hover:text-slate-600 text-sm font-medium">
                        No thanks, I hate saving money
                    </button>
                </div>
            </div>
        </div>
    }
  `
})
export class ExitIntentComponent implements OnInit {
    isOpen = signal(false);
    copied = signal(false);

    constructor(@Inject(PLATFORM_ID) private platformId: Object) { }

    ngOnInit() {
        if (isPlatformBrowser(this.platformId)) {
            this.initExitListener();
        }
    }

    private initExitListener() {
        // Only verify showing once per session
        if (sessionStorage.getItem('exit_intent_shown')) {
            return;
        }

        const handler = (e: MouseEvent) => {
            if (e.clientY <= 0) {
                // Mouse left top of viewport
                this.showPopup();
                document.removeEventListener('mouseleave', handler);
            }
        };

        document.addEventListener('mouseleave', handler);
    }

    private showPopup() {
        this.isOpen.set(true);
        sessionStorage.setItem('exit_intent_shown', 'true');
    }

    close() {
        this.isOpen.set(false);
    }

    copyCode() {
        navigator.clipboard.writeText('SAVE5');
        this.copied.set(true);
        setTimeout(() => this.copied.set(false), 2000);
    }
}
