import { Injectable, inject } from '@angular/core';
import { Firestore, collection, getDocs, doc, updateDoc } from '@angular/fire/firestore';
import { Observable, from } from 'rxjs';
import { map } from 'rxjs/operators';
import { DistributorSubmission } from '../models/distributor.model';

@Injectable({
    providedIn: 'root'
})
export class DistributorService {
    private firestore = inject(Firestore);

    getDistributors(): Observable<DistributorSubmission[]> {
        const distributorsCol = collection(this.firestore, 'distributors');

        return from(getDocs(distributorsCol)).pipe(
            map(snapshot => {
                const distributors: DistributorSubmission[] = [];
                snapshot.forEach(docSnap => {
                    const data = docSnap.data();
                    distributors.push({
                        id: docSnap.id,
                        name: data['name'] || '',
                        business: data['business'] || '',
                        email: data['email'] || '',
                        phone: data['phone'] || '',
                        state: data['state'] || '',
                        volume: data['volume'] || '',
                        comments: data['comments'] || '',
                        createdAt: data['createdAt']?.toDate() || new Date(),
                        status: data['status'] || 'new',
                        notes: data['notes'] || '',
                        contactedBy: data['contactedBy'] || '',
                        contactedAt: data['contactedAt']?.toDate()
                    });
                });
                // Sort by date descending in JavaScript instead of Firestore query
                distributors.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
                console.log('Loaded distributors:', distributors);
                return distributors;
            })
        );
    }

    async updateStatus(id: string, status: string, notes?: string, contactedBy?: string) {
        const docRef = doc(this.firestore, 'distributors', id);
        const updateData: any = {
            status,
            contactedAt: new Date()
        };

        if (notes) updateData.notes = notes;
        if (contactedBy) updateData.contactedBy = contactedBy;

        await updateDoc(docRef, updateData);
    }
}
