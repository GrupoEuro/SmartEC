import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DistributorService } from '../../../../core/services/distributor.service';
import { DistributorSubmission } from '../../../../core/models/distributor.model';
import { ToastService } from '../../../../core/services/toast.service';
import { AuthService } from '../../../../core/services/auth.service';
import { AdminDatePipe } from '../../../../core/pipes/admin-date.pipe';
import { map } from 'rxjs/operators';
import { TranslateModule } from '@ngx-translate/core';
import { AdminPageHeaderComponent } from '../../shared/admin-page-header/admin-page-header.component';

@Component({
    selector: 'app-distributor-list',
    standalone: true,
    imports: [CommonModule, FormsModule, AdminDatePipe, TranslateModule, AdminPageHeaderComponent],
    templateUrl: './distributor-list.component.html',
    styleUrls: ['./distributor-list.component.css']
})
export class DistributorListComponent implements OnInit {
    private distributorService = inject(DistributorService);
    private toast = inject(ToastService);
    private authService = inject(AuthService);

    distributors: DistributorSubmission[] = [];
    filteredDistributors: DistributorSubmission[] = [];
    isLoading = true;

    // Filters
    statusFilter = 'all';
    searchTerm = '';

    // Expandable rows
    expandedRowId: string | null = null;

    // Edit modal
    showEditModal = false;
    editingDistributor: DistributorSubmission | null = null;
    editForm = {
        status: 'new',
        notes: ''
    };

    // Mexican states mapping (3-letter code to full name)
    mexicanStates: { [key: string]: string } = {
        'AGS': 'Aguascalientes',
        'BC': 'Baja California',
        'BCS': 'Baja California Sur',
        'CAM': 'Campeche',
        'CHI': 'Chihuahua',
        'CHS': 'Chiapas',
        'COA': 'Coahuila',
        'COL': 'Colima',
        'DUR': 'Durango',
        'GRO': 'Guerrero',
        'GTO': 'Guanajuato',
        'HGO': 'Hidalgo',
        'JAL': 'Jalisco',
        'MEX': 'Estado de México',
        'MIC': 'Michoacán',
        'MOR': 'Morelos',
        'NAY': 'Nayarit',
        'NL': 'Nuevo León',
        'OAX': 'Oaxaca',
        'PUE': 'Puebla',
        'QRO': 'Querétaro',
        'QR': 'Quintana Roo',
        'SIN': 'Sinaloa',
        'SLP': 'San Luis Potosí',
        'SON': 'Sonora',
        'TAB': 'Tabasco',
        'TAM': 'Tamaulipas',
        'TLA': 'Tlaxcala',
        'VER': 'Veracruz',
        'YUC': 'Yucatán',
        'ZAC': 'Zacatecas',
        'CDMX': 'Ciudad de México'
    };

    getStateName(code: string): string {
        if (!code) return 'N/A';
        const upperCode = code.toUpperCase().trim();
        const stateName = this.mexicanStates[upperCode];
        return stateName || `${code} (Estado no identificado)`;
    }

    ngOnInit() {

        this.loadDistributors();
    }

    loadDistributors() {

        this.isLoading = true;
        this.distributorService.getDistributors().subscribe({
            next: (distributors) => {

                this.distributors = distributors;
                this.applyFilters();
                this.isLoading = false;
            },
            error: (err) => {
                console.error('❌ Error loading distributors:', err);
                this.toast.error('Failed to load distributors');
                this.isLoading = false;
            }
        });
    }

    applyFilters() {

        this.filteredDistributors = this.distributors.filter(d => {
            const matchesStatus = this.statusFilter === 'all' || d.status === this.statusFilter;
            const matchesSearch = !this.searchTerm ||
                d.name.toLowerCase().includes(this.searchTerm.toLowerCase()) ||
                d.business.toLowerCase().includes(this.searchTerm.toLowerCase()) ||
                d.email.toLowerCase().includes(this.searchTerm.toLowerCase()) ||
                d.state.toLowerCase().includes(this.searchTerm.toLowerCase());

            return matchesStatus && matchesSearch;
        });
    }

    toggleRow(id: string) {
        this.expandedRowId = this.expandedRowId === id ? null : id;
    }

    openEditModal(distributor: DistributorSubmission) {
        this.editingDistributor = distributor;
        this.editForm = {
            status: distributor.status || 'new',
            notes: distributor.notes || ''
        };
        this.showEditModal = true;
    }

    closeEditModal() {
        this.showEditModal = false;
        this.editingDistributor = null;
    }

    async saveEdit() {
        if (!this.editingDistributor) return;

        try {
            const user = await this.authService.user$.pipe(
                map(u => u?.email || 'Unknown')
            ).toPromise();

            await this.distributorService.updateStatus(
                this.editingDistributor.id,
                this.editForm.status,
                this.editForm.notes,
                user
            );

            this.toast.success('Lead updated successfully');
            this.closeEditModal();
            this.loadDistributors();
        } catch (error) {
            console.error('Error updating lead:', error);
            this.toast.error('Failed to update lead');
        }
    }

    async quickStatusChange(distributor: DistributorSubmission, newStatus: string) {
        try {
            const user = await this.authService.user$.pipe(
                map(u => u?.email || 'Unknown')
            ).toPromise();

            await this.distributorService.updateStatus(
                distributor.id,
                newStatus,
                distributor.notes,
                user
            );

            this.toast.success('Status updated');
            this.loadDistributors();
        } catch (error) {
            console.error('Error updating status:', error);
            this.toast.error('Failed to update status');
        }
    }

    exportToCSV() {
        const headers = ['Date', 'Name', 'Business', 'Email', 'Phone', 'State', 'Volume', 'Status', 'Comments', 'Notes'];
        const rows = this.filteredDistributors.map(d => [
            d.createdAt.toLocaleDateString(),
            d.name,
            d.business,
            d.email,
            d.phone,
            d.state,
            d.volume,
            d.status || 'new',
            d.comments,
            d.notes || ''
        ]);

        const csvContent = [
            headers.join(','),
            ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
        ].join('\n');

        const blob = new Blob([csvContent], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `distributor-leads-${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
        window.URL.revokeObjectURL(url);

        this.toast.success('Exported to CSV');
    }

    getStatusBadgeClass(status?: string): string {
        switch (status) {
            case 'new': return 'badge-new';
            case 'contacted': return 'badge-contacted';
            case 'pending': return 'badge-pending';
            case 'converted': return 'badge-converted';
            case 'rejected': return 'badge-rejected';
            default: return 'badge-new';
        }
    }

    getStatusCount(status: string): number {
        if (status === 'all') return this.distributors.length;
        return this.distributors.filter(d => d.status === status).length;
    }
}
