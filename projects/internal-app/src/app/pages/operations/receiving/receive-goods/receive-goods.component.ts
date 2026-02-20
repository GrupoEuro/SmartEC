import { Component, inject, signal, OnInit, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { Timestamp } from '@angular/fire/firestore';
import { AppIconComponent } from '../../../../shared/components/app-icon/app-icon.component';
import { ReceivingService } from '../../../../core/services/receiving.service';
import { ProductService } from '../../../../core/services/product.service';
import { AdvancedShippingNotice, GRNItem, QualityStatus } from '../../../../core/models/receiving.model';

@Component({
    selector: 'app-receive-goods',
    standalone: true,
    imports: [CommonModule, FormsModule, TranslateModule, AppIconComponent],
    templateUrl: './receive-goods.component.html',
    styleUrls: ['./receive-goods.component.css']
})
export class ReceiveGoodsComponent implements OnInit {
    private receivingService = inject(ReceivingService);
    private productService = inject(ProductService);
    private route = inject(ActivatedRoute);
    private router = inject(Router);

    // State
    asn = signal<AdvancedShippingNotice | null>(null);
    receivedItems = signal<GRNItem[]>([]);
    currentScan = signal('');
    notes = signal('');
    processing = signal(false);

    // Computed
    allItemsProcessed = computed(() => {
        const asnData = this.asn();
        if (!asnData) return false;
        return asnData.items.every(item => {
            const received = this.receivedItems().find(r => r.productId === item.productId);
            return received && received.quantityReceived > 0;
        });
    });

    ngOnInit() {
        const asnId = this.route.snapshot.paramMap.get('id');
        if (asnId) {
            this.loadASN(asnId);
        }
    }

    loadASN(id: string) {
        this.receivingService.getASNById(id).subscribe(asn => {
            if (asn) {
                this.asn.set(asn);
                // Initialize received items
                const items: GRNItem[] = asn.items.map(item => ({
                    productId: item.productId,
                    productSku: item.productSku,
                    productName: item.productName,
                    quantityReceived: 0,
                    quantityAccepted: 0,
                    quantityRejected: 0,
                    qualityStatus: 'pending'
                }));
                this.receivedItems.set(items);
            }
        });
    }

    // Update received quantity for item
    updateQuantity(productId: string, quantity: number) {
        this.receivedItems.update(items =>
            items.map(item =>
                item.productId === productId
                    ? { ...item, quantityReceived: quantity, quantityAccepted: quantity }
                    : item
            )
        );
    }

    // Update quality status
    updateQuality(productId: string, status: QualityStatus) {
        this.receivedItems.update(items =>
            items.map(item => {
                if (item.productId === productId) {
                    return {
                        ...item,
                        qualityStatus: status,
                        quantityAccepted: status === 'passed' ? item.quantityReceived : 0,
                        quantityRejected: status === 'failed' ? item.quantityReceived : 0
                    };
                }
                return item;
            })
        );
    }

    // Complete receiving and create GRN
    async completeReceiving() {
        const asnData = this.asn();
        if (!asnData) return;

        this.processing.set(true);

        try {
            const grnNumber = await this.receivingService.generateGRNNumber();
            const grnId = await this.receivingService.createGRN({
                grnNumber,
                asnId: asnData.id,
                warehouseId: asnData.warehouseId,
                receivedDate: Timestamp.now(),
                receivedBy: 'current-user', // TODO: Get from auth
                status: 'completed',
                items: this.receivedItems(),
                notes: this.notes()
            });

            // Generate putaway tasks
            await this.receivingService.generatePutawayTasks(grnId);

            // Navigate to putaway
            this.router.navigate(['/operations/receiving/putaway']);
        } catch (error) {
            console.error('Error completing receipt:', error);
            alert('Error creating GRN. Please try again.');
        } finally {
            this.processing.set(false);
        }
    }

    // Cancel and go back
    cancel() {
        this.router.navigate(['/operations/receiving']);
    }

    // Get expected quantity for product
    getExpectedQuantity(productId: string): number {
        const asnData = this.asn();
        if (!asnData) return 0;
        const item = asnData.items.find(i => i.productId === productId);
        return item?.expectedQuantity || 0;
    }
}
