import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Firestore, collection, addDoc, getDocs, query, where, deleteDoc } from '@angular/fire/firestore';
import { Auth } from '@angular/fire/auth';

@Component({
    selector: 'app-firestore-diagnostic',
    standalone: true,
    imports: [CommonModule],
    template: `
    <div class="p-4 bg-slate-900 text-white rounded-lg mb-6 border border-slate-700 font-mono text-sm">
      <h3 class="text-yellow-400 font-bold mb-4 flex items-center gap-2">
        <span>🕵️‍♂️ Firestore Diagnostic Tool</span>
        <span class="text-xs px-2 py-0.5 rounded bg-slate-800 text-slate-400">{{ auth.currentUser?.uid || 'Not Authenticated' }}</span>
      </h3>
      
      <div class="grid grid-cols-2 gap-4">
        <!-- Test Actions -->
        <div class="space-y-2">
          <button (click)="testWrite()" [disabled]="loading()"
            class="w-full px-3 py-2 bg-blue-600 hover:bg-blue-500 rounded text-left flex justify-between items-center">
            <span>1. Test Write (Add Doc)</span>
            <span *ngIf="writeStatus() === 'success'" class="text-emerald-400">OK</span>
            <span *ngIf="writeStatus() === 'error'" class="text-red-400">ERR</span>
          </button>

          <button (click)="testRead()" [disabled]="loading()"
            class="w-full px-3 py-2 bg-purple-600 hover:bg-purple-500 rounded text-left flex justify-between items-center">
            <span>2. Test Read (List All)</span>
            <span *ngIf="readStatus() === 'success'" class="text-emerald-400">OK</span>
            <span *ngIf="readStatus() === 'error'" class="text-red-400">ERR</span>
          </button>

          <button (click)="testQuery()" [disabled]="loading()"
            class="w-full px-3 py-2 bg-pink-600 hover:bg-pink-500 rounded text-left flex justify-between items-center">
            <span>3. Test Query (Array-Contains)</span>
            <span *ngIf="queryStatus() === 'success'" class="text-emerald-400">OK</span>
            <span *ngIf="queryStatus() === 'error'" class="text-red-400">ERR</span>
          </button>
        </div>

        <!-- Logs -->
        <div class="bg-black p-3 rounded h-48 overflow-y-auto whitespace-pre-wrap text-xs font-mono border border-slate-800">
            <div *ngIf="logs().length === 0" class="text-gray-600 italic">Ready to run tests...</div>
            <div *ngFor="let log of logs()" [ngClass]="{
                'text-green-400': log.type === 'success',
                'text-red-400': log.type === 'error',
                'text-blue-400': log.type === 'info'
            }">[{{ log.time }}] {{ log.message }}</div>
        </div>
      </div>
    </div>
  `
})
export class FirestoreDiagnosticComponent {
    firestore = inject(Firestore);
    auth = inject(Auth);

    loading = signal(false);
    writeStatus = signal<'pending' | 'success' | 'error'>('pending');
    readStatus = signal<'pending' | 'success' | 'error'>('pending');
    queryStatus = signal<'pending' | 'success' | 'error'>('pending');

    logs = signal<{ time: string, type: 'info' | 'success' | 'error', message: string }[]>([]);

    log(message: string, type: 'info' | 'success' | 'error' = 'info') {
        const time = new Date().toLocaleTimeString();
        this.logs.update(prev => [{ time, type, message }, ...prev]);
    }

    ngOnInit() {
        // Log Environment Info
        const app = this.firestore.app;
        this.log(`Firebase Project: ${app.options.projectId}`, 'info');
        this.log(`Auth State: ${this.auth.currentUser ? 'Logged In' : 'Logged Out'}`, this.auth.currentUser ? 'success' : 'error');
        if (this.auth.currentUser) {
            this.log(`UID: ${this.auth.currentUser.uid}`, 'info');
            this.log(`Email: ${this.auth.currentUser.email}`, 'info');
        }
    }

    async testWrite() {
        this.loading.set(true);
        this.log('Attempting verify_access write...', 'info');
        try {
            const col = collection(this.firestore, 'purchase_orders');
            const docRef = await addDoc(col, {
                _diagnostic: true,
                createdAt: new Date(),
                createdBy: this.auth.currentUser?.uid
            });
            this.log(`Write Success! Doc ID: ${docRef.id}`, 'success');
            this.writeStatus.set('success');

            // Cleanup
            await deleteDoc(docRef);
            this.log('Cleanup (delete) successful', 'info');
        } catch (e: any) {
            this.log(`Write Failed: ${e.message}`, 'error');
            this.log(`Code: ${e.code}`, 'error');
            this.writeStatus.set('error');
        } finally {
            this.loading.set(false);
        }
    }

    async testRead() {
        this.loading.set(true);
        this.log('Attempting basic read...', 'info');
        try {
            const col = collection(this.firestore, 'purchase_orders');
            const snapshot = await getDocs(col);
            this.log(`Read Success! Found ${snapshot.size} docs`, 'success');
            this.readStatus.set('success');
        } catch (e: any) {
            this.log(`Read Failed: ${e.message}`, 'error');
            this.readStatus.set('error');
        } finally {
            this.loading.set(false);
        }
    }

    async testQuery() {
        this.loading.set(true);
        this.log('Attempting array-contains query...', 'info');
        try {
            // Emulate the exact query failing in the app
            const q = query(
                collection(this.firestore, 'purchase_orders'),
                where('relatedUuids', 'array-contains', 'test-uuid-123')
            );
            const snapshot = await getDocs(q);
            this.log(`Query Success! Execution completed (empty results ok).`, 'success');
            this.queryStatus.set('success');
        } catch (e: any) {
            this.log(`Query Failed: ${e.message}`, 'error');
            if (e.message.includes('index')) {
                this.log('MISSING INDEX DETECTED! Check console for link.', 'error');
            }
            this.queryStatus.set('error');
        } finally {
            this.loading.set(false);
        }
    }
}
