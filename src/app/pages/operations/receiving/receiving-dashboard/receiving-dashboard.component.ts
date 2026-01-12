import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { AppIconComponent } from '../../../../shared/components/app-icon/app-icon.component';
import { ReceivingService } from '../../../../core/services/receiving.service';
import { AdvancedShippingNotice, GoodsReceiptNote } from '../../../../core/models/receiving.model';

@Component({
    selector: 'app-receiving-dashboard',
    standalone: true,
    imports: [CommonModule, TranslateModule, AppIconComponent],
    templateUrl: './receiving-dashboard.component.html',
    styleUrls: ['./receiving-dashboard.component.css']
})
export class ReceivingDashboardComponent implements OnInit {
    private receivingService = inject(ReceivingService);
    private router = inject(Router);

    // State
    pendingASNs = signal<AdvancedShippingNotice[]>([]);
    recentGRNs = signal<GoodsReceiptNote[]>([]);
    loading = signal(true);
    selectedWarehouse = signal('MAIN');

    ngOnInit() {
        this.loadData();
    }

    loadData() {
        this.loading.set(true);

        // Load pending ASNs
        this.receivingService.getASNs(this.selectedWarehouse(), 'pending').subscribe(asns => {
            this.pendingASNs.set(asns);
            this.loading.set(false);
        });

        // Load recent GRNs (last 10)
        this.receivingService.getGRNs(this.selectedWarehouse(), 10).subscribe(grns => {
            this.recentGRNs.set(grns);
        });
    }

    // Navigate to receive goods page
    startReceiving(asn: AdvancedShippingNotice) {
        this.router.navigate(['/operations/receiving/receive', asn.id]);
    }

    // Navigate to create manual receipt (no ASN)
    createManualReceipt() {
        this.router.navigate(['/operations/receiving/receive']);
    }

    // Navigate to putaway tasks
    viewPutawayTasks() {
        this.router.navigate(['/operations/receiving/putaway']);
    }

    // View GRN details
    viewGRN(grn: GoodsReceiptNote) {
        // TODO: Create GRN detail view
        console.log('View GRN:', grn);
    }

    // Format date
    formatDate(timestamp: any): string {
        if (!timestamp) return '';
        const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
        return date.toLocaleDateString();
    }

    // Get status badge color
    getStatusColor(status: string): string {
        switch (status) {
            case 'pending': return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
            case 'partial': return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
            case 'received': return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30';
            case 'completed': return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30';
            default: return 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30';
        }
    }
}
