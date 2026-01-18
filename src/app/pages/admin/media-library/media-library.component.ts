import { Component, inject, OnInit, signal, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { BehaviorSubject } from 'rxjs';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';
import { FolderTreeComponent } from './components/folder-tree/folder-tree.component';
import { AppIconComponent } from '../../../shared/components/app-icon/app-icon.component';
import { EditMediaDialogComponent } from './components/edit-media-dialog/edit-media-dialog.component';
import { ImageEditorDialogComponent } from './components/image-editor-dialog/image-editor-dialog.component';
import { MoveAssetsDialogComponent } from './components/move-assets-dialog/move-assets-dialog.component'; // Added
import { MediaUploadComponent } from './components/media-upload/media-upload.component';
import { CreateLinkDialogComponent } from './components/create-link-dialog/create-link-dialog.component';
import { LinkStatsDialogComponent } from './components/link-stats-dialog/link-stats-dialog.component';
import { MediaAsset, MediaFilter, MediaFolder } from '../../../core/models/media.model';
import { MediaService } from '../../../core/services/media.service';
import { SharedLink } from '../../../core/models/shared-link.model';
import { DocumentSharingService } from '../../../core/services/document-sharing.service';

@Component({
  selector: 'app-media-library',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MediaUploadComponent,
    EditMediaDialogComponent,
    ImageEditorDialogComponent,
    MoveAssetsDialogComponent, // Added
    CreateLinkDialogComponent,
    LinkStatsDialogComponent,
    AppIconComponent,
    FolderTreeComponent
  ],
  templateUrl: './media-library.component.html',
  styleUrls: ['./media-library.component.css']
})
export class MediaLibraryComponent implements OnInit {
  private mediaService = inject(MediaService);
  private sharingService = inject(DocumentSharingService);

  // State
  filter$ = new BehaviorSubject<MediaFilter>({ limit: 30 });
  assets = signal<MediaAsset[]>([]);

  editingAsset = signal<MediaAsset | null>(null);
  editingImage = signal<MediaAsset | null>(null);
  sharingAsset = signal<MediaAsset | null>(null);
  movingAssets = signal<MediaAsset[]>([]); // Added
  sharedLinks = signal<SharedLink[]>([]);
  viewingStats = signal<SharedLink | null>(null);

  // Bulk Actions
  isBulkMode = signal(false);
  bulkTags = '';

  readonly CATEGORIES = [
    { id: 'products', label: 'Products', icon: 'tag' },
    { id: 'banners', label: 'Banners', icon: 'image' },
    { id: 'site-assets', label: 'Site Assets', icon: 'monitor' },
    { id: 'documents', label: 'Documents', icon: 'file_text' },
    { id: 'blog', label: 'Blog', icon: 'pencil' },
    { id: 'icons', label: 'Icons', icon: 'star' }
  ];

  isLoading = signal(false);
  hasMore = signal(true);
  private lastDoc: any = null;

  selectedCategory = signal<string>('');
  searchQuery = signal<string>('');
  isUploadOpen = signal<boolean>(false);
  viewMode = signal<'grid' | 'list'>('grid');



  // Folder State
  currentFolderId = signal<string | null>(null);
  breadcrumbs = signal<MediaFolder[]>([]);

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

  // Folder Actions
  onFolderSelected(folder: MediaFolder) {
    this.currentFolderId.set(folder.id || null);
    this.selectedCategory.set(''); // Clear category when entering folder 
    this.updateFilter();
    this.buildBreadcrumbs(folder);
  }

  async buildBreadcrumbs(folder: MediaFolder) {
    const crumbs = [folder];
    let current = folder;
    // Should probably move this recursive fetch to service for performance or structure it differently
    // For now, naive approach:
    while (current.parentId) {
      const parent = await this.mediaService.getFolder(current.parentId);
      if (parent) {
        crumbs.unshift(parent);
        current = parent;
      } else {
        break;
      }
    }
    this.breadcrumbs.set(crumbs);
  }

  navigateToRoot() {
    this.currentFolderId.set(null);
    this.breadcrumbs.set([]);
    this.updateFilter();
  }

