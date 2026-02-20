import { Injectable } from '@angular/core';

export interface ColorPalette {
    50: string;
    100: string;
    200: string;
    300: string;
    400: string;
    500: string;
    600: string;
    700: string;
    800: string;
    900: string;
    950: string;
}

@Injectable({
    providedIn: 'root'
})
export class ThemeGeneratorService {

    constructor() { }

    /**
     * Generates a full tonal palette from a single base color.
     * Uses HSL logic to create lighter and darker shades.
     */
    generatePalette(hex: string): ColorPalette {
        const [h, s, l] = this.hexToHsl(hex);

        // We anchor the input color to the closest shade (usually 500 or 600)
        // For simplicity, we'll generate a fresh scale based on the Hue/Sat
        // and a fixed Lightness curve that mimics Tailwind's distribution.

        return {
            50: this.hslToHex(h, s, 98),
            100: this.hslToHex(h, s, 94),
            200: this.hslToHex(h, s, 86),
            300: this.hslToHex(h, s, 74),
            400: this.hslToHex(h, s, 60),
            500: this.hslToHex(h, s, 48), // Standard midpoint
            600: this.hslToHex(h, s, 40),
            700: this.hslToHex(h, s, 32),
            800: this.hslToHex(h, s, 24),
            900: this.hslToHex(h, s, 16),
            950: this.hslToHex(h, s, 10),
        };
    }

    /**
     * Returns 'black' or 'white' depending on which has better contrast against the bg.
     */
    getContrastColor(hex: string): 'black' | 'white' {
        const r = parseInt(hex.substring(1, 3), 16);
        const g = parseInt(hex.substring(3, 5), 16);
        const b = parseInt(hex.substring(5, 7), 16);
        const yiq = ((r * 299) + (g * 587) + (b * 114)) / 1000;
        return (yiq >= 128) ? 'black' : 'white';
    }

    // --- Helpers ---

    private hexToHsl(hex: string): [number, number, number] {
        let r = parseInt(hex.substring(1, 3), 16) / 255;
        let g = parseInt(hex.substring(3, 5), 16) / 255;
        let b = parseInt(hex.substring(5, 7), 16) / 255;

        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        let h = 0, s = 0, l = (max + min) / 2;

        if (max !== min) {
            const d = max - min;
            s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
            switch (max) {
                case r: h = (g - b) / d + (g < b ? 6 : 0); break;
                case g: h = (b - r) / d + 2; break;
                case b: h = (r - g) / d + 4; break;
            }
            h /= 6;
        }

        return [h * 360, s * 100, l * 100];
    }

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
    hexToRgba(hex: string, alpha: number): string {
        const r = parseInt(hex.substring(1, 3), 16);
        const g = parseInt(hex.substring(3, 5), 16);
        const b = parseInt(hex.substring(5, 7), 16);
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
}
