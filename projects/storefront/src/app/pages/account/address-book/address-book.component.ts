import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { AccountService, Address } from '@lib/core';
import { AddressFormComponent } from './components/address-form/address-form.component';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { ToastService } from '../../../core/services/toast.service';

@Component({
    selector: 'app-address-book',
    standalone: true,
    imports: [
        CommonModule,
        MatButtonModule,
        MatIconModule,
        MatDialogModule,
        MatProgressSpinnerModule,
        TranslateModule
    ],
    templateUrl: './address-book.component.html',
    styleUrls: ['./address-book.component.css']
})
export class AddressBookComponent implements OnInit {
    accountService = inject(AccountService);
    dialog = inject(MatDialog);
    translate = inject(TranslateService);
    toast = inject(ToastService);

    addresses: Address[] = [];
    loading = true;

    ngOnInit() {
        this.loadAddresses();
    }

    async loadAddresses() {
        this.loading = true;
        try {
            this.addresses = await this.accountService.getAddresses();
            // Sort: Default first, then label or added order
            this.addresses.sort((a, b) => (b.isDefault ? 1 : 0) - (a.isDefault ? 1 : 0));
        } catch (error: any) {
            console.error('Error loading addresses', error);
        } finally {
            this.loading = false;
        }
    }

    addAddress() {
        const dialogRef = this.dialog.open(AddressFormComponent, {
            width: '600px',
            panelClass: 'glass-dialog',
            data: {}
        });

        dialogRef.afterClosed().subscribe(async (result: any) => {
            if (result) {
                this.loading = true;
                try {
                    await this.accountService.addAddress(result);
                    this.toast.success(this.translate.instant('ACCOUNT.ADDRESS_BOOK.SUCCESS_ADD'));
                    await this.loadAddresses();
                } catch (error: any) {
                    console.error('Error adding address', error);
                    this.toast.error(this.translate.instant('ACCOUNT.ADDRESS_BOOK.ERROR_ADD'));
                    this.loading = false;
                }
            }
        });
    }

    editAddress(address: Address) {
        const dialogRef = this.dialog.open(AddressFormComponent, {
            width: '600px',
            panelClass: 'glass-dialog',
            data: { address }
        });

        dialogRef.afterClosed().subscribe(async (result: any) => {
            if (result && address.id) {
                this.loading = true;
                try {
                    await this.accountService.updateAddress(address.id, result);
                    this.toast.success(this.translate.instant('ACCOUNT.ADDRESS_BOOK.SUCCESS_UPDATE'));
                    await this.loadAddresses();
                } catch (error: any) {
                    console.error('Error updating address', error);
                    this.toast.error(this.translate.instant('ACCOUNT.ADDRESS_BOOK.ERROR_UPDATE'));
                    this.loading = false;
                }
            }
        });
    }

    async deleteAddress(address: Address) {
        if (!confirm(this.translate.instant('ACCOUNT.ADDRESS_BOOK.CONFIRM_DELETE'))) return;

        if (address.id) {
            this.loading = true;
            try {
                await this.accountService.deleteAddress(address.id);
                this.toast.success(this.translate.instant('ACCOUNT.ADDRESS_BOOK.SUCCESS_DELETE'));
                await this.loadAddresses();
            } catch (error: any) {
                console.error('Error deleting address', error);
                this.toast.error(this.translate.instant('ACCOUNT.ADDRESS_BOOK.ERROR_DELETE'));
                this.loading = false;
            }
        }
    }
}
