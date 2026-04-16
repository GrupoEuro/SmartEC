import { Component, EventEmitter, Input, Output, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MediaService } from '../../../../../core/services/media.service';
import { MediaAsset } from '../../../../../core/models/media.model';
import { AppIconComponent } from '../../../../../shared/components/app-icon/app-icon.component';

export interface PendingFile {
  file: File;
  previewUrl: string;
  tags: string;
  status: 'pending' | 'compressing' | 'uploading' | 'success' | 'error';
  progress: number;
  errorMessage?: string;
  /** Size of the file as originally selected (bytes) */
  originalSize: number;
  /** Size after WebP compression (bytes) — set after compressImage() runs */
  compressedSize?: number;
}

// ── Per-category max output dimensions ────────────────────────────────────────
// Images are never upscaled. Aspect ratio is always preserved.
const CATEGORY_MAX: Record<string, { w: number; h: number }> = {
  banners:      { w: 1920, h: 800  },
  products:     { w: 1200, h: 1200 },
  'site-assets':{ w: 1200, h: 900  },
  blog:         { w: 1200, h: 630  },
  icons:        { w: 256,  h: 256  },
  documents:    { w: 0,    h: 0    },  // skip — not images
};

/**
 * Compresses an image file to WebP using the browser Canvas API.
 *
 * - Never upscales (ratio is clamped to 1)
 * - Preserves aspect ratio
 * - Quality: 0.85 (excellent, approx 25% smaller than quality 1.0)
 * - Skips non-image files and the 'documents' category unchanged
 *
 * Returns the original File unchanged if compression is skipped or fails.
 */
async function compressImage(file: File, category: string): Promise<File> {
  const dims = CATEGORY_MAX[category] ?? { w: 1200, h: 900 };

  // Skip: not an image, or category explicitly skips compression
  if (dims.w === 0 || !file.type.startsWith('image/') || file.type === 'image/svg+xml') {
    return file;
  }

  return new Promise<File>((resolve) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);

      // Scale down proportionally — never upscale
      const ratio  = Math.min(dims.w / img.naturalWidth, dims.h / img.naturalHeight, 1);
      const outW   = Math.round(img.naturalWidth  * ratio);
      const outH   = Math.round(img.naturalHeight * ratio);

      const canvas = document.createElement('canvas');
      canvas.width  = outW;
      canvas.height = outH;

      const ctx = canvas.getContext('2d');
      if (!ctx) { resolve(file); return; }

      ctx.drawImage(img, 0, 0, outW, outH);

      canvas.toBlob(
        (blob) => {
          if (!blob || blob.size >= file.size) {
            // If WebP is somehow larger (rare with PNGs that have few colors), keep original
            resolve(file);
            return;
          }
          const webpName = file.name.replace(/\.[^.]+$/, '.webp');
          resolve(new File([blob], webpName, { type: 'image/webp', lastModified: Date.now() }));
        },
        'image/webp',
        0.85
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(file); // Graceful fallback
    };

    img.src = objectUrl;
  });
}

