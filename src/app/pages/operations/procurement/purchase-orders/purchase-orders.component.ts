import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { Firestore, collection, query, orderBy, limit, collectionData } from '@angular/fire/firestore';
import { Observable } from 'rxjs';
import { TranslateModule } from '@ngx-translate/core';
import { PurchaseOrder } from '../../../../core/models/procurement.model';
import { AppIconComponent } from '../../../../shared/components/app-icon/app-icon.component';
import { AdminPageHeaderComponent } from '../../../../pages/admin/shared/admin-page-header/admin-page-header.component';

@Component({
  selector: 'app-purchase-orders',
  standalone: true,
  imports: [CommonModule, RouterLink, AppIconComponent, TranslateModule, AdminPageHeaderComponent],
  templateUrl: './purchase-orders.component.html',
  styleUrls: ['./purchase-orders.component.css']
})
export class PurchaseOrdersComponent {
  private firestore = inject(Firestore);

  orders$: Observable<PurchaseOrder[]>;

  constructor() {
    const col = collection(this.firestore, 'purchase_orders');
    const q = query(col, orderBy('createdAt', 'desc'), limit(50));
    this.orders$ = collectionData(q, { idField: 'id' }) as Observable<PurchaseOrder[]>;
  }

  getDate(val: any): Date {
    if (!val) return new Date();
    return (val as any).toDate ? (val as any).toDate() : val;
  }
}
