import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ICONS } from '../../../shared/components/app-icon/icons';
import { AppIconComponent } from '../../../shared/components/app-icon/app-icon.component';
import { FormsModule } from '@angular/forms';
import { ICON_DATA } from './icon-data';
import { ToastService } from '../../../core/services/toast.service';

type IconGroup = 'all' | 'modules' | 'kpis' | 'actions' | 'navigation' | 'status' | 'unused';

@Component({
  selector: 'app-icon-library',
  standalone: true,
  imports: [CommonModule, AppIconComponent, FormsModule],
  styleUrls: ['./icon-library.component.css'],
  template: `
    <div class="library-container">
      <!-- Header / Playground -->
      <div class="library-header glass-panel">
        <div class="header-top">
            <div class="header-content">
                <h1 class="page-title">Icon Library</h1>
                <p class="page-subtitle">
                    Detected <strong>{{stats.used}}</strong> used icons and 
                    <strong>{{stats.unused}}</strong> unused icons in the codebase.
                </p>
            </div>
            
            <!-- Playground Controls -->
            <div class="playground-controls">
                <div class="control-group">
                    <label>Preview Size: {{playgroundSize()}}px</label>
                    <input type="range" min="16" max="64" step="4" 
                        [ngModel]="playgroundSize()" (ngModelChange)="playgroundSize.set($event)">
                </div>
                <div class="control-group">
                    <label>Color</label>
                    <input type="color" [ngModel]="playgroundColor()" (ngModelChange)="playgroundColor.set($event)">
                </div>
            </div>
        </div>

        <div class="search-bar">
            <div class="search-wrapper">
                <app-icon name="search" [size]="18" class="search-icon"></app-icon>
                <input 
                    type="text" 
                    [(ngModel)]="searchTerm"
                    placeholder="Search icons (e.g. 'user', 'chart')..." 
                    class="search-input"
                >
            </div>
        </div>
        
        <!-- Category Tabs -->
        <div class="category-tabs">
            <button *ngFor="let cat of categories" 
                class="tab-btn" 
                [class.active]="currentCategory() === cat.id"
                (click)="currentCategory.set(cat.id)">
                {{cat.label}} 
                <span class="count-badge">{{cat.count}}</span>
            </button>
        </div>
      </div>

      <!-- Icon Grid -->
      <div class="icon-grid">
        <div *ngFor="let icon of filteredIcons()" 
             class="icon-card glass-panel"
             [class.expanded]="expandedIcon() === icon.name"
             (click)="toggleExpand(icon.name)">
             
          <!-- Usage Badge -->
          <span class="usage-badge" 
                [class.has-usage]="getUsageCount(icon.name) > 0"
                [class.zero-usage]="getUsageCount(icon.name) === 0">
            {{getUsageCount(icon.name)}}
          </span>
          
          <div class="icon-preview" [style.color]="playgroundColor()">
             <app-icon [name]="icon.name" [size]="playgroundSize()"></app-icon>
          </div>
          
          <div class="icon-info">
             <div class="icon-name" [title]="icon.name">{{icon.name}}</div>
             
             <!-- Badges -->
             <div class="icon-badges">
                <span *ngIf="isUnused(icon.name)" class="badge unused">Unused</span>
             </div>
          </div>
          
          <!-- Expanded Details -->
          <div class="icon-details" *ngIf="expandedIcon() === icon.name">
            <div class="actions-row">
                <button class="btn-copy" (click)="copyName(icon.name); $event.stopPropagation()">
                    <app-icon name="copy" [size]="14"></app-icon> Name
                </button>
                <button class="btn-copy" (click)="copyComponent(icon.name); $event.stopPropagation()">
                    <app-icon name="code" [size]="14"></app-icon> Component
                </button>
            </div>

            <div class="usage-list-container">
                <div class="usage-label">Found in:</div>
                <ul class="usage-list" *ngIf="getUsage(icon.name).length > 0; else noUsage">
                    <li *ngFor="let file of getUsage(icon.name)">{{ formatPath(file) }}</li>
                </ul>
                <ng-template #noUsage>
                    <div class="no-usage">No direct usages detected in templates/ts files.</div>
                </ng-template>
            </div>
          </div>
        </div>
      </div>
      
      <!-- Empty State -->
      <div *ngIf="filteredIcons().length === 0" class="empty-state">
        <app-icon name="search" [size]="48"></app-icon>
        <h3>No icons found</h3>
        <p>Try adjusting your search or category filter.</p>
      </div>
    </div>
  `
})
export class IconLibraryComponent {
  private toast = inject(ToastService);

  // Signals
  searchTerm = signal('');
  currentCategory = signal<IconGroup>('all');
  playgroundSize = signal(32);
  playgroundColor = signal('#cbd5e1'); // slate-300 for dark mode contrast
  expandedIcon = signal<string | null>(null);

  // Data
  stats = ICON_DATA.stats;

  categories: { id: IconGroup, label: string, count: number }[] = [
    { id: 'all', label: 'All Icons', count: this.stats.total },
    { id: 'modules', label: 'Modules', count: ICON_DATA.categories.modules.length },
    { id: 'kpis', label: 'KPIs', count: ICON_DATA.categories.kpis.length },
    { id: 'actions', label: 'Actions', count: ICON_DATA.categories.actions.length },
    { id: 'navigation', label: 'Navigation', count: ICON_DATA.categories.navigation.length },
    { id: 'status', label: 'Status', count: ICON_DATA.categories.status.length },
    { id: 'unused', label: 'Unused', count: this.stats.unused }
  ];

  // Computed
  filteredIcons = computed(() => {
    const term = this.searchTerm().toLowerCase();
    const category = this.currentCategory();

    let icons = ICON_DATA.defined;

    // Filter by Category
    if (category !== 'all') {
      if (category === 'unused') {
        icons = icons.filter(i => !(ICON_DATA.usage as any)[i]);
      } else {
        // Use the categories map from ICON_DATA
        const catList = (ICON_DATA.categories as any)[category] || [];
        icons = icons.filter(i => catList.includes(i));
      }
    }

    // Filter by Search
    if (term) {
      icons = icons.filter(i => i.includes(term));
    }

    return icons.map(name => ({ name }));
  });

  // Actions
  toggleExpand(name: string) {
    if (this.expandedIcon() === name) {
      this.expandedIcon.set(null);
    } else {
      this.expandedIcon.set(name);
    }
  }

  isUnused(name: string): boolean {
    return !(ICON_DATA.usage as any)[name];
  }

  getUsageCount(name: string): number {
    return (ICON_DATA.usage as any)[name]?.length || 0;
  }

  getUsage(name: string): string[] {
    return (ICON_DATA.usage as any)[name] || [];
  }

  formatPath(path: string): string {
    // Return filename only for cleaner display, or implement relative path logic
    return path.split('/').pop() || path;
  }

  copyName(name: string) {
    navigator.clipboard.writeText(name);
    this.toast.success(`Copied "${name}" to clipboard`);
  }

  copyComponent(name: string) {
    const code = `<app-icon name="${name}" [size]="${this.playgroundSize()}"></app-icon>`;
    navigator.clipboard.writeText(code);
    this.toast.success('Component code copied to clipboard');
  }
}