/** Human-readable file size, e.g. "1.4 MB" or "320 KB" */
export function formatBytes(bytes: number): string {
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  if (bytes >= 1_024)     return `${Math.round(bytes / 1_024)} KB`;
  return `${bytes} B`;
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

  @Input() currentPath: string = '';
  @Input() targetFolderId: string | null = null;
  @Output() uploadComplete = new EventEmitter<MediaAsset[]>();

  isDragging = false;

  // State
  pendingFiles   = signal<PendingFile[]>([]);
  isUploading    = signal(false);
  uploadDone     = signal(false);
  uploadSummary  = signal<{ success: number; error: number; savedBytes: number }>({ success: 0, error: 0, savedBytes: 0 });
  globalTags     = '';
  selectedCategory = 'site-assets';
  readonly CATEGORIES = ['products', 'banners', 'site-assets', 'documents', 'blog', 'icons'];

  readonly formatBytes = formatBytes;

  // ── File selection & drag-drop ──────────────────────────────────────────────

  onFileSelected(event: any) {
    const files = event.target.files;
    if (files?.length > 0) this.addFiles(files);
  }

  onDragOver(event: DragEvent)  { event.preventDefault(); event.stopPropagation(); this.isDragging = true; }
  onDragLeave(event: DragEvent) { event.preventDefault(); event.stopPropagation(); this.isDragging = false; }

  onDrop(event: DragEvent) {
    event.preventDefault(); event.stopPropagation();
    this.isDragging = false;
    const files = event.dataTransfer?.files;
    if (!files || files.length === 0) return;
    this.addFiles(files);
  }

  public addFiles(fileList: FileList) {
    const newFiles: PendingFile[] = Array.from(fileList).map(file => ({
      file,
      previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : '',
      tags: '',
      status: 'pending',
      progress: 0,
      originalSize: file.size,
    }));
    this.pendingFiles.update(current => [...current, ...newFiles]);
  }

  removeFile(index: number) {
    this.pendingFiles.update(files => files.filter((_, i) => i !== index));
    if (this.uploadDone()) this.uploadDone.set(false);
  }

  applyGlobalTags() {
    if (!this.globalTags.trim()) return;
    this.pendingFiles.update(files => files.map(f =>
      f.status === 'pending' ? { ...f, tags: this.globalTags } : f
    ));
  }

  // ── Upload ──────────────────────────────────────────────────────────────────

  async uploadAll() {
    const filesToUpload = this.pendingFiles().filter(f => f.status === 'pending' || f.status === 'error');
    if (filesToUpload.length === 0) return;

    this.isUploading.set(true);
    this.uploadDone.set(false);

    const completedAssets: MediaAsset[] = [];
    let errorCount  = 0;
    let savedBytes  = 0;

    for (const pf of filesToUpload) {
      const fileRef = pf.file;

      // ── Step 1: Compress ─────────────────────────────────────────────────
      this.pendingFiles.update(files => files.map(f =>
        f.file === fileRef ? { ...f, status: 'compressing', progress: 0 } : f
      ));

      let optimized: File;
      try {
        optimized = await compressImage(fileRef, this.selectedCategory);
      } catch {
        optimized = fileRef; // Graceful fallback — still upload original
      }

      const compressed = optimized !== fileRef ? optimized.size : fileRef.size;
      savedBytes += Math.max(0, fileRef.size - compressed);

      // Update the PendingFile with compressed size, then switch to uploading
      this.pendingFiles.update(files => files.map(f =>
        f.file === fileRef
          ? { ...f, status: 'uploading', progress: 0, compressedSize: compressed }
          : f
      ));

      // ── Step 2: Upload compressed file ───────────────────────────────────
      const tagArray = pf.tags.split(',').map((t: string) => t.trim()).filter(Boolean);

      await new Promise<void>((resolve) => {
        this.mediaService.uploadFile(optimized, this.selectedCategory, tagArray, this.targetFolderId).subscribe({
          next: (event) => {
            this.pendingFiles.update(files => files.map(f => {
              if (f.file !== fileRef) return f;
              const next: PendingFile = { ...f, progress: Math.round(event.progress) };
              if (event.asset) {
                next.status = 'success';
                completedAssets.push(event.asset);
              }
              return next;
            }));
          },
          error: (err) => {
            console.error('[MediaUpload] Upload error:', optimized.name, err);
            const msg = err?.message || err?.code || 'Upload failed';
            errorCount++;
            this.pendingFiles.update(files => files.map(f =>
              f.file === fileRef ? { ...f, status: 'error', progress: 0, errorMessage: msg } : f
            ));
            resolve();
          },
          complete: () => resolve()
        });
      });
    }

    this.isUploading.set(false);
    this.uploadSummary.set({ success: completedAssets.length, error: errorCount, savedBytes });
    this.uploadDone.set(true);

    if (completedAssets.length > 0) {
      this.uploadComplete.emit(completedAssets);
      setTimeout(() => {
        this.pendingFiles.update(files => files.filter(f => f.status !== 'success'));
        if (errorCount === 0) this.uploadDone.set(false);
      }, 3000);
    }
  }
}
