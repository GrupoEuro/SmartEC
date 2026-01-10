import { Injectable, inject } from '@angular/core';
import { Firestore, collection, query, where, getDocs, limit } from '@angular/fire/firestore';
import { NotificationService } from './notification.service';
import { Product } from '../models/product.model';
import { Order } from '../models/order.model';

@Injectable({
    providedIn: 'root'
})
export class AlertTriggerService {
    private firestore = inject(Firestore);
    private notificationService = inject(NotificationService);

    /**
     * Run all system checks. 
     * Best called on Command Center initialization.
     */
    async runChecks() {
        await this.checkLowStock();
        await this.checkHighValueOrders();
    }

    private async checkLowStock() {
        // 1. Find products with low stock (< 5)
        // Note: This requires a composite index if combining with other filters, 
        // but simple inequality on one field is fine.
        const productsRef = collection(this.firestore, 'products');
        const q = query(productsRef, where('stockQuantity', '<', 5), where('active', '==', true));

        const snapshot = await getDocs(q);
        const lowStockProducts = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Product));

        for (const product of lowStockProducts) {
            const exists = await this.checkForDuplicate('low_stock', product.id!);
            if (!exists) {
                await this.notificationService.createNotification({
                    type: 'warning',
                    title: 'Low Stock Alert',
                    message: `Product "${product.name.en}" is running low (${product.stockQuantity} units remaining).`,
                    link: `/admin/products/${product.id}/edit`,
                    metadata: { type: 'low_stock', relatedId: product.id }
                });
            }
        }
    }

    private async checkHighValueOrders() {
        // 1. Find recent high value orders (> $10,000)
        const ordersRef = collection(this.firestore, 'orders');
        const q = query(
            ordersRef,
            where('total', '>', 10000),
            where('status', 'in', ['pending', 'processing']),
            limit(10) // Check last 10 to avoid checking entire history
        );

        const snapshot = await getDocs(q);
        const highValueOrders = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Order));

        for (const order of highValueOrders) {
            const exists = await this.checkForDuplicate('high_value_order', order.id!);
            if (!exists) {
                await this.notificationService.createNotification({
                    type: 'info',
                    title: 'High Value Order',
                    message: `New high value order #${order.orderNumber} received ($${order.total}).`,
                    link: `/admin/orders/${order.id}`,
                    metadata: { type: 'high_value_order', relatedId: order.id }
                });
            }
        }
    }

    /**
     * Check if an active (unread) notification already exists for this entity
     */
    private async checkForDuplicate(type: string, relatedId: string): Promise<boolean> {
        const notifRef = collection(this.firestore, 'notifications');
        const q = query(
            notifRef,
            where('read', '==', false),
            where('metadata.type', '==', type),
            where('metadata.relatedId', '==', relatedId)
        );
        const snapshot = await getDocs(q);
        return !snapshot.empty;
    }
}
