import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { MediaAsset } from '../../../core/models/media.model';
import { SharedLink } from '../../../core/models/shared-link.model';
import { Component, OnInit, inject, ViewEncapsulation, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { BehaviorSubject } from 'rxjs';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';
import { MediaService } from '../../../core/services/media.service';
import { DocumentSharingService } from '../../../core/services/document-sharing.service';
import { ToastService } from '../../../core/services/toast.service';
import { MediaFilter, MediaFolder } from '../../../core/models/media.model';
import { MediaUploadComponent } from './components/media-upload/media-upload.component';
import { EditMediaDialogComponent } from './components/edit-media-dialog/edit-media-dialog.component';
import { ImageEditorDialogComponent } from './components/image-editor-dialog/image-editor-dialog.component';
import { MoveAssetsDialogComponent } from './components/move-assets-dialog/move-assets-dialog.component';
import { CreateLinkDialogComponent } from './components/create-link-dialog/create-link-dialog.component';
import { LinkStatsDialogComponent } from './components/link-stats-dialog/link-stats-dialog.component';
import { BulkEditDialogComponent } from './components/bulk-edit-dialog/bulk-edit-dialog.component';
import { AppIconComponent } from '../../../shared/components/app-icon/app-icon.component';
import { FolderTreeComponent } from './components/folder-tree/folder-tree.component';
@Component({
  selector: 'app-media-library',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TranslateModule, // Added
    MediaUploadComponent,
    EditMediaDialogComponent,
    ImageEditorDialogComponent,
    MoveAssetsDialogComponent,
    CreateLinkDialogComponent,
    LinkStatsDialogComponent,
    BulkEditDialogComponent,
    AppIconComponent,
    FolderTreeComponent
  ],
  templateUrl: './media-library.component.html',
  styleUrls: ['./media-library.component.css'],
  encapsulation: ViewEncapsulation.None
})
export class MediaLibraryComponent implements OnInit {
  private mediaService = inject(MediaService);
  private sharingService = inject(DocumentSharingService);
  private toast = inject(ToastService);
  private translate = inject(TranslateService);

  // ... (rest of class)

  filter$ = new BehaviorSubject<MediaFilter>({ limit: 50 });
  assets = signal<MediaAsset[]>([]);

  editingAsset = signal<MediaAsset | null>(null);
  editingImage = signal<MediaAsset | null>(null);
  sharingAsset = signal<MediaAsset | null>(null);
  movingAssets = signal<MediaAsset[]>([]);
  sharedLinks = signal<SharedLink[]>([]);
  viewingStats = signal<SharedLink | null>(null);

  // Bulk Actions
  isBulkMode = signal(false);
  isBulkEditOpen = signal(false);
  bulkTags = '';

  readonly FILE_TYPES = [
    { id: 'all', label: 'ADMIN.MEDIA_LIBRARY.FILTERS.ALL', icon: 'grid' },
    { id: 'image', label: 'ADMIN.MEDIA_LIBRARY.FILTERS.IMAGES', icon: 'image' },
    { id: 'vector', label: 'ADMIN.MEDIA_LIBRARY.FILTERS.VECTORS', icon: 'tool' },
    { id: 'video', label: 'ADMIN.MEDIA_LIBRARY.FILTERS.VIDEOS', icon: 'film' },
    { id: 'document', label: 'ADMIN.MEDIA_LIBRARY.FILTERS.DOCUMENTS', icon: 'file_text' }
  ];

  isLoading = signal(false);
  hasMore = signal(true);
  private lastDoc: any = null;

  selectedType = signal<string>('all');
  searchQuery = signal<string>('');
  isUploadOpen = signal<boolean>(false);
  viewMode = signal<'grid' | 'list'>('grid');



  // Folder State
  currentFolderId = signal<string | null>(null);
  breadcrumbs = signal<MediaFolder[]>([]);
  isFoldersCollapsed = signal(true);


  // Stats
  storageStats$ = this.mediaService.getStorageStats();

