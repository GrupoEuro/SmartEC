import { Component, EventEmitter, Input, Output, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MediaAsset } from '../../../../../core/models/media.model';
import { MediaService } from '../../../../../core/services/media.service';
import { AppIconComponent } from '../../../../../shared/components/app-icon/app-icon.component';

@Component({
    selector: 'app-edit-media-dialog',
    standalone: true,
    imports: [CommonModule, FormsModule, AppIconComponent],
    template: `
    <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
        <div class="bg-white rounded-xl shadow-2xl w-full max-w-lg overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <!-- Header -->
            <div class="flex justify-between items-center p-4 border-b border-slate-100 bg-slate-50/50">
                <h3 class="text-lg font-semibold text-slate-800">Edit Asset</h3>
                <button (click)="cancel.emit()" class="text-slate-400 hover:text-slate-600 transition-colors">
                    <app-icon name="x" [size]="20"></app-icon>
                </button>
            </div>

            <!-- Body -->
            <div class="p-6 space-y-4">
                <!-- Preview -->
                <div class="flex justify-center mb-6">
                    <div class="h-32 w-32 rounded-lg bg-slate-100 border border-slate-200 overflow-hidden relative">
                        <img [src]="asset.publicUrl" class="w-full h-full object-contain">
                    </div>
                </div>

                <!-- Asset Details -->
                <div class="grid grid-cols-2 gap-4 p-3 bg-slate-50 rounded-lg border border-slate-100 text-xs">
                    <div>
                        <span class="block text-slate-400 font-semibold uppercase tracking-wider mb-0.5">Dimensions</span>
                        <span class="text-slate-700 font-mono">{{ asset.metadata.width }} x {{ asset.metadata.height }}</span>
                    </div>
                    <div>
                        <span class="block text-slate-400 font-semibold uppercase tracking-wider mb-0.5">File Size</span>
                        <span class="text-slate-700 font-mono">{{ (asset.size / 1024).toFixed(1) }} KB</span>
                    </div>
                    <div>
                        <span class="block text-slate-400 font-semibold uppercase tracking-wider mb-0.5">Type</span>
                        <span class="text-slate-700 font-mono">{{ asset.contentType }}</span>
                    </div>
                    <div>
                        <span class="block text-slate-400 font-semibold uppercase tracking-wider mb-0.5">Uploaded</span>
                         <!-- Using a pipe would be better but keeping it simple for now -->
                        <span class="text-slate-700">{{ formatDate(asset.createdAt) }}</span>
                    </div>
                </div>

                <!-- Fields -->
                <div class="space-y-4">
                    <!-- Category -->
                    <div>
                        <label class="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Category</label>
                        <select [(ngModel)]="formData.category" 
                                class="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm text-slate-700 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-shadow">
                            <option *ngFor="let cat of categories" [value]="cat.id">{{ cat.label }}</option>
                        </select>
                    </div>

                    <!-- Alt Text -->
                    <div>
                        <label class="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Alt Text</label>
                        <input type="text" [(ngModel)]="formData.altText" 
                               class="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm text-slate-700 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-shadow">
                    </div>

                    <!-- Tags (Chips) -->
                    <div>
                        <label class="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Tags</label>
                        <div class="w-full min-h-[42px] px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm flex flex-wrap gap-2 focus-within:ring-2 focus-within:ring-indigo-500 focus-within:border-indigo-500 transition-shadow">
                             <span *ngFor="let tag of formData.tags; let i = index" 
                                   class="bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full text-xs font-medium flex items-center gap-1">
                                 #{{ tag }}
                                 <button (click)="removeTag(i)" class="hover:text-indigo-900 rounded-full p-0.5">
                                     <app-icon name="x" [size]="12"></app-icon>
                                 </button>
                             </span>
                             <input type="text" [(ngModel)]="tagInput" 
                                    (keydown.enter)="addTag()"
                                    (keydown.backspace)="onBackspace()"
                                    class="flex-1 bg-transparent border-none p-0 focus:ring-0 text-sm placeholder-slate-400 min-w-[60px]"
                                    placeholder="Add tag...">
                        </div>
                        <p class="text-[10px] text-slate-400 mt-1">Press Enter to add tags</p>
                    </div>
                </div>
            </div>

            <!-- Footer -->
            <div class="p-4 bg-slate-50 border-t border-slate-200 flex justify-end gap-3">
                <button (click)="cancel.emit()" 
                        class="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">
                    Cancel
                </button>
                <button (click)="save()" [disabled]="isSaving()"
                        class="px-6 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-sm shadow-indigo-500/20 disabled:opacity-70 disabled:cursor-not-allowed flex items-center gap-2">
                    <span *ngIf="isSaving()" class="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                    <span *ngIf="!isSaving()">Save Changes</span>
                </button>
            </div>
        </div>
    </div>
  `
})
export class EditMediaDialogComponent {
    @Input({ required: true }) asset!: MediaAsset;
    @Input() categories: { id: string, label: string }[] = [];
    @Output() saveComplete = new EventEmitter<void>();
    @Output() cancel = new EventEmitter<void>();

    private mediaService = inject(MediaService);

    formData = {
        category: '',
        altText: '',
        tags: [] as string[]
    };
    tagInput = '';

    isSaving = signal(false);

    ngOnInit() {
        this.formData = {
            category: this.asset.metadata.category,
            altText: this.asset.metadata.altText || '',
            tags: this.asset.metadata.tags ? [...this.asset.metadata.tags] : []
        };
    }

    addTag() {
        if (this.tagInput.trim()) {
            this.formData.tags.push(this.tagInput.trim());
            this.tagInput = '';
        }
    }

    removeTag(index: number) {
        this.formData.tags.splice(index, 1);
    }

    onBackspace() {
        if (!this.tagInput && this.formData.tags.length > 0) {
            this.formData.tags.pop();
        }
    }

    async save() {
        if (this.isSaving()) return;
        this.isSaving.set(true);

        try {
            await this.mediaService.updateMetadata(this.asset.id!, {
                category: this.formData.category,
                altText: this.formData.altText,
                tags: this.formData.tags
            });

            this.saveComplete.emit();
        } catch (error) {
            console.error('Failed to update asset', error);
            alert('Failed to update asset. Please try again.');
        } finally {
            this.isSaving.set(false);
        }
    }

    formatDate(date: any): string {
        if (!date) return '-';
        // Handle Firestore Timestamp
        const d = date.toDate ? date.toDate() : new Date(date);
        return d.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    }
}
