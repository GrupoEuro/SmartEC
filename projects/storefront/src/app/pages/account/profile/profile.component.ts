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
import { AccountService } from '@lib/core';
import { AuthService } from '@lib/core';
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

    // SAT Catalogs CFDI 4.0
    fiscalRegimes = [
        { code: '601', description: '601 - General de Ley Personas Morales' },
        { code: '603', description: '603 - Personas Morales con Fines no Lucrativos' },
        { code: '605', description: '605 - Sueldos y Salarios e Ingresos Asimilados a Salarios' },
        { code: '606', description: '606 - Arrendamiento' },
        { code: '607', description: '607 - Régimen de Enajenación o Adquisición de Bienes' },
        { code: '608', description: '608 - Demás ingresos' },
        { code: '611', description: '611 - Ingresos por Dividendos (socios y accionistas)' },
        { code: '612', description: '612 - Personas Físicas con Actividades Empresariales y Profesionales' },
        { code: '614', description: '614 - Ingresos por intereses' },
        { code: '615', description: '615 - Régimen de los ingresos por obtención de premios' },
        { code: '616', description: '616 - Sin obligaciones fiscales' },
        { code: '620', description: '620 - Sociedades Cooperativas de Producción que optan por diferir sus ingresos' },
        { code: '621', description: '621 - Incorporación Fiscal' },
        { code: '622', description: '622 - Actividades Agrícolas, Ganaderas, Silvícolas y Pesqueras' },
        { code: '623', description: '623 - Opcional para Grupos de Sociedades' },
        { code: '624', description: '624 - Coordinados' },
        { code: '625', description: '625 - Régimen de las Actividades Empresariales con ingresos a través de Plataformas Tecnológicas' },
        { code: '626', description: '626 - Régimen Simplificado de Confianza' }
    ];

    cfdiUses = [
        { code: 'G01', description: 'G01 - Adquisición de mercancías' },
        { code: 'G02', description: 'G02 - Devoluciones, descuentos o bonificaciones' },
        { code: 'G03', description: 'G03 - Gastos en general' },
        { code: 'I01', description: 'I01 - Construcciones' },
        { code: 'I02', description: 'I02 - Mobiliario y equipo de oficina por inversiones' },
        { code: 'I03', description: 'I03 - Equipo de transporte' },
        { code: 'I04', description: 'I04 - Equipo de cómputo y accesorios' },
        { code: 'I05', description: 'I05 - Dados, troqueles, moldes, matrices y herramental' },
        { code: 'I06', description: 'I06 - Comunicaciones telefónicas' },
        { code: 'I07', description: 'I07 - Comunicaciones satelitales' },
        { code: 'I08', description: 'I08 - Otra maquinaria y equipo' },
        { code: 'D01', description: 'D01 - Honorarios médicos, dentales y gastos hospitalarios' },
        { code: 'D02', description: 'D02 - Gastos médicos por incapacidad o discapacidad' },
        { code: 'D03', description: 'D03 - Gastos funerales' },
        { code: 'D04', description: 'D04 - Donativos' },
        { code: 'D05', description: 'D05 - Intereses reales efectivamente pagados por créditos hipotecarios (casa habitación)' },
        { code: 'D06', description: 'D06 - Aportaciones voluntarias al SAR' },
        { code: 'D07', description: 'D07 - Primas por seguros de gastos médicos' },
        { code: 'D08', description: 'D08 - Gastos de transportación escolar obligatoria' },
        { code: 'D09', description: 'D09 - Depósitos en cuentas para el ahorro, primas que tengan como base planes de pensiones' },
        { code: 'D10', description: 'D10 - Pagos por servicios educativos (colegiaturas)' },
        { code: 'S01', description: 'S01 - Sin efectos fiscales' },
        { code: 'CP01', description: 'CP01 - Pagos' }
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
