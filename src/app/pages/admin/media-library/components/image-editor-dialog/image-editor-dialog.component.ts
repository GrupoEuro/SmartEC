import { Component, ElementRef, EventEmitter, Input, Output, ViewChild, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { MediaAsset } from '../../../../../core/models/media.model';
import { MediaService } from '../../../../../core/services/media.service';
import { AppIconComponent } from '../../../../../shared/components/app-icon/app-icon.component';

interface ImageAdjustments {
    brightness: number; // 100 default
    contrast: number; // 100 default
    saturation: number; // 100 default
    rotation: number; // degrees
    flipH: boolean;
    flipV: boolean;
}

@Component({
    selector: 'app-image-editor-dialog',
    standalone: true,
    imports: [CommonModule, FormsModule, AppIconComponent],
    templateUrl: './image-editor-dialog.component.html',
    styles: [`
    :host { display: block; }
    .crop-overlay {
        position: absolute;
        top: 0; left: 0; right: 0; bottom: 0;
        pointer-events: none;
    }
  `]
})
export class ImageEditorDialogComponent {
    @Input({ required: true }) asset!: MediaAsset;
    @Output() close = new EventEmitter<boolean>();

    @ViewChild('canvas') canvasRef!: ElementRef<HTMLCanvasElement>;
    @ViewChild('image') imageRef!: ElementRef<HTMLImageElement>;

    private mediaService = inject(MediaService);
    private http = inject(HttpClient);
    private sanitizer = inject(DomSanitizer);

    // State
    mode = signal<'crop' | 'svg' | 'adjust'>('crop');
    isLoading = signal(true);
    isSaving = signal(false);

    // SVG State
    svgContent = signal<string>('');
    svgColor = '#000000';
    sanitizedSvg = computed(() => this.sanitizer.bypassSecurityTrustHtml(this.svgContent()));

    // Image/Crop State
    imgLoaded = false;
    imageAdjustments: ImageAdjustments = {
        brightness: 100,
        contrast: 100,
        saturation: 100,
        rotation: 0,
        flipH: false,
        flipV: false
    };

    // Crop Logic
    cropRect = { x: 0, y: 0, w: 0, h: 0 };
    isDragging = false;
    dragStart = { x: 0, y: 0 };
    dragHandle: string | null = null;
    displayImageRect = { x: 0, y: 0, w: 0, h: 0 }; // Where image is drawn on screen

    ngOnInit() {
        if (this.asset.contentType === 'image/svg+xml') {
            this.mode.set('svg');
            this.loadSvg();
        } else {
            this.mode.set('crop');
        }
    }

    // --- SVG Logic ---
    corsError = signal(false);

    loadSvg() {
        this.isLoading.set(true);
        this.corsError.set(false);
        this.http.get(this.asset.publicUrl, { responseType: 'text' }).subscribe({
            next: (svg) => {
                if (!svg) {
                    console.error('SVG content is empty');
                    this.fallbackToImageMode();
                    return;
                }
                const parser = new DOMParser();
                const doc = parser.parseFromString(svg, 'image/svg+xml');

                const parserError = doc.querySelector('parsererror');
                if (parserError) {
                    console.warn('SVG Parsing Warning:', parserError.textContent);
                    // Fallback to raw SVG
                    this.svgContent.set(svg);
                } else {
                    // Normalize standard attributes for display
                    if (!doc.documentElement.hasAttribute('viewBox') && doc.documentElement.hasAttribute('width')) {
                        const w = doc.documentElement.getAttribute('width');
                        const h = doc.documentElement.getAttribute('height');
                        doc.documentElement.setAttribute('viewBox', `0 0 ${parseFloat(w!) || 100} ${parseFloat(h!) || 100}`);
                    }
                    doc.documentElement.setAttribute('width', '100%');
                    doc.documentElement.setAttribute('height', '100%');

                    this.svgContent.set(doc.documentElement.outerHTML);
                }
                this.isLoading.set(false);
            },
            error: (e) => {
                console.error('Failed to load SVG (likely CORS)', e);
                this.fallbackToImageMode(true);
            }
        });
    }

    private fallbackToImageMode(isCors = false) {
        this.isLoading.set(false);
        if (isCors) this.corsError.set(true);
        this.mode.set('crop'); // Fallback to standard image editor
    }

    applySvgColor() {
        const parser = new DOMParser();
        const doc = parser.parseFromString(this.svgContent(), 'image/svg+xml');

        // Helper to change color
        const setFill = (el: Element) => {
            const currentFill = el.getAttribute('fill');
            // Don't override 'none'
            if (currentFill !== 'none') {
                el.setAttribute('fill', this.svgColor);
            }
            // If style exists
            if (el.hasAttribute('style')) {
                let style = el.getAttribute('style')!;
                if (style.includes('fill:')) {
                    style = style.replace(/fill:[^;"]*/g, `fill:${this.svgColor}`);
                    el.setAttribute('style', style);
                }
            }
        };

        const elements = doc.querySelectorAll('*');
        elements.forEach(el => setFill(el));

        // Also do root
        setFill(doc.documentElement);

        this.svgContent.set(doc.documentElement.outerHTML);
    }

    async saveSvg() {
        if (this.isSaving()) return;
        this.isSaving.set(true);
        try {
            const blob = new Blob([this.svgContent()], { type: 'image/svg+xml' });
            await this.mediaService.uploadBlob(blob, `edited_${this.asset.filename}`, this.asset.metadata.folderId || null, 'image/svg+xml');
            this.close.emit(true);
        } catch (e) {
            console.error('Save failed', e);
            alert('Failed to save SVG');
        } finally {
            this.isSaving.set(false);
        }
    }

    // --- Image Logic ---
    onImageLoad() {
        this.isLoading.set(false);
        this.imgLoaded = true;
        this.centerCropRect();
    }

    centerCropRect() {
        const img = this.imageRef.nativeElement;
        // Simple delay to ensure layout
        setTimeout(() => {
            const w = img.width * 0.8;
            const h = img.height * 0.8;
            this.cropRect = {
                x: (img.width - w) / 2,
                y: (img.height - h) / 2,
                w, h
            };
        }, 50);
    }

    // Adjustments
    rotate(deg: number) {
        this.imageAdjustments.rotation = (this.imageAdjustments.rotation + deg) % 360;
    }

    flip(axis: 'H' | 'V') {
        if (axis === 'H') this.imageAdjustments.flipH = !this.imageAdjustments.flipH;
        if (axis === 'V') this.imageAdjustments.flipV = !this.imageAdjustments.flipV;
    }

    get imageStyle() {
        return {
            filter: `brightness(${this.imageAdjustments.brightness}%) contrast(${this.imageAdjustments.contrast}%) saturate(${this.imageAdjustments.saturation}%)`,
            transform: `rotate(${this.imageAdjustments.rotation}deg) scaleX(${this.imageAdjustments.flipH ? -1 : 1}) scaleY(${this.imageAdjustments.flipV ? -1 : 1})`
        };
    }

    // Crop Interaction
    startDrag(e: MouseEvent, type: string) {
        e.preventDefault();
        e.stopPropagation();
        this.isDragging = true;
        this.dragHandle = type;
        this.dragStart = { x: e.clientX, y: e.clientY };
    }

    onMouseMove(e: MouseEvent) {
        if (!this.isDragging) return;
        const dx = e.clientX - this.dragStart.x;
        const dy = e.clientY - this.dragStart.y;

        // Bounds checking would go here in a full impl
        if (this.dragHandle === 'move') {
            this.cropRect.x += dx;
            this.cropRect.y += dy;
        } else if (this.dragHandle === 'br') {
            this.cropRect.w += dx;
            this.cropRect.h += dy;
        }

        this.dragStart = { x: e.clientX, y: e.clientY };
    }

    stopDrag() {
        this.isDragging = false;
        this.dragHandle = null;

        // Sanity checks on rect
        if (this.cropRect.w < 50) this.cropRect.w = 50;
        if (this.cropRect.h < 50) this.cropRect.h = 50;
    }

    async saveImage() {
        if (this.isSaving()) return;
        this.isSaving.set(true);

        try {
            const img = this.imageRef.nativeElement;
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d')!;

            // 1. Setup Canvas for Rotation/Flip if needed
            // NOTE: Doing crop + rotation + flip + filter + resize all at once is complex math.
            // Simplified approach: Draw modified image to temp canvas, then crop from that.

            // For MVP: Crop based on Visual Rect assuming NO Rotation for Crop
            // If we allow simultaneous Adjust + Crop, we need to map coordinates.
            // Let's support Adjustments OR Crop for simplicity, or apply adjustments first.

            // Implementation: Draw visual image to canvas with filters
            const tempCanvas = document.createElement('canvas');
            const tCtx = tempCanvas.getContext('2d')!;

            // Handle dimensions for rotation
            const isRotated = Math.abs(this.imageAdjustments.rotation % 180) === 90;
            tempCanvas.width = isRotated ? img.naturalHeight : img.naturalWidth;
            tempCanvas.height = isRotated ? img.naturalWidth : img.naturalHeight;

            // Apply transformations
            tCtx.save();
            tCtx.translate(tempCanvas.width / 2, tempCanvas.height / 2);
            tCtx.rotate(this.imageAdjustments.rotation * Math.PI / 180);
            tCtx.scale(this.imageAdjustments.flipH ? -1 : 1, this.imageAdjustments.flipV ? -1 : 1);
            tCtx.filter = `brightness(${this.imageAdjustments.brightness}%) contrast(${this.imageAdjustments.contrast}%) saturate(${this.imageAdjustments.saturation}%)`;
            tCtx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
            tCtx.restore();

            // 2. Crop from the temp canvas
            // Map display coordinates to natural coordinates
            const scaleX = tempCanvas.width / img.width;  // approx
            const scaleY = tempCanvas.height / img.height; // approx

            // If user didn't crop, save whole thing
            // For now, let's just save the crop rect
            const actualX = this.cropRect.x * scaleX;
            const actualY = this.cropRect.y * scaleY;
            const actualW = this.cropRect.w * scaleX;
            const actualH = this.cropRect.h * scaleY;

            canvas.width = actualW;
            canvas.height = actualH;

            ctx.drawImage(tempCanvas, actualX, actualY, actualW, actualH, 0, 0, actualW, actualH);

            canvas.toBlob(async (blob) => {
                if (blob) {
                    await this.mediaService.uploadBlob(blob, `edit_${this.asset.filename}`, this.asset.metadata.folderId || null, this.asset.contentType);
                    this.close.emit(true);
                }
            }, this.asset.contentType);

        } catch (e) {
            console.error(e);
            alert('Save failed');
            this.isSaving.set(false);
        }
    }
}