  async createFolder() {
    const name = prompt('Folder Name:');
    if (name) {
      await this.mediaService.createFolder(name, this.currentFolderId(), this.getCurrentPath());
      // Refresh tree? The tree component handles its own loading. 
      // We might need a signal to trigger refresh if we want it instant.
    }
  }

  getCurrentPath(): string {
    return this.breadcrumbs().map(f => f.name).join('/');
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
      folderId: this.currentFolderId() !== null ? this.currentFolderId()! : undefined,
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
  async migrateCategories() {
    if (!confirm('This will move all assets from legacy categories into new Folders. Continue?')) return;
    this.isLoading.set(true);
    try {
      const result = await this.mediaService.migrateLegacyCategories(this.CATEGORIES);
      alert(`Migration Complete. Moved ${result.migrated} assets.`);
      this.loadAssets(true);
    } catch (e) {
      alert('Migration failed');
      console.error(e);
    } finally {
      this.isLoading.set(false);
    }
  }

  async duplicateAsset(asset: MediaAsset) {
    this.isLoading.set(true);
    try {
      await this.mediaService.duplicateAsset(asset.id!);
      // Refresh list
      // We could also just push to local state but full reload is safer for consistency
      this.loadAssets(true);
      // Optional toast
    } catch (e) {
      console.error('Duplicate failed', e);
      alert('Failed to duplicate asset');
    } finally {
      this.isLoading.set(false);
    }
  }

  // Helpers
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

  moveSelected() {
    const ids = Array.from(this.selectedAssets());
    const assets = this.assets().filter(a => ids.includes(a.id!));
    this.launchMoveDialog(assets);
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

  // Drag & Drop
  isDragging = signal(false);

  onDragOver(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging.set(true);
  }

  onDragLeave(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging.set(false);
  }

  onDrop(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging.set(false);

    const files = event.dataTransfer?.files;
    if (files && files.length > 0) {
      // Open upload dialog or handle directly
      // For now, let's just open the upload dialog with these files 
      // (assuming we pass them, or just open the dialog and user re-selects - MVP)
      this.isUploadOpen.set(true);
      // Ideally: this.mediaUpload.handleFiles(files);
    }
  }

  shareAsset(asset: MediaAsset) {
    this.sharingAsset.set(asset);
  }

  onShareComplete(linkOrString: SharedLink | string) {
    this.sharingAsset.set(null);
    // If it's a string, we might just reload or ignore updating the local list if we don't have the full object
    if (typeof linkOrString !== 'string') {
      this.sharedLinks.update(links => [linkOrString, ...links]);
    }
    // Show stats?
    // this.viewingStats.set(link);
  }

  launchImageEditor(asset: MediaAsset) {
    if (asset.contentType.startsWith('image/') || asset.contentType === 'image/svg+xml') {
      this.editingImage.set(asset);
    } else {
      alert('Only images can be edited');
    }
  }

  onImageEditComplete(saved: boolean) {
    this.editingImage.set(null);
    if (saved) this.loadAssets(true);
  }

  // Move
  launchMoveDialog(assets: MediaAsset[]) {
    this.movingAssets.set(assets);
  }

  onMoveComplete(success: boolean) {
    this.movingAssets.set([]);
    if (success) {
      this.selectedAssets.set(new Set()); // Clear selection
      this.isBulkMode.set(false);
      this.loadAssets(true); // Refresh
    }
  }

  // File Type Helpers
  isImage(asset: MediaAsset): boolean {
    return asset.contentType.startsWith('image/') && asset.contentType !== 'image/tiff';
  }

  getFileIcon(asset: MediaAsset): string {
    const type = asset.contentType;
    if (type.includes('pdf')) return 'file_text';
    if (type.includes('spreadsheet') || type.includes('excel') || type.includes('csv')) return 'bar_chart';
    if (type.includes('word') || type.includes('document')) return 'file_text';
    if (type.includes('video')) return 'video';
    if (type.includes('audio')) return 'mic';
    if (type.includes('zip') || type.includes('compressed')) return 'archive';
    return 'file';
  }

  getFileExtension(asset: MediaAsset): string {
    return asset.filename.split('.').pop()?.toUpperCase() || 'FILE';
  }

  async recalculateStats() {
    if (confirm('Recalculate Storage Stats? This scans all assets.')) {
      await this.mediaService.recalculateStorageStats();
    }
  }
}
