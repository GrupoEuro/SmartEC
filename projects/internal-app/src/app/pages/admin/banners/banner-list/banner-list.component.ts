import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { BannerService, Banner } from '../../services/banner.service';
import { Observable } from 'rxjs';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { AdminPageHeaderComponent } from '../../shared/admin-page-header/admin-page-header.component';
import { ConfirmDialogService } from '../../../../core/services/confirm-dialog.service';
import { ToastService } from '../../../../core/services/toast.service';

@Component({
  selector: 'app-banner-list',
  standalone: true,
  imports: [CommonModule, RouterModule, TranslateModule, AdminPageHeaderComponent],
  templateUrl: './banner-list.component.html',
  styleUrl: './banner-list.component.css'
})
export class BannerListComponent {
  bannerService = inject(BannerService);
  private translate = inject(TranslateService);
  private confirmDialog = inject(ConfirmDialogService);
  private toast = inject(ToastService);
  banners$: Observable<Banner[]> = this.bannerService.getBanners();

  async deleteBanner(banner: Banner) {
    const confirmed = await this.confirmDialog.confirmDelete(
      banner.title || 'this banner',
      'Banner'
    );

    if (!confirmed) return;

    try {
      await this.bannerService.deleteBanner(banner);
      this.toast.success('Banner deleted successfully');
    } catch (error) {
      console.error('Error deleting banner:', error);
      this.toast.error('Failed to delete banner. Please try again.');
    }
  }
}
