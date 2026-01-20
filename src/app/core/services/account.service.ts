import { Injectable, inject } from '@angular/core';
import { Firestore, collection, addDoc, doc, setDoc, getDoc, updateDoc, deleteDoc, query, where, getDocs, writeBatch } from '@angular/fire/firestore';
import { AuthService } from './auth.service';
import { Address } from '../models/address.model';
import { OrderSummary } from '../models/order.model';

export { Address }; // Re-export for convenience

@Injectable({ providedIn: 'root' })
export class AccountService {
    private firestore = inject(Firestore);
    private authService = inject(AuthService);

    private userId(): string | null {
        const user = this.authService.currentUser();
        return user ? user.uid : null;
    }

    // ---------- Addresses ----------
    async getAddresses(): Promise<Address[]> {
        const uid = this.userId();
        if (!uid) return [];
        const col = collection(this.firestore, `users/${uid}/addresses`);
        const snapshot = await getDocs(col);
        return snapshot.docs.map(d => ({ id: d.id, ...(d.data() as Address) }));
    }

    async addAddress(address: Address): Promise<void> {
        const uid = this.userId();
        if (!uid) throw new Error('User not logged in');

        const col = collection(this.firestore, `users/${uid}/addresses`);

        // If generic "isDefault" logic needed:
        if (address.isDefault) {
            await this.clearDefaultAddress(uid);
        }

        await addDoc(col, address);
    }

    async updateAddress(id: string, address: Partial<Address>): Promise<void> {
        const uid = this.userId();
        if (!uid) throw new Error('User not logged in');

        if (address.isDefault) {
            await this.clearDefaultAddress(uid);
        }

        const docRef = doc(this.firestore, `users/${uid}/addresses/${id}`);
        await updateDoc(docRef, address);
    }

    async deleteAddress(id: string): Promise<void> {
        const uid = this.userId();
        if (!uid) throw new Error('User not logged in');
        const docRef = doc(this.firestore, `users/${uid}/addresses/${id}`);
        await deleteDoc(docRef);
    }

    private async clearDefaultAddress(uid: string): Promise<void> {
        const col = collection(this.firestore, `users/${uid}/addresses`);
        const q = query(col, where('isDefault', '==', true));
        const snapshot = await getDocs(q);

        if (!snapshot.empty) {
            const batch = writeBatch(this.firestore);
            snapshot.docs.forEach(d => {
                batch.update(d.ref, { isDefault: false });
            });
            await batch.commit();
        }
    }

    // ---------- Orders ----------
    // ---------- Orders ----------
    async getOrders(): Promise<OrderSummary[]> {
        const uid = this.userId();
        if (!uid) return [];
        // TODO: Ensure index exists for date sorting if needed
        const col = collection(this.firestore, `users/${uid}/orders`);
        const snapshot = await getDocs(col);
        return snapshot.docs.map(d => {
            const data = d.data() as OrderSummary;
            return { ...data, id: d.id };
        });
    }

    // ---------- Profile ----------
    async getProfile(): Promise<any> {
        const uid = this.userId();
        if (!uid) return null;
        const docRef = doc(this.firestore, `users/${uid}/profile`);
        const snap = await getDoc(docRef);
        return snap.exists() ? snap.data() : null;
    }

    async updateProfile(data: any): Promise<void> {
        const uid = this.userId();
        if (!uid) throw new Error('User not logged in');
        const docRef = doc(this.firestore, `users/${uid}/profile`);
        await setDoc(docRef, data, { merge: true });
    }
}
