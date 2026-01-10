import { Injectable, inject, PLATFORM_ID } from '@angular/core';
import { Router, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs/operators';
import { isPlatformBrowser } from '@angular/common';

declare let gtag: Function;
declare let clarity: Function;

@Injectable({
    providedIn: 'root'
})
export class AnalyticsService {
    private router = inject(Router);
    private platformId = inject(PLATFORM_ID);
    private isBrowser: boolean;

    constructor() {
        this.isBrowser = isPlatformBrowser(this.platformId);
    }

    /**
     * Initialize analytics tracking
     */
    init(): void {
        if (!this.isBrowser) {
            return;
        }

        // Track page views on route changes
        this.router.events.pipe(
            filter(event => event instanceof NavigationEnd)
        ).subscribe((event) => {
            const navEnd = event as NavigationEnd;
            this.trackPageView(navEnd.urlAfterRedirects);
        });
    }

    /**
     * Track page view
     */
    trackPageView(url: string): void {
        if (!this.isBrowser) {
            return;
        }

        // Google Analytics 4
        if (typeof gtag !== 'undefined') {
            gtag('event', 'page_view', {
                page_path: url,
                page_title: document.title,
                page_location: window.location.href
            });
        }
    }

    /**
     * Track custom event
     */
    trackEvent(eventName: string, eventParams?: any): void {
        if (!this.isBrowser) {
            return;
        }

        // Google Analytics 4
        if (typeof gtag !== 'undefined') {
            gtag('event', eventName, eventParams);
        }
    }

    /**
     * Track form submission
     */
    trackFormSubmission(formName: string, success: boolean): void {
        this.trackEvent('form_submission', {
            form_name: formName,
            success: success
        });
    }

    /**
     * Track PDF download
     */
    trackPDFDownload(pdfTitle: string, pdfCategory: string): void {
        this.trackEvent('file_download', {
            file_name: pdfTitle,
            file_category: pdfCategory,
            file_extension: 'pdf'
        });
    }

    /**
     * Track button click
     */
    trackButtonClick(buttonName: string, location: string): void {
        this.trackEvent('button_click', {
            button_name: buttonName,
            click_location: location
        });
    }

    /**
     * Track search
     */
    trackSearch(searchTerm: string, resultsCount: number): void {
        this.trackEvent('search', {
            search_term: searchTerm,
            results_count: resultsCount
        });
    }

    /**
     * Track user engagement time
     */
    trackEngagement(pageName: string, timeSpent: number): void {
        this.trackEvent('user_engagement', {
            page_name: pageName,
            engagement_time_msec: timeSpent
        });
    }

    /**
     * Track conversion (distributor form)
     */
    trackConversion(value?: number): void {
        this.trackEvent('conversion', {
            currency: 'USD',
            value: value || 0
        });
    }

    /**
     * Set custom Clarity tag
     */
    setClarityTag(key: string, value: string): void {
        if (!this.isBrowser) {
            return;
        }

        if (typeof clarity !== 'undefined') {
            clarity('set', key, value);
        }
    }

    /**
     * Identify user in Clarity
     */
    identifyUser(userId: string, userRole?: string): void {
        if (!this.isBrowser) {
            return;
        }

        if (typeof clarity !== 'undefined') {
            clarity('identify', userId, {
                role: userRole
            });
        }
    }
}
