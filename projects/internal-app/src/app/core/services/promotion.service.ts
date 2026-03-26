import { Injectable, inject } from '@angular/core';
import {
    Firestore, collection, collectionData, doc,
    addDoc, updateDoc, deleteDoc, query, orderBy,
    Timestamp, where, increment, getDoc
} from '@angular/fire/firestore';
import { Observable, map, from } from 'rxjs';
import { Promotion } from '../models/promotion.model';

@Injectable({ providedIn: 'root' })
export class PromotionService {
    private firestore  = inject(Firestore);
    private col        = collection(this.firestore, 'promotions');

    getPromotions(): Observable<Promotion[]> {
        const q = query(this.col, orderBy('priority', 'desc'));
        return collectionData(q, { idField: 'id' }).pipe(
            map((d: any[]) => d.map(p => this.convert(p)))
        );
    }

    getActivePromotions(): Observable<Promotion[]> {
        const q = query(this.col, where('status', '==', 'active'), orderBy('priority', 'desc'));
        return collectionData(q, { idField: 'id' }).pipe(
            map((d: any[]) => d.map(p => this.convert(p)))
        );
    }

    getById(id: string): Observable<Promotion | undefined> {
        const ref = doc(this.firestore, `promotions/${id}`);
        return from(getDoc(ref)).pipe(
            map(snap => snap.exists() ? this.convert({ id: snap.id, ...snap.data() }) : undefined)
        );
    }

    create(data: Partial<Promotion>): Promise<any> {
        return addDoc(this.col, {
            ...data,
            totalShown:   0,
            totalClicked: 0,
            createdAt: Timestamp.now(),
            updatedAt: Timestamp.now(),
        });
    }

    update(id: string, data: Partial<Promotion>): Promise<void> {
        return updateDoc(doc(this.firestore, `promotions/${id}`), {
            ...data,
            updatedAt: Timestamp.now(),
        });
    }

    delete(id: string): Promise<void> {
        return deleteDoc(doc(this.firestore, `promotions/${id}`));
    }

    recordShown(id: string): Promise<void> {
        return updateDoc(doc(this.firestore, `promotions/${id}`), { totalShown: increment(1) });
    }

    recordClicked(id: string): Promise<void> {
        return updateDoc(doc(this.firestore, `promotions/${id}`), { totalClicked: increment(1) });
    }

    private convert(p: any): Promotion {
        const toDate = (v: any) => (v instanceof Timestamp ? v.toDate() : v ? new Date(v) : null);
        return {
            ...p,
            startDate: toDate(p.startDate),
            endDate:   toDate(p.endDate),
            createdAt: toDate(p.createdAt),
            updatedAt: toDate(p.updatedAt),
        };
    }
}
