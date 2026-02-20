import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Firestore, collection, doc, writeBatch, getDocs, query, where } from '@angular/fire/firestore';
import { SecretsService } from './config/secrets.service';
import { MeliTokens } from './meli.service';
import { MeliItem, MeliSyncResult } from '../models/meli-item.model';
import { ProductService } from './product.service';
import { firstValueFrom } from 'rxjs';

@Injectable({
    providedIn: 'root'
})
export class MeliSyncService {
    private http = inject(HttpClient);
    private firestore = inject(Firestore);
    private secrets = inject(SecretsService);
    private productService = inject(ProductService);

    private readonly API_URL = 'https://api.mercadolibre.com';

    /**
     * FULL SYNC: Fetches all items from MELI and updates local "Shadow Catalog"
     */
    async syncAccountItems(sellerId: number): Promise<MeliSyncResult> {
        const result: MeliSyncResult = { total: 0, updated: 0, errors: 0, details: [] };

        try {
            const token = await this.getValidToken();
            if (!token) throw new Error('No valid MELI token found.');

            // 1. Get All Item IDs
            // Note: Scroll API is better for large catalogs, but search is simpler for < 1000 items
            const searchUrl = `${this.API_URL}/users/${sellerId}/items/search?search_type=scan&access_token=${token}`;

            // For MVP, simplified paging or assuming < 50 items for demo
            const searchResp: any = await firstValueFrom(this.http.get(searchUrl));
            const itemIds: string[] = searchResp.results || [];
            result.total = itemIds.length;

            if (itemIds.length === 0) {
                result.details.push('No items found on MercadoLibre account.');
                return result;
            }

            // 2. Get Item Details (Chunked by 20, API limit)
            const chunkSize = 20;
            const chunks = [];
            for (let i = 0; i < itemIds.length; i += chunkSize) {
                chunks.push(itemIds.slice(i, i + chunkSize));
            }

            // Fetch Local Products for SKU matching
            const localProducts = await firstValueFrom(this.productService.getProducts());
            const skuMap = new Map<string, string>(); // SKU -> LocalID
            localProducts.forEach(p => {
                if (p.sku) skuMap.set(p.sku.toUpperCase(), p.id!);
            });

            // Process chunks
            for (const chunk of chunks) {
                const idsParam = chunk.join(',');
                const detailsUrl = `${this.API_URL}/items?ids=${idsParam}&access_token=${token}`;

                try {
                    const detailsResp: any[] = await firstValueFrom(this.http.get<any[]>(detailsUrl));

                    // Batch Write to Firestore
                    const batch = writeBatch(this.firestore);

                    detailsResp.forEach(wrapper => {
                        if (wrapper.code === 200) {
                            const item = wrapper.body;
                            const meliItem: MeliItem = this.mapToLocal(item);

                            // AUTO-LINK Logic
                            // Try to find SKU in attributes
                            const skuAttr = item.attributes?.find((a: any) => a.id === 'SELLER_SKU' || a.id === 'GTIN');
                            const rawSku = skuAttr?.value_name || '';

                            if (rawSku && skuMap.has(rawSku.toUpperCase())) {
                                meliItem.localProductId = skuMap.get(rawSku.toUpperCase());
                                meliItem.syncStatus = 'SYNCED';
                            } else {
                                meliItem.syncStatus = 'ORPHAN';
                            }

                            // Write to collection 'meli_items'
                            const ref = doc(this.firestore, `meli_items/${meliItem.id}`);
                            batch.set(ref, meliItem, { merge: true });
                            result.updated++;
                        } else {
                            result.errors++;
                        }
                    });

                    await batch.commit();

                } catch (err) {
                    console.error('Error fetching details chunk', err);
                    result.errors += chunk.length;
                }
            }

        } catch (error: any) {
            console.error('Sync failed', error);
            result.details.push(error.message);
        }

        return result;
    }

    private mapToLocal(apiItem: any): MeliItem {
        return {
            id: apiItem.id,
            site_id: apiItem.site_id,
            title: apiItem.title,
            price: apiItem.price,
            currency_id: apiItem.currency_id,
            available_quantity: apiItem.available_quantity,
            sold_quantity: apiItem.sold_quantity,
            buying_mode: apiItem.buying_mode,
            listing_type_id: apiItem.listing_type_id,
            condition: apiItem.condition,
            permalink: apiItem.permalink,
            thumbnail: apiItem.thumbnail,
            pictures: apiItem.pictures?.map((p: any) => ({ id: p.id, url: p.url })) || [],
            status: apiItem.status,
            lastSync: new Date()
        };
    }

    private async getValidToken(): Promise<string | null> {
        const config = await this.secrets.getConfig();
        // Simple check. In prod, check expiration and refresh if needed using refresh_token
        return config?.meli?.accessToken || null;
    }
}
