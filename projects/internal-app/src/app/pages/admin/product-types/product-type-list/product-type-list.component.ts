import { Component, inject, OnInit, signal } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { ProductTypeTemplateService } from '../../../../core/services/product-type-template.service';
import { ProductTypeTemplate } from '../../../../core/models/catalog.model';
import { AppIconComponent } from '../../../../shared/components/app-icon/app-icon.component';
import { FormsModule } from '@angular/forms';

@Component({
    selector: 'app-product-type-list',
    standalone: true,
    imports: [CommonModule, RouterModule, AppIconComponent, FormsModule, TranslateModule],
    templateUrl: './product-type-list.component.html',
    styleUrls: ['./product-type-list.component.css']
})
export class ProductTypeListComponent implements OnInit {
    private productTypeService = inject(ProductTypeTemplateService);
    private router = inject(Router);

    // State
    templates = signal<ProductTypeTemplate[]>([]);
    systemTemplates = signal<ProductTypeTemplate[]>([]);
    customTemplates = signal<ProductTypeTemplate[]>([]);
    loading = signal(true);
    searchQuery = signal('');

    async ngOnInit() {
        await this.loadTemplates();
    }

    async loadTemplates() {
        try {
            this.loading.set(true);
            const allTemplates = await this.productTypeService.getAllTemplates();

            this.templates.set(allTemplates);
            // Sort alphabetically by English name
            const sortedSystem = allTemplates.filter(t => t.isSystem).sort((a, b) => a.name.en.localeCompare(b.name.en));
            const sortedCustom = allTemplates.filter(t => !t.isSystem).sort((a, b) => a.name.en.localeCompare(b.name.en));

            this.systemTemplates.set(sortedSystem);
            this.customTemplates.set(sortedCustom);
        } catch (error) {
            console.error('Error loading templates:', error);
        } finally {
            this.loading.set(false);
        }
    }

    filteredSystemTemplates() {
        const query = this.searchQuery().toLowerCase();
        if (!query) return this.systemTemplates();

        return this.systemTemplates().filter(t =>
            t.name.en.toLowerCase().includes(query) ||
            t.name.es.toLowerCase().includes(query) ||
            t.id.toLowerCase().includes(query)
        );
    }

    filteredCustomTemplates() {
        const query = this.searchQuery().toLowerCase();
        if (!query) return this.customTemplates();

        return this.customTemplates().filter(t =>
            t.name.en.toLowerCase().includes(query) ||
            t.name.es.toLowerCase().includes(query) ||
            t.id.toLowerCase().includes(query)
        );
    }

    createNewType() {
        this.router.navigate(['/admin/product-types/new']);
    }

    editType(id: string) {
        this.router.navigate(['/admin/product-types/edit', id]);
    }

    async toggleActive(template: ProductTypeTemplate) {
        try {
            await this.productTypeService.toggleActive(template.id, !template.active);
            await this.loadTemplates();
        } catch (error: any) {
            alert(`Error: ${error.message}`);
        }
    }

    async duplicateType(template: ProductTypeTemplate) {
        const newId = prompt('Enter ID for duplicated template (lowercase, alphanumeric):');
        if (!newId) return;

        const newNameEn = prompt('Enter English name for duplicated template:');
        if (!newNameEn) return;

        const newNameEs = prompt('Enter Spanish name for duplicated template:');
        if (!newNameEs) return;

        try {
            await this.productTypeService.duplicateTemplate(
                template.id,
                newId,
                { en: newNameEn, es: newNameEs }
            );
            await this.loadTemplates();
        } catch (error: any) {
            alert(`Error: ${error.message}`);
        }
    }

    async deleteType(template: ProductTypeTemplate) {
        if (!confirm(`Delete product type "${template.name.en}"? This action cannot be undone.`)) {
            return;
        }

        try {
            await this.productTypeService.deleteTemplate(template.id);
            await this.loadTemplates();
        } catch (error: any) {
            alert(`Error: ${error.message}`);
        }
    }

    getSpecCount(template: ProductTypeTemplate): number {
        return template.schema.length;
    }

    /**
     * Map product type ID to Feather icon name
     */
    getIconName(template: ProductTypeTemplate): string {
        const iconMap: Record<string, string> = {
            'tire': 'disc',
            'helmet': 'shield',
            'battery': 'zap',
            'part': 'tool',
            'accessory': 'shopping-bag'
        };
        return iconMap[template.id] || 'box';
    }
}
