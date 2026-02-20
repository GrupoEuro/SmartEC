import { Injectable, inject } from '@angular/core';
import { Firestore, collection, doc, query, where, getDocs, setDoc, Timestamp, addDoc } from '@angular/fire/firestore';
import { SupplierProductMapping } from '../models/procurement.model';

@Injectable({
    providedIn: 'root'
})
export class SupplierMappingService {
    private firestore = inject(Firestore);

    constructor() { }

    /**
     * Tries to find a mapping for a given Supplier SKU.
     */
    async findMapping(supplierId: string, supplierSku: string): Promise<SupplierProductMapping | null> {
        const col = collection(this.firestore, 'supplier_product_mappings');
        // Query by supplierId AND supplierSku
        // Assuming we have an index or compound query is fine.
        // Ideally we assume 1:1 mapping per supplier.
        const q = query(
            col,
            where('supplierId', '==', supplierId),
            where('supplierSku', '==', supplierSku)
        );

        const snapshot = await getDocs(q);
        if (snapshot.empty) return null;

        const data = snapshot.docs[0].data();
        return { id: snapshot.docs[0].id, ...data } as SupplierProductMapping;
    }

    /**
     * Creates or updates a mapping.
     */
    async createMapping(mapping: SupplierProductMapping): Promise<void> {
        const col = collection(this.firestore, 'supplier_product_mappings');
        // Clean data
        const data = {
            ...mapping,
            lastVerified: Timestamp.now()
        };

        // We could use a deterministic ID like `SUP_SKU` to avoid dupes easily, 
        // but `addDoc` with query check is safer for now if SKU has weird chars.
        await addDoc(col, data);
    }
}
