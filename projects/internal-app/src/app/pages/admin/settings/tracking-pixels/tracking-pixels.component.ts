import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TrackingConfig, TrackingConfigService, DEFAULT_TRACKING_CONFIG, PixelConfig } from '../../../../core/services/tracking-config.service';
import { AuthService } from '../../../../core/services/auth.service';

// Re-export for template usage
export { PixelConfig };

interface Platform {
    key:         keyof Omit<TrackingConfig, 'updatedAt' | 'updatedBy'>;
    name:        string;
    description: string;
    docsUrl:     string;
    icon:        string;       // SVG path or emoji
    idLabel:     string;
    idPlaceholder: string;
    idPattern:   string;       // regex hint
    color:       string;       // accent colour class
    badge?:      string;
}

const PLATFORMS: Platform[] = [
    {
        key: 'ga4', name: 'Google Analytics 4', color: 'orange',
        description: 'Page views, e-commerce funnel, conversions',
        docsUrl: 'https://analytics.google.com',
        icon: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12.545 10.239v3.821h5.445c-.712 2.315-2.647 3.972-5.445 3.972a6.033 6.033 0 1 1 0-12.064c1.498 0 2.866.549 3.921 1.453l2.814-2.814A9.969 9.969 0 0 0 12.545 2C7.021 2 2.543 6.477 2.543 12s4.478 10 10.002 10c8.396 0 10.249-7.85 9.426-11.748z"/></svg>`,
        idLabel: 'Measurement ID', idPlaceholder: 'G-XXXXXXXXXX',
        idPattern: 'G-[A-Z0-9]+'
    },
    {
        key: 'meta', name: 'Meta (Facebook) Pixel', color: 'blue',
        description: 'Facebook & Instagram ads, retargeting, lookalike audiences',
        docsUrl: 'https://business.facebook.com/events_manager',
        icon: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>`,
        idLabel: 'Pixel ID', idPlaceholder: '1234567890123456',
        idPattern: '[0-9]{15,16}',
        badge: 'Most Important'
    },
    {
        key: 'clarity', name: 'Microsoft Clarity', color: 'indigo',
        description: 'Session recordings, heatmaps, rage click detection',
        docsUrl: 'https://clarity.microsoft.com',
        icon: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M11.5 2C6.262 2 2 6.262 2 11.5S6.262 21 11.5 21 21 16.738 21 11.5 16.738 2 11.5 2zm0 18C7.364 20 4 16.636 4 12.5S7.364 5 11.5 5 19 8.364 19 12.5 15.636 20 11.5 20z"/></svg>`,
        idLabel: 'Project ID', idPlaceholder: 'abcde12345',
        idPattern: '[a-z0-9]+'
    },
    {
        key: 'tiktok', name: 'TikTok Pixel', color: 'pink',
        description: 'TikTok Ads conversions, retargeting, custom audiences',
        docsUrl: 'https://ads.tiktok.com/i18n/events-manager',
        icon: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 0 0-.79-.05 6.34 6.34 0 0 0-6.34 6.34 6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.33-6.34V8.19a8.2 8.2 0 0 0 4.8 1.54V6.28a4.84 4.84 0 0 1-1.03-.41z"/></svg>`,
        idLabel: 'Pixel Code', idPlaceholder: 'ABCDE1234567890',
        idPattern: '[A-Z0-9]+'
    },
    {
        key: 'pinterest', name: 'Pinterest Tag', color: 'red',
        description: 'Pinterest Ads tracking — ideal for product discovery',
        docsUrl: 'https://ads.pinterest.com',
        icon: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.373 0 0 5.373 0 12c0 5.084 3.163 9.426 7.627 11.174-.105-.949-.2-2.405.042-3.441.218-.937 1.407-5.965 1.407-5.965s-.359-.719-.359-1.782c0-1.668.967-2.914 2.171-2.914 1.023 0 1.518.769 1.518 1.69 0 1.029-.655 2.568-.994 3.995-.283 1.194.599 2.169 1.777 2.169 2.133 0 3.772-2.249 3.772-5.495 0-2.873-2.064-4.882-5.012-4.882-3.414 0-5.418 2.561-5.418 5.207 0 1.031.397 2.138.893 2.738a.36.36 0 0 1 .083.345l-.333 1.36c-.053.22-.174.267-.402.161-1.499-.698-2.436-2.889-2.436-4.649 0-3.785 2.75-7.262 7.929-7.262 4.163 0 7.398 2.967 7.398 6.931 0 4.136-2.607 7.464-6.227 7.464-1.216 0-2.359-.632-2.75-1.378l-.748 2.853c-.271 1.043-1.002 2.35-1.492 3.146C9.57 23.812 10.763 24 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0z"/></svg>`,
        idLabel: 'Tag ID', idPlaceholder: '1234567890123',
        idPattern: '[0-9]+'
    },
    {
        key: 'snapchat', name: 'Snapchat Pixel', color: 'yellow',
        description: 'Snapchat Ads conversions and audience building',
        docsUrl: 'https://ads.snapchat.com',
        icon: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12.017 0C5.396 0 .029 5.367.029 11.987c0 5.079 3.158 9.417 7.618 11.162-.105-.949-.2-2.405.042-3.441.218-.937 1.407-5.965 1.407-5.965s-.359-.719-.359-1.782c0-1.668.967-2.914 2.171-2.914 1.023 0 1.518.769 1.518 1.69 0 1.029-.655 2.568-.994 3.995-.283 1.194.599 2.169 1.777 2.169 2.133 0 3.772-2.249 3.772-5.495 0-2.873-2.064-4.882-5.012-4.882-3.414 0-5.418 2.561-5.418 5.207 0 1.031.397 2.138.893 2.738.098.119.112.224.083.345l-.333 1.36c-.053.22-.174.267-.402.161-1.499-.698-2.436-2.889-2.436-4.649 0-3.785 2.75-7.262 7.929-7.262 4.163 0 7.398 2.967 7.398 6.931 0 4.136-2.607 7.464-6.227 7.464-1.216 0-2.359-.632-2.75-1.378l-.748 2.853c-.271 1.043-1.002 2.35-1.492 3.146C9.616 23.816 10.815 24 12.017 24c6.624 0 11.99-5.367 11.99-11.987C24.007 5.367 18.641.001 12.017.001z"/></svg>`,
        idLabel: 'Pixel ID', idPlaceholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
        idPattern: '[a-f0-9-]+'
    },
    {
        key: 'gads', name: 'Google Ads', color: 'green',
        description: 'Google Ads conversion tracking (separate from GA4)',
        docsUrl: 'https://ads.google.com',
        icon: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M2.167 19.502L9.5 7.332 12.5 12.5 9.5 17.667H2.167zm12.833 0L21.833 7.332 18.5 1.5 8.833 19.502h6.167zM15 19.502h6.167L18.5 24z"/></svg>`,
        idLabel: 'Conversion Tag ID', idPlaceholder: 'AW-XXXXXXXXX/XXXXXXXXXXXXXXXX',
        idPattern: 'AW-.+'
    },
    {
        key: 'gtm', name: 'Google Tag Manager', color: 'teal',
        description: 'Container mode — manages all other pixels via GTM dashboard. When enabled, individual scripts above are ignored.',
        docsUrl: 'https://tagmanager.google.com',
        icon: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 0L1 6v12l11 6 11-6V6L12 0zM8.4 17.2L4 12l4.4-5.2 1.6 1.4L6.2 12l3.8 4.4-1.6 1.8zm7.2 0l-1.6-1.8L17.8 12l-3.8-4.4 1.6-1.4L20 12l-4.4 5.2z"/></svg>`,
        idLabel: 'Container ID', idPlaceholder: 'GTM-XXXXXXX',
        idPattern: 'GTM-[A-Z0-9]+',
        badge: 'Pro Mode'
    }
];

