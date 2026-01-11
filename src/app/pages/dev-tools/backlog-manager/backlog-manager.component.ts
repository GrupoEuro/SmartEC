import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';
import { AppIconComponent } from '../../../shared/components/app-icon/app-icon.component';
import { BacklogListComponent } from './backlog-list/backlog-list.component';
import { BacklogFormComponent } from './backlog-form/backlog-form.component';
import { BacklogService } from '../../../core/services/backlog.service';
import { BacklogItem } from '../../../core/models/backlog.model';

@Component({
    selector: 'app-backlog-manager',
    standalone: true,
    imports: [CommonModule, TranslateModule, AppIconComponent, BacklogListComponent, BacklogFormComponent],
    templateUrl: './backlog-manager.component.html',
    styleUrls: ['./backlog-manager.component.css']
})
export class BacklogManagerComponent {
    private backlogService = inject(BacklogService);

    isFormOpen = signal(false);
    editingItem = signal<BacklogItem | null>(null);

    openCreateForm() {
        this.editingItem.set(null);
        this.isFormOpen.set(true);
    }

    openEditForm(item: BacklogItem) {
        this.editingItem.set(item);
        this.isFormOpen.set(true);
    }

    closeForm() {
        this.isFormOpen.set(false);
        this.editingItem.set(null);
    }

    handleSave() {
        this.closeForm();
        // List component streams updates automatically
    }
}
