import { Injectable, signal, effect, inject } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { ThemeGeneratorService, ColorPalette } from './theme-generator.service';

export type ThemeType = 'default' | 'premium' | 'seasonal' | 'ops' | 'command' | string;

export interface CustomTheme {
    id: string;
    name: string;
    colors: {
        primary: string;
        bg: string;
        surface: string;
    };
    // Studio Enhancements
    isStudio?: boolean;
    palettes?: {
        primary: ColorPalette;
        // extended palettes can go here
    };
    settings?: {
        radius: number;
        font: string;
    };
}

@Injectable({
    providedIn: 'root'
})
export class ThemeService {
    private document = inject(DOCUMENT);
    private generator = inject(ThemeGeneratorService);

    // Core Signals
    public currentTheme = signal<ThemeType>(this.loadTheme());
    public customThemes = signal<CustomTheme[]>(this.loadCustomThemes());

    constructor() {
        effect(() => {
            const themeId = this.currentTheme();
            this.applyTheme(themeId);
            this.saveTheme(themeId);
        });
    }

    setTheme(theme: ThemeType) {
        this.currentTheme.set(theme);
    }

    addCustomTheme(theme: CustomTheme) {
        const current = this.customThemes();
        // Remove if exists (update)
        const filtered = current.filter(t => t.id !== theme.id);
        const updated = [...filtered, theme];

        this.customThemes.set(updated);
        this.saveCustomThemes(updated);
        this.setTheme(theme.id);
    }

    deleteCustomTheme(id: string) {
        const updated = this.customThemes().filter(t => t.id !== id);
        this.customThemes.set(updated);
        this.saveCustomThemes(updated);

        if (this.currentTheme() === id) {
            this.setTheme('premium');
        }
    }

    private applyTheme(themeId: ThemeType) {
        const body = this.document.body;
        const root = this.document.documentElement;

        // 1. Reset
        const knownThemes = ['theme-premium', 'theme-seasonal', 'theme-default', 'theme-ops', 'theme-command'];
        body.classList.remove(...knownThemes);
        root.removeAttribute('style');

        // 2. Presets
        if (knownThemes.includes(`theme-${themeId}`)) {
            if (themeId !== 'default') {
                body.classList.add(`theme-${themeId}`);
            }
            return;
        }

        // 3. Custom Themes
        const theme = this.customThemes().find(t => t.id === themeId);
        if (theme) {
            this.applyCustomThemeStyles(root, theme);
        } else {
            // Fallback: If custom theme ID is active but not found (e.g. deleted or storage error),
            // revert to Premium (Dark) safely.
            console.warn(`Theme ${themeId} not found. Reverting to Premium.`);
            body.classList.add('theme-premium');
            this.setTheme('premium');
        }
    }

    private applyCustomThemeStyles(root: HTMLElement, theme: CustomTheme) {
        // Base Colors
        root.style.setProperty('--theme-primary', theme.colors.primary);
        root.style.setProperty('--theme-bg-app', theme.colors.bg);
        root.style.setProperty('--theme-bg-surface', theme.colors.surface);

        // Palettes (Tailwind-like scales)
        if (theme.palettes?.primary) {
            Object.entries(theme.palettes.primary).forEach(([shade, value]) => {
                root.style.setProperty(`--theme-primary-${shade}`, value);
            });

            // Derived Primary States for Custom Themes
            root.style.setProperty('--theme-primary-hover', theme.palettes.primary[600]);
            root.style.setProperty('--theme-primary-light', theme.palettes.primary[400]);
            root.style.setProperty('--theme-text-brand', theme.palettes.primary[400]); // Good for dark mode
            root.style.setProperty('--theme-accent', theme.palettes.primary[500]); // Fallback accent
        }

        // Derived Backgrounds
        // We assume 'bg' is the main app background (often dark)
        // Surface Soft is slightly lighter than surface, or just more opaque
        // Glass is based on BG color but transparent

        // Convert to RGBA for glass effects
        const bgRgba = this.generator.hexToRgba(theme.colors.bg, 0.7);
        root.style.setProperty('--theme-bg-glass', bgRgba);

        // Soft Surface: If surface is defined, use it. Or derive.
        // Assuming surface is provided in hex.
        root.style.setProperty('--theme-bg-surface-soft', this.generator.hexToRgba(theme.colors.surface, 0.8)); // More opacity?

        // Derived Borders
        const contrast = this.generator.getContrastColor(theme.colors.bg);
        const border = contrast === 'white' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)';
        const borderSoft = contrast === 'white' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)';

        root.style.setProperty('--theme-border', border);
        root.style.setProperty('--theme-border-soft', borderSoft);

        // Settings (Radius, Font)
        if (theme.settings) {
            root.style.setProperty('--theme-radius', `${theme.settings.radius}px`);
            // Map radius to sm/md/lg roughly
            root.style.setProperty('--theme-radius-sm', `${Math.max(2, theme.settings.radius / 2)}px`);
            root.style.setProperty('--theme-radius-md', `${theme.settings.radius}px`);
            root.style.setProperty('--theme-radius-lg', `${theme.settings.radius * 2}px`);

            root.style.setProperty('--theme-font', theme.settings.font);
        }
    }

    // --- Persistance ---
    private loadTheme(): ThemeType {
        const stored = localStorage.getItem('app-theme');
        return (stored as ThemeType) || 'premium';
    }

    private saveTheme(theme: ThemeType) {
        localStorage.setItem('app-theme', theme);
    }

    private loadCustomThemes(): CustomTheme[] {
        const stored = localStorage.getItem('app-custom-themes');
        return stored ? JSON.parse(stored) : [];
    }

    private saveCustomThemes(themes: CustomTheme[]) {
        localStorage.setItem('app-custom-themes', JSON.stringify(themes));
    }

    // --- Compatibility ---
    getAvailableThemes() {
        return [
            {
                id: 'premium',
                name: 'Premium Dark',
                backgroundColor: '#020617',
                primaryColor: '#2563eb'
            },
            {
                id: 'default',
                name: 'Legacy Admin',
                backgroundColor: '#f3f4f6',
                primaryColor: '#1C355E'
            },
            {
                id: 'seasonal',
                name: 'Summer Sale',
                backgroundColor: '#fff7ed',
                primaryColor: '#ea580c'
            },
            {
                id: 'ops',
                name: 'Operations',
                backgroundColor: '#18181b',
                primaryColor: '#3b82f6'
            },
            {
                id: 'command',
                name: 'Command Center',
                backgroundColor: '#0f172a',
                primaryColor: '#3b82f6'
            }
        ];
    }
}
