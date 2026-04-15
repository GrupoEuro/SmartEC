import { Component, EventEmitter, Input, Output, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MediaService } from '../../../../../core/services/media.service';
import { MediaAsset } from '../../../../../core/models/media.model';
import { AppIconComponent } from '../../../../../shared/components/app-icon/app-icon.component';

export interface PendingFile {
  file: File;
  previewUrl: string;
  tags: string; // local model for input
  status: 'pending' | 'uploading' | 'success' | 'error';
  progress: number;
  errorMessage?: string;
}

@Component({
  selector: 'app-media-upload',
  standalone: true,
  imports: [CommonModule, FormsModule, AppIconComponent],
  templateUrl: './media-upload.component.html',
  styleUrls: ['./media-upload.component.css']
})
export class MediaUploadComponent {
  private mediaService = inject(MediaService);
  private http = inject(HttpClient);

  @Input() currentPath: string = '';
  @Input() targetFolderId: string | null = null;
  @Output() uploadComplete = new EventEmitter<MediaAsset[]>();

  isDragging = false;

  // State
  pendingFiles = signal<PendingFile[]>([]);
  isUploading = signal(false);
  uploadDone = signal(false);
  uploadSummary = signal<{ success: number; error: number }>({ success: 0, error: 0 });
  globalTags = ''; // For bulk applying tags
  selectedCategory = 'site-assets';
  readonly CATEGORIES = ['products', 'banners', 'site-assets', 'documents', 'blog', 'icons'];

  // Actions
  onFileSelected(event: any) {
    const files = event.target.files;
    if (files && files.length > 0) {
      this.addFiles(files);
    }
  }

  onDragOver(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging = true;
  }

  onDragLeave(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging = false;
  }

  onDrop(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging = false;
    const files = event.dataTransfer?.files;
    if (files && files.length > 0) {
      this.addFiles(files);
    }
  }

  public addFiles(fileList: FileList) {
    const newFiles: PendingFile[] = Array.from(fileList).map(file => ({
      file,
      previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : '', // simple preview
      tags: '',
      status: 'pending',
      progress: 0
    }));

    this.pendingFiles.update(current => [...current, ...newFiles]);
  }

  removeFile(index: number) {
    this.pendingFiles.update(files => files.filter((_, i) => i !== index));
    // Reset done state when queue changes
    if (this.uploadDone()) this.uploadDone.set(false);
  }

  applyGlobalTags() {
    if (!this.globalTags.trim()) return;
    this.pendingFiles.update(files => files.map(f => {
      if (f.status === 'pending') {
        return { ...f, tags: this.globalTags };
      }
      return f;
    }));
  }

  async uploadAll() {
    const filesToUpload = this.pendingFiles().filter(f => f.status === 'pending' || f.status === 'error');
    if (filesToUpload.length === 0) return;

    this.isUploading.set(true);
    this.uploadDone.set(false);

    // Mark all pending/error files as 'uploading'
    this.pendingFiles.update(files => files.map(f =>
      (f.status === 'pending' || f.status === 'error') ? { ...f, status: 'uploading', progress: 0, errorMessage: undefined } : f
    ));

    const completedAssets: MediaAsset[] = [];
    let errorCount = 0;

    for (const pf of filesToUpload) {
      // Capture the file object for stable identity inside the closure
      const fileRef = pf.file;
      const tagArray = pf.tags.split(',').map((t: string) => t.trim()).filter(Boolean);

      await new Promise<void>((resolve) => {
        this.mediaService.uploadFile(fileRef, this.selectedCategory, tagArray, this.targetFolderId).subscribe({
          next: (event) => {
            this.pendingFiles.update(files => {
              const updated = files.map(f => {
                if (f.file !== fileRef) return f;
                const next: PendingFile = { ...f, progress: Math.round(event.progress) };
                if (event.asset) {
                  next.status = 'success' as const;
                  completedAssets.push(event.asset);
                }
                return next;
              });
              return updated;
            });
          },
          error: (err) => {
            console.error('[MediaUpload] Upload error for file:', fileRef.name, err);
            // Try to extract a meaningful error
            const msg = err?.message || err?.code || 'Upload failed';
            errorCount++;
            this.pendingFiles.update(files =>
              files.map(f => f.file === fileRef
                ? { ...f, status: 'error' as const, progress: 0, errorMessage: msg }
                : f)
            );
            resolve();
          },
          complete: () => resolve()
        });
      });
    }

    this.isUploading.set(false);
    this.uploadSummary.set({ success: completedAssets.length, error: errorCount });
    this.uploadDone.set(true);

    if (completedAssets.length > 0) {
      this.uploadComplete.emit(completedAssets);
      // Auto-clear successful files after a short delay
      setTimeout(() => {
        this.pendingFiles.update(files => files.filter(f => f.status !== 'success'));
        // If no errors remain, also clear the done state
        if (errorCount === 0) {
          this.uploadDone.set(false);
        }
      }, 2000);
    }
  }

  // importPraxis removed
}

// Helper to create FileList
function createFileList(file: File): FileList {
  const dt = new DataTransfer();
  dt.items.add(file);
  return dt.files;
}
