import { Component, Inject, OnInit, OnDestroy, inject } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Address } from '@lib/core';
import { LocationService } from '../../../../../core/services/location.service';
import { Subject } from 'rxjs';
import { debounceTime, distinctUntilChanged, takeUntil } from 'rxjs/operators';

@Component({
    selector: 'app-address-form',
    standalone: true,
    imports: [
        CommonModule,
        ReactiveFormsModule,
        MatDialogModule,
        MatFormFieldModule,
        MatInputModule,
        MatSelectModule,
        MatButtonModule,
        MatCheckboxModule,
        MatIconModule,
        MatProgressSpinnerModule,
        TranslateModule
    ],
    templateUrl: './address-form.component.html',
    styleUrls: ['./address-form.component.css']
})
export class AddressFormComponent implements OnInit, OnDestroy {
    form: FormGroup;
    isEdit = false;
    colonias: string[] = [];
    isLoadingZip = false;

    private fb = inject(FormBuilder);
    private dialogRef = inject(MatDialogRef<AddressFormComponent>);
    private locationService = inject(LocationService);
    private destroy$ = new Subject<void>();

    constructor(@Inject(MAT_DIALOG_DATA) public data: { address?: Address }) {
        this.form = this.fb.group({
            label: ['', Validators.required],
            street: ['', Validators.required],
            extNum: ['', Validators.required],
            intNum: [''],
            colonia: ['', Validators.required],
            city: ['', Validators.required],
            state: ['', Validators.required],
            zip: ['', [Validators.required, Validators.pattern('^[0-9]{5}$')]],
            country: ['Mexico', Validators.required],
            reference: [''],
            isDefault: [false]
        });
    }

    ngOnInit() {
        if (this.data?.address) {
            this.isEdit = true;
            this.form.patchValue(this.data.address);
            if (this.data.address.zip) {
                this.lookupZipCode(this.data.address.zip, true);
            }
        }

        this.form.get('zip')?.valueChanges.pipe(
            debounceTime(500),
            distinctUntilChanged(),
            takeUntil(this.destroy$)
        ).subscribe(zip => {
            if (zip && zip.length === 5) {
                this.lookupZipCode(zip);
            } else {
                this.colonias = [];
            }
        });
    }

    ngOnDestroy() {
        this.destroy$.next();
        this.destroy$.complete();
    }

    private lookupZipCode(zip: string, isInit = false) {
        console.log(`[AddressForm] Looking up zip: ${zip}, isInit: ${isInit}`);
        this.isLoadingZip = true;
        this.locationService.getZipCodeInfo(zip).subscribe(response => {
            this.isLoadingZip = false;
            console.log(`[AddressForm] Zip response:`, response);
            if (response && response.places && response.places.length > 0) {
                this.colonias = response.places.map(p => p['place name']);

                if (!isInit) {
                    // For Mexico, Zippopotam doesn't consistently return an explicit "city".
                    // We use the state or a placeholder, allowing the user to edit it.
                    const stateName = response.places[0].state || '';

                    this.form.patchValue({
                        state: stateName,
                        city: stateName // Fallback city to state name to satisfy required validator
                    });

                    // Preselect colonia if there's only one
                    if (this.colonias.length === 1) {
                        this.form.get('colonia')?.setValue(this.colonias[0]);
                    } else {
                        // Clear previous selection
                        this.form.get('colonia')?.setValue('');
                    }
                }
            } else {
                this.colonias = [];
                if (!isInit) {
                    this.form.patchValue({ state: '', city: '', colonia: '' });
                }
            }
        });
    }

    save() {
        if (this.form.valid) {
            this.dialogRef.close(this.form.value);
        }
    }

    cancel() {
        this.dialogRef.close();
    }
}
