import { Component, EventEmitter, Input, Output, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MediaService } from '../../../../../core/services/media.service';
import { MediaAsset, MediaFolder } from '../../../../../core/models/media.model';
import { FolderTreeComponent } from '../folder-tree/folder-tree.component';
import { AppIconComponent } from '../../../../../shared/components/app-icon/app-icon.component';

@Component({
    selector: 'app-move-assets-dialog',
    standalone: true,
    imports: [CommonModule, FolderTreeComponent, AppIconComponent],
    template: `
    <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
        <div class="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col max-h-[80vh]">
            
            <!-- Header -->
            <div class="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                <div>
                    <h3 class="font-semibold text-slate-800">Move Assets</h3>
                    <p class="text-xs text-slate-500">Select destination for {{ assets.length }} item(s)</p>
                </div>
                <button (click)="cancel.emit()" class="text-slate-400 hover:text-slate-600 transition-colors">
                    <app-icon name="x_mark" [size]="20"></app-icon>
                </button>
            </div>

            <!-- Body -->
            <div class="flex-1 overflow-y-auto p-4 custom-scrollbar">
                
                <!-- Root Option -->
                <button (click)="selectRoot()" 
                    class="w-full flex items-center gap-2 p-2 rounded-lg transition-colors mb-2 text-sm font-medium"
                    [class.bg-indigo-50]="selectedFolderId() === null"
                    [class.text-indigo-700]="selectedFolderId() === null"
                    [class.text-slate-600]="selectedFolderId() !== null"
                    [class.hover:bg-slate-50]="selectedFolderId() !== null">
                    <app-icon name="home" [size]="16"></app-icon>
                    <span>Home (Root)</span>
                    <app-icon *ngIf="selectedFolderId() === null" name="check" [size]="14" class="ml-auto"></app-icon>
                </button>

                <!-- Tree -->
                <div class="border-t border-slate-100 pt-2">
                    <p class="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 px-2">Folders</p>
                    <app-folder-tree 
                        [selectedFolderId]="selectedFolderId() || undefined"
                        (folderSelected)="onFolderSelected($event)">
                    </app-folder-tree>
                </div>
            </div>

            <!-- Footer -->
            <div class="p-4 border-t border-slate-100 bg-slate-50/50 flex justify-end gap-2">
                <button (click)="cancel.emit()" 
                    class="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors">
                    Cancel
                </button>
                <button (click)="confirmMove()" 
                    [disabled]="isLoading()"
                    class="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-sm transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed">
                    <span *ngIf="isLoading()" class="animate-spin w-3 h-3 border-2 border-white/30 border-t-white rounded-full"></span>
                    <span>{{ isLoading() ? 'Moving...' : 'Move Here' }}</span>
                </button>
            </div>
        </div>
    </div>
  `,
    styles: [`
    .custom-scrollbar::-webkit-scrollbar { width: 6px; }
    .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
    .custom-scrollbar::-webkit-scrollbar-thumb { background-color: #e2e8f0; border-radius: 3px; }
  `]
})
export class MoveAssetsDialogComponent {
    private mediaService = inject(MediaService);

    @Input() assets: MediaAsset[] = [];
    @Output() close = new EventEmitter<boolean>(); // true if moved
    @Output() cancel = new EventEmitter<void>();

    selectedFolderId = signal<string | null>(null);
    isLoading = signal(false);

    selectRoot() {
        this.selectedFolderId.set(null);
    }

    onFolderSelected(folder: MediaFolder) {
        this.selectedFolderId.set(folder.id || null);
    }

    async confirmMove() {
        if (this.isLoading()) return;

        this.isLoading.set(true);
        const ids = this.assets.map(a => a.id!);
        const targetId = this.selectedFolderId();

        try {
            await this.mediaService.moveAssets(ids, targetId);
            this.close.emit(true);
        } catch (e) {
            console.error('Failed to move assets', e);
            alert('Failed to move assets');
            this.isLoading.set(false);
        }
    }
}
