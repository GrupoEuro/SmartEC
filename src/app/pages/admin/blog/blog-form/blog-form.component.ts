import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { BlogService } from '../../../../core/services/blog.service';
import { BlogPost } from '../../../../core/models/blog.model';
import { take } from 'rxjs/operators';

import { TranslateModule } from '@ngx-translate/core';
import { AdminPageHeaderComponent } from '../../shared/admin-page-header/admin-page-header.component';

@Component({
  selector: 'app-blog-form',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterModule, TranslateModule, AdminPageHeaderComponent],
  templateUrl: './blog-form.component.html',
  styleUrl: './blog-form.component.css'
})
export class BlogFormComponent implements OnInit {
  fb = inject(FormBuilder);
  blogService = inject(BlogService);
  router = inject(Router);
  route = inject(ActivatedRoute);

  postForm: FormGroup;
  isEditing = false;
  isSubmitting = false;
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

  async onSubmit() {
    if (this.postForm.invalid) return;
    if (!this.selectedFile && !this.isEditing) {
      alert('Please select a cover image');
      return;
    }

    this.isSubmitting = true;
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
        await this.blogService.updatePost(this.currentPostId, postData, this.selectedFile || undefined);
      } else {
        // New post
        // @ts-ignore - Ignoring TS strict checks for id as it's generated
        await this.blogService.createPost(postData as BlogPost, this.selectedFile!);
      }
      this.router.navigate(['/admin/blog']);
      this.router.navigate(['/admin/blog']);
    } catch (error) {
      console.error('Error saving post:', error);
      alert('Error saving post');
    } finally {
      this.isSubmitting = false;
    }
  }

  onCancel() {
    this.router.navigate(['/admin/blog']);
  }
}
