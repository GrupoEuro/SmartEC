import { Component, inject, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators, FormsModule } from '@angular/forms';
import { UserManagementService } from '../../../../core/services/user-management.service';
import { ToastService } from '../../../../core/services/toast.service';
import { TranslateModule } from '@ngx-translate/core';
import { UserProfile, UserRole } from '../../../../core/models/user.model';
import { AuthService } from '../../../../core/services/auth.service';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { AdminPageHeaderComponent } from '../../shared/admin-page-header/admin-page-header.component';
import { PaginationComponent, PaginationConfig } from '../../shared/pagination/pagination.component';

@Component({
    selector: 'app-user-list',
    standalone: true,
    imports: [CommonModule, ReactiveFormsModule, FormsModule, TranslateModule, AdminPageHeaderComponent, PaginationComponent],
    templateUrl: './user-list.component.html',
    styleUrls: ['./user-list.component.css']
})
export class UserListComponent implements OnInit {
    private userService = inject(UserManagementService);
    private toast = inject(ToastService);
    private fb = inject(FormBuilder);
    private authService = inject(AuthService);
    private cdr = inject(ChangeDetectorRef);

    // Data
    users: UserProfile[] = [];
    filteredUsers: UserProfile[] = [];
    paginatedUsers: UserProfile[] = [];

    // Check if current user is SUPER_ADMIN
    isSuperAdmin$: Observable<boolean> = this.authService.userProfile$.pipe(
        map(profile => profile?.role === 'SUPER_ADMIN')
    );

    // Modal State
    showInviteModal = false;
    inviteForm: FormGroup;
    isSubmitting = false;

    // Edit state
    editingUserId: string | null = null;
    editingName: string = '';

    roles: UserRole[] = ['SUPER_ADMIN', 'ADMIN', 'EDITOR'];

    // Filtering & Pagination
    searchTerm = '';
    selectedRole = '';
    selectedStatus = '';

    sortField: string = 'name';
    sortDirection: 'asc' | 'desc' = 'asc';

    paginationConfig: PaginationConfig = {
        currentPage: 1,
        itemsPerPage: 10,
        totalItems: 0
    };

    isLoading = true;

    constructor() {
        this.inviteForm = this.fb.group({
            email: ['', [Validators.required, Validators.email]],
            role: ['ADMIN', Validators.required]
        });
    }

    ngOnInit() {
        this.loadUsers();
    }

    loadUsers() {
        this.isLoading = true;
        this.cdr.markForCheck(); // Signal update
        this.userService.getStaff().subscribe({
            next: (users) => {
                console.log('Staff loaded:', users.length, users);
                this.users = users || [];
                this.applyFilters();
                this.isLoading = false;
                this.cdr.detectChanges(); // Force update
            },
            error: (err) => {
                console.error('Error loading users:', err);
                this.toast.error('Failed to load users');
                this.isLoading = false;
                this.cdr.detectChanges();
            }
        });
    }

    applyFilters() {
        let filtered = [...this.users];

        // 1. Search
        if (this.searchTerm.trim()) {
            const searchLower = this.searchTerm.toLowerCase();
            filtered = filtered.filter(u =>
                (u.email && u.email.toLowerCase().includes(searchLower)) ||
                (u.displayName && u.displayName.toLowerCase().includes(searchLower))
            );
        }

        // 2. Role Filter
        if (this.selectedRole) {
            filtered = filtered.filter(u => u.role === this.selectedRole);
        }

        // 3. Status Filter
        if (this.selectedStatus) {
            const isActive = this.selectedStatus === 'active';
            filtered = filtered.filter(u => u.isActive === isActive);
        }

        // 4. Sort
        filtered = this.sortUsers(filtered);

        this.filteredUsers = filtered;
        this.paginationConfig.totalItems = filtered.length;
        this.applyPagination();
    }

