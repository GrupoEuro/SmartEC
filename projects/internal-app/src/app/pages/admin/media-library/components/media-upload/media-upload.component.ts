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

    // Mark all pending/error files as 'uploading'
    this.pendingFiles.update(files => files.map(f =>
      (f.status === 'pending' || f.status === 'error') ? { ...f, status: 'uploading', progress: 0 } : f
    ));

    const completedAssets: MediaAsset[] = [];

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
                const next = { ...f, progress: Math.round(event.progress) };
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
            console.error('Upload error', err);
            this.pendingFiles.update(files =>
              files.map(f => f.file === fileRef ? { ...f, status: 'error' as const, progress: 0 } : f)
            );
            resolve();
          },
          complete: () => resolve()
        });
      });
    }

    if (completedAssets.length > 0) {
      this.uploadComplete.emit(completedAssets);
      setTimeout(() => {
        this.pendingFiles.update(files => files.filter(f => f.status !== 'success'));
      }, 1500);
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
