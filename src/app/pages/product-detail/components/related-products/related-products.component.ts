import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { Product } from '../../../../core/models/product.model';

@Component({
    selector: 'app-related-products',
    standalone: true,
    imports: [CommonModule, RouterModule, TranslateModule],
    templateUrl: './related-products.component.html',
    styleUrl: './related-products.component.css'
})
export class RelatedProductsComponent {
    @Input() products: Product[] = [];
}
