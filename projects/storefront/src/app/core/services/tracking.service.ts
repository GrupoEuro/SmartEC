import { Injectable, inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Router, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs/operators';
import { TrackingConfigService, TrackingConfig } from './tracking-config.service';

/** Universal event params for cross-platform normalisation */
export interface TrackingItem {
    item_id:    string;
    item_name:  string;
    item_brand?: string;
    price:      number;
    quantity:   number;
}

export interface PurchaseParams {
    transaction_id: string;
    value:   number;
    shipping?: number;
    currency?: string;
    items:   TrackingItem[];
}

declare const gtag: Function;
declare const fbq:  Function;
declare const clarity: Function;
declare const ttq: any;

@Injectable({ providedIn: 'root' })
export class TrackingService {
    private configSvc  = inject(TrackingConfigService);
    private platformId = inject(PLATFORM_ID);
    private router     = inject(Router);
    private config: TrackingConfig | null = null;
    private initialized = false;

    /** Call once from AppComponent — injects pixel scripts and wires page_view to the router */
    async init(): Promise<void> {
        if (this.initialized) return;
        this.initialized = true;
        if (!isPlatformBrowser(this.platformId)) return;

        this.config = await this.configSvc.load();
        this.injectScripts(this.config);
        this.wirePageViews();
    }

    /** Subscribe to router NavigationEnd to fire page_view on every route change */
    private wirePageViews() {
        this.router.events.pipe(
            filter(e => e instanceof NavigationEnd)
        ).subscribe((e) => {
            const url = (e as NavigationEnd).urlAfterRedirects;
            this.trackPageView(url);
        });
    }

    // ── Script Injection ────────────────────────────────────────────────────

    private injectScripts(cfg: TrackingConfig) {
        if (cfg.gtm?.enabled && cfg.gtm.id) {
            this.injectGTM(cfg.gtm.id);
            return; // GTM manages all other pixels
        }
        if (cfg.ga4?.enabled && cfg.ga4.id)             this.injectGA4(cfg.ga4.id);
        if (cfg.meta?.enabled && cfg.meta.id)           this.injectMeta(cfg.meta.id);
        if (cfg.clarity?.enabled && cfg.clarity.id)     this.injectClarity(cfg.clarity.id);
        if (cfg.tiktok?.enabled && cfg.tiktok.id)       this.injectTikTok(cfg.tiktok.id);
        if (cfg.pinterest?.enabled && cfg.pinterest.id) this.injectPinterest(cfg.pinterest.id);
        if (cfg.snapchat?.enabled && cfg.snapchat.id)   this.injectSnapchat(cfg.snapchat.id);
        if (cfg.gads?.enabled && cfg.gads.id)           this.injectGoogleAds(cfg.gads.id);
    }

    private injectGA4(id: string) {
        // Queue stub exists in index.html already
        const s = document.createElement('script');
        s.async = true;
        s.src = `https://www.googletagmanager.com/gtag/js?id=${id}`;
        document.head.appendChild(s);
        try {
            gtag('js', new Date());
            gtag('config', id, { send_page_view: false });
        } catch { /* gtag stub not yet defined */ }
    }

    private injectMeta(id: string) {
        if ((window as any).fbq) return;
        const f = window as any;
        f.fbq = function(...a: any[]) { f.fbq.callMethod ? f.fbq.callMethod(...a) : f.fbq.queue.push(a); };
        if (!f._fbq) f._fbq = f.fbq;
        f.fbq.push = f.fbq; f.fbq.loaded = true; f.fbq.version = '2.0'; f.fbq.queue = [];
        const s = document.createElement('script'); s.async = true;
        s.src = 'https://connect.facebook.net/en_US/fbevents.js';
        document.head.appendChild(s);
        f.fbq('init', id);
        f.fbq('track', 'PageView');
    }

    private injectClarity(id: string) {
        if ((window as any).clarity?.q) return;
        const c = window as any;
        c.clarity = c.clarity || function(...a: any[]) { (c.clarity.q = c.clarity.q || []).push(a); };
        const s = document.createElement('script'); s.async = true;
        s.src = `https://www.clarity.ms/tag/${id}`;
        document.head.appendChild(s);
    }

    private injectTikTok(id: string) {
        if ((window as any).ttq) return;
        const t = window as any;
        t.TiktokAnalyticsObject = 'ttq';
        t.ttq = t.ttq || [];
        t.ttq.methods = ['page','track','identify','instances','debug','on','off','once','ready','alias','group','enableCookie','disableCookie'];
        t.ttq.setAndDefer = function(o: any, e: any) { o[e] = function(...a: any[]) { o.push([e].concat(a)); }; };
        t.ttq.methods.forEach((m: string) => t.ttq.setAndDefer(t.ttq, m));
        t.ttq.instance = function(t2: any) { const i = t.ttq._i[t2] || []; i._u = t2; return i; };
        t.ttq.load = function(e: string, n: any) {};
        const s = document.createElement('script'); s.async = true;
        s.src = `https://analytics.tiktok.com/i18n/pixel/events.js?sdkid=${id}&lib=ttq`;
        document.head.appendChild(s);
        t.ttq.page();
    }

    private injectPinterest(id: string) {
        const e = window as any;
        e.pintrk = e.pintrk || function(...a: any[]) { e.pintrk.queue = e.pintrk.queue || []; e.pintrk.queue.push(a); };
        const s = document.createElement('script'); s.async = true;
        s.src = 'https://s.pinimg.com/ct/core.js';
        document.head.appendChild(s);
        e.pintrk('load', id, { np: 'general' });
        e.pintrk('page');
    }

    private injectSnapchat(id: string) {
        const e = window as any;
        e.snaptr = e.snaptr || function(...a: any[]) { e.snaptr.handleRequest ? e.snaptr.handleRequest(...a) : (e.snaptr.queue = e.snaptr.queue || []).push(a); };
        const s = document.createElement('script'); s.async = true;
        s.src = 'https://sc-static.net/scevent.min.js';
        document.head.appendChild(s);
        e.snaptr('init', id, {});
        e.snaptr('track', 'PAGE_VIEW');
    }

    private injectGoogleAds(id: string) {
        // Google Ads uses gtag — inject the conversion linker
        const s = document.createElement('script'); s.async = true;
        s.src = `https://www.googletagmanager.com/gtag/js?id=${id}`;
        document.head.appendChild(s);
        try { gtag('config', id); } catch { /* queue */ }
    }

    private injectGTM(id: string) {
        // Standard GTM snippet
        (window as any).dataLayer = (window as any).dataLayer || [];
        (function(w: any, d, s, l, i) {
            w[l] = w[l] || [];
            w[l].push({ 'gtm.start': new Date().getTime(), event: 'gtm.js' });
            const f = d.getElementsByTagName(s)[0];
            const j = d.createElement(s) as HTMLScriptElement;
            j.async = true;
            j.src = `https://www.googletagmanager.com/gtm.js?id=${i}`;
            f.parentNode!.insertBefore(j, f);
        })(window, document, 'script', 'dataLayer', id);
    }

    // ── Unified Event Firing ────────────────────────────────────────────────

    trackPageView(url: string) {
        if (!this.config) return;
        const { ga4, meta, clarity: clar, tiktok } = this.config;

        if (ga4?.enabled)     try { gtag('event', 'page_view', { page_path: url, page_title: document.title, page_location: window.location.href }); } catch {}
        if (meta?.enabled)    try { fbq('track', 'PageView'); } catch {}
        if (clar?.enabled)    try { clarity('set', 'page', url); } catch {}
        if (tiktok?.enabled)  try { ttq.page(); } catch {}
    }

    trackViewItem(currency = 'MXN', value: number, items: TrackingItem[]) {
        if (!this.config) return;
        const { ga4, meta, tiktok, pinterest } = this.config;
        const first = items[0];

        if (ga4?.enabled)      try { gtag('event', 'view_item', { currency, value, items: this.toGA4Items(items) }); } catch {}
        if (meta?.enabled)     try { fbq('track', 'ViewContent', { content_ids: items.map(i => i.item_id), content_type: 'product', value, currency }); } catch {}
        if (tiktok?.enabled)   try { ttq.track('ViewContent', { content_id: first?.item_id, content_type: 'product', value, currency }); } catch {}
        if (pinterest?.enabled) try { (window as any).pintrk('track', 'pagevisit', { value, currency, line_items: this.toPinterestItems(items) }); } catch {}
    }

    trackAddToCart(currency = 'MXN', value: number, items: TrackingItem[]) {
        if (!this.config) return;
        const { ga4, meta, tiktok, pinterest, snapchat } = this.config;
        const first = items[0];

        if (ga4?.enabled)      try { gtag('event', 'add_to_cart', { currency, value, items: this.toGA4Items(items) }); } catch {}
        if (meta?.enabled)     try { fbq('track', 'AddToCart', { content_ids: items.map(i => i.item_id), content_type: 'product', value, currency }); } catch {}
        if (tiktok?.enabled)   try { ttq.track('AddToCart', { content_id: first?.item_id, content_type: 'product', value, currency }); } catch {}
        if (pinterest?.enabled) try { (window as any).pintrk('track', 'addtocart', { value, currency, line_items: this.toPinterestItems(items) }); } catch {}
        if (snapchat?.enabled) try { (window as any).snaptr('track', 'ADD_CART'); } catch {}
    }

    trackRemoveFromCart(currency = 'MXN', value: number, items: TrackingItem[]) {
        if (!this.config) return;
        const { ga4 } = this.config;
        if (ga4?.enabled) try { gtag('event', 'remove_from_cart', { currency, value, items: this.toGA4Items(items) }); } catch {}
    }

    trackBeginCheckout(currency = 'MXN', value: number, items: TrackingItem[]) {
        if (!this.config) return;
        const { ga4, meta, tiktok, pinterest, snapchat } = this.config;

        if (ga4?.enabled)      try { gtag('event', 'begin_checkout', { currency, value, items: this.toGA4Items(items) }); } catch {}
        if (meta?.enabled)     try { fbq('track', 'InitiateCheckout', { content_ids: items.map(i => i.item_id), value, currency, num_items: items.reduce((s, i) => s + i.quantity, 0) }); } catch {}
        if (tiktok?.enabled)   try { ttq.track('InitiateCheckout', { value, currency }); } catch {}
        if (pinterest?.enabled) try { (window as any).pintrk('track', 'checkout', { value, currency, line_items: this.toPinterestItems(items) }); } catch {}
        if (snapchat?.enabled) try { (window as any).snaptr('track', 'START_CHECKOUT', { price: value, currency }); } catch {}
    }

    trackPurchase(params: PurchaseParams) {
        if (!this.config) return;
        const { ga4, meta, tiktok, pinterest, snapchat, gads } = this.config;
        const currency = params.currency ?? 'MXN';

        if (ga4?.enabled) try {
            gtag('event', 'purchase', {
                transaction_id: params.transaction_id,
                currency, value: params.value, shipping: params.shipping ?? 0,
                items: this.toGA4Items(params.items)
            });
        } catch {}

        if (meta?.enabled) try {
            fbq('track', 'Purchase', {
                content_ids: params.items.map(i => i.item_id),
                content_type: 'product', value: params.value, currency,
                num_items: params.items.reduce((s, i) => s + i.quantity, 0)
            });
        } catch {}

        if (tiktok?.enabled) try {
            ttq.track('CompletePayment', {
                content_id: params.items[0]?.item_id,
                content_type: 'product', value: params.value, currency,
                quantity: params.items.reduce((s, i) => s + i.quantity, 0)
            });
        } catch {}

        if (pinterest?.enabled) try {
            (window as any).pintrk('track', 'checkout', {
                value: params.value, currency, order_id: params.transaction_id,
                line_items: this.toPinterestItems(params.items)
            });
        } catch {}

        if (snapchat?.enabled) try {
            (window as any).snaptr('track', 'PURCHASE', { price: params.value, currency, transaction_id: params.transaction_id });
        } catch {}

        if (gads?.enabled) try {
            gtag('event', 'conversion', { send_to: this.config.gads.id, value: params.value, currency });
        } catch {}
    }

    trackSearch(term: string, resultsCount: number) {
        if (!this.config) return;
        const { ga4, meta } = this.config;
        if (ga4?.enabled)  try { gtag('event', 'search', { search_term: term, results_count: resultsCount }); } catch {}
        if (meta?.enabled) try { fbq('track', 'Search', { search_string: term }); } catch {}
    }

    // ── Format Helpers ──────────────────────────────────────────────────────

    private toGA4Items(items: TrackingItem[]) {
        return items.map(i => ({
            item_id: i.item_id, item_name: i.item_name,
            item_brand: i.item_brand, price: i.price, quantity: i.quantity
        }));
    }

    private toPinterestItems(items: TrackingItem[]) {
        return items.map(i => ({
            product_id: i.item_id, product_name: i.item_name,
            product_price: i.price, product_quantity: i.quantity
        }));
    }
}
