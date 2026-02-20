
import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { StaffService } from '../../../../../core/services/staff.service';
import { StaffMember } from '../../../../../core/models/staff.model';
import { StaffFormComponent } from '../staff-form/staff-form.component';

@Component({
    selector: 'app-staff-list',
    standalone: true,
    imports: [CommonModule, RouterModule, FormsModule, StaffFormComponent],
    template: `
    <div class="staff-container p-6">
      <div class="header flex justify-between items-center mb-6">
        <div>
          <h1 class="text-2xl font-bold text-slate-100">Staff Management</h1>
          <p class="text-slate-400 text-sm">Manage operational profiles, warehouse assignments, and roles.</p>
        </div>
        <button (click)="openInviteModal()" class="px-4 py-2 bg-yellow-500 hover:bg-yellow-400 text-black font-bold rounded shadow transition">
          <i class="fas fa-plus mr-2"></i> Invite Staff
        </button>
      </div>

      <!-- Filters -->
      <div class="filters mb-6 flex gap-4">
        <div class="relative flex-1 max-w-md">
           <i class="fas fa-search absolute left-3 top-3 text-slate-500"></i>
           <input type="text" [(ngModel)]="searchTerm" placeholder="Search by name, email, or job title..." 
                  class="w-full bg-slate-800 border border-slate-700 rounded pl-10 pr-4 py-2 text-slate-200 focus:outline-none focus:border-yellow-500 transition">
        </div>
        <select [(ngModel)]="roleFilter" class="bg-slate-800 border border-slate-700 rounded px-4 py-2 text-slate-200 focus:outline-none focus:border-yellow-500">
            <option value="ALL">All Roles</option>
            <option value="SUPER_ADMIN">Super Admin</option>
            <option value="MANAGER">Manager</option>
            <option value="ADMIN">Admin</option>
            <option value="OPERATIONS">Operations</option>
        </select>
        <select [(ngModel)]="deptFilter" class="bg-slate-800 border border-slate-700 rounded px-4 py-2 text-slate-200 focus:outline-none focus:border-yellow-500">
            <option value="ALL">All Departments</option>
            <option value="WAREHOUSE">Warehouse</option>
            <option value="LOGISTICS">Logistics</option>
            <option value="SUPPORT">Support</option>
            <option value="SALES">Sales</option>
        </select>
      </div>

      <!-- Table -->
      <div class="bg-slate-800 rounded-lg border border-slate-700 overflow-hidden shadow-lg">
        <table class="w-full text-left border-collapse">
            <thead>
                <tr class="bg-slate-900/50 text-slate-400 text-xs uppercase tracking-wider border-b border-slate-700">
                    <th class="p-4">Staff Member</th>
                    <th class="p-4">Operational Role</th>
                    <th class="p-4">Assignment</th>
                    <th class="p-4">Status</th>
                    <th class="p-4 text-right">Actions</th>
                </tr>
            </thead>
            <tbody class="divide-y divide-slate-700">
                <tr *ngFor="let staff of filteredStaff()" class="hover:bg-slate-700/30 transition group">
                    <td class="p-4">
                        <div class="flex items-center gap-3">
                            <div class="w-10 h-10 rounded-full bg-slate-600 flex items-center justify-center text-slate-300 font-bold overflow-hidden shadow-inner">
                                <img *ngIf="staff.photoURL" [src]="staff.photoURL" class="w-full h-full object-cover">
                                <span *ngIf="!staff.photoURL">{{ staff.displayName?.charAt(0) || staff.email.charAt(0) | uppercase }}</span>
                            </div>
                            <div>
                                <div class="font-medium text-white flex items-center gap-2">
                                    {{ staff.displayName || 'Unset' }}
                                    <span class="px-1.5 py-0.5 rounded text-[10px] font-bold border opacity-70" [ngClass]="getRoleBadge(staff.role)">
                                        {{ staff.role }}
                                    </span>
                                </div>
                                <div class="text-xs text-slate-500">{{ staff.email }}</div>
                            </div>
                        </div>
                    </td>
                    <td class="p-4">
                        <div class="flex flex-col">
                            <span class="text-sm text-slate-200 font-medium">{{ staff.profile?.jobTitle || 'No Title' }}</span>
                            <span class="text-xs text-slate-500">{{ staff.profile?.department || 'Unassigned' }}</span>
                        </div>
                    </td>
                    <td class="p-4">
                         <div *ngIf="staff.profile?.assignedWarehouseId" class="flex items-center gap-2 text-sm text-slate-300">
                            <i class="fas fa-warehouse text-slate-500"></i>
                            <!-- We would ideally look up the name, but ID is shown for now or we map it if we load warehouses -->
                            <span class="font-mono text-xs bg-slate-900 px-1 py-0.5 rounded">{{ staff.profile?.assignedWarehouseId }}</span>
                         </div>
                         <span *ngIf="!staff.profile?.assignedWarehouseId" class="text-xs text-slate-600 italic">No warehouse assigned</span>
                    </td>
                    <td class="p-4">
                        <div class="flex items-center gap-2">
                             <div class="w-2 h-2 rounded-full" 
                                  [class.bg-green-500]="staff.profile?.status === 'ONLINE'" 
                                  [class.bg-slate-500]="staff.profile?.status === 'OFFLINE'"
                                  [class.bg-orange-500]="staff.profile?.status === 'BUSY'"></div>
                             <span class="text-xs uppercase font-bold" 
                                   [class.text-green-500]="staff.profile?.status === 'ONLINE'"
                                   [class.text-slate-500]="staff.profile?.status === 'OFFLINE'">
                                {{ staff.profile?.status || 'OFFLINE' }}
                             </span>
                        </div>
                    </td>
                    <td class="p-4 text-right">
                        <button (click)="editStaff(staff)" class="text-slate-400 hover:text-yellow-500 px-3 py-1 hover:bg-slate-700/50 rounded transition">
                            <i class="fas fa-pen"></i> Edit
                        </button>
                    </td>
                </tr>
            </tbody>
        </table>
      </div>

      <!-- Modal -->
      <app-staff-form *ngIf="selectedStaff" 
                      [staff]="selectedStaff" 
                      (close)="selectedStaff = null" 
                      (saved)="onStaffSaved()">
      </app-staff-form>

    </div>
  `
})
export class StaffListComponent implements OnInit {
    private staffService = inject(StaffService);

