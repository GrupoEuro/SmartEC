import { Component, inject, OnInit, Signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, NavigationEnd, RouterModule, ActivatedRoute } from '@angular/router';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { TranslateService } from '@ngx-translate/core';
import { HelpSearchService } from '../../services/help-search.service';
import { HelpContentService } from '../../services/help-content.service';
import { debounceTime, distinctUntilChanged, switchMap, filter, map } from 'rxjs/operators';
import { Observable, of, firstValueFrom } from 'rxjs';
import { toSignal } from '@angular/core/rxjs-interop';

@Component({
    selector: 'app-help-header',
    standalone: true,
    imports: [CommonModule, RouterModule, ReactiveFormsModule],
    template: `
    <header class="help-header">
        <!-- Left: Home + Breadcrumbs -->
        <div class="header-left">
             <a routerLink="/help" class="glass-btn icon-btn home-btn" title="Help Home">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                </svg>
             </a>

             <nav class="breadcrumbs">
                <ng-container *ngFor="let crumb of breadcrumbs(); let last = last">
                    <span class="crumb-separator">
                         <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
                         </svg>
                    </span>
                    <a [routerLink]="crumb.url" class="crumb-link" [class.active]="last">
                        {{ crumb.label }}
                    </a>
                </ng-container>
            </nav>
        </div>

        <!-- Center: Search -->
        <div class="header-center">
             <div class="glass-input-wrapper">
                <span class="search-icon">
                   <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                     <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                   </svg>
                </span>
                <input 
                  [formControl]="searchControl"
                  type="text" 
                  placeholder="Search guides (e.g. 'Returns', 'Stock')" 
                  class="search-input"
                  (focus)="showResults = true"
                  (blur)="onBlur()"
                />
                <button *ngIf="searchControl.value" (click)="clearSearch()" class="clear-btn">×</button>
            </div>

            <!-- Search Results Dropdown -->
            <div *ngIf="showResults && (searchResults$ | async) as results" class="search-dropdown" 
                 [class.has-results]="results.topics.length > 0 || results.terms.length > 0">
                 
                <div *ngIf="searchControl.value && results.topics.length === 0 && results.terms.length === 0" class="no-results">
                    No matches found for "{{searchControl.value}}"
                </div>

                <!-- Terms -->
                <div *ngIf="results.terms.length > 0" class="result-section">
                    <h4>Glossary</h4>
                    <div class="result-list">
                        <div *ngFor="let term of results.terms.slice(0, 3)" class="result-item term" (click)="navigateTo('glossary', term)">
                            <span class="icon">📚</span>
                            <div class="info">
                                <span class="name">{{ term.term }}</span>
                                <span class="desc">{{ term.definition | slice:0:60 }}...</span>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Topics -->
                <div *ngIf="results.topics.length > 0" class="result-section">
                    <h4>Guides</h4>
                    <div class="result-list">
                        <a *ngFor="let topic of results.topics.slice(0, 3)" [routerLink]="['/help/topic', topic.id]" class="result-item topic">
                            <span class="icon">📄</span>
                            <div class="info">
                                <span class="name">{{ topic.title }}</span>
                                <span class="desc">{{ topic.category }}</span>
                            </div>
                        </a>
                    </div>
                </div>
            </div>
        </div>

        <!-- Right: Actions -->
        <div class="header-right">
             <!-- Language Switcher -->
            <button (click)="toggleLang()" class="glass-btn lang-btn">
                <ng-container *ngIf="currentLang === 'es'; else enTemplate">
                    <div class="lang-content">
                        <span class="flag-icon">🇲🇽</span>
                        <span class="lang-code">ES</span>
                    </div>
                </ng-container>
                <ng-template #enTemplate>
                    <div class="lang-content">
                        <span class="flag-icon">🇺🇸</span>
                        <span class="lang-code">EN</span>
                    </div>
                </ng-template>
            </button>
        </div>
    </header>
  `,
    styles: [`
    :host {
        display: block;
        position: sticky;
        top: 0;
        z-index: 100;
        width: 100%;
        height: 88px; /* Fixed Height matching Command Center */
        background: rgba(15, 23, 42, 0.8);
        backdrop-filter: blur(16px);
        border-bottom: 1px solid rgba(148, 163, 184, 0.1);
    }

    .help-header {
        height: 100%;
        width: 100%;
        padding: 0 2rem;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 2rem;
        box-sizing: border-box;
    }

    /* Left: Breadcrumbs */
    .header-left { 
        flex: 1; 
        min-width: 0; /* Allow shrinking */
        display: flex;
        align-items: center;
        gap: 1rem;
    }
    
    .home-btn {
        margin-right: 0.5rem;
    }

    .breadcrumbs {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        font-size: 0.875rem;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .crumb-link {
        color: #94a3b8;
        text-decoration: none;
        transition: color 0.2s;
        font-weight: 500;
        display: flex;
        align-items: center;
    }

    .crumb-link:hover { color: #e2e8f0; }

    .crumb-link.active {
        color: #fbbf24; /* Amber accent */
        font-weight: 600;
        pointer-events: none;
    }

    .crumb-separator {
        color: #64748b;
        display: flex;
        align-items: center;
    }

    /* Center: Search (Glass Style) */
    .header-center {
        flex: 1;
        display: flex;
        justify-content: center;
        max-width: 480px;
        position: relative;
    }

    .glass-input-wrapper {
        background: rgba(30, 41, 59, 0.4);
        border: 1px solid rgba(148, 163, 184, 0.1);
        border-radius: 0.75rem;
        padding: 0 0.75rem;
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        width: 100%;
        height: 40px;
        display: flex;
        align-items: center;
        gap: 0.75rem;
    }

    .glass-input-wrapper:focus-within {
        background: rgba(30, 41, 59, 0.8);
        border-color: rgba(251, 191, 36, 0.5);
        box-shadow: 0 0 0 1px rgba(251, 191, 36, 0.2), 0 4px 12px rgba(0, 0, 0, 0.1);
    }

    .search-icon { color: #64748b; display: flex; }
    .glass-input-wrapper:focus-within .search-icon { color: #fbbf24; }

    .search-input {
        flex: 1;
        background: none;
        border: none;
        color: #f1f5f9;
        font-size: 0.875rem;
        outline: none;
        width: 100%;
        height: 100%;
    }

    .search-input::placeholder { color: #64748b; }

    .clear-btn {
        background: none;
        border: none;
        color: #94a3b8;
        font-size: 1.2rem;
        cursor: pointer;
        padding: 0;
        display: flex;
    }
    .clear-btn:hover { color: #fff; }

    /* Dropdown */
    .search-dropdown {
        position: absolute;
        top: calc(100% + 0.5rem);
        left: 0;
        right: 0;
        background: #1e293b;
        border: 1px solid #334155;
        border-radius: 12px;
        box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5);
        overflow: hidden;
        max-height: 400px;
        overflow-y: auto;
        z-index: 101;
    }
    
    .result-section h4 {
        margin: 0;
        padding: 0.5rem 1rem;
        font-size: 0.7rem;
        text-transform: uppercase;
        color: #94a3b8;
        background: #0f172a;
        font-weight: 600;
        letter-spacing: 0.05em;
    }

    .result-item {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        padding: 0.75rem 1rem;
        border-bottom: 1px solid #334155;
        cursor: pointer;
        text-decoration: none;
        transition: background 0.15s;
    }
    .result-item:hover { background: #334155; }
    .result-item:last-child { border-bottom: none; }
    .result-item .icon { font-size: 1.2rem; }
    .result-item .name { color: #f1f5f9; font-weight: 500; font-size: 0.9rem; display: block; }
    .result-item .desc { color: #94a3b8; font-size: 0.8rem; }
    .no-results { padding: 1.5rem; text-align: center; color: #94a3b8; }

    /* Right Actions */
    .header-right { 
        display: flex; 
        align-items: center; 
        gap: 1rem; 
        justify-content: flex-end;
        flex: 1;
    }

    /* Glass Button (Shared UX) */
    .glass-btn {
        background: rgba(30, 41, 59, 0.4);
        border: 1px solid rgba(148, 163, 184, 0.1);
        border-radius: 0.75rem;
        color: #e2e8f0;
        cursor: pointer;
        transition: all 0.2s;
        display: flex;
        align-items: center;
        justify-content: center;
        height: 40px;
        padding: 0 1rem;
        font-weight: 600;
        font-size: 0.875rem;
    }

    .icon-btn {
        padding: 0;
        width: 40px;
    }

    .glass-btn:hover {
        background: rgba(30, 41, 59, 0.7);
        border-color: rgba(148, 163, 184, 0.3);
        transform: translateY(-1px);
    }

    .lang-content {
        display: flex;
        align-items: center;
        gap: 0.5rem;
    }
    .flag-icon { font-size: 1.1em; }
    .lang-code { letter-spacing: 0.05em; }

  `]
})
export class HelpHeaderComponent {
    private searchService = inject(HelpSearchService);
    private helpContentService = inject(HelpContentService); // To fetch titles
    private translate = inject(TranslateService);
    private router = inject(Router);
    private route = inject(ActivatedRoute);

