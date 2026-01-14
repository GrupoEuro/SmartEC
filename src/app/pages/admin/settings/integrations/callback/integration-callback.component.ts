
import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { MeliService } from '../../../../../core/services/meli.service';

@Component({
    selector: 'app-integration-callback',
    standalone: true,
    imports: [CommonModule],
    template: `
    <div class="h-screen flex flex-col items-center justify-center bg-slate-900 text-white">
        <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-yellow-500 mb-4"></div>
        <h2 class="text-xl font-bold mb-2">Connecting to MercadoLibre...</h2>
        <p class="text-slate-400 text-sm">{{ statusMessage }}</p>
        
        <div *ngIf="error" class="mt-4 p-4 bg-red-500/20 border border-red-500 rounded text-red-200 text-sm max-w-md text-center">
            {{ error }}
            <button (click)="goBack()" class="block w-full mt-3 py-2 bg-red-600 hover:bg-red-500 rounded text-white font-bold">
                Return to Settings
            </button>
        </div>
    </div>
    `
})
export class IntegrationCallbackComponent implements OnInit {
    private route = inject(ActivatedRoute);
    private router = inject(Router);
    private meliService = inject(MeliService);

    statusMessage = 'Verifying credentials...';
    error: string | null = null;

    ngOnInit() {
        this.route.queryParams.subscribe(async params => {
            const code = params['code'];
            const error = params['error'];

            if (error) {
                this.error = `Authorization denied: ${params['error_description'] || error}`;
                this.statusMessage = 'Connection Failed';
                return;
            }

            if (!code) {
                this.error = 'No authorization code received.';
                this.statusMessage = 'Invalid Callback';
                return;
            }

            try {
                this.statusMessage = 'Exchanging details...';
                await this.meliService.handleAuthCallback(String(code));

                this.statusMessage = 'Success! Redirecting...';
                // Delay slightly for UX
                setTimeout(() => {
                    this.router.navigate(['/admin/integrations']);
                }, 1000);
            } catch (err: any) {
                this.error = 'Failed to connect. The code may be expired or invalid. Detailed error check console.';
                this.statusMessage = 'Connection Error';
            }
        });
    }

    goBack() {
        this.router.navigate(['/admin/integrations']);
    }
}
