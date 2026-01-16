
import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Firestore, collection, query, where, getDocs, doc, updateDoc, orderBy, limit } from '@angular/fire/firestore';
import { ProductService } from '../../../../../core/services/product.service';
import { Product } from '../../../../../core/models/catalog.model';
import { MeliItem } from '../../../../../core/models/meli-item.model';
import { AppIconComponent } from '../../../../../shared/components/app-icon/app-icon.component';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';

@Component({
    selector: 'app-product-link',
    standalone: true,
    imports: [CommonModule, FormsModule, AppIconComponent],
    template: `
    <div class="h-full flex flex-col p-6">
        <div class="flex justify-between items-center mb-6">
            <div>
                <h1 class="text-2xl font-bold text-white flex items-center gap-2">
                    <app-icon name="link" class="text-indigo-400"></app-icon>
                    Product Linking
                </h1>
                <p class="text-slate-400 text-sm">
                    Connect orphan MercadoLibre listings to your local catalog.
                </p>
            </div>
            <button (click)="goBack()" class="bg-slate-800 hover:bg-slate-700 text-slate-300 px-4 py-2 rounded transition">
                Back to Integrations
            </button>
        </div>

        <!-- Filters -->
        <div class="flex gap-4 mb-6">
            <button (click)="filter.set('ORPHAN')" 
                class="px-4 py-2 rounded-lg border text-sm font-bold transition"
                [class.bg-orange-500]="filter() === 'ORPHAN'" [class.border-orange-500]="filter() === 'ORPHAN'" [class.text-white]="filter() === 'ORPHAN'"
                [class.bg-slate-800]="filter() !== 'ORPHAN'" [class.border-slate-700]="filter() !== 'ORPHAN'" [class.text-slate-400]="filter() !== 'ORPHAN'">
                Orphans ({{ counts().orphans }})
            </button>
            <button (click)="filter.set('SYNCED')" 
                class="px-4 py-2 rounded-lg border text-sm font-bold transition"
                [class.bg-green-600]="filter() === 'SYNCED'" [class.border-green-600]="filter() === 'SYNCED'" [class.text-white]="filter() === 'SYNCED'"
                [class.bg-slate-800]="filter() !== 'SYNCED'" [class.border-slate-700]="filter() !== 'SYNCED'" [class.text-slate-400]="filter() !== 'SYNCED'">
                Synced ({{ counts().synced }})
            </button>
        </div>

        <!-- List -->
        <div class="flex-1 overflow-auto bg-slate-900 rounded-xl border border-slate-700">
            <table class="w-full text-left border-collapse">
                <thead class="bg-slate-800 sticky top-0 z-10">
                    <tr>
                        <th class="p-4 text-xs font-bold text-slate-400 uppercase">MELI Item</th>
                        <th class="p-4 text-xs font-bold text-slate-400 uppercase">Price</th>
                        <th class="p-4 text-xs font-bold text-slate-400 uppercase">Status</th>
                        <th class="p-4 text-xs font-bold text-slate-400 uppercase">Local Link</th>
                        <th class="p-4 text-xs font-bold text-slate-400 uppercase text-right">Action</th>
                    </tr>
                </thead>
                <tbody>
                    <tr *ngFor="let item of filteredItems()" class="border-b border-slate-800 hover:bg-slate-800/50 transition">
                        <td class="p-4">
                            <div class="flex items-center gap-3">
                                <img [src]="item.thumbnail" class="w-12 h-12 rounded object-cover bg-white" alt="">
                                <div>
                                    <div class="text-white font-medium text-sm line-clamp-1">{{ item.title }}</div>
                                    <div class="text-xs text-slate-500 font-mono">{{ item.id }}</div>
                                </div>
                            </div>
                        </td>
                        <td class="p-4 text-slate-300 text-sm font-mono">
                            {{ item.price | currency: item.currency_id }}
                        </td>
                        <td class="p-4">
                            <span class="px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wide"
                                [class.bg-orange-500]="item.syncStatus === 'ORPHAN'" [class.text-orange-950]="item.syncStatus === 'ORPHAN'"
                                [class.bg-green-500]="item.syncStatus === 'SYNCED'" [class.text-green-950]="item.syncStatus === 'SYNCED'">
                                {{ item.syncStatus }}
                            </span>
                        </td>
                        <td class="p-4 w-96">
                            <!-- Link Interface -->
                            <div *ngIf="item.syncStatus === 'ORPHAN'; else linkedView" class="relative">
                                <div class="flex gap-2">
                                     <input type="text" placeholder="Search SKU or Name..." 
                                        [(ngModel)]="searchCache[item.id]"
                                        (keyup.enter)="searchProduct(item.id, searchCache[item.id])"
                                        class="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-white placeholder-slate-500 focus:border-indigo-500 outline-none">
                                     <button (click)="searchProduct(item.id, searchCache[item.id])" class="p-1 text-slate-400 hover:text-white">
                                        <app-icon name="search" [size]="16"></app-icon>
                                     </button>
                                </div>
                                
                                <!-- Dropdown Results -->
                                <div *ngIf="searchResults[item.id]" class="absolute top-full left-0 w-full mt-1 bg-slate-800 border border-slate-600 rounded shadow-xl z-20 max-h-48 overflow-y-auto">
                                    <div *ngFor="let p of searchResults[item.id]" (click)="selectProduct(item, p)" 
                                        class="p-2 hover:bg-indigo-600/20 cursor-pointer border-b border-slate-700/50 last:border-0 flex justify-between items-center group">
                                        <div>
                                            <div class="text-xs text-white group-hover:text-indigo-300">{{ p.name }}</div>
                                            <div class="text-[10px] text-slate-500 font-mono">{{ p.sku }}</div>
                                        </div>
                                        <div class="text-xs font-bold text-slate-300">{{ p.price | currency }}</div>
                                    </div>
                                    <div *ngIf="searchResults[item.id].length === 0" class="p-2 text-xs text-slate-500 text-center">No matches found</div>
                                </div>
                            </div>

                            <ng-template #linkedView>
                                <div class="flex items-center gap-2 text-sm text-green-400">
                                    <app-icon name="link" [size]="14"></app-icon>
                                    <span class="font-mono">{{ item.localProductId }}</span>
                                    <button (click)="unlink(item)" class="ml-2 text-slate-600 hover:text-red-400" title="Unlink">
                                        <app-icon name="close" [size]="12"></app-icon>
                                    </button>
                                </div>
                            </ng-template>
                        </td>
                        <td class="p-4 text-right">
                            <a [href]="item.permalink" target="_blank" class="text-indigo-400 hover:text-indigo-300 text-xs flex items-center justify-end gap-1">
                                View
                                <app-icon name="open_in_new" [size]="12"></app-icon>
                            </a>
                        </td>
                    </tr>
                </tbody>
            </table>

            <div *ngIf="loading" class="p-8 text-center text-slate-500">
                <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500 mx-auto mb-2"></div>
                Loading items...
            </div>
        </div>
    </div>
    `
})
export class ProductLinkComponent implements OnInit {
    private firestore = inject(Firestore);
    private productService = inject(ProductService);
    private router = inject(Router);

