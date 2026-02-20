import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { BlogService } from '@lib/core';
import { BlogPost } from '@lib/core';
import { Observable } from 'rxjs';
import { TranslateModule } from '@ngx-translate/core';
import { MetaService } from '../../../core/services/meta.service';

@Component({
    selector: 'app-blog-list',
    standalone: true,
    imports: [CommonModule, RouterModule, TranslateModule],
    templateUrl: './blog-list.component.html',
    styleUrls: ['./blog-list.component.css']
})
export class BlogListComponent implements OnInit {
    private blogService = inject(BlogService);
    private metaService = inject(MetaService);
    posts$!: Observable<BlogPost[]>;

    ngOnInit() {
        this.metaService.updateTags({
            title: 'Blog - Noticias y Consejos sobre Motociclismo',
            description: 'Descubre las últimas novedades, consejos de mantenimiento y tecnología en llantas de motocicleta. Blog oficial de Importadora Euro.',
            image: 'assets/images/blog-hero.jpg'
        });
        this.posts$ = this.blogService.getPosts();
    }
}