@Component({
    selector: 'app-tracking-pixels',
    standalone: true,
    imports: [CommonModule, FormsModule],
    templateUrl: './tracking-pixels.component.html',
    styleUrls: ['./tracking-pixels.component.css']
})
export class TrackingPixelsComponent implements OnInit {
    private configSvc = inject(TrackingConfigService);
    private auth      = inject(AuthService);

    platforms        = PLATFORMS;
    config           = signal<TrackingConfig>({ ...DEFAULT_TRACKING_CONFIG });
    isSaving         = signal(false);
    saveSuccess      = signal(false);
    isLoading        = signal(true);
    showIds          = signal<Record<string, boolean>>({});

    async ngOnInit() {
        this.isLoading.set(true);
        const loaded = await this.configSvc.load();
        this.config.set(loaded);
        this.isLoading.set(false);
    }

    getPixel(key: string): PixelConfig {
        const cfg = this.config() as any;
        return cfg[key] ?? { enabled: false, id: '' };
    }

    setEnabled(key: string, value: boolean) {
        const current = { ...this.config() } as any;
        current[key] = { ...current[key], enabled: value };
        this.config.set(current);
    }

    setId(key: string, id: string) {
        const current = { ...this.config() } as any;
        current[key] = { ...current[key], id };
        this.config.set(current);
    }

    toggleShowId(key: string) {
        const current = { ...this.showIds() };
        current[key] = !current[key];
        this.showIds.set(current);
    }

    isIdVisible(key: string): boolean {
        return this.showIds()[key] ?? false;
    }

    getEnabledCount(): number {
        const cfg = this.config() as any;
        return PLATFORMS.filter(p => cfg[p.key]?.enabled && cfg[p.key]?.id).length;
    }

    async save() {
        this.isSaving.set(true);
        try {
            const user = this.auth.currentUser();
            await this.configSvc.save(this.config(), user?.email ?? undefined);
            this.saveSuccess.set(true);
            setTimeout(() => this.saveSuccess.set(false), 3000);
        } catch (e) {
            console.error('Failed to save tracking config:', e);
        } finally {
            this.isSaving.set(false);
        }
    }

    getColorClass(color: string, type: 'bg' | 'border' | 'text' | 'ring'): string {
        const map: Record<string, Record<string, string>> = {
            orange:  { bg: 'bg-orange-500/10', border: 'border-orange-500/30', text: 'text-orange-400', ring: 'ring-orange-500/40' },
            blue:    { bg: 'bg-blue-500/10',   border: 'border-blue-500/30',   text: 'text-blue-400',   ring: 'ring-blue-500/40' },
            indigo:  { bg: 'bg-indigo-500/10', border: 'border-indigo-500/30', text: 'text-indigo-400', ring: 'ring-indigo-500/40' },
            pink:    { bg: 'bg-pink-500/10',   border: 'border-pink-500/30',   text: 'text-pink-400',   ring: 'ring-pink-500/40' },
            red:     { bg: 'bg-red-500/10',    border: 'border-red-500/30',    text: 'text-red-400',    ring: 'ring-red-500/40' },
            yellow:  { bg: 'bg-yellow-500/10', border: 'border-yellow-500/30', text: 'text-yellow-400', ring: 'ring-yellow-500/40' },
            green:   { bg: 'bg-green-500/10',  border: 'border-green-500/30',  text: 'text-green-400',  ring: 'ring-green-500/40' },
            teal:    { bg: 'bg-teal-500/10',   border: 'border-teal-500/30',   text: 'text-teal-400',   ring: 'ring-teal-500/40' },
        };
        return map[color]?.[type] ?? '';
    }
}
