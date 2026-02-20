import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { CatalogDataService, VisualizerNode } from '../../../core/services/catalog-data.service';
import { AdminPageHeaderComponent } from '../shared/admin-page-header/admin-page-header.component';
import { AppIconComponent } from '../../../shared/components/app-icon/app-icon.component';
import { Observable } from 'rxjs';

@Component({
    selector: 'app-catalog-overview',
    standalone: true,
    imports: [CommonModule, RouterModule, TranslateModule, AdminPageHeaderComponent, AppIconComponent],
    templateUrl: './catalog-overview.component.html',
    styleUrl: './catalog-overview.component.css'
})
export class CatalogOverviewComponent implements OnInit {
    private catalogService = inject(CatalogDataService);

    catalogData$: Observable<VisualizerNode[]> | null = null;

    // Stats for Hero Cards (computed from catalog data if needed, or we can add a stats method to service later)
    // For now, we focus on the tree.

    ngOnInit() {
        this.catalogData$ = this.catalogService.getUnifiedCatalog();
    }

    toggleNode(node: VisualizerNode) {
        node.expanded = !node.expanded;
    }

    // Zoom / Focus logic can go here later
}
