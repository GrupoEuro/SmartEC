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
    <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
        <div class="bg-slate-900 border border-white/10 rounded-xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col max-h-[80vh] animate-in zoom-in-95 duration-200">
            
            <!-- Header -->
            <div class="px-6 py-4 border-b border-white/5 flex items-center justify-between bg-white/5">
                <div>
                    <h3 class="font-semibold text-white flex items-center gap-2">
                        <app-icon name="folder_move" [size]="20" class="text-indigo-400"></app-icon>
                        Move Assets
                    </h3>
                    <p class="text-xs text-slate-400 mt-0.5">Select destination for <span class="text-slate-200 font-medium">{{ assets.length }}</span> item(s)</p>
                </div>
                <button (click)="cancel.emit()" class="text-slate-400 hover:text-white transition-colors">
                    <app-icon name="x" [size]="20"></app-icon>
                </button>
            </div>

            <!-- Body -->
            <div class="flex-1 overflow-y-auto p-4 custom-scrollbar">
                
                <!-- Root Option -->
                <button (click)="selectRoot()" 
                    class="w-full flex items-center gap-3 p-3 rounded-lg transition-all mb-2 text-sm font-medium border border-transparent"
                    [class.bg-indigo-500_10]="selectedFolderId() === null"
                    [class.border-indigo-500_30]="selectedFolderId() === null"
                    [class.text-indigo-400]="selectedFolderId() === null"
                    [class.text-slate-300]="selectedFolderId() !== null"
                    [class.hover:bg-white_05]="selectedFolderId() !== null"
                    [class.hover:text-white]="selectedFolderId() !== null">
                    <app-icon name="home" [size]="18"></app-icon>
                    <span>Home (Root)</span>
                    <app-icon *ngIf="selectedFolderId() === null" name="check" [size]="16" class="ml-auto text-indigo-400"></app-icon>
                </button>

                <!-- Tree -->
                <div class="border-t border-white/5 pt-4 mt-2">
                    <p class="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3 px-2">Folders</p>
                    <app-folder-tree 
                        [selectedFolderId]="selectedFolderId() || undefined"
                        (folderSelected)="onFolderSelected($event)">
                    </app-folder-tree>
                </div>
            </div>

            <!-- Footer -->
            <div class="px-6 py-4 bg-slate-950/50 border-t border-white/5 flex justify-end gap-3">
                <button (click)="cancel.emit()" 
                    class="px-4 py-2 text-sm font-medium text-slate-400 hover:text-white transition-colors hover:bg-white/5 rounded-lg">
                    Cancel
                </button>
                <button (click)="confirmMove()" 
                    [disabled]="isLoading()"
                    class="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg shadow-lg shadow-indigo-500/20 transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed">
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
    .custom-scrollbar::-webkit-scrollbar-thumb { background-color: #334155; border-radius: 3px; }
    .custom-scrollbar::-webkit-scrollbar-thumb:hover { background-color: #475569; }
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
