import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators, FormsModule } from '@angular/forms';
import { UserManagementService } from '../../../../core/services/user-management.service';
import { ToastService } from '../../../../core/services/toast.service';
import { TranslateModule } from '@ngx-translate/core';
import { UserProfile, UserRole } from '../../../../core/models/user.model';
import { AuthService } from '../../../../core/services/auth.service';
import { Observable, BehaviorSubject, combineLatest } from 'rxjs';
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

    // Data observables
    users$: Observable<UserProfile[]> = this.userService.getUsers();
    paginatedUsers$!: Observable<UserProfile[]>;

    // Check if current user is SUPER_ADMIN
    isSuperAdmin$: Observable<boolean> = this.authService.userProfile$.pipe(
        map(profile => profile?.role === 'SUPER_ADMIN')
    );

    showInviteForm = false;
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

    private filterSubject = new BehaviorSubject<void>(undefined);

    constructor() {
        this.inviteForm = this.fb.group({
            email: ['', [Validators.required, Validators.email]],
            role: ['ADMIN', Validators.required]
        });
    }

    ngOnInit() {
        this.setupFiltering();
    }

    setupFiltering() {
        this.paginatedUsers$ = combineLatest([
            this.users$,
            this.filterSubject
        ]).pipe(
            map(([users]) => {
                // Apply filters
                let filtered = this.applyFilters(users);

                // Apply sorting
                filtered = this.applySorting(filtered);

                // Update pagination total
                this.paginationConfig.totalItems = filtered.length;

                // Apply pagination
                return this.applyPagination(filtered);
            })
        );
    }

    applyFilters(users: UserProfile[]): UserProfile[] {
        let filtered = users;

        if (this.searchTerm.trim()) {
            const searchLower = this.searchTerm.toLowerCase();
            filtered = filtered.filter(u =>
                (u.email && u.email.toLowerCase().includes(searchLower)) ||
                (u.displayName && u.displayName.toLowerCase().includes(searchLower))
            );
        }

        if (this.selectedRole) {
            filtered = filtered.filter(u => u.role === this.selectedRole);
        }

        if (this.selectedStatus) {
            const isActive = this.selectedStatus === 'active';
            filtered = filtered.filter(u => u.isActive === isActive);
        }

        return filtered;
    }

    applySorting(users: UserProfile[]): UserProfile[] {
        return [...users].sort((a, b) => {
            let comparison = 0;
            if (this.sortField === 'name') {
                const nameA = a.displayName || a.email || '';
                const nameB = b.displayName || b.email || '';
                comparison = nameA.localeCompare(nameB);
            } else if (this.sortField === 'lastLogin') {
                const dateA = a.lastLogin ? a.lastLogin.toDate().getTime() : 0;
                const dateB = b.lastLogin ? b.lastLogin.toDate().getTime() : 0;
                comparison = dateA - dateB;
            }
            return this.sortDirection === 'asc' ? comparison : -comparison;
        });
    }

    applyPagination(users: UserProfile[]): UserProfile[] {
        const start = (this.paginationConfig.currentPage - 1) * this.paginationConfig.itemsPerPage;
        const end = start + this.paginationConfig.itemsPerPage;
        return users.slice(start, end);
    }

    toggleInviteForm() {
        this.showInviteForm = !this.showInviteForm;
    }

    async onInvite() {
        if (this.inviteForm.invalid) return;

        this.isSubmitting = true;
        const { email, role } = this.inviteForm.value;

        try {
            await this.userService.inviteUser(email, role);
            this.toast.success('User invited successfully');
            this.inviteForm.reset({ role: 'ADMIN' });
            this.showInviteForm = false;
        } catch (error: any) {
            console.error(error);
            this.toast.error('Failed to invite user');
        } finally {
            this.isSubmitting = false;
        }
    }

    async toggleStatus(user: UserProfile) {
        try {
            await this.userService.toggleUserStatus(user.uid, !user.isActive);
            this.toast.success(`User ${user.isActive ? 'deactivated' : 'activated'}`);
            // Force refresh if needed, but observable users$ should auto-update if service updates the store/firestore
        } catch (error) {
            this.toast.error('Failed to update status');
        }
    }

    async updateRole(user: UserProfile, event: any) {
        // Logic handled by updateRoleFromModel
    }

    async updateRoleFromModel(user: UserProfile, newRole: UserRole) {
        const originalRole = user.role;

        // Check permission first
        const currentUserProfile = await this.authService.userProfile$.pipe(
            map(profile => profile)
        ).toPromise();

        if (currentUserProfile?.role !== 'SUPER_ADMIN') {
            this.toast.error('Only Super Admins can change user roles');
            // Revert to original
            user.role = originalRole;
            return;
        }

        try {
            await this.userService.updateUserRole(user.uid, newRole);
            this.toast.success('Role updated');
        } catch (error) {
            this.toast.error('Failed to update role');
            // Revert to original
            user.role = originalRole;
        }
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
            this.editingUserId = null;
            this.editingName = '';
        } catch (error) {
            this.toast.error('Failed to update name');
        }
    }

    onSearchChange() {
        this.paginationConfig.currentPage = 1;
        this.filterSubject.next();
    }

    onFilterChange() {
        this.paginationConfig.currentPage = 1;
        this.filterSubject.next();
    }

    onSortChange(field: string) {
        if (this.sortField === field) {
            this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
        } else {
            this.sortField = field;
            this.sortDirection = 'asc';
        }
        this.filterSubject.next();
    }

    onPageChange(page: number) {
        this.paginationConfig.currentPage = page;
        this.filterSubject.next();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    onItemsPerPageChange(itemsPerPage: number) {
        this.paginationConfig.itemsPerPage = itemsPerPage;
        this.paginationConfig.currentPage = 1;
        this.filterSubject.next();
    }
}
