import { Component, inject, signal, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { Firestore, doc, docData, setDoc, addDoc, collection, Timestamp, query, where, getDocs } from '@angular/fire/firestore';
import { CfdiParserService, CfdiData, CfdiItem } from '../../../../core/services/cfdi-parser.service';
import { PurchaseOrder, PurchaseOrderItem, PurchaseOrderStatus } from '../../../../core/models/procurement.model';
import { AppIconComponent } from '../../../../shared/components/app-icon/app-icon.component';
import { FormsModule } from '@angular/forms';
import { Auth } from '@angular/fire/auth';
import { SupplierMappingService } from '../../../../core/services/supplier-mapping.service';
import { ProductService } from '../../../../core/services/product.service';
import { Product } from '../../../../core/models/product.model';
import { ToastService } from '../../../../core/services/toast.service';
import { ConfirmDialogService } from '../../../../core/services/confirm-dialog.service';

import { TranslateModule } from '@ngx-translate/core';
import { AdminPageHeaderComponent } from '../../../../pages/admin/shared/admin-page-header/admin-page-header.component';

import { FileImportService } from '../../../../core/services/file-import.service';

import { InventoryLedgerService } from '../../../../core/services/inventory-ledger.service';
import { ReceivingService } from '../../../../core/services/receiving.service';
// import { DragDropModule } from '@angular/cdk/drag-drop';


@Component({
    selector: 'app-purchase-order-detail',
    standalone: true,
    imports: [CommonModule, RouterModule, FormsModule, AdminPageHeaderComponent, AppIconComponent, TranslateModule],
    templateUrl: './purchase-order-detail.component.html',
    styleUrls: ['./purchase-order-detail.component.css']
})
export class PurchaseOrderDetailComponent {
    private route = inject(ActivatedRoute);
    private router = inject(Router);
    private firestore = inject(Firestore);
    private auth = inject(Auth); // Assuming Auth is the correct service, not AuthService as it's not imported
    private cfdiParser = inject(CfdiParserService);
    private fileImportService = inject(FileImportService);
    private mappingService = inject(SupplierMappingService);
    private productService = inject(ProductService);
    private inventoryService = inject(InventoryLedgerService);
    private receivingService = inject(ReceivingService);
    private toast = inject(ToastService);
    private confirmDialog = inject(ConfirmDialogService);

    poId = signal<string>('new');
    po = signal<PurchaseOrder | null>(null);

    isDragging = signal(false);
    isProcessing = signal(false);
    errorMessage = signal<string>('');

    // Inline Editor State
    focusedRowIndex = signal<number | null>(null);
    inlineSearchTerm = signal('');
    inlineResults = signal<Product[]>([]);
    inlineSelectedIndex = signal(0); // For navigating the dropdown
    isCreatingStub = signal(false);
    allProducts: Product[] = [];

    constructor() {
        this.route.params.subscribe(params => {
            this.poId.set(params['id']);
            if (params['id'] !== 'new') {
                this.loadPO(params['id']);
            } else {
                this.initializeNewPO();
            }
        });

        this.productService.getProducts().subscribe(products => {
            this.allProducts = products;
        });
    }

    async generateHash(content: string): Promise<string> {
        const msgBuffer = new TextEncoder().encode(content);
        const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }

    initializeNewPO() {
        this.po.set({
            poNumber: `PO-${new Date().getFullYear()}-${Math.floor(Math.random() * 10000)}`,
            supplierId: '',
            supplierName: '',
            status: 'DRAFT',
            createdAt: new Date(),
            updatedAt: new Date(),
            currency: 'MXN',
            exchangeRate: 1,
            subtotal: 0,
            taxTotal: 0,
            grandTotal: 0,
            items: [],
            invoices: [],
            createdByUserId: this.auth.currentUser?.uid || 'SYSTEM'
        });
    }

    loadPO(id: string) {
        const docRef = doc(this.firestore, `purchase_orders/${id}`);
        docData(docRef, { idField: 'id' }).subscribe(data => {
            this.po.set(data as PurchaseOrder);
        });
    }

    onDragOver(e: DragEvent) {
        e.preventDefault();
        this.isDragging.set(true);
    }

    onDragLeave(e: DragEvent) {
        e.preventDefault();
        this.isDragging.set(false);
    }

    async onDrop(e: DragEvent) {
        e.preventDefault();
        this.isDragging.set(false);
        this.errorMessage.set('');

        const files = e.dataTransfer?.files;
        if (!files || files.length === 0) return;

        const file = files[0];
        const isXml = file.name.endsWith('.xml') || file.type === 'text/xml';
        const isExcel = file.name.endsWith('.xlsx') || file.name.endsWith('.xls') || file.name.endsWith('.csv');

        if (!isXml && !isExcel) {
            this.errorMessage.set('Only XML, Excel, or CSV files are supported.');
            return;
        }

        this.isProcessing.set(true);
        try {
            if (isXml) {
                const text = await file.text();
                const data = this.cfdiParser.parse(text);
                await this.populateFromCfdi(data);
            } else {
                // Excel/CSV Import
                const items = await this.fileImportService.parseFile(file);

                // Create a content signature for duplicate check
                const contentStr = file.name + JSON.stringify(items);
                const hash = await this.generateHash(contentStr);

                await this.populateFromImport(items, file.name, hash);
            }
        } catch (err: any) {
            this.errorMessage.set('Failed to process file: ' + err.message);
        } finally {
            this.isProcessing.set(false);
        }
    }

    async populateFromImport(items: any[], fileName: string, fileHash: string) {
        const current = this.po();
        if (!current) return;

        // 0. Duplicate Check
        const duplicatesQuery = query(
            collection(this.firestore, 'purchase_orders'),
            where('fileHash', '==', fileHash)
        );
        const duplicatesSnapshot = await getDocs(duplicatesQuery);

        if (!duplicatesSnapshot.empty) {
            const existingPo = duplicatesSnapshot.docs[0].data() as PurchaseOrder;
            this.errorMessage.set(`Duplicate File! This file is already imported in PO: ${existingPo.poNumber}`);
            this.isProcessing.set(false);
            return;
        }

        const newItems: PurchaseOrderItem[] = [];

        for (const item of items) {
            // 1. Try to find mapping (using description or sku if available)
            // For Excel import, we might default to SKU if present
            const supplierSku = item.sku || item.description;
            const mapping = await this.mappingService.findMapping(current.supplierId || 'UNKNOWN', supplierSku);

            let linkedProductId = '';
            let linkedProductName = item.description;
            // let autoLinked = false; // Add back when verified

            if (mapping) {
                linkedProductId = mapping.internalProductId;
                const p = this.allProducts.find(p => p.id === linkedProductId);
                if (p) linkedProductName = p.name.es;
            } else {
                // Try fuzzy match or exact SKU match
                const exactMatch = this.allProducts.find(p => p.sku === item.sku);
                if (exactMatch) {
                    linkedProductId = exactMatch.id!;
                    linkedProductName = exactMatch.name.es;
                }
            }

            newItems.push({
                productId: linkedProductId,
                sku: item.sku,
                productName: linkedProductName,
                quantityOrdered: item.quantity,
                quantityReceived: 0,
                unitCost: item.unitPrice,
                totalCost: item.total,
                autoLinked: !!linkedProductId // Simple check
            });
        }

        const total = newItems.reduce((sum, i) => sum + i.totalCost, 0);

        this.po.set({
            ...current,
            items: [...current.items, ...newItems],
            subtotal: (current.subtotal || 0) + total,
            grandTotal: (current.grandTotal || 0) + total,
            fileHash: fileHash, // Save the hash
            notes: (current.notes || '') + `\nImported from ${fileName}`
        });
    }


    async populateFromCfdi(data: CfdiData) {
        // 0. Duplicate Check
        const duplicatesQuery = query(
            collection(this.firestore, 'purchase_orders'),
            where('relatedUuids', 'array-contains', data.uuid)
        );
        const duplicatesSnapshot = await getDocs(duplicatesQuery);

        if (!duplicatesSnapshot.empty) {
            const existingPo = duplicatesSnapshot.docs[0].data() as PurchaseOrder;
            this.errorMessage.set(`Duplicate Invoice! This UUID (${data.uuid}) is already linked to PO: ${existingPo.poNumber}`);
            this.isProcessing.set(false);
            return;
        }

        const current = this.po();
        if (!current) return;

        const newItems: PurchaseOrderItem[] = [];

        for (const item of data.items) {
            // 1. Try to find mapping
            const mapping = await this.mappingService.findMapping(data.supplierRfc, item.sku);

            // 2. Try to find EXACT SKU match if no mapping (Auto-Link fallback)
            let linkedProductId = '';
            let linkedProductName = item.description;
            let autoLinked = false;

            if (mapping) {
                linkedProductId = mapping.internalProductId;
                const p = this.allProducts.find(p => p.id === linkedProductId);
                if (p) {
                    linkedProductName = p.name.es;
                    autoLinked = true;
                }
            } else {
                const exactMatch = this.allProducts.find(p => p.sku === item.sku);
                if (exactMatch) {
                    linkedProductId = exactMatch.id!;
                    linkedProductName = exactMatch.name.es;
                    // We don't mark exact SKU match as 'autoLinked' in the sense of mapping, 
                    // but it IS a link. Let's mark it so UI shows it's good.
                    autoLinked = true;
                }
            }

            newItems.push({
                productId: linkedProductId,
                sku: item.sku,
                productName: linkedProductName,
                quantityOrdered: item.quantity,
                quantityReceived: 0,
                unitCost: item.unitPrice,
                totalCost: item.totalAmount,
                autoLinked: autoLinked
            });
        }

        const newState: PurchaseOrder = {
            ...current,
            supplierName: current.supplierName || data.supplierName,
            supplierId: current.supplierId || data.supplierRfc,
            currency: data.currency as any,
            items: [...current.items, ...newItems],
            subtotal: (current.subtotal || 0) + data.subtotal,
            taxTotal: (current.taxTotal || 0) + data.taxTotal,
            grandTotal: (current.grandTotal || 0) + data.total,
            relatedUuids: [...(current.relatedUuids || []), data.uuid],
            invoices: [...current.invoices, {
                uuid: data.uuid,
                invoiceNumber: data.invoiceNumber,
                date: data.date,
                totalAmount: data.total,
                currency: data.currency,
                status: 'VALID'
            }]
        };

        this.po.set(newState);
    }

    removeItem(index: number) {
        const current = this.po();
        if (!current) return;
        const newItems = [...current.items];
        const removed = newItems.splice(index, 1)[0];

        this.po.set({
            ...current,
            items: newItems,
            subtotal: current.subtotal - removed.totalCost,
            grandTotal: current.grandTotal - removed.totalCost
        });
    }

    // --- Picker Modal Logic ---

    // --- Inline Editing Logic ---

    /**
     * Handle Focus on a specific row's input
     */
    onRowFocus(index: number, currentProductId: string | undefined) {
        this.focusedRowIndex.set(index);
        this.inlineSelectedIndex.set(0);

        // If already linked, maybe we want to search for the existing product name or clear it?
        // For now, let's start empty to allow searching.
        this.inlineSearchTerm.set('');
        this.searchProducts('');
    }

    /**
     * Handle Blur (close dropdown after delay to allow click)
     */
    onRowBlur() {
        // Small delay to allow click event to register on dropdown
        setTimeout(() => {
            if (this.focusedRowIndex() !== null) {
                // this.focusedRowIndex.set(null); // Optional: Keep focus logic strictly controlled
            }
        }, 200);
    }

    /**
     * Search products for the inline dropdown
     */
    searchProducts(term: string) {
        this.inlineSearchTerm.set(term);

        if (!term.trim()) {
            this.inlineResults.set([]); // Or top 5 recent?
            return;
        }

        const normalizedTerm = term.toLowerCase().replace(/[^a-z0-9]/g, '');
        // Simple client-side fuzzy search for now (assuming allProducts is loaded)
        // In real app, might want to check if allProducts is populated.

        if (this.allProducts.length === 0) {
            // Lazy load if not already? (Assuming they are loaded in effect)
        }

        const results = this.allProducts.filter(p => {
            const searchStr = (p.sku + p.name.es + p.brand).toLowerCase().replace(/[^a-z0-9]/g, '');
            return searchStr.includes(normalizedTerm);
        }).slice(0, 8); // Limit to 8 results

        this.inlineResults.set(results);
        this.inlineSelectedIndex.set(0);
    }

    /**
     * Handle keystrokes in the inline input
     */
    async onRowKeydown(event: KeyboardEvent, index: number) {
        const results = this.inlineResults();

        if (event.key === 'ArrowDown') {
            event.preventDefault();
            this.inlineSelectedIndex.update(i => Math.min(i + 1, results.length)); // +1 for "Create Stub" option
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            this.inlineSelectedIndex.update(i => Math.max(i - 1, 0));
        } else if (event.key === 'Enter') {
            event.preventDefault();
            this.handleEnterKey(index);
        } else if (event.key === 'Tab') {
            // Allow default tab behavior to move to next input? 
            // Or handle manually to ensure focusedRowIndex updates?
            // Let's manually handle to control the flow
            event.preventDefault();
            this.focusNextRow(index);
        } else if (event.key === 'Escape') {
            this.focusedRowIndex.set(null);
        }
    }

    async handleEnterKey(index: number) {
        const results = this.inlineResults();
        const selectedIdx = this.inlineSelectedIndex();

        // Case A: Select from Dropdown
        if (selectedIdx < results.length) {
            this.selectProduct(results[selectedIdx], index);
        }
        // Case B: Create Stub (Last Option)
        else {
            await this.inlineCreateStub(index);
        }
    }

    async inlineCreateStub(index: number) {
        const item = this.po()!.items[index];
        if (!item) return;

        this.isCreatingStub.set(true);
        try {
            const newId = await this.productService.createStub(
                item.sku || 'NEW-' + Date.now(),
                item.originalDescription || 'New Product',
                item.unitCost,
                this.po()!.supplierId
            );

            // Create local object for immediate UI feedback
            const stub: Product = {
                id: newId,
                type: 'simple',
                name: { es: item.originalDescription || 'New Product', en: '' },
                sku: item.sku || 'NEW',
                price: item.unitCost * 1.5,
                costPrice: item.unitCost,
                inStock: true,
                stockQuantity: 0,
                active: true,
                description: { es: '', en: '' },
                slug: '',
                brand: 'GENERIC',
                categoryId: 'uncategorized',
                images: { main: '', gallery: [] },
                specifications: {} as any,
                features: { es: [], en: [] },
                applications: [],
                tags: [],
                featured: false,
                newArrival: false,
                bestSeller: false,
                publishStatus: 'draft',
                visibility: 'private',
                supplierId: this.po()!.supplierId,
                createdAt: new Date(),
                updatedAt: new Date()
            };

            this.selectProduct(stub, index);

        } catch (e) {
            this.toast.error('Error creating stub');
        } finally {
            this.isCreatingStub.set(false);
        }
    }

    async selectProduct(product: Product, index: number) {
        const currentPo = this.po();
        if (!currentPo) return;

        const items = [...currentPo.items];
        const item = items[index];

        // 1. Create Mapping (Learn from this action)
        if (currentPo.supplierId && item.sku) {
            try {
                await this.mappingService.createMapping({
                    supplierId: currentPo.supplierId,
                    supplierSku: item.sku,
                    internalProductId: product.id!,
                    internalSku: product.sku,
                    lastVerified: Timestamp.now()
                });
            } catch (err) {
                this.toast.error("Failed to create mapping");
            }
        }

        // 2. Update Item locally
        items[index] = {
            ...item,
            productId: product.id!,
            productName: product.name.es,
            autoLinked: true // Mark as manually/auto linked
        };

        this.po.set({ ...currentPo, items });

        // Move to next
        this.focusNextRow(index);

        // Clear search
        this.inlineSearchTerm.set('');
        this.inlineResults.set([]);
    }

    focusNextRow(currentIndex: number) {
        const items = this.po()?.items || [];
        if (currentIndex < items.length - 1) {
            this.focusedRowIndex.set(currentIndex + 1);
            // We need to focus the actual DOM element. 
            // We'll use a timeout and ID selector for simplicity in this phase.
            setTimeout(() => {
                const nextInput = document.getElementById(`row-input-${currentIndex + 1}`);
                if (nextInput) (nextInput as HTMLElement).focus();
            }, 50);
        } else {
            this.focusedRowIndex.set(null); // Finished
        }
    }




    async receiveOrder() {
        const po = this.po();
        if (!po) return;

        if (po.status === 'RECEIVED') {
            this.toast.warning('This order is already received.');
            return;
        }

        const confirmed = await this.confirmDialog.confirm({
            title: 'Receive Order?',
            message: 'This will create an Advance Shipping Notice (ASN), Goods Receipt Note (GRN), and update inventory. Continue?'
        });

        if (!confirmed) return;

        this.isProcessing.set(true);

        try {
            // === STEP 1: Generate ASN (Advance Shipping Notice) ===
            const asnNumber = await this.receivingService.generateASNNumber();
            const asnId = await this.receivingService.createASN({
                asnNumber,
                purchaseOrderRef: po.id || this.poId(),
                supplierName: po.supplierName,
                supplierId: po.supplierId,
                warehouseId: 'MAIN',
                expectedDate: Timestamp.now(),
                status: 'received', // Already physically arrived
                items: po.items.filter(item => item.productId).map(item => ({
                    productId: item.productId,
                    productSku: item.sku,
                    productName: item.productName,
                    expectedQuantity: item.quantityOrdered,
                    receivedQuantity: item.quantityOrdered, // Assume full receipt
                    uom: 'ea'
                })),
                notes: `Auto-generated from PO: ${po.poNumber}`,
                createdBy: this.auth.currentUser?.uid || 'SYSTEM'
            });

            // === STEP 2: Generate GRN (Goods Receipt Note) ===
            const grnNumber = await this.receivingService.generateGRNNumber();
            const grnId = await this.receivingService.createGRN({
                grnNumber,
                asnId,
                warehouseId: 'MAIN',
                receivedDate: Timestamp.now(),
                receivedBy: this.auth.currentUser?.uid || 'SYSTEM',
                status: 'completed',
                items: po.items.filter(item => item.productId).map(item => ({
                    productId: item.productId,
                    productSku: item.sku,
                    productName: item.productName,
                    quantityReceived: item.quantityOrdered,
                    quantityAccepted: item.quantityOrdered, // Assume all accepted
                    quantityRejected: 0,
                    qualityStatus: 'passed'
                })),
                notes: `Generated from PO: ${po.poNumber}`
            });

            // === STEP 3: Generate Putaway Tasks ===
            await this.receivingService.generatePutawayTasks(grnId);

            // === STEP 4: Update Inventory (Original Logic) ===
            let processedCount = 0;
            for (const item of po.items) {
                if (item.productId) {
                    await this.inventoryService.logTransaction(
                        item.productId,
                        'PURCHASE',
                        item.quantityOrdered,
                        item.unitCost,
                        po.id || this.poId(),
                        'PURCHASE_ORDER',
                        `PO Receive: ${po.poNumber} | GRN: ${grnNumber}`,
                        'MAIN'
                    );
                    processedCount++;
                }
            }

            if (processedCount === 0) {
                throw new Error('No linked items to receive. Please link products first.');
            }

            // === STEP 5: Update PO with ASN/GRN References ===
            const updatedPO: PurchaseOrder = {
                ...po,
                status: 'RECEIVED',
                actualArrivalDate: new Date(),
                receivedByUserId: this.auth.currentUser?.uid || 'SYSTEM',
                updatedAt: new Date(),
                asnId, // Link to ASN
                grnId  // Link to GRN
            };

            this.po.set(updatedPO);
            await this.savePO();

            this.toast.success(`✅ Received ${processedCount} items! ASN: ${asnNumber}, GRN: ${grnNumber}`);

            // Navigate to putaway tasks
            this.router.navigate(['/operations/receiving/putaway']);

        } catch (e: any) {
            this.toast.error('Error receiving order: ' + e.message);
        } finally {
            this.isProcessing.set(false);
        }
    }

    async savePO() {
        const data = this.po();
        if (!data) return;

        try {
            if (this.poId() === 'new') {
                const col = collection(this.firestore, 'purchase_orders');
                await addDoc(col, data);
            } else {
                const docRef = doc(this.firestore, `purchase_orders/${this.poId()}`);
                await setDoc(docRef, data, { merge: true });
            }
            this.toast.success('Saved!');
        } catch (e: any) {
            this.toast.error('Error: ' + e.message);
        }
    }

    getDate(val: any): Date {
        if (!val) return new Date();
        return (val as any).toDate ? (val as any).toDate() : val;
    }
}
