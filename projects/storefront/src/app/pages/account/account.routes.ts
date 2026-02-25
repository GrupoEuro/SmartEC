import { Routes } from '@angular/router';
import { AuthGuard } from '../../core/guards/auth.guard';
import { AccountLayoutComponent } from './account-layout/account-layout.component';
import { AccountOverviewComponent } from './account-overview/account-overview.component';
import { AddressBookComponent } from './address-book/address-book.component';
import { OrderHistoryComponent } from './order-history/order-history.component';
import { OrderDetailComponent } from './order-history/order-detail/order-detail.component';
import { ProfileComponent } from './profile/profile.component';

export const accountRoutes: Routes = [
    {
        path: '',
        component: AccountLayoutComponent,
        canActivate: [AuthGuard],
        children: [
            { path: '', component: AccountOverviewComponent },
            { path: 'addresses', component: AddressBookComponent },
            { path: 'orders', component: OrderHistoryComponent },
            { path: 'orders/details/:id', component: OrderDetailComponent },
            { path: 'profile', component: ProfileComponent }
        ]
    }
];
