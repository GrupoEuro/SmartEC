import { CreateLinkDialogComponent } from './components/create-link-dialog/create-link-dialog.component';

import { SharedLink } from '../../../core/models/shared-link.model';
import { LinkStatsDialogComponent } from './components/link-stats-dialog/link-stats-dialog.component';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MediaUploadComponent } from './components/media-upload/media-upload.component';
import { EditMediaDialogComponent } from './components/edit-media-dialog/edit-media-dialog.component';
import { AppIconComponent } from '../../../shared/components/app-icon/app-icon.component';
import { Component, inject, OnInit, signal } from '@angular/core';
import { MediaAsset, MediaFilter } from '../../../core/models/media.model';
import { MediaService } from '../../../core/services/media.service';
import { BehaviorSubject } from 'rxjs';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';

import { DocumentSharingService } from '../../../core/services/document-sharing.service';

@Component({
  selector: 'app-media-library',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MediaUploadComponent,
    EditMediaDialogComponent,
    CreateLinkDialogComponent,
    LinkStatsDialogComponent,
    AppIconComponent
  ],
  templateUrl: './media-library.component.html',
  styleUrls: ['./media-library.component.css']
})
export class MediaLibraryComponent implements OnInit {
  private mediaService = inject(MediaService);
  private sharingService = inject(DocumentSharingService);

  // ... existing code ...

  editingAsset = signal<MediaAsset | null>(null);
  sharingAsset = signal<MediaAsset | null>(null);
  sharedLinks = signal<SharedLink[]>([]);
  viewingStats = signal<SharedLink | null>(null); // Added

  // ... existing code ...

  shareAsset(asset: MediaAsset) {
    this.sharingAsset.set(asset);
  }

  onShareComplete(slug: string) {
    // Optional: could show toast details here
    this.sharingAsset.set(null);
    // Refresh if in shared links view to show new link
    if (this.selectedCategory() === 'shared-links') {
      this.loadSharedLinks();
    }
  }

  loadSharedLinks() {
    this.isLoading.set(true);
    this.sharingService.getLinks().subscribe({
      next: (links) => {
        this.sharedLinks.set(links);
        this.isLoading.set(false);
      },
      error: (e) => {
        console.error(e);
        this.isLoading.set(false);
      }
    });
  }

  copyLink(url: string) {
    navigator.clipboard.writeText(url);
    // Optional: Toast
  }

  openStats(link: SharedLink) {
    this.viewingStats.set(link);
  }

  // ... existing code ...

  // Strings for UI
  readonly CATEGORIES = [
    { id: 'products', label: 'Products', icon: 'package' },
    { id: 'banners', label: 'Banners', icon: 'layers' },
    { id: 'site-assets', label: 'Site Assets', icon: 'layout' },
    { id: 'documents', label: 'Documents', icon: 'file_text' },
    { id: 'blog', label: 'Blog', icon: 'edit' },
    { id: 'icons', label: 'Icons', icon: 'image' }
  ];

  // State
  filter$ = new BehaviorSubject<MediaFilter>({ limit: 50 });

  // Signals for Data
  assets = signal<MediaAsset[]>([]);
  isLoading = signal(false);
  hasMore = signal(true);
  private lastDoc: any = null;

  selectedCategory = signal<string>('');
  searchQuery = signal<string>('');
  isUploadOpen = signal<boolean>(false);
  viewMode = signal<'grid' | 'list'>('grid');



  // Stats
  storageStats$ = this.mediaService.getStorageStats();

  constructor() {
    // Initial Load
    // We subscribe to filter changes to reset and reload
    this.filter$.pipe(
      debounceTime(300),
      distinctUntilChanged((p, c) => JSON.stringify(p) === JSON.stringify(c))
    ).subscribe(() => {
      this.loadAssets(true);
    });
  }

  ngOnInit() { }

