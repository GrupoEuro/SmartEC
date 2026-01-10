import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
    selector: 'app-image-gallery',
    standalone: true,
    imports: [CommonModule],
    templateUrl: './image-gallery.component.html',
    styleUrl: './image-gallery.component.css'
})
export class ImageGalleryComponent {
    @Input() images: string[] = [];
    @Input() productName: string = '';

    selectedImageIndex = 0;
    isLightboxOpen = false;

    selectImage(index: number) {
        this.selectedImageIndex = index;
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
