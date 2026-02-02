import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ThemeService, ThemeType, CustomTheme } from '../../../core/services/theme.service';
import { ThemeGeneratorService, ColorPalette } from '../../../core/services/theme-generator.service';

interface ThemeOption {
    id: ThemeType;
    name: string;
    description: string;
    colors: {
        primary: string;
        bg: string;
        surface: string;
    };
}

import { TranslateModule } from '@ngx-translate/core';
import { AppIconComponent } from '../../../shared/components/app-icon/app-icon.component';

@Component({
    selector: 'app-theme-manager',
    standalone: true,
    imports: [CommonModule, FormsModule, AppIconComponent, TranslateModule],
    templateUrl: './theme-manager.component.html',
    styleUrl: './theme-manager.component.css'
})
export class ThemeManagerComponent {
    public themeService = inject(ThemeService);
    public generator = inject(ThemeGeneratorService);

    // Initial Presets
    presets: ThemeOption[] = [
        {
            id: 'premium',
            name: 'Premium Dark',
            description: 'Deep Slate & Cyan. High-contrast glassmorphism.',
            colors: { primary: '#2563eb', bg: '#020617', surface: '#1e293b' }
        },
        {
            id: 'default',
            name: 'Legacy Admin',
            description: 'Classic Navy & Gold. Standard integrity.',
            colors: { primary: '#1C355E', bg: '#f3f4f6', surface: '#ffffff' }
        },
        {
            id: 'seasonal',
            name: 'Summer Sale',
            description: 'Warm Orange & Yellow. High energy.',
            colors: { primary: '#ea580c', bg: '#fff7ed', surface: '#ffffff' }
        },
        {
            id: 'ops',
            name: 'Operations',
            description: 'Industrial Zinc. Dense data optimized.',
            colors: { primary: '#3b82f6', bg: '#18181b', surface: '#27272a' }
        },
        {
            id: 'command',
            name: 'Command Center',
            description: 'Cyberpunk Data. Immersive monitoring.',
            colors: { primary: '#3b82f6', bg: '#0f172a', surface: '#1e293b' }
        }
    ];

    // Accessors
    get currentThemeId() { return this.themeService.currentTheme(); }
    get customThemes() { return this.themeService.customThemes(); }

    setTheme(themeId: string) {
        this.themeService.setTheme(themeId);
    }

    deleteTheme(e: Event, id: string) {
        e.stopPropagation();
        if (confirm('Delete this theme?')) {
            this.themeService.deleteCustomTheme(id);
        }
    }

    // --- STUDIO MODE ---
    showStudio = signal(false);

    // Studio State
    studioName = signal('My Custom Theme');
    brandColor = signal('#3b82f6');
    baseColor = signal('#0f172a'); // e.g. Slate-900
    radius = signal(12);
    fontFamily = signal('Inter');

    // Options
    fonts = ['Inter', 'Roboto', 'Poppins', 'Montserrat', 'Open Sans', 'Lato'];
    paletteKeys: (keyof ColorPalette)[] = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];

    // Computed Preview
    previewPalette = computed(() => this.generator.generatePalette(this.brandColor()));

    // Mock Data for Preview
    mockProduct = {
        name: { en: 'Michelin Pilot Sport 4S', es: 'Michelin Pilot Sport 4S' },
        brand: 'Michelin',
        price: 4500,
        compareAtPrice: 5200,
        images: { main: 'assets/images/euro-logo-new.png' }, // Placeholder
        inStock: true,
        newArrival: true,
        bestSeller: false,
        specifications: {
            width: 245,
            aspectRatio: 40,
            diameter: 19
        }
    };

    toggleStudio() {
        this.showStudio.update(v => !v);
    }

    randomizeTheme() {
        // Random HSL for Brand Color
        const h = Math.floor(Math.random() * 360);
        const s = 60 + Math.floor(Math.random() * 40); // 60-100%
        const l = 40 + Math.floor(Math.random() * 20); // 40-60%
        this.brandColor.set(this.hslToHex(h, s, l));

        // Random Dark Base
        const baseH = (h + 180) % 360; // Complementaryish or just random
        const baseS = 10 + Math.floor(Math.random() * 20); // Low saturation
        const baseL = 2 + Math.floor(Math.random() * 8); // Very dark 2-10%
        this.baseColor.set(this.hslToHex(baseH, baseS, baseL));

        // Random Settings
        this.radius.set(Math.floor(Math.random() * 24));
        this.fontFamily.set(this.fonts[Math.floor(Math.random() * this.fonts.length)]);
    }

    // Helper for randomizer (duplicated from service for now for simplicity, or inject utils)
    private hslToHex(h: number, s: number, l: number): string {
        l /= 100;
        const a = s * Math.min(l, 1 - l) / 100;
        const f = (n: number) => {
            const k = (n + h / 30) % 12;
            const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
            return Math.round(255 * color).toString(16).padStart(2, '0');
        };
        return `#${f(0)}${f(8)}${f(4)}`;
    }

    saveStudioTheme() {
        const primaryPalette = this.previewPalette();

        // Construct the theme object
        const theme: CustomTheme = {
            id: `studio-${Date.now()}`,
            name: this.studioName(),
            colors: {
                primary: primaryPalette[500],
                bg: this.baseColor(), // In a real studio we'd generate a neutral scale too
                surface: this.lighten(this.baseColor(), 6) // Slightly lighter for surfaces
            },
            isStudio: true,
            palettes: {
                primary: primaryPalette
            },
            settings: {
                radius: this.radius(),
                font: this.fontFamily()
            }
        };

        this.themeService.addCustomTheme(theme);

        // UX Feedback
        alert(`Theme "${this.studioName()}" saved successfully!`);
        console.log('Theme Saved:', theme);

        this.showStudio.set(false);
    }

    // Helper to lighten hex for surface color (naive implementation)
    public lighten(hex: string, percent: number): string {
        const num = parseInt(hex.replace('#', ''), 16);
        const amt = Math.round(2.55 * percent);
        const R = (num >> 16) + amt;
        const G = (num >> 8 & 0x00FF) + amt;
        const B = (num & 0x0000FF) + amt;
        return '#' + (0x1000000 + (R < 255 ? R < 1 ? 0 : R : 255) * 0x10000 + (G < 255 ? G < 1 ? 0 : G : 255) * 0x100 + (B < 255 ? B < 1 ? 0 : B : 255)).toString(16).slice(1);
    }
}