  loadAssets(reset: boolean = false) {
    if (this.isLoading() && !reset) return;

    this.isLoading.set(true);

    if (reset) {
      this.lastDoc = null;
      this.assets.set([]);
      this.hasMore.set(true);
    }

    const filter = this.filter$.value;

    this.mediaService.getAssets(filter, this.lastDoc).subscribe({
      next: (result) => {
        if (reset) {
          this.assets.set(result.assets);
        } else {
          this.assets.update(current => [...current, ...result.assets]);
        }

        this.lastDoc = result.lastDoc;
        this.hasMore.set(result.assets.length === filter.limit); // If we got full page, assume more
        this.isLoading.set(false);
      },
      error: (err) => {
        console.error('Failed to load assets', err);
        this.isLoading.set(false);
      }
    });
  }

  loadMore() {
    if (!this.hasMore() || this.isLoading()) return;
    this.loadAssets(false);
  }

  onCategoryChange(category: string) {
    this.selectedCategory.set(category);
    this.updateFilter();
  }

  onSearch(query: string) {
    this.searchQuery.set(query);
    this.updateFilter();
  }

  // Sort State
  sortField = signal<'createdAt' | 'size' | 'filename'>('createdAt');
  sortDirection = signal<'asc' | 'desc'>('desc');

  onSortChange(field: 'createdAt' | 'size' | 'filename') {
    if (this.sortField() === field) {
      this.sortDirection.update(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      this.sortField.set(field);
      this.sortDirection.set('desc');
    }
    this.updateFilter();
  }

  private updateFilter() {
    const current = this.filter$.value;
    this.filter$.next({
      ...current,
      category: this.selectedCategory() || undefined,
      sortField: this.sortField(),
      sortDirection: this.sortDirection()
      // search: this.searchQuery() || undefined 
    });
  }

  onUploadSuccess(assets: MediaAsset | MediaAsset[]) {
    // Reload to show new assets at top
    // Ideally we just prepend, but for simplicity we reload
    this.updateFilter();
    this.isUploadOpen.set(false);
  }

  toggleUpload() {
    this.isUploadOpen.update(v => !v);
  }

  copyUrl(url: string) {
    navigator.clipboard.writeText(url);
    // TODO: Show toast
  }

  // Selection State
  selectedAssets = signal<Set<string>>(new Set());
  isBulkMode = signal(false);
  bulkTags = '';

  toggleSelection(asset: MediaAsset) {
    const current = new Set(this.selectedAssets());
    if (current.has(asset.id!)) {
      current.delete(asset.id!);
    } else {
      current.add(asset.id!);
    }
    this.selectedAssets.set(current);
    this.isBulkMode.set(current.size > 0);
  }

  selectAll(assets: MediaAsset[]) {
    const allIds = new Set(assets.map(a => a.id!));
    if (this.selectedAssets().size === allIds.size) {
      this.selectedAssets.set(new Set()); // Deselect all
    } else {
      this.selectedAssets.set(allIds);
    }
    this.isBulkMode.set(this.selectedAssets().size > 0);
  }

  async applyBulkTags() {
    if (!this.bulkTags.trim()) return;
    const ids = Array.from(this.selectedAssets());
    const tags = this.bulkTags.split(',').map(t => t.trim()).filter(Boolean);

    if (confirm(`Update tags for ${ids.length} assets?`)) {
      await this.mediaService.bulkUpdateMetadata(ids, { tags });
      this.selectedAssets.set(new Set());
      this.isBulkMode.set(false);
      this.bulkTags = '';
      this.updateFilter(); // Refresh
    }
  }

  async deleteSelected() {
    const ids = Array.from(this.selectedAssets());
    if (confirm(`Delete ${ids.length} assets? This cannot be undone.`)) {
      alert('Bulk Delete is complex due to storage cleanup. Please delete individually for safer operations.');
    }
  }

  deleteAsset(asset: MediaAsset) {
    if (confirm('Are you sure you want to delete this asset?')) {
      this.mediaService.deleteAsset(asset).then(() => {
        this.updateFilter();
      });
    }
  }

  editAsset(asset: MediaAsset) {
    this.editingAsset.set(asset);
  }

  onEditComplete() {
    this.editingAsset.set(null);
    this.updateFilter();
  }

  async recalculateStats() {
    if (confirm('Recalculate Storage Stats? This scans all assets.')) {
      await this.mediaService.recalculateStorageStats();
    }
  }
}
