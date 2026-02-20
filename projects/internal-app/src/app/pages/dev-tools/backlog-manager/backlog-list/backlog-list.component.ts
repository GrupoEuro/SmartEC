import { Component, EventEmitter, inject, Output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';
import { AppIconComponent } from '../../../../shared/components/app-icon/app-icon.component';
import { BacklogService } from '../../../../core/services/backlog.service';
import { BacklogItem } from '../../../../core/models/backlog.model';
import { toSignal } from '@angular/core/rxjs-interop';

@Component({
    selector: 'app-backlog-list',
    standalone: true,
    imports: [CommonModule, TranslateModule, AppIconComponent],
    templateUrl: './backlog-list.component.html',
    styleUrls: ['./backlog-list.component.css']
})
export class BacklogListComponent {
    private backlogService = inject(BacklogService);

    items = toSignal(this.backlogService.getBacklogItems(), { initialValue: [] });

    @Output() editItem = new EventEmitter<BacklogItem>();

    getPriorityColor(priority: string): string {
        switch (priority) {
            case 'critical': return 'bg-red-500/20 text-red-500 border-red-500/30';
            case 'high': return 'bg-orange-500/20 text-orange-500 border-orange-500/30';
            case 'medium': return 'bg-blue-500/20 text-blue-500 border-blue-500/30';
            default: return 'bg-zinc-500/20 text-zinc-500 border-zinc-500/30';
        }
    }

    getTypeIcon(type: string): string {
        switch (type) {
            case 'bug': return 'alert-circle';
            case 'feature': return 'star';
            case 'task': return 'check-square';
            case 'improvement': return 'trending-up';
            default: return 'file-text';
        }
    }

    onEdit(item: BacklogItem) {
        this.editItem.emit(item);
    }

    async onDelete(id: string) {
        if (confirm('Are you sure?')) {
            await this.backlogService.deleteItem(id);
        }
    }
}
