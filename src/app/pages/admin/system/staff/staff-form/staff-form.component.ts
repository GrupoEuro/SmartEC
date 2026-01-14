
import { Component, EventEmitter, Input, Output, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { StaffService } from '../../../../../core/services/staff.service';
import { WarehouseService } from '../../../../../core/services/warehouse.service';
import { StaffMember, Department, StaffStatus } from '../../../../../core/models/staff.model';
import { Warehouse } from '../../../../../core/models/warehouse.model';

@Component({
    selector: 'app-staff-form',
    standalone: true,
    imports: [CommonModule, FormsModule],
    template: `
    <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <div class="bg-slate-900 border border-slate-700 rounded-lg shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div class="header p-6 border-b border-slate-800 flex justify-between items-center">
          <div>
             <h2 class="text-xl font-bold text-white">{{ staff ? 'Edit Staff Profile' : 'New Staff Profile' }}</h2>
             <p class="text-slate-400 text-sm" *ngIf="staff">{{ staff.email }}</p>
          </div>
          <button (click)="close.emit()" class="text-slate-500 hover:text-white transition">
            <i class="fas fa-times text-xl"></i>
          </button>
        </div>

        <div class="p-6 space-y-6">
            
            <!-- Context Section -->
            <div class="bg-slate-800/50 p-4 rounded border border-slate-700/50">
                <h3 class="text-yellow-500 text-xs uppercase font-bold mb-4">Operational Context</h3>
                
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <!-- Warehouse -->
                    <div class="form-group">
                        <label class="block text-slate-400 text-xs mb-1">Assigned Warehouse</label>
                        <select [(ngModel)]="formData.assignedWarehouseId" class="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-white focus:border-yellow-500 outline-none">
                            <option [ngValue]="null">-- None --</option>
                            <option *ngFor="let w of warehouses()" [value]="w.id">{{ w.name }}</option>
                        </select>
                        <p class="text-[10px] text-slate-500 mt-1">Primary warehouse for task assignment.</p>
                    </div>

                    <!-- Department -->
                    <div class="form-group">
                        <label class="block text-slate-400 text-xs mb-1">Department</label>
                        <select [(ngModel)]="formData.department" class="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-white focus:border-yellow-500 outline-none">
                            <option value="WAREHOUSE">Warehouse Operations</option>
                            <option value="LOGISTICS">Logistics & Fleet</option>
                            <option value="SUPPORT">Customer Support</option>
                            <option value="SALES">Sales</option>
                            <option value="ADMIN">Administration</option>
                            <option value="IT">IT & Systems</option>
                        </select>
                    </div>
                </div>
            </div>

            <!-- Details Section -->
            <div class="bg-slate-800/50 p-4 rounded border border-slate-700/50">
                <h3 class="text-blue-400 text-xs uppercase font-bold mb-4">Role Details</h3>
                
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <!-- Job Title -->
                    <div class="form-group">
                        <label class="block text-slate-400 text-xs mb-1">Job Title</label>
                        <input type="text" [(ngModel)]="formData.jobTitle" placeholder="e.g. Senior Picker" class="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-white focus:border-blue-500 outline-none">
                    </div>

                     <!-- Employee ID -->
                    <div class="form-group">
                        <label class="block text-slate-400 text-xs mb-1">Employee ID</label>
                        <input type="text" [(ngModel)]="formData.employeeId" placeholder="e.g. EMP-023" class="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-white focus:border-blue-500 outline-none">
                    </div>
                </div>
            </div>

             <!-- Status Section -->
            <div class="bg-slate-800/50 p-4 rounded border border-slate-700/50">
                <h3 class="text-green-400 text-xs uppercase font-bold mb-4">System Status</h3>
                
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div class="form-group">
                        <label class="block text-slate-400 text-xs mb-1">Current Status</label>
                         <select [(ngModel)]="formData.status" class="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-white focus:border-green-500 outline-none">
                            <option value="OFFLINE">Offline</option>
                            <option value="ONLINE">Online (Available)</option>
                            <option value="BUSY">Busy</option>
                            <option value="ON_BREAK">On Break</option>
                        </select>
                    </div>
                </div>
            </div>

        </div>

        <div class="footer p-6 border-t border-slate-800 flex justify-end gap-3">
            <button (click)="close.emit()" class="px-4 py-2 text-slate-400 hover:text-white transition">Cancel</button>
            <button (click)="save()" [disabled]="saving()" class="px-6 py-2 bg-yellow-500 hover:bg-yellow-400 text-black font-bold rounded shadow transition disabled:opacity-50 disabled:cursor-not-allowed">
                {{ saving() ? 'Saving...' : 'Save Profile' }}
            </button>
        </div>
      </div>
    </div>
  `
})
export class StaffFormComponent {
    private staffService = inject(StaffService);
    private warehouseService = inject(WarehouseService);

    @Input() staff: StaffMember | null = null;
    @Output() close = new EventEmitter<void>();
    @Output() saved = new EventEmitter<void>();

    warehouses = signal<Warehouse[]>([]);
    saving = signal(false);

    // Form Data
    formData: any = {
        department: 'WAREHOUSE',
        status: 'OFFLINE',
        jobTitle: '',
        employeeId: '',
        assignedWarehouseId: null
    };

    async ngOnInit() {
        this.loadWarehouses();
        if (this.staff && this.staff.profile) {
            this.formData = { ...this.staff.profile };
        } else if (this.staff) {
            // Defaults based on role
            if (this.staff.role === 'OPERATIONS') this.formData.department = 'WAREHOUSE';
            if (this.staff.role === 'MANAGER') this.formData.department = 'ADMIN';
        }
    }

    loadWarehouses() {
        this.warehouseService.getWarehouses().subscribe(list => {
            this.warehouses.set(list);
        });
    }

    async save() {
        if (!this.staff) return;
        this.saving.set(true);
        try {
            await this.staffService.updateStaffProfile(this.staff.uid, this.formData);
            this.saved.emit();
        } catch (err) {
            console.error(err);
            alert('Failed to save profile');
        } finally {
            this.saving.set(false);
        }
    }
}
