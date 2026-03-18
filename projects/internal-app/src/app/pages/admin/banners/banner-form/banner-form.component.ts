import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { BannerService, Banner } from '../../services/banner.service';
import { take } from 'rxjs/operators';

import { TranslateModule } from '@ngx-translate/core';
import { AdminPageHeaderComponent } from '../../shared/admin-page-header/admin-page-header.component';
import { ToggleSwitchComponent } from '../../shared/toggle-switch/toggle-switch.component';
import { MediaPickerDialogComponent } from '../../../../shared/components/media-picker-dialog/media-picker-dialog.component';
import { MediaAsset } from '../../../../core/models/media.model';

@Component({
  selector: 'app-banner-form',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterModule, TranslateModule, AdminPageHeaderComponent, ToggleSwitchComponent, MediaPickerDialogComponent],
  templateUrl: './banner-form.component.html',
  styleUrl: './banner-form.component.css'
})
export class BannerFormComponent implements OnInit {
  fb = inject(FormBuilder);
  bannerService = inject(BannerService);
  router = inject(Router);
  route = inject(ActivatedRoute);

  bannerForm: FormGroup;
  isEditing = false;
  isSubmitting = false;
  previewUrl: string | null = null;
  selectedFile: File | null = null;
  currentBannerId: string | null = null;
  currentBanner: Banner | null = null;

  constructor() {
    this.bannerForm = this.fb.group({
      title: ['', Validators.required],
      subtitle: [''],
      link: [''],
      order: [0, Validators.required],
      active: [true]
    });
  }

  ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.isEditing = true;
      this.currentBannerId = id;
      this.loadBanner(id);
    }
  }

  loadBanner(id: string) {
    this.bannerService.getBanners().pipe(take(1)).subscribe(banners => {
      const banner = banners.find(b => b.id === id);
      if (banner) {
        this.currentBanner = banner;
        this.bannerForm.patchValue({
          title: banner.title,
          subtitle: banner.subtitle,
          link: banner.link,
          order: banner.order,
          active: banner.active
        });
        this.previewUrl = banner.imageUrl;
      }
    });
  }

  onFileSelected(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (file) {
      this.selectedFile = file;
      // Create preview
      const reader = new FileReader();
      reader.onload = () => {
        this.previewUrl = reader.result as string;
      };
      reader.readAsDataURL(file);
    }
  }

  removeImage() {
    this.selectedFile = null;
    this.previewUrl = null;
    this.bannerForm.markAsDirty();
  }

  showMediaPicker = false;

  openMediaLibrary() {
    this.showMediaPicker = true;
  }

  onMediaAssetSelected(asset: MediaAsset) {
    this.previewUrl = asset.publicUrl;
    this.selectedFile = null;
    this.bannerForm.markAsDirty();
    this.showMediaPicker = false;
  }

  closeMediaPicker() {
    this.showMediaPicker = false;
  }

  async onSubmit() {
    if (this.bannerForm.invalid) return;
    if (!this.selectedFile && !this.previewUrl && !this.isEditing) {
      alert('Please select an image');
      return;
    }

    this.isSubmitting = true;
    const formValue = this.bannerForm.value;

    try {
      if (this.isEditing && this.currentBannerId && this.currentBanner) {
        const updatedBanner: Banner = {
          ...this.currentBanner,
          ...formValue
        };
        if (!this.selectedFile && this.previewUrl && this.previewUrl !== this.currentBanner.imageUrl) {
            updatedBanner.imageUrl = this.previewUrl;
        }
        await this.bannerService.updateBanner(this.currentBannerId, updatedBanner, this.selectedFile || undefined);
      } else {
        const newBanner: Banner = {
          ...formValue,
          imageUrl: this.previewUrl || '',
          imagePath: ''
        };
        await this.bannerService.createBanner(newBanner, this.selectedFile || undefined as any);
      }
      this.router.navigate(['/admin/banners']);
    } catch (error) {
      console.error('Error saving banner:', error);
      alert('Error saving banner');
    } finally {
      this.isSubmitting = false;
    }
  }

  onCancel() {
    this.router.navigate(['/admin/banners']);
  }
}
