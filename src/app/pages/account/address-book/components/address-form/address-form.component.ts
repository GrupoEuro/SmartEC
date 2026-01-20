import { Component, Inject, OnInit } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { Address } from '../../../../../core/services/account.service';

@Component({
    selector: 'app-address-form',
    standalone: true,
    imports: [
        CommonModule,
        ReactiveFormsModule,
        MatDialogModule,
        MatFormFieldModule,
        MatInputModule,
        MatButtonModule,
        MatCheckboxModule,
        TranslateModule
    ],
    templateUrl: './address-form.component.html',
    styleUrls: ['./address-form.component.css']
})
export class AddressFormComponent implements OnInit {
    form: FormGroup;
    isEdit = false;

    constructor(
        private fb: FormBuilder,
        private dialogRef: MatDialogRef<AddressFormComponent>,
        @Inject(MAT_DIALOG_DATA) public data: { address?: Address }
    ) {
        this.form = this.fb.group({
            label: [''],
            street: ['', Validators.required],
            extNum: ['', Validators.required],
            intNum: [''],
            colonia: ['', Validators.required],
            city: ['', Validators.required],
            state: ['', Validators.required],
            zip: ['', Validators.required],
            country: ['Mexico', Validators.required],
            reference: [''],
            isDefault: [false]
        });
    }

    ngOnInit() {
        if (this.data?.address) {
            this.isEdit = true;
            this.form.patchValue(this.data.address);
        }
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
