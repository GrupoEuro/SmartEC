// Media Library Integration Methods
// Add these to product-form.component.ts after removeGalleryImage() method

openMediaLibrary(mode: 'main' | 'gallery') {
    this.mediaPickerMode = mode;
    this.showMediaPicker = true;
}

onMediaAssetSelected(asset: MediaAsset) {
    if (this.mediaPickerMode === 'main') {
        // Set main image from library
        this.mainImagePreview = asset.url;
        this.mainImageFile = null; // Clear file since we're using URL
    } else {
        // Add to gallery from library
        this.galleryPreviews.push(asset.url);
    }
    this.showMediaPicker = false;
    this.toast.success('Image selected from library');
}

closeMediaPicker() {
    this.showMediaPicker = false;
}
