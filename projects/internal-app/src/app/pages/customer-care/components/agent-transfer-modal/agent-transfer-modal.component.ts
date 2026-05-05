import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { UserManagementService } from '../../../../core/services/user-management.service';
import { UserProfile } from '../../../../core/models/user.model';
import { AppIconComponent } from '../../../../shared/components/app-icon/app-icon.component';

@Component({
    selector: 'app-agent-transfer-modal',
    standalone: true,
    imports: [CommonModule, FormsModule, MatDialogModule, AppIconComponent],
    template: `
        <div class="modal-container">
            <div class="modal-header">
                <h2>Transferir Conversación</h2>
                <button class="close-btn" (click)="close()">
                    <app-icon name="x" [size]="20"></app-icon>
                </button>
            </div>
            
            <div class="modal-body">
                <p class="helper-text">Selecciona un agente o supervisor al cual transferir esta conversación de forma directa.</p>

                <!-- Search -->
                <div class="search-box">
                    <app-icon name="search" [size]="18" class="search-icon"></app-icon>
                    <input type="text" 
                           [(ngModel)]="searchTerm" 
                           (ngModelChange)="filterAgents()"
                           placeholder="Buscar agente por nombre..." 
                           class="search-input">
                </div>

                <!-- Agent List -->
                <div class="results-area">
                    @if (loading()) {
                        <div class="state-msg">
                            <div class="spinner"></div>
                            <span>Cargando agentes...</span>
                        </div>
                    } @else if (filteredAgents().length === 0) {
                        <div class="state-msg">
                            <app-icon name="users" [size]="32"></app-icon>
                            <span>No se encontraron agentes disponibles.</span>
                        </div>
                    } @else {
                        <div class="results-list">
                            <!-- Unassigned Option -->
                            <div class="user-card release-card" (click)="releaseToPool()">
                                <div class="user-avatar release-avatar">
                                    <app-icon name="corner-up-right" [size]="18"></app-icon>
                                </div>
                                <div class="user-info">
                                    <span class="u-name">Liberar a "Sin Asignar"</span>
                                    <span class="u-email">La conversación volverá a la cola general.</span>
                                </div>
                            </div>

                            <!-- Agent Options -->
                            @for (agent of filteredAgents(); track agent.uid) {
                                <div class="user-card" (click)="selectAgent(agent)">
                                    <div class="user-avatar">
                                        @if (agent.photoURL) {
                                            <img [src]="agent.photoURL" alt="">
                                        } @else {
                                            <span>{{ initials(agent.displayName || agent.email) }}</span>
                                        }
                                    </div>
                                    <div class="user-info">
                                        <div class="name-row">
                                            <span class="u-name">{{ agent.displayName || 'Agente' }}</span>
                                            <span class="u-role role-{{ agent.role.toLowerCase() }}">{{ agent.role }}</span>
                                        </div>
                                        <span class="u-email">{{ agent.email }}</span>
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
        
        .modal-body { padding: 1.5rem; display: flex; flex-direction: column; gap: 1.25rem; flex: 1; min-height: 400px; max-height: 500px; }
        .helper-text { margin: 0; font-size: .85rem; color: #a1a1aa; line-height: 1.4; }

        .search-box { position: relative; display: flex; align-items: center; flex-shrink: 0; }
        .search-icon { position: absolute; left: 1rem; color: #71717a; pointer-events: none; }
        .search-input { width: 100%; background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.12); border-radius: 8px; padding: .85rem 1rem .85rem 2.8rem; color: #fff; font-size: .95rem; font-family: inherit; transition: border-color .2s; }
        .search-input:focus { outline: none; border-color: rgba(16,185,129,.5); background: rgba(255,255,255,.06); }
        .search-input::placeholder { color: #52525b; }

        .results-area { flex: 1; overflow-y: auto; background: rgba(0,0,0,.2); border-radius: 8px; border: 1px solid rgba(255,255,255,.04); }
        .results-area::-webkit-scrollbar { width: 4px; }
        .results-area::-webkit-scrollbar-thumb { background: rgba(255,255,255,.1); border-radius: 2px; }
        
        .state-msg { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; gap: 1rem; color: #52525b; font-size: .9rem; padding: 3rem; }
        .spinner { width: 24px; height: 24px; border: 2px solid rgba(255,255,255,.1); border-top-color: #10b981; border-radius: 50%; animation: spin .8s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }
        
        .results-list { display: flex; flex-direction: column; }
        .user-card { display: flex; align-items: center; gap: 1rem; padding: 1rem; border-bottom: 1px solid rgba(255,255,255,.04); cursor: pointer; transition: background .15s; }
        .user-card:last-child { border-bottom: none; }
        .user-card:hover { background: rgba(255,255,255,.05); }

        .release-card { background: rgba(59,130,246,.05); border-bottom: 1px solid rgba(59,130,246,.2); }
        .release-card:hover { background: rgba(59,130,246,.1); }
        .release-avatar { background: rgba(59,130,246,.2) !important; color: #60a5fa !important; }
        
        .user-avatar { width: 42px; height: 42px; border-radius: 50%; background: rgba(255,255,255,.1); display: flex; align-items: center; justify-content: center; overflow: hidden; font-weight: 700; color: #d4d4d8; font-size: .9rem; flex-shrink: 0; }
        .user-avatar img { width: 100%; height: 100%; object-fit: cover; }
        
        .user-info { display: flex; flex-direction: column; gap: .15rem; min-width: 0; }
        .name-row { display: flex; align-items: center; gap: .5rem; }
        .u-name { font-size: .95rem; font-weight: 600; color: #f4f4f5; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .u-email { font-size: .8rem; color: #a1a1aa; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        
        .u-role { font-size: .6rem; font-weight: 800; padding: .15rem .4rem; border-radius: 4px; text-transform: uppercase; letter-spacing: .05em; }
        .role-super_admin, .role-admin { background: rgba(139,92,246,.2); color: #c4b5fd; }
        .role-manager { background: rgba(245,158,11,.2); color: #fcd34d; }
        .role-customer { display: none; } /* shouldn't appear but safeguard */
    `]
})
export class AgentTransferModalComponent implements OnInit {
    dialogRef = inject(MatDialogRef<AgentTransferModalComponent>);
    userService = inject(UserManagementService);

