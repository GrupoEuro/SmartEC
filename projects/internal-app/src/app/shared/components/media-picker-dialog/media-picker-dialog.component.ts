import { Component, EventEmitter, Output, inject, signal, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MediaService } from '../../../core/services/media.service';
import { MediaAsset, MediaFilter } from '../../../core/models/media.model';
import { Observable, BehaviorSubject, switchMap, map } from 'rxjs';
import { MediaUploadComponent } from '../../../pages/admin/media-library/components/media-upload/media-upload.component';
import { AppIconComponent } from '../../../shared/components/app-icon/app-icon.component';

@Component({
  selector: 'app-media-picker-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, MediaUploadComponent, AppIconComponent],
  templateUrl: './media-picker-dialog.component.html',
  styleUrls: ['./media-picker-dialog.component.css']
})
export class MediaPickerDialogComponent {
  private mediaService = inject(MediaService);

  @Output() assetSelected = new EventEmitter<MediaAsset>();
  @Output() close = new EventEmitter<void>();

  // Close modal on ESC key
  @HostListener('document:keydown.escape', ['$event'])
  handleEscapeKey(event: KeyboardEvent): void {
    this.close.emit();
  }

  readonly CATEGORIES = ['products', 'banners', 'site-assets', 'documents', 'blog'];

  filter$ = new BehaviorSubject<MediaFilter>({ limit: 20 });
  assets$: Observable<MediaAsset[]>;

  selectedCategory = signal<string>('');
  showUpload = signal<boolean>(false);
  selectedAsset = signal<MediaAsset | null>(null);

  constructor() {
    this.assets$ = this.filter$.pipe(
      switchMap(filter => this.mediaService.getAssets(filter)),
      map(result => result.assets)
    );
  }

  onCategoryChange(category: string) {
    this.selectedCategory.set(category);
    this.filter$.next({
      ...this.filter$.value,
      category: category || undefined
    });
  }

  selectAsset(asset: MediaAsset) {
    this.selectedAsset.set(asset);
  }

  confirmSelection() {
    const asset = this.selectedAsset();
    if (asset) {
      this.assetSelected.emit(asset);
    }
  }

  onUploadSuccess(assets: MediaAsset[]) {
    this.showUpload.set(false);
    if (assets && assets.length > 0) {
      this.selectAsset(assets[0]); // Auto-select but wait for confirmation
    }
    this.filter$.next(this.filter$.value); // Refresh
  }
}
