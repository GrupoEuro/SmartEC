import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { AccountService, Address } from '../../../core/services/account.service';
import { AddressFormComponent } from './components/address-form/address-form.component';
import { TranslateModule } from '@ngx-translate/core';

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
                    await this.loadAddresses();
                } catch (error: any) {
                    console.error('Error adding address', error);
                    // TODO: Show error
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
                    await this.loadAddresses();
                } catch (error: any) {
                    console.error('Error updating address', error);
                    this.loading = false;
                }
            }
        });
    }

    async deleteAddress(address: Address) {
        if (!confirm('Are you sure you want to delete this address?')) return;

        if (address.id) {
            this.loading = true;
            try {
                await this.accountService.deleteAddress(address.id);
                await this.loadAddresses();
            } catch (error: any) {
                console.error('Error deleting address', error);
                this.loading = false;
            }
        }
    }
}
