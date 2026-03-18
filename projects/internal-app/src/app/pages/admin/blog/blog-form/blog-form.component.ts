import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { BlogService } from '../../../../core/services/blog.service';
import { BlogPost } from '../../../../core/models/blog.model';
import { take } from 'rxjs/operators';

import { TranslateModule } from '@ngx-translate/core';
import { AdminPageHeaderComponent } from '../../shared/admin-page-header/admin-page-header.component';
import { AppIconComponent } from '../../../../shared/components/app-icon/app-icon.component';
import { MediaPickerDialogComponent } from '../../../../shared/components/media-picker-dialog/media-picker-dialog.component';
import { MediaAsset } from '../../../../core/models/media.model';

// Sanitized: Verified imports and route configuration

@Component({
  selector: 'app-blog-form',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterModule, TranslateModule, AdminPageHeaderComponent, AppIconComponent, MediaPickerDialogComponent],
  templateUrl: './blog-form.component.html',
  styleUrls: ['./blog-form.component.css', '../../shared/admin-forms.css']
})
export class BlogFormComponent implements OnInit {
  fb = inject(FormBuilder);
  blogService = inject(BlogService);
  router = inject(Router);
  route = inject(ActivatedRoute);

  postForm: FormGroup;
  isEditing = false;
  submitState: 'idle' | 'saving' | 'success' | 'error' = 'idle';
  previewUrl: string | null = null;
  selectedFile: File | null = null;
  currentPostId: string | null = null;
  currentPost: BlogPost | null = null;

  constructor() {
    this.postForm = this.fb.group({
      title: ['', Validators.required],
      slug: ['', Validators.required],
      excerpt: ['', Validators.required],
      content: ['', Validators.required],
      category: ['Consejos', Validators.required],
      readTime: [5, Validators.required],
      tags: [''] // Comma separated string
    });
  }

  ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.isEditing = true;
      this.currentPostId = id;
      this.loadPost(id);
    }
  }

  loadPost(id: string) {
    this.blogService.getPostById(id).pipe(take(1)).subscribe(post => {
      if (post) {
        this.currentPost = post;
        this.postForm.patchValue({
          title: post.title,
          slug: post.slug,
          excerpt: post.excerpt,
          content: post.content,
          category: post.category,
          readTime: post.readTime,
          tags: post.tags.join(', ')
        });
        this.previewUrl = post.coverImage;
      }
    });
  }

  generateSlug() {
    if (!this.isEditing) {
      const title = this.postForm.get('title')?.value;
      if (title) {
        const slug = title.toLowerCase()
          .replace(/[^\w\s-]/g, '') // Remove special chars
          .replace(/\s+/g, '-') // Replace spaces with hyphens
          .replace(/^-+|-+$/g, ''); // Trim hyphens
        this.postForm.patchValue({ slug });
      }
    }
  }

  onFileSelected(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (file) {
      this.selectedFile = file;
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
    this.postForm.markAsDirty();
  }

  showMediaPicker = false;

  openMediaLibrary() {
    this.showMediaPicker = true;
  }

  onMediaAssetSelected(asset: MediaAsset) {
    this.previewUrl = asset.publicUrl;
    this.selectedFile = null;
    this.postForm.markAsDirty();
    this.showMediaPicker = false;
  }

  closeMediaPicker() {
    this.showMediaPicker = false;
  }

  async onSubmit() {
    if (this.postForm.invalid) return;
    if (!this.selectedFile && !this.previewUrl && !this.isEditing) {
      alert('Please select a cover image');
      return;
    }

    this.submitState = 'saving';
    const val = this.postForm.value;

    // Process tags
    const tagsArray = val.tags.split(',').map((t: string) => t.trim()).filter((t: string) => t.length > 0);

    const postData: Partial<BlogPost> = {
      title: val.title,
      slug: val.slug,
      excerpt: val.excerpt,
      content: val.content,
      category: val.category,
      readTime: val.readTime,
      tags: tagsArray,
      date: this.isEditing && this.currentPost ? this.currentPost.date : new Date(),
      author: { // Default author for Eurollantas blog posts
        name: 'Equipo Eurollantas',
        avatar: 'E',
        role: 'Expertos en Llantas'
      }
    };

    try {
      if (this.isEditing && this.currentPostId) {
        // Keep existing properties not in form
        if (this.currentPost) {
          postData.coverImage = this.currentPost.coverImage;
        }

        if (!this.selectedFile && this.previewUrl && this.previewUrl !== this.currentPost?.coverImage) {
            postData.coverImage = this.previewUrl;
        }
        await this.blogService.updatePost(this.currentPostId, postData, this.selectedFile || undefined);
      } else {
        // New post
        postData.coverImage = this.previewUrl || '';
        // @ts-ignore - Ignoring TS strict checks for id as it's generated
        await this.blogService.createPost(postData as BlogPost, this.selectedFile || undefined as any);
      }
      this.submitState = 'success';
      setTimeout(() => this.router.navigate(['/admin/blog']), 800);
    } catch (error) {
      console.error('Error saving post:', error);
      this.submitState = 'error';
    }
  }

  onCancel() {
    this.router.navigate(['/admin/blog']);
  }
}