    sortUsers(users: UserProfile[]): UserProfile[] {
        return users.sort((a, b) => {
            let comparison = 0;
            if (this.sortField === 'name') {
                const nameA = a.displayName || a.email || '';
                const nameB = b.displayName || b.email || '';
                comparison = nameA.localeCompare(nameB);
            } else if (this.sortField === 'lastLogin') {
                const dateA = a.lastLogin ? new Date(a.lastLogin).getTime() : 0;
                const dateB = b.lastLogin ? new Date(b.lastLogin).getTime() : 0;
                comparison = dateA - dateB;
            }
            return this.sortDirection === 'asc' ? comparison : -comparison;
        });
    }

    applyPagination() {
        const start = (this.paginationConfig.currentPage - 1) * this.paginationConfig.itemsPerPage;
        const end = start + this.paginationConfig.itemsPerPage;
        this.paginatedUsers = this.filteredUsers.slice(start, end);
        this.cdr.markForCheck();
    }

    // Modal Control
    openInviteModal() {
        this.showInviteModal = true;
    }

    closeInviteModal() {
        this.showInviteModal = false;
        this.inviteForm.reset({ role: 'ADMIN' });
    }

    async onInvite() {
        if (this.inviteForm.invalid) return;

        this.isSubmitting = true;
        const { email, role } = this.inviteForm.value;

        try {
            await this.userService.inviteUser(email, role);
            this.toast.success('User invited successfully');
            this.closeInviteModal();
            this.loadUsers(); // Reload list
        } catch (error: any) {
            console.error(error);
            this.toast.error('Failed to invite user');
        } finally {
            this.isSubmitting = false;
            this.cdr.detectChanges();
        }
    }

    async toggleStatus(user: UserProfile) {
        try {
            await this.userService.toggleUserStatus(user.uid, !user.isActive);
            user.isActive = !user.isActive; // Optimistic update
            this.toast.success(`User ${user.isActive ? 'activated' : 'deactivated'}`); // Fix logic text
            this.cdr.detectChanges();
        } catch (error) {
            this.toast.error('Failed to update status');
            // Revert if needed, or just reload
            this.loadUsers();
        }
    }

    async updateRoleFromModel(user: UserProfile, newRole: UserRole) {
        const originalRole = user.role;

        // Check if I am super admin
        this.isSuperAdmin$.subscribe(async (isSuper) => {
            if (!isSuper) {
                this.toast.error('Only Super Admins can change user roles');
                user.role = originalRole;
                this.cdr.detectChanges();
                return;
            }

            try {
                await this.userService.updateUserRole(user.uid, newRole);
                user.role = newRole; // Optimistic
                this.toast.success('Role updated');
            } catch (error) {
                this.toast.error('Failed to update role');
                user.role = originalRole;
            }
            this.cdr.detectChanges();
        });
    }

    startEdit(user: UserProfile) {
        this.editingUserId = user.uid;
        this.editingName = user.displayName || '';
    }

    cancelEdit() {
        this.editingUserId = null;
        this.editingName = '';
    }

    async saveDisplayName(user: UserProfile) {
        if (!this.editingName.trim()) {
            this.toast.error('Name cannot be empty');
            return;
        }

        try {
            await this.userService.updateDisplayName(user.uid, this.editingName.trim());
            this.toast.success('Name updated');
            user.displayName = this.editingName.trim(); // Optimistic
            this.editingUserId = null;
            this.editingName = '';
            this.cdr.detectChanges();
        } catch (error) {
            this.toast.error('Failed to update name');
        }
    }

    onSearchChange() {
        this.paginationConfig.currentPage = 1;
        this.applyFilters();
    }

    onFilterChange() {
        this.paginationConfig.currentPage = 1;
        this.applyFilters();
    }

    onSortChange(field: string) {
        if (this.sortField === field) {
            this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
        } else {
            this.sortField = field;
            this.sortDirection = 'asc';
        }
        this.applyFilters();
    }

    onPageChange(page: number) {
        this.paginationConfig.currentPage = page;
        this.applyPagination();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    onItemsPerPageChange(itemsPerPage: number) {
        this.paginationConfig.itemsPerPage = itemsPerPage;
        this.paginationConfig.currentPage = 1;
        this.applyFilters();
    }
}
