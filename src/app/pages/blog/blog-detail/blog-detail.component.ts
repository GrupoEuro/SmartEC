import { Component, inject, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { BlogService } from '../../../core/services/blog.service';
import { BlogPost } from '../../../core/models/blog.model';
import { Observable, switchMap, tap } from 'rxjs';
import { TranslateModule } from '@ngx-translate/core';
import { FormsModule } from '@angular/forms';
import { Firestore, collection, addDoc } from '@angular/fire/firestore';
import { MetaService } from '../../../core/services/meta.service';
import { LanguageService } from '../../../core/services/language.service';

@Component({
    selector: 'app-blog-detail',
    standalone: true,
    imports: [CommonModule, RouterModule, TranslateModule, FormsModule],
    templateUrl: './blog-detail.component.html',
    styleUrls: ['./blog-detail.component.css']
})
export class BlogDetailComponent implements OnInit, OnDestroy {
    private route = inject(ActivatedRoute);
    private blogService = inject(BlogService);
    private metaService = inject(MetaService);
    private languageService = inject(LanguageService);

    post$!: Observable<BlogPost | undefined>;
    relatedPosts$!: Observable<BlogPost[]>;

    ngOnInit() {
        this.post$ = this.route.paramMap.pipe(
            switchMap(params => {
                const slug = params.get('slug');
                return this.blogService.getPostBySlug(slug || '');
            }),
            tap(post => {
                if (post) {
                    this.updateSEO(post);
                }
            })
        );
    }

    // Newsletter Logic
    email = '';
    isSubscribing = false;
    subscribeSuccess = false;
    private firestore = inject(Firestore);

    async subscribe() {
        if (!this.email) return;

        this.isSubscribing = true;
        try {
            await addDoc(collection(this.firestore, 'newsletter'), {
                email: this.email,
                date: new Date(),
                source: 'blog-detail'
            });
            this.subscribeSuccess = true;
            this.email = '';
        } catch (e) {
            console.error('Newsletter error:', e);
        } finally {
            this.isSubscribing = false;
        }
    }

    private updateSEO(post: BlogPost): void {
        // Update meta tags
        this.metaService.updateTags({
            title: post.title,
            description: post.excerpt,
            image: post.coverImage,
            type: 'article',
            author: post.author.name,
            publishedTime: post.date?.toISOString(),
            modifiedTime: post.date?.toISOString()
        });

        // Add Article structured data
        this.metaService.addStructuredData({
            '@context': 'https://schema.org',
            '@type': 'Article',
            'headline': post.title,
            'description': post.excerpt,
            'image': post.coverImage,
            'datePublished': post.date?.toISOString(),
            'dateModified': post.date?.toISOString(),
            'author': {
                '@type': 'Person',
                'name': post.author.name
            },
            'publisher': {
                '@type': 'Organization',
                'name': 'Importadora Eurollantas',
                'logo': {
                    '@type': 'ImageObject',
                    'url': 'https://tiendapraxis.web.app/assets/images/logo.png'
                }
            },
            'mainEntityOfPage': {
                '@type': 'WebPage',
                '@id': window.location.href
            }
        });
    }

    ngOnDestroy(): void {
        this.metaService.removeStructuredData();
    }
}
