import { Routes } from '@angular/router';
import { AuthGuard } from '../../core/guards/auth.guard';
import { AccountOverviewComponent } from './account-overview/account-overview.component';
import { AddressBookComponent } from './address-book/address-book.component';
import { OrderHistoryComponent } from './order-history/order-history.component';
import { OrderDetailComponent } from './order-history/order-detail/order-detail.component';
import { ProfileComponent } from './profile/profile.component';

export const accountRoutes: Routes = [
    { path: '', component: AccountOverviewComponent, canActivate: [AuthGuard] },
    { path: 'addresses', component: AddressBookComponent, canActivate: [AuthGuard] },
    { path: 'orders', component: OrderHistoryComponent, canActivate: [AuthGuard] },
    { path: 'orders/details/:id', component: OrderDetailComponent, canActivate: [AuthGuard] },
    { path: 'profile', component: ProfileComponent, canActivate: [AuthGuard] }
];
