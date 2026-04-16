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

    /**
     * HISTORIC SYNC: Download all orders for a specific year.
     * Fetches month-by-month to avoid pagination limits (max 1000 offset usually).
     */
    async syncHistoricOrders(year: number, sellerId: number): Promise<{ imported: number, errors: number }> {
        const result = { imported: 0, errors: 0 };
        const config = await this.secrets.getConfig();
        const token = config?.meli?.accessToken;

        if (!token) throw new Error('No access token');

        // Iterate Month by Month
        for (let month = 0; month < 12; month++) {
            const startDate = new Date(year, month, 1);
            const endDate = new Date(year, month + 1, 0, 23, 59, 59); // Last day of month

            // ISO Strings
            const from = startDate.toISOString().split('.')[0] + '-00:00';
            const to = endDate.toISOString().split('.')[0] + '-00:00';

            // Fetch page by page for this month
            let offset = 0;
            const limit = 50;
            let hasMore = true;

            while (hasMore) {
                try {
                    // query: date_created
                    const url = `${this.API_URL}/orders/search?seller=${sellerId}&order.date_created.from=${from}&order.date_created.to=${to}&access_token=${token}&limit=${limit}&offset=${offset}&sort=date_asc`;

                    // Using 'any' for the response to bypass strict typing for now
                    const response: any = await firstValueFrom(this.http.get(url));
                    const meliOrders = response.results || [];

                    if (meliOrders.length > 0) {
                        await this.processBatch(meliOrders);
                        result.imported += meliOrders.length;
                        offset += limit;
                    } else {
                        hasMore = false;
                    }

                    // Safety break for massive months or loop errors
                    if (offset > 2000) hasMore = false;

                } catch (err) {
                    console.error(`Error fetching ${from} to ${to}`, err);
                    result.errors++;
                    hasMore = false; // Skip to next month on critical error
                }
            }
        }

        return result;
    }

    private async processBatch(meliOrders: any[]): Promise<void> {
        const batch = writeBatch(this.firestore);
        let opCount = 0;

        for (const mOrder of meliOrders) {
            const orderId = `ord_meli_${mOrder.id}`;
            const ref = doc(this.firestore, `orders/${orderId}`);

            // Always merge to update/prevent duplicates
            // We map customer first
            const customerData = this.mapCustomer(mOrder.buyer, mOrder.shipping);
            const custRef = doc(this.firestore, `customers/cust_meli_${mOrder.buyer.id}`);
            batch.set(custRef, customerData, { merge: true });

            // Then map order
            const localOrder = this.mapOrder(mOrder, orderId, `cust_meli_${mOrder.buyer.id}`);

            // Add Historic Flag if older than 30 days (optional, but good for filtering)
            const created = new Date(mOrder.date_created);
            const age = (Date.now() - created.getTime()) / (1000 * 60 * 60 * 24);
            if (age > 30) {
                localOrder['is_historic'] = true;
            }

            batch.set(ref, localOrder, { merge: true });
            opCount++;
        }

        if (opCount > 0) {
            await batch.commit();
        }
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
            productId:   i.item.id,
            productName: i.item.title,
            quantity:    i.quantity,
            price:       i.unit_price,
            subtotal:    i.unit_price * i.quantity,
            listingTypeId: i.item.listing_type_id ?? null, // per-item listing type from MeLi API
        }));

        // Derive listing tier from the first item's listing_type_id.
        // MeLi returns listing_type_id on order_items[].item when the full order detail is fetched.
        const firstListingTypeId: string = mOrder.order_items?.[0]?.item?.listing_type_id ?? '';
        const meliListingType = this.resolveListingType(firstListingTypeId);

        // Derive ship mode: 'fulfillment' = Meli Full, 'me2' = Flex / Classic merchant ship
        const logisticType: string = mOrder.shipping?.logistic_type ?? '';
        const meliShipMode = this.resolveShipMode(logisticType);

        // fulfillmentType: 'platform' when MeLi handles packing/shipping (Meli Full)
        const fulfillmentType = meliShipMode === 'fulfillment' ? 'platform' : 'merchant';

        return {
            id,
            orderNumber:     `MELI-${mOrder.id}`,
            customer:        { id: custId, name: `${mOrder.buyer.first_name} ${mOrder.buyer.last_name}` },
            status:          this.mapStatus(mOrder),
            sourceChannel:   'mercadolibre',
            fulfillmentType,
            meliListingType,
            meliShipMode,
            items,
            total:           mOrder.total_amount,
            createdAt:       Timestamp.fromDate(new Date(mOrder.date_created)),
            updatedAt:       Timestamp.now(),
            paymentStatus:   'paid',
            externalId:      String(mOrder.id),
            metadata: {
                shipping_cost:   mOrder.shipping?.cost || 0,
                original_status: mOrder.status,
                shipping_status: mOrder.shipping?.status,
                logistic_type:   logisticType,
                listing_type_id: firstListingTypeId,
            },
        };
    }

    /**
     * Normalize MeLi's listing_type_id into our three-tier model.
     *
     * MeLi MX listing type IDs (as of 2025):
     *   Premium  → gold_special, gold_pro
     *   Classic  → gold_premium, gold_extra (confusingly named but this is the "Classic" tier)
     *   Free     → free
     *
     * Fallback: anything unknown → 'classic' (safe default, avoids null breakage).
     */
    private resolveListingType(id: string): 'premium' | 'classic' | 'free' {
        const lower = (id ?? '').toLowerCase();
        if (!lower)                                               return 'classic';
        if (lower === 'free')                                     return 'free';
        if (lower === 'gold_special' || lower === 'gold_pro')     return 'premium';
        // gold_premium and gold_extra are MeLi's "Classic" tier despite the name
        return 'classic';
    }

    /**
     * Map MeLi's logistic_type to our simplified ship mode.
     *   'fulfillment'   → Meli Full (they warehouse + ship)
     *   'me2'           → Flex / Classic (we ship, they provide label)
     *   'not_specified' → fallback
     */
    private resolveShipMode(logisticType: string): 'me2' | 'fulfillment' | 'not_specified' {
        const lower = (logisticType ?? '').toLowerCase();
        if (lower === 'fulfillment') return 'fulfillment';
        if (lower === 'me2' || lower === 'me1') return 'me2';
        return 'not_specified';
    }

    private mapStatus(mOrder: any): 'pending' | 'processing' | 'shipped' | 'completed' | 'cancelled' {
        if (mOrder.status === 'cancelled') return 'cancelled';
        if (mOrder.shipping?.status === 'delivered') return 'completed';
        if (mOrder.shipping?.status === 'shipped') return 'shipped';
        return 'processing';
    }
}
