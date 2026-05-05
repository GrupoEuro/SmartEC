import { Component, inject, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { BlogService } from '@lib/core';
import { BlogPost } from '@lib/core';
import { Observable, switchMap, tap } from 'rxjs';
import { TranslateModule } from '@ngx-translate/core';
import { FormsModule } from '@angular/forms';
import { Firestore, collection, addDoc } from '@angular/fire/firestore';
import { MetaService } from '../../../core/services/meta.service';
import { LanguageService } from '@lib/core';
import { SafeHtmlPipe } from '../../../shared/pipes/safe-html.pipe';

@Component({
    selector: 'app-blog-detail',
    standalone: true,
    imports: [CommonModule, RouterModule, TranslateModule, FormsModule, SafeHtmlPipe],
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
    private firestore = inject('FIRESTORE' as any) as Firestore;

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
        const domain = 'https://importadoraeuro.com';
        // Use dedicated OG image if available, else fall back to coverImage
        const ogImage = (post as any).ogImage || post.coverImage;

        // Update meta tags
        this.metaService.updateTags({
            title: post.title,
            description: post.excerpt,
            image: ogImage,
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
            'image': ogImage?.startsWith('http') ? ogImage : `${domain}${ogImage}`,
            'datePublished': post.date?.toISOString(),
            'dateModified': post.date?.toISOString(),
            'inLanguage': 'es-MX',
            'articleSection': post.category,
            'keywords': Array.isArray((post as any).tags) ? (post as any).tags.join(', ') : '',
            'author': {
                '@type': 'Organization',
                'name': 'Importadora Eurollantas',
                'url': domain
            },
            'publisher': {
                '@type': 'Organization',
                'name': 'Importadora Eurollantas',
                'url': domain,
                'logo': {
                    '@type': 'ImageObject',
                    'url': `${domain}/assets/images/euro-logo-new.png`
                }
            },
            'mainEntityOfPage': {
                '@type': 'WebPage',
                '@id': `${domain}/blog/${(post as any).slug || ''}`
            }
        });
    }

    ngOnDestroy(): void {
        this.metaService.removeStructuredData();
    }
}
