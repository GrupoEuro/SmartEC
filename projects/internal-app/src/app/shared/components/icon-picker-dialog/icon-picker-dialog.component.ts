import { Component, EventEmitter, Output, computed, signal, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ICONS } from '../app-icon/icons';
import { AppIconComponent } from '../app-icon/app-icon.component';

@Component({
  selector: 'app-icon-picker-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, AppIconComponent],
  template: `
    <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" (click)="close.emit()">
      <div class="bg-slate-900 border border-slate-700/50 rounded-xl shadow-2xl w-full max-w-xl max-h-[60vh] flex flex-col overflow-hidden" (click)="$event.stopPropagation()">
        
        <!-- Header -->
        <div class="p-4 border-b border-white/10 flex items-center justify-between bg-white/5">
          <h3 class="text-lg font-semibold text-white">Select Icon</h3>
          <button (click)="close.emit()" class="text-slate-400 hover:text-white transition-colors">
            <app-icon name="x" [size]="20"></app-icon>
          </button>
        </div>

        <!-- Search -->
        <div class="p-4 border-b border-white/5 bg-slate-800/50">
          <div class="relative">
            <span class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
              <app-icon name="search" [size]="18"></app-icon>
            </span>
            <input 
              type="text" 
              [(ngModel)]="searchQuery"
              placeholder="Search icons..." 
              class="w-full bg-slate-950 border border-slate-700 rounded-lg py-2.5 pl-10 pr-4 text-white placeholder-slate-500 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-all"
              autoFocus
            >
          </div>
        </div>

        <!-- Grid -->
        <div class="flex-1 overflow-y-auto p-4 custom-scrollbar">
          <div class="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-2">
            @for (icon of filteredIcons(); track icon) {
              <button 
                (click)="selectIcon(icon)"
                class="aspect-square flex flex-col items-center justify-center gap-2 p-2 rounded-lg border border-transparent hover:bg-blue-500/10 hover:border-blue-500/30 text-slate-400 hover:text-blue-400 transition-all group"
                [title]="icon"
              >
                <div class="group-hover:scale-110 transition-transform">
                    <app-icon [name]="icon" [size]="24"></app-icon>
                </div>
                <span class="text-[10px] truncate w-full text-center opacity-70 group-hover:opacity-100">{{ icon }}</span>
              </button>
            }
          </div>
          
          @if (filteredIcons().length === 0) {
            <div class="flex flex-col items-center justify-center py-12 text-slate-500">
                <app-icon name="search" [size]="48" class="mb-4 opacity-20"></app-icon>
                <p>No icons found for "{{ searchQuery() }}"</p>
            </div>
          }
        </div>

        <!-- Footer -->
        <div class="p-3 bg-slate-950 text-right text-xs text-slate-500 border-t border-white/5">
            {{ filteredIcons().length }} icons available
        </div>
      </div>
    </div>
  `,
  styles: [`
    .custom-scrollbar::-webkit-scrollbar {
      width: 6px;
    }
    .custom-scrollbar::-webkit-scrollbar-track {
      background: rgba(255, 255, 255, 0.02);
    }
    .custom-scrollbar::-webkit-scrollbar-thumb {
      background: rgba(255, 255, 255, 0.1);
      border-radius: 3px;
    }
    .custom-scrollbar::-webkit-scrollbar-thumb:hover {
        background: rgba(255, 255, 255, 0.2);
    }
  `]
})
export class IconPickerDialogComponent {
  @Output() iconSelected = new EventEmitter<string>();
  @Output() close = new EventEmitter<void>();

  searchQuery = signal('');

  // Get all icon keys from the ICONS constant
  allIcons = Object.keys(ICONS);

  filteredIcons = computed(() => {
    const query = this.searchQuery().toLowerCase();
    if (!query) return this.allIcons;
    return this.allIcons.filter(icon => icon.toLowerCase().includes(query));
  });

  selectIcon(icon: string) {
    this.iconSelected.emit(icon);
  }

  @HostListener('document:keydown.escape')
  onEscape() {
    this.close.emit();
  }
}