  constructor() {
    // Initial Load
    console.log('MediaLibraryComponent initialized - Sidebar Refactor Active');
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
    this.selectedType.set('all'); // Clear type when entering folder 
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
    const name = prompt(this.translate.instant('ADMIN.MEDIA_LIBRARY.MESSAGES.FOLDER_NAME_PROMPT'));
    if (name) {
      await this.mediaService.createFolder(name, this.currentFolderId(), this.getCurrentPath());
      // Refresh tree? The tree component handles its own loading. 
      // We might need a signal to trigger refresh if we want it instant.
    }
  }

  // ...

  copyUrl(url: string) {
    navigator.clipboard.writeText(url);
    this.toast.success(this.translate.instant('ADMIN.MEDIA_LIBRARY.MESSAGES.LINK_COPIED'));
  }

  // ...

  async applyBulkTags() {
    if (!this.bulkTags.trim()) return;
    const ids = Array.from(this.selectedAssets());
    const tags = this.bulkTags.split(',').map(t => t.trim()).filter(Boolean);

    if (confirm(`Update tags for ${ids.length} assets?`)) { // Keep dynamic for now or use complex param
      await this.mediaService.bulkUpdateMetadata(ids, { tags });
      this.selectedAssets.set(new Set());
      this.isBulkMode.set(false);
      this.bulkTags = '';
      this.updateFilter(); // Refresh
      this.toast.success(this.translate.instant('ADMIN.MEDIA_LIBRARY.MESSAGES.UPDATE_SUCCESS'));
    }
  }

  async deleteSelected() {
    const ids = Array.from(this.selectedAssets());
    if (confirm(this.translate.instant('ADMIN.MEDIA_LIBRARY.MESSAGES.DELETE_BULK_CONFIRM', { count: ids.length }))) {
      this.isLoading.set(true);
      try {
        const assetsToDelete = this.assets().filter(a => ids.includes(a.id!));

        // Sequential delete to avoid overwhelming (or use Promise.all for speed if safe)
        // Promise.all is better for UX here
        await Promise.all(assetsToDelete.map(asset => this.mediaService.deleteAsset(asset)));

        this.selectedAssets.set(new Set());
        this.isBulkMode.set(false);
        this.updateFilter(); // Reload
        this.toast.success(`Deleted ${ids.length} assets`); // Keep simple or translate
      } catch (e) {
        console.error('Bulk delete failed', e);
        this.toast.error('Some assets failed to delete');
      } finally {
        this.isLoading.set(false);
      }
    }
  }

  // ...

  async onBulkEditComplete(changes: { tags?: string[], category?: string }) {
    this.isBulkEditOpen.set(false);
    if (!changes.tags && !changes.category) return;

    const ids = Array.from(this.selectedAssets());
    this.isLoading.set(true);
    try {
      await this.mediaService.bulkUpdateMetadata(ids, changes);
      this.toast.success(this.translate.instant('ADMIN.MEDIA_LIBRARY.MESSAGES.UPDATE_SUCCESS'));
      this.selectedAssets.set(new Set());
      this.isBulkMode.set(false);
      this.loadAssets(true);
    } catch (e) {
      console.error('Bulk edit failed', e);
      this.toast.error('Failed to update assets');
    } finally {
      this.isLoading.set(false);
    }
  }

  deleteAsset(asset: MediaAsset) {
    if (confirm(this.translate.instant('ADMIN.MEDIA_LIBRARY.MESSAGES.DELETE_CONFIRM'))) {
      this.mediaService.deleteAsset(asset).then(() => {
        this.updateFilter();
      });
    }
  }

  // ...

  launchImageEditor(asset: MediaAsset) {
    if (asset.contentType.startsWith('image/') || asset.contentType === 'image/svg+xml') {
      this.editingImage.set(asset);
    } else {
      this.toast.warning(this.translate.instant('ADMIN.MEDIA_LIBRARY.MESSAGES.ONLY_IMAGES_EDIT'));
    }
  }

  // ...

