import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { UserManagementService } from '../../../../core/services/user-management.service';
import { UserProfile } from '../../../../core/models/user.model';
import { AppIconComponent } from '../../../../shared/components/app-icon/app-icon.component';
import { Subject, debounceTime, distinctUntilChanged } from 'rxjs';

@Component({
    selector: 'app-customer-search-modal',
    standalone: true,
    imports: [CommonModule, FormsModule, MatDialogModule, AppIconComponent],
    template: `
        <div class="modal-container">
            <div class="modal-header">
                <h2>Asociar Cliente</h2>
                <button class="close-btn" (click)="close()">
                    <app-icon name="x" [size]="20"></app-icon>
                </button>
            </div>
            
            <div class="modal-body">
                <p class="helper-text">Busca por nombre, email o teléfono para asociar esta conversación a un perfil de cliente existente en el CRM.</p>
                
                <div class="search-box">
                    <app-icon name="search" [size]="18" class="search-icon"></app-icon>
                    <input type="text" 
                           [(ngModel)]="searchTerm" 
                           (ngModelChange)="onSearchChange($event)"
                           placeholder="Buscar cliente..." 
                           class="search-input"
                           autocomplete="off">
                </div>

                <div class="results-area">
                    @if (loading()) {
                        <div class="state-msg">
                            <div class="spinner"></div>
                            <span>Buscando...</span>
                        </div>
                    } @else if (hasSearched() && results().length === 0) {
                        <div class="state-msg">
                            <app-icon name="user-x" [size]="32"></app-icon>
                            <span>No se encontraron clientes.</span>
                        </div>
                    } @else {
                        <div class="results-list">
                            @for (user of results(); track user.uid) {
                                <div class="user-card" (click)="selectUser(user)">
                                    <div class="user-avatar">
                                        @if (user.photoURL) {
                                            <img [src]="user.photoURL" alt="">
                                        } @else {
                                            <span>{{ initials(user.displayName || user.email) }}</span>
                                        }
                                    </div>
                                    <div class="user-info">
                                        <span class="u-name">{{ user.displayName || 'Sin Nombre' }}</span>
                                        <span class="u-email">{{ user.email }}</span>
                                        @if (user.phone) {
                                            <span class="u-phone"><app-icon name="phone" [size]="10"></app-icon> {{ user.phone }}</span>
                                        }
                                    </div>
                                </div>
                            }
                        </div>
                    }
                </div>
            </div>
        </div>
    `,
    styles: [`
        .modal-container { background: #0d0d10; color: #e4e4e7; display: flex; flex-direction: column; height: 100%; border: 1px solid rgba(255,255,255,.1); border-radius: 12px; overflow: hidden; }
        .modal-header { display: flex; align-items: center; justify-content: space-between; padding: 1.25rem 1.5rem; border-bottom: 1px solid rgba(255,255,255,.08); background: rgba(0,0,0,.2); }
        .modal-header h2 { margin: 0; font-size: 1.1rem; font-weight: 700; color: #f4f4f5; }
        .close-btn { background: transparent; border: none; color: #a1a1aa; cursor: pointer; display: flex; align-items: center; justify-content: center; padding: .2rem; border-radius: 6px; transition: background .2s; }
        .close-btn:hover { background: rgba(255,255,255,.1); color: #fff; }
        
        .modal-body { padding: 1.5rem; display: flex; flex-direction: column; gap: 1.25rem; flex: 1; min-height: 400px; }
        .helper-text { margin: 0; font-size: .85rem; color: #a1a1aa; line-height: 1.4; }
        
        .search-box { position: relative; display: flex; align-items: center; }
        .search-icon { position: absolute; left: 1rem; color: #71717a; pointer-events: none; }
        .search-input { width: 100%; background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.12); border-radius: 8px; padding: .85rem 1rem .85rem 2.8rem; color: #fff; font-size: .95rem; font-family: inherit; transition: border-color .2s; }
        .search-input:focus { outline: none; border-color: rgba(59,130,246,.5); background: rgba(255,255,255,.06); }
        .search-input::placeholder { color: #52525b; }
        
        .results-area { flex: 1; overflow-y: auto; background: rgba(0,0,0,.2); border-radius: 8px; border: 1px solid rgba(255,255,255,.04); }
        
        .state-msg { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; gap: 1rem; color: #52525b; font-size: .9rem; padding: 3rem; }
        .spinner { width: 24px; height: 24px; border: 2px solid rgba(255,255,255,.1); border-top-color: #3b82f6; border-radius: 50%; animation: spin .8s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }
        
        .results-list { display: flex; flex-direction: column; }
        .user-card { display: flex; align-items: center; gap: 1rem; padding: 1rem; border-bottom: 1px solid rgba(255,255,255,.04); cursor: pointer; transition: background .15s; }
        .user-card:last-child { border-bottom: none; }
        .user-card:hover { background: rgba(59,130,246,.1); }
        
        .user-avatar { width: 42px; height: 42px; border-radius: 50%; background: rgba(255,255,255,.1); display: flex; align-items: center; justify-content: center; overflow: hidden; font-weight: 700; color: #d4d4d8; font-size: .9rem; flex-shrink: 0; }
        .user-avatar img { width: 100%; height: 100%; object-fit: cover; }
        
        .user-info { display: flex; flex-direction: column; gap: .15rem; min-width: 0; }
        .u-name { font-size: .95rem; font-weight: 600; color: #f4f4f5; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .u-email { font-size: .8rem; color: #a1a1aa; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .u-phone { font-size: .75rem; color: #71717a; display: flex; align-items: center; gap: .25rem; margin-top: .15rem; }
    `]
})
export class CustomerSearchModalComponent {
    dialogRef = inject(MatDialogRef<CustomerSearchModalComponent>);
    userService = inject(UserManagementService);

    searchTerm = '';
    results = signal<UserProfile[]>([]);
    loading = signal(false);
    hasSearched = signal(false);

    private searchSubject = new Subject<string>();

    constructor() {
        this.searchSubject.pipe(
            debounceTime(400),
            distinctUntilChanged()
        ).subscribe(term => {
            if (term.length < 3) {
                this.results.set([]);
                this.loading.set(false);
                return;
            }
            this.executeSearch(term);
        });
    }

    onSearchChange(term: string) {
        if (term.length >= 3) {
            this.loading.set(true);
            this.hasSearched.set(true);
        }
        this.searchSubject.next(term);
    }

    executeSearch(term: string) {
        this.userService.searchCustomers(term).subscribe({
            next: (users) => {
                this.results.set(users);
                this.loading.set(false);
            },
            error: (err) => {
                console.error('Search failed', err);
                this.results.set([]);
                this.loading.set(false);
            }
        });
    }

    selectUser(user: UserProfile) {
        this.dialogRef.close(user.uid);
    }

    close() {
        this.dialogRef.close();
    }

    initials(name: string): string {
        return (name || '?').split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
    }
}
