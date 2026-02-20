import { Injectable, inject } from '@angular/core';
import { Firestore, collection, addDoc, updateDoc, deleteDoc, doc, query, where, getDocs, Timestamp, orderBy } from '@angular/fire/firestore';
import { Observable, from, map } from 'rxjs';
import { OrderNote, NoteType } from '../models/order-note.model';

@Injectable({
    providedIn: 'root'
})
export class OrderNotesService {
    private firestore = inject(Firestore);
    private notesCollection = collection(this.firestore, 'orderNotes');

    /**
     * Add a new note to an order
     */
    async addNote(
        orderId: string,
        text: string,
        type: NoteType,
        createdBy: string,
        createdByName: string,
        isInternal: boolean = true
    ): Promise<string> {
        const note: Omit<OrderNote, 'id'> = {
            orderId,
            text,
            type,
            createdBy,
            createdByName,
            createdAt: Timestamp.now(),
            isInternal,
            isResolved: type !== 'issue' // Auto-resolve non-issues
        };

        const docRef = await addDoc(this.notesCollection, note);
        return docRef.id;
    }

    /**
     * Update an existing note
     */
    async updateNote(noteId: string, text: string): Promise<void> {
        const noteRef = doc(this.firestore, 'orderNotes', noteId);
        await updateDoc(noteRef, {
            text,
            updatedAt: Timestamp.now()
        });
    }

    /**
     * Delete a note
     */
    async deleteNote(noteId: string): Promise<void> {
        const noteRef = doc(this.firestore, 'orderNotes', noteId);
        await deleteDoc(noteRef);
    }

    /**
     * Mark an issue as resolved
     */
    async resolveIssue(noteId: string): Promise<void> {
        const noteRef = doc(this.firestore, 'orderNotes', noteId);
        await updateDoc(noteRef, {
            isResolved: true,
            updatedAt: Timestamp.now()
        });
    }

    /**
     * Get all notes for an order
     */
    getOrderNotes(orderId: string): Observable<OrderNote[]> {
        const q = query(
            this.notesCollection,
            where('orderId', '==', orderId),
            orderBy('createdAt', 'desc')
        );

        return from(getDocs(q)).pipe(
            map(snapshot => snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            } as OrderNote)))
        );
    }

    /**
     * Get internal notes only
     */
    getInternalNotes(orderId: string): Observable<OrderNote[]> {
        const q = query(
            this.notesCollection,
            where('orderId', '==', orderId),
            where('isInternal', '==', true),
            orderBy('createdAt', 'desc')
        );

        return from(getDocs(q)).pipe(
            map(snapshot => snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            } as OrderNote)))
        );
    }

    /**
     * Get unresolved issues for an order
     */
    getUnresolvedIssues(orderId: string): Observable<OrderNote[]> {
        const q = query(
            this.notesCollection,
            where('orderId', '==', orderId),
            where('type', '==', 'issue'),
            where('isResolved', '==', false),
            orderBy('createdAt', 'desc')
        );

        return from(getDocs(q)).pipe(
            map(snapshot => snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            } as OrderNote)))
        );
    }
}