  onFolderDrop(event: { folder: MediaFolder, assetIds: string[] }) {
    if (!event.folder.id) return;

    this.mediaService.moveAssets(event.assetIds, event.folder.id).then(() => {
      this.toast.success(this.translate.instant('ADMIN.MEDIA_LIBRARY.MESSAGES.MOVED_SUCCESS', { count: event.assetIds.length, folder: event.folder.name }));
      this.loadAssets(); // Refresh grid
      this.selectedAssets.set(new Set()); // Clear selection
      this.draggedAssets.set([]); // Clear dragged state
    });
  }

  // ...

  async duplicateAsset(asset: MediaAsset) {
    this.isLoading.set(true);
    try {
      await this.mediaService.duplicateAsset(asset.id!);
      // Refresh list
      // We could also just push to local state but full reload is safer for consistency
      this.loadAssets(true);
      this.toast.success(this.translate.instant('ADMIN.MEDIA_LIBRARY.MESSAGES.DUPLICATE_SUCCESS'));
    } catch (e) {
      console.error('Duplicate failed', e);
      this.toast.error('Failed to duplicate asset');
    } finally {
      this.isLoading.set(false);
    }
  }

  async recalculateStats() {
    if (confirm(this.translate.instant('ADMIN.MEDIA_LIBRARY.MESSAGES.RECALCULATE_CONFIRM'))) {
      try {
        await this.mediaService.recalculateStorageStats();
        this.toast.success('Storage stats updated');
      } catch (e) {
        this.toast.error('Failed to update stats');
      }
    }
  }

