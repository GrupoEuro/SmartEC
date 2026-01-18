import { Component, EventEmitter, Input, OnInit, Output, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MediaFolder } from '../../../../../core/models/media.model';
import { MediaService } from '../../../../../core/services/media.service';
import { AppIconComponent } from '../../../../../shared/components/app-icon/app-icon.component';
import { FormsModule } from '@angular/forms';

@Component({
    selector: 'app-folder-tree',
    standalone: true,
    imports: [CommonModule, AppIconComponent, FormsModule],
    template: `
    <div class="folder-tree pl-2">
       <!-- Root Create Action (Only shown at top level if desired, or handled by parent) -->
       
       <div *ngFor="let folder of folders()" class="folder-node">
          <div 
            class="flex items-center gap-2 p-1.5 rounded-lg cursor-pointer transition-colors group relative"
            [class.bg-indigo-50]="selectedFolderId === folder.id"
            [class.text-indigo-700]="selectedFolderId === folder.id"
            [class.text-slate-600]="selectedFolderId !== folder.id"
            [class.hover:bg-slate-100]="selectedFolderId !== folder.id"
            (click)="selectFolder(folder)"
            (contextmenu)="onContextMenu($event, folder)">
            
            <!-- Expand Toggle -->
            <button 
                (click)="$event.stopPropagation(); toggleExpand(folder)"
                class="p-0.5 rounded hover:bg-black/5 text-slate-400">
                <app-icon [name]="isExpanded(folder) ? 'chevron_down' : 'chevron_right'" [size]="14"></app-icon>
            </button>

            <!-- Icon -->
            <div class="relative">
                 <app-icon [name]="selectedFolderId === folder.id ? 'folder_open' : 'folder'" [size]="18"
                 [class.text-indigo-500]="selectedFolderId === folder.id"
                 [class.text-slate-400]="selectedFolderId !== folder.id"></app-icon>
            </div>

            <span class="text-sm font-medium truncate select-none">{{ folder.name }}</span>
            
            <!-- Quick Add Subfolder (Hover) -->
            <button (click)="$event.stopPropagation(); promptCreateFolder(folder)"
                class="ml-auto opacity-0 group-hover:opacity-100 p-1 hover:bg-indigo-100 text-indigo-600 rounded"
                title="New Subfolder">
                <app-icon name="plus" [size]="12"></app-icon>
            </button>
          </div>

          <!-- Recursive Children -->
          <div *ngIf="isExpanded(folder)" class="border-l border-slate-200 ml-4 mt-1">
             <app-folder-tree 
                [parentId]="folder.id || null" 
                [selectedFolderId]="selectedFolderId"
                (folderSelected)="onChildFolderSelected($event)">
             </app-folder-tree>
          </div>
       </div>

       <!-- Loading State -->
       <div *ngIf="isLoading()" class="pl-6 py-2">
          <div class="h-4 w-24 bg-slate-100 rounded animate-pulse"></div>
       </div>
       
       <!-- Empty State (No subfolders) -->
       <div *ngIf="!isLoading() && folders().length === 0 && parentId" class="pl-6 py-2 text-xs text-slate-400 italic">
          Empty
       </div>
    </div>
  `
})
export class FolderTreeComponent implements OnInit {
    private mediaService = inject(MediaService);

    @Input() parentId: string | null = null;
    @Input() selectedFolderId: string | undefined = undefined;

    @Output() folderSelected = new EventEmitter<MediaFolder>();

    folders = signal<MediaFolder[]>([]);
    expandedFolders = signal<Set<string>>(new Set());
    isLoading = signal(false);

    ngOnInit() {
        this.loadFolders();
    }

    loadFolders() {
        this.isLoading.set(true);
        this.mediaService.getFoldersDisplay(this.parentId).subscribe({
            next: (folders) => {
                this.folders.set(folders);
                this.isLoading.set(false);
            },
            error: (e) => this.isLoading.set(false)
        });
    }

    toggleExpand(folder: MediaFolder) {
        if (!folder.id) return;
        const current = new Set(this.expandedFolders());
        if (current.has(folder.id)) {
            current.delete(folder.id);
        } else {
            current.add(folder.id);
        }
        this.expandedFolders.set(current);
    }

    isExpanded(folder: MediaFolder): boolean {
        return !!folder.id && this.expandedFolders().has(folder.id);
    }

    selectFolder(folder: MediaFolder) {
        this.toggleExpand(folder); // Auto expand on click? maybe just select
        this.folderSelected.emit(folder);
    }

    onChildFolderSelected(folder: MediaFolder) {
        this.folderSelected.emit(folder);
    }

    async promptCreateFolder(parent: MediaFolder) {
        // Simple prompt for now, could be a dialog
        const name = prompt(`Create subfolder in "${parent.name}":`);
        if (name && name.trim()) {
            const path = parent.path ? `${parent.path}/${name}` : name;
            await this.mediaService.createFolder(name, parent.id, path);
            // Reload current level to see validation if we were doing real-time, 
            // but since we are recursively rendering, the CHILD tree needs to reload.
            // Actually, we called create on the service. 
            // The child component (if it exists) needs to reload.
            // We can just force expand the parent which triggers the ngIf.
            if (parent.id && !this.expandedFolders().has(parent.id)) {
                this.toggleExpand(parent);
            } else {
                // If already expanded, we might need a signal to trigger reload in child. 
                // For MVP, simplistic "toggle collapse/expand" refreshes it because it destroys the component.
                if (parent.id) {
                    this.expandedFolders.update(s => {
                        const n = new Set(s);
                        n.delete(parent.id!);
                        return n;
                    });
                    setTimeout(() => this.toggleExpand(parent), 50);
                }
            }
        }
    }

    onContextMenu(event: MouseEvent, folder: MediaFolder) {
        event.preventDefault();
        // TODO: Implement Context Menu (Rename, Delete)
        console.log('Right clicked', folder);
    }
}
