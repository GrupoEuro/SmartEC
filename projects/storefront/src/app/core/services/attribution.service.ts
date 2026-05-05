import { Injectable, inject, PLATFORM_ID, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import {
    Firestore, doc, setDoc, addDoc, collection,
    Timestamp, serverTimestamp,
} from '@angular/fire/firestore';
import { SessionService } from './session.service';

// ─── Interfaces ────────────────────────────────────────────────────────────────

export interface UtmParams {
    utm_source?:   string;
    utm_medium?:   string;
    utm_campaign?: string;
    utm_content?:  string;
    utm_term?:     string;
}

export interface GeoData {
    ip?:         string;
    city?:       string;
    region?:     string;
    country?:    string;
    postal?:     string;
    timezone?:   string;
    latitude?:   number;
    longitude?:  number;
    org?:        string;   // ISP / carrier name
}

export interface DeviceData {
    userAgent?:        string;
    language?:         string;
    timezone?:         string;   // IANA tz, from browser JS (no HTTP call needed)
    screenWidth?:      number;
    screenHeight?:     number;
    devicePixelRatio?: number;
    colorDepth?:       number;
    touch?:            boolean;
    mobile?:           boolean;  // navigator.userAgentData / screen size heuristic
    platform?:         string;
    connection?:       string;   // '4g', 'wifi', etc. (NetworkInformation API)
}

export interface Attribution {
    // UTM — all 5 params captured on first landing
    utm:             UtmParams;
    // Where they came from
    referrer?:       string;     // full referrer URL
    referrerDomain?: string;     // just the domain
    landingUrl?:     string;     // full URL on first page load
    landingPath?:    string;     // just the pathname
    // AI source — set when referrerDomain matches a known AI assistant
    aiSource?:       string;     // 'chatgpt' | 'perplexity' | 'claude' | 'gemini' | 'copilot' | ...
    // Device signals
    device:          DeviceData;
    // IP + approximate geo (from ipapi.co — free, HTTPS, no key required)
    geo?:            GeoData;
    // Internal campaign active on landing
    campaignId?:     string;
    campaignName?:   string;
    // When attribution was captured
    capturedAt:      number;     // Unix ms
}

// localStorage key — reuse across sessions for first-touch attribution
const STORAGE_KEY = 'euro_attribution';

/**
 * Maps referrer hostname patterns → canonical AI source label.
 * Used to classify AI-generated traffic from ChatGPT, Perplexity, Claude, Gemini, etc.
 */
export const AI_REFERRER_MAP: Record<string, string> = {
    'chat.openai.com':           'chatgpt',
    'chatgpt.com':               'chatgpt',
    'perplexity.ai':             'perplexity',
    'www.perplexity.ai':         'perplexity',
    'labs.perplexity.ai':        'perplexity',
    'claude.ai':                 'claude',
    'www.claude.ai':             'claude',
    'gemini.google.com':         'gemini',
    'bard.google.com':           'gemini',
    'copilot.microsoft.com':     'copilot',
    'www.bing.com':              'copilot',
    'you.com':                   'you',
    'poe.com':                   'poe',
    'kagi.com':                  'kagi',
    'phind.com':                 'phind',
    'mistral.ai':                'mistral',
    'chat.mistral.ai':           'mistral',
    'meta.ai':                   'meta-ai',
    'www.meta.ai':               'meta-ai',
};

/** Resolves a hostname to a canonical AI source, or undefined if not an AI referrer */
export function detectAiSource(hostname: string): string | undefined {
    if (!hostname) return undefined;
    const h = hostname.toLowerCase();
    // Direct match first
    if (AI_REFERRER_MAP[h]) return AI_REFERRER_MAP[h];
    // Subdomain match (e.g., apps.perplexity.ai)
    for (const [key, val] of Object.entries(AI_REFERRER_MAP)) {
        if (h.endsWith('.' + key) || h === key) return val;
    }
    return undefined;
}

/**
 * Recursively remove undefined fields from an object before writing to Firestore.
 *
 * IMPORTANT: Firestore special types (Timestamp, GeoPoint, DocumentReference, etc.)
 * must be passed through AS-IS — they are class instances that Firestore's SDK
 * recognizes by prototype, not by shape. Recursing into them would turn a
 * Timestamp into a plain { seconds, nanoseconds } map, which Firestore stores
 * as a regular object instead of a proper Timestamp field.
 */
export function stripUndefined<T>(obj: T): T {
    if (obj === null || obj === undefined) return obj;
    // Pass Firestore special types through untouched
    if (obj instanceof Timestamp) return obj;
    if (Array.isArray(obj)) return obj.map(stripUndefined) as any;
    if (typeof obj === 'object') {
        const clean: any = {};
        for (const [k, v] of Object.entries(obj as any)) {
            if (v !== undefined) clean[k] = stripUndefined(v);
        }
        return clean;
    }
    return obj;
}

// ─── Service ───────────────────────────────────────────────────────────────────

@Injectable({ providedIn: 'root' })
export class AttributionService {
    private platformId  = inject(PLATFORM_ID);
    private http        = inject(HttpClient);
    private fs          = inject(Firestore);
    private sessionSvc  = inject(SessionService);

    private _attribution: Attribution | null = null;

    /** Signal — available after init() resolves */
    readonly attribution = signal<Attribution | null>(null);

    /** Convenience — same sessionId used by CartService */
    get sessionId(): string { return this.sessionSvc.sessionId; }

    /**
     * Call this ONCE on app init (app.component.ngOnInit) — deferred, non-blocking.
     * Reads UTM from URL (must be called on landing while params are in the URL).
     * Makes one async call to ipapi.co for IP + geo.
     */
    async init(): Promise<void> {
        if (!isPlatformBrowser(this.platformId)) {
            console.log('[Attribution] SSR context — skipping.');
            return;
        }
        console.log('[Attribution] init() called — starting capture.');

        // If we already have stored first-touch attribution, keep it
        const stored = this.loadFromStorage();

        if (stored) {
            console.log('[Attribution] Found stored attribution from', new Date(stored.capturedAt).toLocaleTimeString());
            const freshUtm = this.captureUtm();
            const hasFreshUtm = Object.keys(freshUtm).length > 0;

            if (!stored.geo) {
                console.log('[Attribution] Geo missing from stored — re-resolving...');
                stored.geo = await this.resolveGeo();
            }

            if (hasFreshUtm) {
                console.log('[Attribution] New UTM params found — updating:', freshUtm);
                stored.utm = freshUtm;
            }

            this._attribution = stored;
            this.attribution.set(stored);
            this.saveToStorage(stored);

            // ── AI Visit: detect THIS page load's AI source (returning visitors) ──
            // Referrer is read fresh every page load. UTM fallback catches ChatGPT
            // which strips referrer headers on outbound links.
            const freshReferrer = this.captureReferrer();
            const freshAiSource = freshReferrer.aiSource
                ?? this.detectAiFromUtm(hasFreshUtm ? freshUtm : stored.utm);
            if (freshAiSource) {
                console.log('[Attribution] AI source detected on returning visit:', freshAiSource);
                this.writeAiVisit({
                    ...stored,
                    aiSource:       freshAiSource,
                    referrer:       freshReferrer.full || stored.referrer,
                    referrerDomain: freshReferrer.domain || stored.referrerDomain,
                    landingPath:    window.location.pathname,
                    landingUrl:     window.location.href,
                }).catch(e => console.warn('[Attribution] ai_visit write failed:', e));
            }

            console.log('[Attribution] ✅ Resolved from storage:', stored);
            return;
        }

        // ─── First visit capture ──────────────────────────────────────────────
        console.log('[Attribution] First visit — capturing all data...');
        const utm         = this.captureUtm();
        const referrer    = this.captureReferrer();
        const landingUrl  = window.location.href;
        const landingPath = window.location.pathname;
        const device      = this.captureDevice();
        console.log('[Attribution] Device captured:', device);
        console.log('[Attribution] Calling ipapi.co for geo...');
        const geo         = await this.resolveGeo();
        console.log('[Attribution] Geo resolved:', geo);

        // Detect AI source: referrer takes priority, UTM is the fallback.
        // ChatGPT strips referrer headers (Referrer-Policy: same-origin), so
        // utm_source=chatgpt is the only reliable signal for that platform.
        const aiSource = referrer.aiSource ?? this.detectAiFromUtm(utm);

        const attr: Attribution = {
            utm,
            referrer:       referrer.full,
            referrerDomain: referrer.domain,
            ...(aiSource ? { aiSource } : {}),
            landingUrl,
            landingPath,
            device,
            geo,
            capturedAt: Date.now(),
        };

        this._attribution = attr;
        this.attribution.set(attr);
        this.saveToStorage(attr);
        console.log('[Attribution] ✅ First-visit attribution captured and stored:', attr);

        // Write session_start to Firestore (only on new sessions)
        if (this.sessionSvc.isNewSession) {
            this.writeSessionStart(attr).catch(e =>
                console.warn('[Attribution] session_start write failed:', e)
            );
        }

        // Write ai_visit on every first-visit that is AI-sourced
        if (attr.aiSource) {
            this.writeAiVisit(attr).catch(e =>
                console.warn('[Attribution] ai_visit write failed:', e)
            );
        }
    }

    /** Attach active campaign metadata — call from CampaignService when winner resolves */
    setCampaign(id: string, name: string) {
        if (!this._attribution) return;
        this._attribution.campaignId   = id;
        this._attribution.campaignName = name;
        this.attribution.set({ ...this._attribution });
        this.saveToStorage(this._attribution);
    }

    /** Return attribution snapshot for embedding in Firestore docs */
    get(): Attribution | null {
        return this._attribution;
    }

    /**
     * Call on login/register — writes a `user_identified` event to sessionEvents
     * that maps the anonymous sessionId → authenticated uid.
     * This is the core of session stitching.
     */
    async flushSessionIdentity(uid: string, email: string): Promise<void> {
        if (!isPlatformBrowser(this.platformId)) return;
        const attr = this._attribution;
        try {
            const eventsRef = collection(this.fs, 'sessionEvents');
            await addDoc(eventsRef, stripUndefined({
                event:      'user_identified',
                sessionId:  this.sessionSvc.sessionId,
                uid,
                email,
                attribution: attr ? {
                    ...attr,
                    capturedAt: Timestamp.fromMillis(attr.capturedAt),
                } : null,
                timestamp:  Timestamp.now(),
            }));
            console.log('[Attribution] ✅ user_identified event written — uid:', uid);
        } catch (e) {
            console.warn('[Attribution] Could not write user_identified event:', e);
        }
    }

    // ─── UTM capture ────────────────────────────────────────────────────────────

    /**
     * Read UTM params from the current URL.
     * Prefers ActivatedRoute queryParams (Angular-safe) but falls back to
     * window.location.search for direct reads on app boot.
     */
    private captureUtm(queryParams?: Record<string, string>): UtmParams {
        const p: UtmParams = {};
        try {
            const keys: (keyof UtmParams)[] = [
                'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'
            ];
            // Prefer Angular router's queryParams if provided
            if (queryParams) {
                for (const k of keys) {
                    const v = queryParams[k];
                    if (v) p[k] = v;
                }
                return p;
            }
            // Fallback: raw URL (works on first page load)
            const params = new URLSearchParams(window.location.search);
            for (const k of keys) {
                const v = params.get(k);
                if (v) p[k] = v;
            }
            // Referral program: capture ?ref=CUSTOMERID
            const ref = params.get('ref');
            if (ref) (p as any)['ref'] = ref;
        } catch { /* noop */ }
        return p;
    }

    // ─── Referrer capture ───────────────────────────────────────────────────────

    private captureReferrer(): { full: string; domain: string; aiSource?: string } {
        try {
            const ref = document.referrer;
            if (!ref) return { full: '', domain: '' };
            try {
                const domain = new URL(ref).hostname;
                const aiSource = detectAiSource(domain);
                return { full: ref, domain, aiSource };
            } catch {
                return { full: ref, domain: ref };
            }
        } catch {
            return { full: '', domain: '' };
        }
    }

    // ─── Device capture (100% client-side, no HTTP) ─────────────────────────────

    private captureDevice(): DeviceData {
        try {
            const nav    = navigator;
            const screen = window.screen;

            // Connection quality (Chrome/Android, not Safari)
            let connection = '';
            try {
                const net = (nav as any).connection ||
                            (nav as any).mozConnection ||
                            (nav as any).webkitConnection;
                if (net) connection = net.effectiveType || net.type || '';
            } catch { /* noop */ }

            // Mobile heuristic — userAgentData is modern (Chrome 90+)
            let mobile = false;
            try {
                if ((nav as any).userAgentData?.mobile !== undefined) {
                    mobile = (nav as any).userAgentData.mobile;
                } else {
                    mobile = /Mobi|Android|iPhone|iPad|iPod/i.test(nav.userAgent);
                }
            } catch { mobile = false; }

            return {
                userAgent:        nav.userAgent,
                language:         nav.language || nav.languages?.[0] || '',
                timezone:         Intl.DateTimeFormat().resolvedOptions().timeZone,
                screenWidth:      screen.width,
                screenHeight:     screen.height,
                devicePixelRatio: window.devicePixelRatio,
                colorDepth:       screen.colorDepth,
                touch:            navigator.maxTouchPoints > 0,
                mobile,
                platform:         (nav as any).userAgentData?.platform || nav.platform || '',
                connection,
            };
        } catch {
            return {};
        }
    }

    // ─── AI Source from UTM params (fallback for platforms that strip referrer) ──
    /**
     * ChatGPT and some other AI platforms set Referrer-Policy: same-origin,
     * stripping the referrer on outbound links. When utm_source matches a known
     * AI platform name (e.g. 'chatgpt', 'perplexity'), classify it as AI traffic.
     */
    private detectAiFromUtm(utm: UtmParams): string | undefined {
        const src = utm?.utm_source?.toLowerCase();
        if (!src) return undefined;
        // Domain-format: ChatGPT automatically appends ?utm_source=chatgpt.com
        // Check against AI_REFERRER_MAP which already maps these domains
        if (AI_REFERRER_MAP[src]) return AI_REFERRER_MAP[src];
        // Canonical name (e.g. 'chatgpt', 'perplexity')
        const knownSources = [
            'chatgpt', 'perplexity', 'claude', 'gemini', 'copilot',
            'meta-ai', 'you', 'poe', 'kagi', 'phind', 'mistral',
        ];
        if (knownSources.includes(src)) return src;
        // utm_medium = 'ai' or 'llm' is also a reliable signal
        const med = utm?.utm_medium?.toLowerCase();
        if (med === 'ai' || med === 'llm') return src;
        return undefined;
    }

    // ─── AI Visit event (fires on EVERY page load from an AI source) ────────────
    /**
     * Unlike session_start (written once per 30-day session), this fires every
     * time a visitor arrives from an AI platform — including returning visitors.
     * This is the primary signal for the AI analytics dashboard.
     */
    private async writeAiVisit(attr: Attribution): Promise<void> {
        if (!isPlatformBrowser(this.platformId)) return;
        if (!attr.aiSource) return;
        try {
            const eventsRef = collection(this.fs, 'sessionEvents');
            await addDoc(eventsRef, stripUndefined({
                event:          'ai_visit',
                sessionId:      this.sessionSvc.sessionId,
                aiSource:       attr.aiSource,
                landingPath:    attr.landingPath,
                landingUrl:     attr.landingUrl,
                referrer:       attr.referrer,
                referrerDomain: attr.referrerDomain,
                utm:            Object.keys(attr.utm ?? {}).length > 0 ? attr.utm : undefined,
                geo:            attr.geo,
                device:         attr.device,
                campaignId:     attr.campaignId,
                campaignName:   attr.campaignName,
                timestamp:      Timestamp.now(),
            }));
            console.log('[Attribution] ✅ ai_visit written — source:', attr.aiSource);
        } catch (e) {
            console.warn('[Attribution] ai_visit write failed:', e);
        }
    }

    // ─── Session Start event ─────────────────────────────────────────────────────
    private async writeSessionStart(attr: Attribution): Promise<void> {
        try {
            const eventsRef = collection(this.fs, 'sessionEvents');
            // Use sessionId as doc ID so it's idempotent
            const sessionDocRef = doc(this.fs, `sessionEvents/${this.sessionSvc.sessionId}`);
            await setDoc(sessionDocRef, stripUndefined({
                event:      'session_start',
                sessionId:  this.sessionSvc.sessionId,
                attribution: {
                    ...attr,
                    capturedAt: Timestamp.fromMillis(attr.capturedAt),
                },
                timestamp:  Timestamp.now(),
            }));
        } catch { /* non-critical */ }
    }

    // ─── IP + Geo (via ipapi.co — free, HTTPS, no API key) ──────────────────────
    /**
     * ipapi.co gives: ip, city, region, country, postal, timezone, lat/lon, org (ISP)
     * Free tier: 30,000 requests/month (1,000/day/IP)
     * No API key required. HTTPS. No identifying cookies.
     * Docs: https://ipapi.co/developers/
     */
    private async resolveGeo(): Promise<GeoData | undefined> {
        try {
            const data = await firstValueFrom(
                this.http.get<any>('https://ipapi.co/json/', { headers: { 'Accept': 'application/json' } })
            );
            if (!data || data.error) return undefined;
            return {
                ip:        data.ip,
                city:      data.city,
                region:    data.region,
                country:   data.country_name || data.country,
                postal:    data.postal,
                timezone:  data.timezone,
                latitude:  data.latitude,
                longitude: data.longitude,
                org:       data.org,  // e.g. "AS8151 UNINET S.A. de C.V." (TELMEX)
            };
        } catch {
            return undefined;
        }
    }

    // ─── Persistence (localStorage — survives page reloads) ────────────────────

    private saveToStorage(attr: Attribution) {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(attr));
        } catch { /* noop — quota exceeded or private mode */ }
    }

    private loadFromStorage(): Attribution | null {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return null;
            const parsed: Attribution = JSON.parse(raw);
            // Expire after 30 days — avoids ancient attribution being attached to future carts
            const maxAge = 30 * 24 * 60 * 60 * 1000; // 30 days in ms
            if (Date.now() - parsed.capturedAt > maxAge) {
                localStorage.removeItem(STORAGE_KEY);
                return null;
            }
            return parsed;
        } catch {
            return null;
        }
    }
}
