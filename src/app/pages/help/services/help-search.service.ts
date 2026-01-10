import { Injectable, inject } from '@angular/core';
import { combineLatest, map, Observable } from 'rxjs';
import { HelpContentService, HelpTopic } from './help-content.service';
import { HelpGlossaryService, GlossaryTerm } from './help-glossary.service';

export interface HelpSearchResult {
    topics: HelpTopic[];
    terms: GlossaryTerm[];
}

@Injectable({
    providedIn: 'root'
})
export class HelpSearchService {
    private helpService = inject(HelpContentService);
    private glossaryService = inject(HelpGlossaryService);

    search(query: string): Observable<HelpSearchResult> {
        return combineLatest([
            this.helpService.getTopics(),
            this.glossaryService.getTerms()
        ]).pipe(
            map(([topics, terms]) => {
                const q = (query || '').toLowerCase().trim();

                if (!q) {
                    return { topics: [], terms: [] };
                }

                const filteredTopics = topics.filter(t =>
                    t.title.toLowerCase().includes(q) ||
                    t.description.toLowerCase().includes(q) ||
                    t.category.toLowerCase().includes(q)
                );

                const filteredTerms = terms.filter(t =>
                    t.term.toLowerCase().includes(q) ||
                    t.definition.toLowerCase().includes(q) ||
                    t.tags?.some(tag => tag.toLowerCase().includes(q))
                );

                // Zero-Result Tracking
                if (filteredTopics.length === 0 && filteredTerms.length === 0) {
                    // TODO: Connect to Analytics Service
                    console.warn(`[Analytics] Search No-Results: "${q}"`);
                }

                return { topics: filteredTopics, terms: filteredTerms };
            })
        );
    }
}
