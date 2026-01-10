import { Component, inject } from '@angular/core';
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

@Component({
    selector: 'app-user-list',
    standalone: true,
    imports: [CommonModule, ReactiveFormsModule, FormsModule, TranslateModule, AdminPageHeaderComponent],
    templateUrl: './user-list.component.html',
    styleUrls: ['./user-list.component.css']
})
export class UserListComponent {
    private userService = inject(UserManagementService);
    private toast = inject(ToastService);
    private fb = inject(FormBuilder);
    private authService = inject(AuthService);

    users$: Observable<UserProfile[]> = this.userService.getUsers();

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

    constructor() {
        this.inviteForm = this.fb.group({
            email: ['', [Validators.required, Validators.email]],
            role: ['ADMIN', Validators.required]
        });
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
        } catch (error) {
            this.toast.error('Failed to update status');
        }
    }

    async updateRole(user: UserProfile, event: any) {
        const newRole = event.target.value as UserRole;
        if (user.role === newRole) return;

        // Check permission first
        const currentUserProfile = await this.authService.userProfile$.pipe(
            map(profile => profile)
        ).toPromise();

        if (currentUserProfile?.role !== 'SUPER_ADMIN') {
            this.toast.error('Only Super Admins can change user roles');
            // Reset the select to original value
            event.target.value = user.role;
            return;
        }

        try {
            await this.userService.updateUserRole(user.uid, newRole);
            this.toast.success('Role updated');
        } catch (error) {
            this.toast.error('Failed to update role');
            // Revert the select
            event.target.value = user.role;
        }
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
}
