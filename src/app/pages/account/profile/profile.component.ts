import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatCardModule } from '@angular/material/card';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatIconModule } from '@angular/material/icon';
import { AccountService } from '../../../core/services/account.service';
import { AuthService } from '../../../core/services/auth.service';
import { TranslateModule } from '@ngx-translate/core';

@Component({
    selector: 'app-profile',
    standalone: true,
    imports: [
        CommonModule,
        ReactiveFormsModule,
        MatButtonModule,
        MatFormFieldModule,
        MatInputModule,
        MatSelectModule,
        MatCardModule,
        MatProgressSpinnerModule,
        MatSnackBarModule,
        MatIconModule,
        TranslateModule
    ],
    templateUrl: './profile.component.html',
    styleUrls: ['./profile.component.css']
})
export class ProfileComponent implements OnInit {
    accountService = inject(AccountService);
    authService = inject(AuthService);
    fb = inject(FormBuilder);
    snackBar = inject(MatSnackBar);

    form: FormGroup;
    loading = true;
    saving = false;

    // SAT Catalogs
    fiscalRegimes = [
        { code: '601', description: '601 - General de Ley Personas Morales' },
        { code: '603', description: '603 - Personas Morales con Fines no Lucrativos' },
        { code: '605', description: '605 - Sueldos y Salarios' },
        { code: '606', description: '606 - Arrendamiento' },
        { code: '612', description: '612 - Personas Físicas con Actividades Empresariales' },
        { code: '626', description: '626 - Régimen Simplificado de Confianza' }
    ];

    cfdiUses = [
        { code: 'G01', description: 'G01 - Adquisición de mercancías' },
        { code: 'G03', description: 'G03 - Gastos en general' },
        { code: 'P01', description: 'P01 - Por definir' },
        { code: 'D04', description: 'D04 - Donativos' }
    ];

    constructor() {
        this.form = this.fb.group({
            displayName: ['', Validators.required],
            email: [{ value: '', disabled: true }],
            phone: [''],
            // Tax Info Fields
            rfc: ['', [Validators.pattern(/^[A-Z&Ñ]{3,4}[0-9]{6}[A-V1-9][A-Z1-9][0-9A]$/)]],
            legalName: [''],
            fiscalRegime: [''],
            fiscalZip: [''],
            cfdiUse: ['']
        });
    }

    async ngOnInit() {
        this.loading = true;
        try {
            // Get data from Auth first for email/name as fallback
            const user = this.authService.currentUser();
            if (user) {
                this.form.patchValue({
                    displayName: user.displayName,
                    email: user.email
                });
            }

            // Get extended profile from Firestore
            const profile = await this.accountService.getProfile();
            if (profile) {
                this.form.patchValue({
                    displayName: profile.displayName || user?.displayName,
                    phone: profile.phone,
                    // Flatten tax info for the form
                    rfc: profile.taxInfo?.rfc || '',
                    legalName: profile.taxInfo?.legalName || '',
                    fiscalRegime: profile.taxInfo?.fiscalRegime || '',
                    fiscalZip: profile.taxInfo?.fiscalZip || '',
                    cfdiUse: profile.taxInfo?.cfdiUse || ''
                });
            }
        } catch (error: any) {
            console.error('Error loading profile', error);
        } finally {
            this.loading = false;
        }
    }

    async save() {
        if (this.form.invalid) return;

        this.saving = true;
        try {
            const raw = this.form.getRawValue();

            // Construct payload
            const updateData: any = {
                displayName: raw.displayName,
                phone: raw.phone,
                updatedAt: new Date(),
                // Reconstruct TaxInfo object
                taxInfo: {
                    rfc: raw.rfc ? raw.rfc.toUpperCase() : '',
                    legalName: raw.legalName,
                    fiscalRegime: raw.fiscalRegime,
                    fiscalZip: raw.fiscalZip,
                    cfdiUse: raw.cfdiUse
                }
            };

            await this.accountService.updateProfile(updateData);

            this.snackBar.open('Profile updated successfully', 'Close', {
                duration: 3000,
                panelClass: ['success-snackbar']
            });
        } catch (error: any) {
            console.error('Error updating profile', error);
            this.snackBar.open('Failed to update profile', 'Close', { duration: 3000 });
        } finally {
            this.saving = false;
        }
    }
}
