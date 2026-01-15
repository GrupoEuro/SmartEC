import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Firestore, collection, doc, writeBatch, Timestamp, getDoc, setDoc } from '@angular/fire/firestore';
import { SecretsService } from './config/secrets.service';
import { MeliSyncService } from './meli-sync.service';
import { firstValueFrom } from 'rxjs';

@Injectable({
    providedIn: 'root'
})
export class MeliOrderService {
    private http = inject(HttpClient);
    private firestore = inject(Firestore);
    private secrets = inject(SecretsService);

    private readonly API_URL = 'https://api.mercadolibre.com';

    /**
     * Import recent orders from MELI
     * @param sellerId 
     */
    async importOrders(sellerId: number): Promise<{ imported: number, errors: number }> {
        const result = { imported: 0, errors: 0 };

        try {
            const config = await this.secrets.getConfig();
            const token = config?.meli?.accessToken;
            if (!token) throw new Error('No access token');

            // 1. Fetch recent orders (last 7 days or status=paid)
            // https://api.mercadolibre.com/orders/search?seller=123&order.status=paid
            const url = `${this.API_URL}/orders/search?seller=${sellerId}&order.status=paid&access_token=${token}&sort=date_desc`;

            const response: any = await firstValueFrom(this.http.get(url));
            const meliOrders = response.results || [];

            if (meliOrders.length === 0) return result;

            const batch = writeBatch(this.firestore);
            let opCount = 0;

            for (const mOrder of meliOrders) {
                // Check if already exists
                const orderId = `ord_meli_${mOrder.id}`;
                const ref = doc(this.firestore, `orders/${orderId}`);
                const exists = (await getDoc(ref)).exists();

                if (exists) continue; // Skip if imported

                // 2. Map Customer
                const customerData = this.mapCustomer(mOrder.buyer, mOrder.shipping);
                const custRef = doc(this.firestore, `customers/cust_meli_${mOrder.buyer.id}`);
                batch.set(custRef, customerData, { merge: true });
                opCount++;

                // 3. Map Order
                const localOrder = this.mapOrder(mOrder, orderId, `cust_meli_${mOrder.buyer.id}`);
                batch.set(ref, localOrder);
                opCount++;

                result.imported++;
            }

            if (opCount > 0) await batch.commit();

        } catch (error) {
            console.error('Import failed', error);
            result.errors = 1;
        }

        return result;
    }


    private mapCustomer(buyer: any, shipping: any): any {
        return {
            uid: `cust_meli_${buyer.id}`,
            displayName: `${buyer.first_name} ${buyer.last_name}`,
            email: buyer.email || 'meli-proxy@example.com', // Often masked
            phone: buyer.phone?.number || '',
            role: 'CUSTOMER',
            acquisitionChannel: 'MERCADOLIBRE',
            createdAt: Timestamp.now(),
            // Assuming we parse address from shipping if available or mock
            address: {
                city: 'Unknown', // Need specific shipping details endpoint usually
                country: 'Mexico'
            }
        };
    }

    private mapOrder(mOrder: any, id: string, custId: string): any {
        const items = mOrder.order_items.map((i: any) => ({
            productId: i.item.id, // Mapped to MELI ID initially. Should resolve to Local ID via MeliSyncService map.
            productName: i.item.title,
            quantity: i.quantity,
            price: i.unit_price,
            subtotal: i.unit_price * i.quantity
        }));

        return {
            id: id,
            orderNumber: `MELI-${mOrder.id}`,
            customer: { id: custId, name: `${mOrder.buyer.first_name} ${mOrder.buyer.last_name}` },
            status: 'processing', // Default for paid
            channel: 'MELI_CLASSIC',
            items: items,
            total: mOrder.total_amount,
            createdAt: Timestamp.fromDate(new Date(mOrder.date_created)),
            updatedAt: Timestamp.now(),
            paymentStatus: 'paid',
            externalId: String(mOrder.id)
        };
    }
}
