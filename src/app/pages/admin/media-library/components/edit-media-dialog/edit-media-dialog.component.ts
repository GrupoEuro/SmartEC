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
    <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200"
         (click)="close.emit()">
        
        <div class="bg-slate-900 border border-white/10 rounded-xl shadow-2xl w-full max-w-5xl h-[80vh] overflow-hidden flex animate-in zoom-in-95 duration-200"
             (click)="$event.stopPropagation()">
            
            <!-- Left: Large Preview (60%) -->
            <div class="flex-1 bg-black/40 relative flex items-center justify-center p-8 border-r border-white/5 overflow-hidden group">
                <!-- Checkered Background -->
                <div class="absolute inset-0 checkered-bg opacity-30 pointer-events-none"></div>

                <img [src]="asset.publicUrl"
                     class="max-w-full max-h-full object-contain shadow-2xl shadow-black/50 rounded pointer-events-none relative z-10 transition-transform duration-500 group-hover:scale-105">

                <div class="absolute bottom-4 left-4 z-20 bg-black/60 backdrop-blur-md px-3 py-1.5 rounded-lg border border-white/10 flex items-center gap-3 text-xs text-slate-300">
                    <div class="flex items-center gap-1.5" *ngIf="asset.metadata.width">
                        <app-icon name="maximize" [size]="12"></app-icon>
                        <span class="font-mono">{{ asset.metadata.width }}x{{ asset.metadata.height }}</span>
                    </div>
                    <div class="w-px h-3 bg-white/20"></div>
                    <span class="font-mono">{{ (asset.size / 1024).toFixed(1) }} KB</span>
                    <div class="w-px h-3 bg-white/20"></div>
                    <span class="uppercase tracking-wider font-bold">{{ asset.contentType.split('/')[1] }}</span>
                </div>
            </div>

            <!-- Right: Metadata Form (40% / 400px fixed) -->
            <div class="w-[400px] flex flex-col bg-slate-900">
                <!-- Header -->
                <div class="flex justify-between items-center px-6 py-5 border-b border-white/5 bg-white/5 shrink-0">
                    <div>
                        <h3 class="text-lg font-semibold text-white flex items-center gap-2">
                             Edit Metadata
                        </h3>
                        <p class="text-xs text-slate-500 mt-0.5 truncate max-w-[280px]" [title]="asset.filename">{{ asset.filename }}</p>
                    </div>
                    <button (click)="close.emit()" class="text-slate-400 hover:text-white transition-colors">
                        <app-icon name="x" [size]="20"></app-icon>
                    </button>
                </div>

                <!-- Form Body -->
                <div class="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
                    
                    <!-- Category -->
                    <div class="space-y-4">
                        <div>
                            <label class="block text-xs font-bold text-slate-400 uppercase tracking-wide mb-2">Destination</label>
                            <select [(ngModel)]="formData.category" 
                                    class="w-full px-4 py-2.5 bg-black/20 border border-white/10 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all appearance-none cursor-pointer hover:bg-black/30">
                                <option *ngFor="let cat of categories" [value]="cat.id">{{ cat.label }}</option>
                            </select>
                        </div>

                        <!-- Alt Text -->
                        <div>
                            <label class="block text-xs font-bold text-slate-400 uppercase tracking-wide mb-2">Alt Text <span class="text-slate-600 font-normal normal-case">(SEO)</span></label>
                            <input type="text" [(ngModel)]="formData.altText" placeholder="Describe the image..."
                                   class="w-full px-4 py-2.5 bg-black/20 border border-white/10 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all placeholder:text-slate-600">
                        </div>

                        <!-- Tags -->
                        <div>
                            <label class="block text-xs font-bold text-slate-400 uppercase tracking-wide mb-2">Tags</label>
                            <div class="w-full min-h-[100px] p-3 bg-black/20 border border-white/10 rounded-lg text-sm flex flex-col gap-2 focus-within:border-indigo-500/50 transition-colors">
                                 
                                 <div class="flex flex-wrap gap-2 mb-2">
                                    <span *ngFor="let tag of formData.tags; let i = index" 
                                          class="bg-indigo-500/10 text-indigo-300 border border-indigo-500/20 px-2.5 py-1 rounded-md text-xs font-medium flex items-center gap-2 group/tag animate-in zoom-in-95 duration-100">
                                        #{{ tag }}
                                        <button (click)="removeTag(i)" class="text-indigo-400/50 hover:text-white transition-colors">
                                            <app-icon name="x" [size]="10"></app-icon>
                                        </button>
                                    </span>
                                 </div>

                                 <input type="text" [(ngModel)]="tagInput" 
                                        (keydown.enter)="addTag()"
                                        (keydown.backspace)="onBackspace()"
                                        class="w-full bg-transparent border-none p-0 focus:ring-0 text-sm text-slate-200 placeholder-slate-600"
                                        placeholder="Type tag and press Enter...">
                            </div>
                        </div>
                    </div>

                    <!-- Info Box -->
                     <div class="p-4 rounded-lg bg-indigo-500/5 border border-indigo-500/10 flex gap-3 items-start">
                        <app-icon name="info" [size]="16" class="text-indigo-400 mt-0.5 shrink-0"></app-icon>
                        <div class="space-y-1">
                            <p class="text-xs text-indigo-200 font-medium">Metadata Tips</p>
                            <p class="text-[10px] text-indigo-300/70 leading-relaxed">
                                Use concise, descriptive tags to improve searchability. Alt text improves accessibility and SEO ranking.
                            </p>
                        </div>
                    </div>

                </div>

                <!-- Footer -->
                <div class="px-6 py-5 bg-slate-950/30 border-t border-white/5 flex gap-3 shrink-0">
                    <button (click)="close.emit()" 
                            class="flex-1 py-2.5 text-sm font-medium text-slate-400 hover:text-white hover:bg-white/5 rounded-lg transition-colors border border-transparent">
                        Cancel
                    </button>
                    <button (click)="save()" [disabled]="isSaving()"
                            class="flex-1 py-2.5 text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg shadow-lg shadow-indigo-500/20 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-all">
                        <span *ngIf="isSaving()" class="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                        <span *ngIf="!isSaving()">Save Changes</span>
                    </button>
                </div>
            </div>
        </div>
    </div>
  `,
    styles: [`
    .checkered-bg {
        background-color: transparent;
        background-image: radial-gradient(#64748b 1px, transparent 1px);
        background-size: 24px 24px;
    }
    .custom-scrollbar::-webkit-scrollbar { width: 4px; }
    .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
    .custom-scrollbar::-webkit-scrollbar-thumb { background-color: #334155; border-radius: 2px; }
    .custom-scrollbar::-webkit-scrollbar-thumb:hover { background-color: #475569; }
  `]
})
export class EditMediaDialogComponent {
    @Input({ required: true }) asset!: MediaAsset;

    // Default categories if none provided
    @Input() categories: { id: string, label: string }[] = [
        { id: 'products', label: 'Products' },
        { id: 'banners', label: 'Banners' },
        { id: 'site-assets', label: 'Site Assets' },
        { id: 'documents', label: 'Documents' },
        { id: 'blog', label: 'Blog' },
        { id: 'icons', label: 'Icons' }
    ];

    @Output() saveComplete = new EventEmitter<void>();
    @Output() close = new EventEmitter<void>(); // Renamed from 'cancel' to 'close' to match standard

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
            category: this.asset.metadata.category || 'site-assets',
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
            // Also emit close for consistent parent handling if they listen to close
        } catch (error) {
            console.error('Failed to update asset', error);
            alert('Failed to update asset. Please try again.');
        } finally {
            this.isSaving.set(false);
        }
    }
}
