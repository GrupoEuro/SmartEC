import { Component, Input, ElementRef, ViewChild } from '@angular/core';
import { CommonModule, NgOptimizedImage } from '@angular/common';

@Component({
    selector: 'app-image-gallery',
    standalone: true,
    imports: [CommonModule, NgOptimizedImage],
    templateUrl: './image-gallery.component.html',
    styleUrl: './image-gallery.component.css'
})
export class ImageGalleryComponent {
    @Input() images: string[] = [];
    @Input() productName: string = '';

    selectedImageIndex = 0;
    isLightboxOpen = false;

    // Zoom State
    showZoom = false;
    zoomPosition = { x: 0, y: 0 };

    @ViewChild('mainImgContainer') mainImgContainer!: ElementRef<HTMLElement>;

    selectImage(index: number) {
        this.selectedImageIndex = index;
    }

    onMouseMove(event: MouseEvent) {
        if (!this.mainImgContainer) return;

        const container = this.mainImgContainer.nativeElement;
        const rect = container.getBoundingClientRect();

        // Calculate mouse position relative to image
        let x = event.clientX - rect.left;
        let y = event.clientY - rect.top;

        // Prevent going out of bounds
        x = Math.max(0, Math.min(x, rect.width));
        y = Math.max(0, Math.min(y, rect.height));

        this.showZoom = true;

        // Calculate background position % (center on cursor)
        const xPercent = (x / rect.width) * 100;
        const yPercent = (y / rect.height) * 100;

        this.zoomPosition = { x: xPercent, y: yPercent };
    }

    onMouseLeave() {
        this.showZoom = false;
    }

    openLightbox(index: number) {
        this.selectedImageIndex = index;
        this.isLightboxOpen = true;
    }

    closeLightbox() {
        this.isLightboxOpen = false;
    }

    nextImage() {
        this.selectedImageIndex = (this.selectedImageIndex + 1) % this.images.length;
    }

    previousImage() {
        this.selectedImageIndex = this.selectedImageIndex === 0
            ? this.images.length - 1
            : this.selectedImageIndex - 1;
    }
}