    staffList = signal<StaffMember[]>([]);
    selectedStaff: StaffMember | null = null;
    loading = signal(true);

    searchTerm = '';
    roleFilter = 'ALL';
    deptFilter = 'ALL';

    async ngOnInit() {
        this.loadStaff();
    }

    async loadStaff() {
        this.loading.set(true);
        try {
            const staff = await this.staffService.getAllStaff();
            this.staffList.set(staff);
        } catch (err) {
            console.error('Failed to load staff', err);
        } finally {
            this.loading.set(false);
        }
    }

    editStaff(staff: StaffMember) {
        this.selectedStaff = staff;
    }

    onStaffSaved() {
        this.selectedStaff = null;
        this.loadStaff(); // Refresh list
    }

    filteredStaff() {
        const term = this.searchTerm.toLowerCase();
        return this.staffList().filter(user => {
            const matchesTerm = (user.displayName?.toLowerCase().includes(term) || user.email.toLowerCase().includes(term) || user.profile?.jobTitle?.toLowerCase().includes(term));
            const matchesRole = this.roleFilter === 'ALL' || user.role === this.roleFilter;
            const matchesDept = this.deptFilter === 'ALL' || (user.profile?.department === this.deptFilter);
            return matchesTerm && matchesRole && matchesDept;
        });
    }

    getRoleBadge(role: string): string {
        switch (role) {
            case 'SUPER_ADMIN': return 'text-purple-400 border-purple-800 bg-purple-900/10';
            case 'ADMIN': return 'text-blue-400 border-blue-800 bg-blue-900/10';
            case 'MANAGER': return 'text-green-400 border-green-800 bg-green-900/10';
            case 'OPERATIONS': return 'text-orange-400 border-orange-800 bg-orange-900/10';
            default: return 'text-slate-300 border-slate-600';
        }
    }

    openInviteModal() {
        alert('Invite system coming soon.');
    }
}
