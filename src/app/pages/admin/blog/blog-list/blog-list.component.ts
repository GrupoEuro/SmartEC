import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { BlogService } from '../../../../core/services/blog.service';
import { BlogPost } from '../../../../core/models/blog.model';
import { Observable, BehaviorSubject, combineLatest, of } from 'rxjs';
import { take, map, tap, catchError } from 'rxjs/operators';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { AdminPageHeaderComponent } from '../../shared/admin-page-header/admin-page-header.component';
import { ConfirmDialogService } from '../../../../core/services/confirm-dialog.service';
import { ToastService } from '../../../../core/services/toast.service';
import { ExportService } from '../../../../core/services/export.service';
import { PaginationComponent, PaginationConfig } from '../../shared/pagination/pagination.component';

@Component({
  selector: 'app-blog-list',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule, TranslateModule, AdminPageHeaderComponent, PaginationComponent],
  templateUrl: './blog-list.component.html',
  styleUrl: './blog-list.component.css'
})
export class BlogListComponent implements OnInit {
  blogService = inject(BlogService);
  private translate = inject(TranslateService);
  private confirmDialog = inject(ConfirmDialogService);
  private toast = inject(ToastService);
  private exportService = inject(ExportService);

  // Data observables
  posts$!: Observable<BlogPost[]>;
  paginatedPosts$!: Observable<BlogPost[]>;
  uniqueCategories: string[] = [];

  // Search and filters
  searchTerm = '';
  selectedCategory = '';

  // Sorting
  sortField: 'title' | 'date' = 'date';
  sortDirection: 'asc' | 'desc' = 'desc';

  // Pagination
  paginationConfig: PaginationConfig = {
    currentPage: 1,
    itemsPerPage: 10,
    totalItems: 0
  };

  // Subjects for reactive filtering
  private filterSubject = new BehaviorSubject<void>(undefined);

  ngOnInit() {
    this.loadData();
    this.setupFiltering();
  }

  loadData() {
    this.posts$ = this.blogService.getPosts().pipe(
      tap(posts => {
        // Extract unique categories
        const categories = new Set(posts.map(p => p.category).filter(c => !!c));
        this.uniqueCategories = Array.from(categories).sort();
      }),
      catchError(error => {
        console.error('Error loading posts:', error);
        return of([]);
      })
    );
  }

  setupFiltering() {
    this.paginatedPosts$ = combineLatest([
      this.posts$,
      this.filterSubject
    ]).pipe(
      map(([posts]) => {
        // Apply filters
        let filtered = this.applyFilters(posts);

        // Apply sorting
        filtered = this.applySorting(filtered);

        // Update pagination total
        this.paginationConfig.totalItems = filtered.length;

        // Apply pagination
        return this.applyPagination(filtered);
      })
    );
  }

  applyFilters(posts: BlogPost[]): BlogPost[] {
    let filtered = posts;

    if (this.searchTerm.trim()) {
      const searchLower = this.searchTerm.toLowerCase();
      filtered = filtered.filter(p =>
        p.title.toLowerCase().includes(searchLower) ||
        p.slug.toLowerCase().includes(searchLower) ||
        (p.tags && p.tags.some(t => t.toLowerCase().includes(searchLower)))
      );
    }

    if (this.selectedCategory) {
      filtered = filtered.filter(p => p.category === this.selectedCategory);
    }

    return filtered;
  }

  applySorting(posts: BlogPost[]): BlogPost[] {
    return [...posts].sort((a, b) => {
      let comparison = 0;
      if (this.sortField === 'title') {
        comparison = a.title.localeCompare(b.title);
      } else if (this.sortField === 'date') {
        const dateA = a.date ? new Date(a.date).getTime() : 0;
        const dateB = b.date ? new Date(b.date).getTime() : 0;
        comparison = dateA - dateB;
      }
      return this.sortDirection === 'asc' ? comparison : -comparison;
    });
  }

  applyPagination(posts: BlogPost[]): BlogPost[] {
    const start = (this.paginationConfig.currentPage - 1) * this.paginationConfig.itemsPerPage;
    const end = start + this.paginationConfig.itemsPerPage;
    return posts.slice(start, end);
  }

  async deletePost(post: BlogPost) {
    const confirmed = await this.confirmDialog.confirmDelete(
      post.title,
      'Blog Post'
    );

    if (!confirmed) return;

    try {
      await this.blogService.deletePost(post.id);
      this.toast.success('Blog post deleted successfully');
      // Trigger reload
      this.loadData();
      this.filterSubject.next();
    } catch (error) {
      console.error('Error deleting post:', error);
      this.toast.error('Failed to delete blog post. Please try again.');
    }
  }

  onSearchChange() {
    this.paginationConfig.currentPage = 1;
    this.filterSubject.next();
  }

  onFilterChange() {
    this.paginationConfig.currentPage = 1;
    this.filterSubject.next();
  }

  onSortChange(field: 'title' | 'date') {
    if (this.sortField === field) {
      this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      this.sortField = field;
      this.sortDirection = 'asc';
    }
    this.filterSubject.next();
  }

  onPageChange(page: number) {
    this.paginationConfig.currentPage = page;
    this.filterSubject.next();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  onItemsPerPageChange(itemsPerPage: number) {
    this.paginationConfig.itemsPerPage = itemsPerPage;
    this.paginationConfig.currentPage = 1;
    this.filterSubject.next();
  }

  exportToCSV() {
    this.posts$.pipe(take(1)).subscribe(posts => {
      const filtered = this.applyFilters(posts);
      const sorted = this.applySorting(filtered);

      this.exportService.exportToCSVWithMapping(
        sorted,
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
