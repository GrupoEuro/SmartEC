import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AppIconComponent } from '../../../../../shared/components/app-icon/app-icon.component';

@Component({
    selector: 'app-bulk-edit-dialog',
    standalone: true,
    imports: [CommonModule, FormsModule, AppIconComponent],
    template: `
    <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div class="bg-slate-900 border border-white/10 rounded-xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200">
        
        <!-- Header -->
        <div class="px-6 py-4 border-b border-white/5 flex items-center justify-between bg-white/5">
          <h2 class="text-lg font-semibold text-white flex items-center gap-2">
            <app-icon name="edit" [size]="20" class="text-indigo-400"></app-icon>
            Bulk Edit Assets
          </h2>
          <button (click)="close.emit()" class="text-slate-400 hover:text-white transition-colors">
            <app-icon name="x" [size]="20"></app-icon>
          </button>
        </div>

        <!-- Body -->
        <div class="p-6 space-y-6">
          <p class="text-slate-400 text-sm">
            Updating metadata for <span class="text-white font-semibold">{{ selectedCount }}</span> selected assets.
            Leave fields empty to keep existing values.
          </p>

          <!-- Type (Category) -->
          <div class="space-y-2">
            <label class="text-xs font-semibold text-slate-400 uppercase tracking-wider">Category / Folder</label>
            <select [(ngModel)]="category" 
                    class="w-full bg-black/20 border border-white/10 rounded-lg px-4 py-2.5 text-slate-200 focus:outline-none focus:border-indigo-500 hover:border-white/20 transition-colors appearance-none">
              <option value="">Keep Original Category</option>
              <option *ngFor="let cat of CATEGORIES" [value]="cat.id">{{ cat.label }}</option>
            </select>
          </div>

          <!-- Tags -->
          <div class="space-y-2">
            <label class="text-xs font-semibold text-slate-400 uppercase tracking-wider">Tags (comma separated)</label>
            <input type="text" [(ngModel)]="tagsInput" placeholder="e.g. summer, campaign, 2024"
                   class="w-full bg-black/20 border border-white/10 rounded-lg px-4 py-2.5 text-slate-200 focus:outline-none focus:border-indigo-500 transition-colors placeholder:text-slate-600">
            <p class="text-[10px] text-slate-500">Note: This will <span class="text-orange-400">overwrite</span> existing tags.</p>
          </div>
        </div>

        <!-- Footer -->
        <div class="px-6 py-4 bg-slate-950/50 border-t border-white/5 flex justify-end gap-3">
          <button (click)="close.emit()" 
                  class="px-4 py-2 text-sm font-medium text-slate-400 hover:text-white transition-colors">
            Cancel
          </button>
          <button (click)="onSave()" 
                  class="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded-lg transition-colors shadow-lg shadow-indigo-500/20">
            Update Assets
          </button>
        </div>
      </div>
    </div>
  `
})
export class BulkEditDialogComponent {
    @Input() selectedCount = 0;
    @Output() close = new EventEmitter<void>();
    @Output() save = new EventEmitter<{ tags?: string[], category?: string }>();

    category = '';
    tagsInput = '';

    readonly CATEGORIES = [
        { id: 'products', label: 'Products' },
        { id: 'banners', label: 'Banners' },
        { id: 'site-assets', label: 'Site Assets' },
        { id: 'documents', label: 'Documents' },
        { id: 'blog', label: 'Blog' },
        { id: 'icons', label: 'Icons' }
    ];

    onSave() {
        const changes: { tags?: string[], category?: string } = {};

        if (this.category) {
            changes.category = this.category;
        }

        if (this.tagsInput.trim()) {
            changes.tags = this.tagsInput.split(',').map(t => t.trim()).filter(Boolean);
        }

        this.save.emit(changes);
    }
}
