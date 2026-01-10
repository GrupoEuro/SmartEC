import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { BlogService } from '../../../../core/services/blog.service';
import { BlogPost } from '../../../../core/models/blog.model';
import { Observable } from 'rxjs';
import { take } from 'rxjs/operators';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { AdminPageHeaderComponent } from '../../shared/admin-page-header/admin-page-header.component';
import { ConfirmDialogService } from '../../../../core/services/confirm-dialog.service';
import { ToastService } from '../../../../core/services/toast.service';
import { ExportService } from '../../../../core/services/export.service';

@Component({
  selector: 'app-blog-list',
  standalone: true,
  imports: [CommonModule, RouterModule, TranslateModule, AdminPageHeaderComponent],
  templateUrl: './blog-list.component.html',
  styleUrl: './blog-list.component.css'
})
export class BlogListComponent {
  blogService = inject(BlogService);
  private translate = inject(TranslateService);
  private confirmDialog = inject(ConfirmDialogService);
  private toast = inject(ToastService);
  private exportService = inject(ExportService);
  posts$: Observable<BlogPost[]> = this.blogService.getPosts();

  async deletePost(post: BlogPost) {
    const confirmed = await this.confirmDialog.confirmDelete(
      post.title,
      'Blog Post'
    );

    if (!confirmed) return;

    try {
      await this.blogService.deletePost(post.id);
      this.toast.success('Blog post deleted successfully');
    } catch (error) {
      console.error('Error deleting post:', error);
      this.toast.error('Failed to delete blog post. Please try again.');
    }
  }

  exportToCSV() {
    this.posts$.pipe(take(1)).subscribe(posts => {
      this.exportService.exportToCSVWithMapping(
        posts,
        'blog-posts',
        ['Title', 'Category', 'Author', 'Date', 'Read Time', 'Tags'],
        (post) => [
          post.title,
          post.category || 'N/A',
          post.author?.name || 'N/A',
          post.date?.toLocaleDateString() || 'N/A',
          `${post.readTime || 0} min`,
          post.tags?.join(', ') || 'N/A'
        ]
      );
      this.toast.success('Blog posts exported successfully');
    });
  }
}