    loading = signal(true);
    agents = signal<UserProfile[]>([]);
    filteredAgents = signal<UserProfile[]>([]);
    searchTerm = '';

    ngOnInit() {
        this.loadAgents();
    }

    loadAgents() {
        this.userService.getUsers().subscribe({
            next: (users) => {
                // Filter out standard customers, keep internal staff (Admins, Managers, Ops, Editor)
                const internalStaff = users.filter(u => u.role !== 'CUSTOMER' && u.isActive);
                this.agents.set(internalStaff);
                this.filteredAgents.set(internalStaff);
                this.loading.set(false);
            },
            error: (err) => {
                console.error('Failed to load agents', err);
                this.loading.set(false);
            }
        });
    }

    filterAgents() {
        const term = this.searchTerm.toLowerCase();
        if (!term) {
            this.filteredAgents.set(this.agents());
            return;
        }
        
        const filtered = this.agents().filter(a => 
            (a.displayName && a.displayName.toLowerCase().includes(term)) ||
            a.email.toLowerCase().includes(term)
        );
        this.filteredAgents.set(filtered);
    }

    selectAgent(agent: UserProfile) {
        this.dialogRef.close({ action: 'transfer', uid: agent.uid });
    }

    releaseToPool() {
        this.dialogRef.close({ action: 'release', uid: null });
    }

    close() {
        this.dialogRef.close();
    }

    initials(name: string): string {
        return (name || '?').split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
    }
}