    items = signal<MeliItem[]>([]);
    filter = signal<'ORPHAN' | 'SYNCED'>('ORPHAN');
    loading = true;

    counts = signal({ orphans: 0, synced: 0 });

    // UI State
    searchCache: Record<string, string> = {};
    searchResults: Record<string, Product[]> = {};

    async ngOnInit() {
        await this.loadItems();
    }

    async loadItems() {
        this.loading = true;
        try {
            // Fetch all for counts (optimize later if huge)
            const q = query(collection(this.firestore, 'meli_items'), orderBy('title'));
            const snap = await getDocs(q);

            const all: MeliItem[] = snap.docs.map(d => d.data() as MeliItem);

            this.counts.set({
                orphans: all.filter(i => i.syncStatus === 'ORPHAN').length,
                synced: all.filter(i => i.syncStatus === 'SYNCED').length
            });

            this.items.set(all);
        } finally {
            this.loading = false;
        }
    }

    filteredItems() {
        return this.items().filter(i => i.syncStatus === this.filter());
    }

    async searchProduct(itemId: string, term: string) {
        if (!term || term.length < 2) return;

        // Use ProductService search
        try {
            const results = await firstValueFrom(this.productService.searchProducts(term));
            this.searchResults = { ...this.searchResults, [itemId]: results };
        } catch (e) {
            console.error(e);
        }
    }

    async selectProduct(meliItem: MeliItem, localProduct: Product) {
        // Optimistic Update
        const oldStatus = meliItem.syncStatus;
        const updatedItem: MeliItem = { ...meliItem, syncStatus: 'SYNCED', localProductId: localProduct.id };

        this.items.update(list => list.map(i => i.id === meliItem.id ? updatedItem : i));
        delete this.searchResults[meliItem.id];

        try {
            const ref = doc(this.firestore, `meli_items/${meliItem.id}`);
            await updateDoc(ref, {
                localProductId: localProduct.id,
                syncStatus: 'SYNCED'
            });
            // Update counts
            const current = this.counts();
            this.counts.set({ orphans: current.orphans - 1, synced: current.synced + 1 });

        } catch (e) {
            console.error('Failed to link', e);
            // Revert
            this.items.update(list => list.map(i => i.id === meliItem.id ? { ...meliItem, syncStatus: oldStatus } : i));
        }
    }

    async unlink(meliItem: MeliItem) {
        if (!confirm('Unlink this product? Stock sync will stop.')) return;

        const updatedItem: MeliItem = { ...meliItem, syncStatus: 'ORPHAN', localProductId: undefined };
        this.items.update(list => list.map(i => i.id === meliItem.id ? updatedItem : i));

        try {
            const ref = doc(this.firestore, `meli_items/${meliItem.id}`);
            await updateDoc(ref, {
                localProductId: null,
                syncStatus: 'ORPHAN'
            });
            // Update counts
            const current = this.counts();
            this.counts.set({ orphans: current.orphans + 1, synced: current.synced - 1 });
        } catch (e) {
            console.error('Failed to unlink', e);
        }
    }

    goBack() {
        this.router.navigate(['/admin/integrations']);
    }

}
