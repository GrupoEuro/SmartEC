import { Injectable, signal, effect, inject } from '@angular/core';
import { Campaign, ThemeConfig, WebsiteTheme } from '../models/campaign.model';
import { DOCUMENT } from '@angular/common';

@Injectable({
    providedIn: 'root'
})
export class ThemeService {
    private document = inject(DOCUMENT);

    // Current active theme signal
    activeTheme = signal<WebsiteTheme>('default');

    // Predefined Themes Registry
    private readonly THEMES: Record<WebsiteTheme, ThemeConfig> = {
        'default': {
            id: 'default',
            primaryColor: '#2563eb', // blue-600
            secondaryColor: '#1e293b', // slate-800
            accentColor: '#3b82f6',
            backgroundColor: '#ffffff'
        },
        'halloween': {
            id: 'halloween',
            primaryColor: '#ea580c', // orange-600
            secondaryColor: '#271033', // dark purple
            accentColor: '#f97316',
            backgroundColor: '#0f0a14', // very dark
            patternOverlay: 'assets/patterns/spider-web.svg'
        },
        'christmas': {
            id: 'christmas',
            primaryColor: '#dc2626', // red-600
            secondaryColor: '#14532d', // green-900
            accentColor: '#166534',
            backgroundColor: '#f8fafc' // snow white
        },
        'buen-fin': {
            id: 'buen-fin',
            primaryColor: '#be123c', // rose-700
            secondaryColor: '#000000',
            accentColor: '#e11d48',
            backgroundColor: '#ffffff'
        },
        'black-friday': {
            id: 'black-friday',
            primaryColor: '#000000',
            secondaryColor: '#171717', // neutral-900
            accentColor: '#ef4444', // red-500
            backgroundColor: '#000000'
        },
        'hot-sale': {
            id: 'hot-sale',
            primaryColor: '#ef4444', // red-500
            secondaryColor: '#f97316', // orange-500
            accentColor: '#facc15', // yellow-400
            backgroundColor: '#ffffff'
        }
    };

    constructor() {
        // Reactively apply theme when signal changes
        effect(() => {
            this.applyTheme(this.activeTheme());
        });
    }

    /**
     * Sets the active theme
     */
    setTheme(themeId: WebsiteTheme) {
        this.activeTheme.set(themeId);
    }

    /**
     * Applies CSS variables to the document root
     */
    private applyTheme(themeId: WebsiteTheme) {
        const theme = this.THEMES[themeId] || this.THEMES['default'];
        const root = this.document.documentElement;

        root.style.setProperty('--theme-primary', theme.primaryColor);
        root.style.setProperty('--theme-secondary', theme.secondaryColor);
        root.style.setProperty('--theme-accent', theme.accentColor);
        root.style.setProperty('--theme-bg', theme.backgroundColor);

        if (theme.patternOverlay) {
            root.style.setProperty('--theme-pattern', `url('${theme.patternOverlay}')`);
        } else {
            root.style.removeProperty('--theme-pattern');
        }

        // Toggle dark class for dark themes
        if (['halloween', 'black-friday'].includes(themeId)) {
            root.classList.add('dark');
        } else {
            root.classList.remove('dark');
        }
    }

    /**
     * Returns metadata for all available themes
     */
    getAvailableThemes(): ThemeConfig[] {
        return Object.values(this.THEMES);
    }
}