  async scanStorage() {
    if (confirm(this.translate.instant('ADMIN.MEDIA_LIBRARY.MESSAGES.SYNC_START'))) {
      this.isLoading.set(true);
      try {
        const stats = await this.mediaService.syncStorageToFirestore();
        this.toast.success(this.translate.instant('ADMIN.MEDIA_LIBRARY.MESSAGES.SYNC_SUCCESS', { scanned: stats.scanned, recovered: stats.recovered, errors: stats.errors }));
        this.loadAssets(true);
      } catch (e) {
        console.error(e);
        this.toast.error('Sync failed');
      } finally {
        this.isLoading.set(false);
      }
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
        this.hasMore.set(result.assets.length === filter.limit);
        this.isLoading.set(false);
      },
      error: (err) => {
        console.error('Failed to load assets', err);
        // Check for missing index error
        if (err.code === 'failed-precondition' && err.message.includes('index')) {
          this.toast.error('Missing Index: Check console for creation link!');
          alert('Firestore Index Required! Check the browser console for the link to create it.');
        } else {
          this.toast.error('Failed to load assets');
        }
        this.isLoading.set(false);
      }
    });
  }

  loadMore() {
    if (!this.hasMore() || this.isLoading()) return;
    this.loadAssets(false);
  }

  onTypeChange(type: string) {
    this.selectedType.set(type);
    this.currentFolderId.set(null);
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
      category: undefined,
      type: this.selectedType() === 'all' ? undefined : (this.selectedType() as any),
      folderId: this.currentFolderId() !== null ? this.currentFolderId()! : undefined,
      sortField: this.sortField(),
      sortDirection: this.sortDirection(),
      searchQuery: this.searchQuery() || undefined,
      limit: 50
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



  // Selection State
  selectedAssets = signal<Set<string>>(new Set());


  clearFilters() {
    this.searchQuery.set('');
    this.selectedType.set('all');
    this.updateFilter();
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





  launchBulkEdit() {
    this.isBulkEditOpen.set(true);
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

  // --- File Upload Drag & Drop ---
  onDragOver(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    // Only show upload drop zone if dragging files from OS
    if (event.dataTransfer?.types.includes('Files')) {
      this.isDragging.set(true);
    }
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
      this.isUploadOpen.set(true);
    }
  }

  // --- Internal Asset Drag & Drop (Move to Folder) ---
  draggedAssets = signal<MediaAsset[]>([]);

  onAssetDragStart(event: DragEvent, asset: MediaAsset) {
    // If dragging a selection, move all selected. If just one item (not in selection), move just that one.
    let assetsToMove: MediaAsset[] = [];
    if (this.selectedAssets().has(asset.id!)) {
      assetsToMove = this.assets().filter(a => this.selectedAssets().has(a.id!));
    } else {
      assetsToMove = [asset];
    }

    this.draggedAssets.set(assetsToMove);
    event.dataTransfer!.effectAllowed = 'move';
    event.dataTransfer!.setData('application/json', JSON.stringify(assetsToMove.map(a => a.id)));

    // Set custom drag image
    const ghost = this.createDragGhost(assetsToMove);
    document.body.appendChild(ghost);
    event.dataTransfer!.setDragImage(ghost, 0, 0);
    // Remove after drag starts - slight delay to ensure browser captures it
    setTimeout(() => document.body.removeChild(ghost), 10);
  }

  createDragGhost(assets: MediaAsset[]): HTMLElement {
    const el = document.createElement('div');
    if (!assets || assets.length === 0) return el;

    el.id = 'drag-ghost-element';
    el.style.width = '160px';
    el.style.height = '48px';
    el.style.backgroundColor = '#0f172a'; // slate-900
    el.style.border = '1px solid #6366f1'; // indigo-500
    el.style.borderRadius = '8px';
    el.style.padding = '8px';
    el.style.display = 'flex';
    el.style.alignItems = 'center';
    el.style.gap = '10px';
    el.style.position = 'fixed';
    el.style.top = '-9999px'; // Move off-screen initially to avoid flicker, or 0 if z-index trick needed
    el.style.left = '-9999px';
    el.style.zIndex = '9999';
    el.style.pointerEvents = 'none';

    // Safely get asset properties
    const asset = assets[0];
    const isImage = asset.contentType ? asset.contentType.startsWith('image/') : false;

    // Icon
    const iconDiv = document.createElement('div');
    iconDiv.style.minWidth = '24px';
    iconDiv.style.width = '24px';
    iconDiv.style.height = '24px';
    iconDiv.style.borderRadius = '4px';
    iconDiv.style.backgroundColor = 'rgba(255, 255, 255, 0.1)';
    iconDiv.style.display = 'flex';
    iconDiv.style.alignItems = 'center';
    iconDiv.style.justifyContent = 'center';
    iconDiv.style.fontSize = '14px';

    if (assets.length > 1) {
      iconDiv.textContent = '📚';
    } else {
      iconDiv.textContent = isImage ? '🖼️' : '📄';
    }
    el.appendChild(iconDiv);

    // Text
    const text = document.createElement('span');
    text.style.color = '#f8fafc';
    text.style.fontSize = '12px';
    text.style.fontWeight = '500';
    text.style.whiteSpace = 'nowrap';
    text.style.overflow = 'hidden';
    text.style.textOverflow = 'ellipsis';

    if (assets.length > 1) {
      text.textContent = `${assets.length} items`;
    } else {
      const name = asset.filename || 'Unknown';
      text.textContent = name.length > 15 ? name.substring(0, 15) + '...' : name;
    }
    el.appendChild(text);

    return el;
  }

  onAssetDragEnd(event: DragEvent) {
    this.draggedAssets.set([]);
  }




  shareAsset(asset: MediaAsset) {
    this.sharingAsset.set(asset);
  }

  onShareComplete(linkOrString: SharedLink | string) {
    this.sharingAsset.set(null);
    // If it's a string, we might just reload or ignore updating the local list if we don't have the full object
    if (typeof linkOrString !== 'string') {
      this.sharedLinks.update((links: SharedLink[]) => [linkOrString, ...links]);
    }
    // Show stats?
    // this.viewingStats.set(link);
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

  formatDate(date: any): Date | null {
    if (!date) return null;
    if (date.toDate && typeof date.toDate === 'function') {
      return date.toDate();
    }
    return new Date(date);
  }
}