    // Search
    searchControl = new FormControl('');
    showResults = false;
    searchResults$ = this.searchControl.valueChanges.pipe(
        debounceTime(300),
        distinctUntilChanged(),
        switchMap(term => {
            if (!term || term.length < 2) return of({ topics: [], terms: [] });
            return this.searchService.search(term);
        })
    );

    // Dynamic Breadcrumbs
    breadcrumbs = toSignal(
        this.router.events.pipe(
            filter(event => event instanceof NavigationEnd),
            switchMap(() => this.buildBreadcrumbs()),
            map(crumbs => crumbs)
        ),
        { initialValue: [{ label: 'Help Center', url: '/help' }] }
    );

    async buildBreadcrumbs(): Promise<{ label: string, url: string }[]> {
        const url = this.router.url;
        const crumbs = [{ label: 'Help Center', url: '/help' }];

        if (url.includes('/help/glossary')) {
            crumbs.push({ label: 'Glossary', url: '/help/glossary' });
        } else if (url.includes('/help/topic')) {
            // Extract ID
            const id = url.split('/').pop() || '';
            if (id) {
                // We need to fetch the topic title synchronously or waiting for it
                // Since getTopicById returns Observable, we convert to Promise
                try {
                    const topic = await firstValueFrom(this.helpContentService.getTopicById(id));
                    if (topic) {
                        crumbs.push({ label: topic.category, url: '/help' }); // Or category filter?
                        crumbs.push({ label: topic.title, url: url });
                    }
                } catch (e) {
                    crumbs.push({ label: 'Topic', url: url });
                }
            }
        }
        return crumbs;
    }

    get currentLang() { return this.translate.currentLang || 'en'; }

    toggleLang() {
        const newLang = this.currentLang === 'en' ? 'es' : 'en';
        this.translate.use(newLang);
    }

    clearSearch() {
        this.searchControl.setValue('');
        this.showResults = false;
    }

    onBlur() {
        setTimeout(() => { this.showResults = false; }, 200);
    }

    navigateTo(type: 'topic' | 'glossary', item: any) {
        if (type === 'glossary') {
            this.router.navigate(['/help/glossary'], { queryParams: { term: item.term } });
        }
    }
}
