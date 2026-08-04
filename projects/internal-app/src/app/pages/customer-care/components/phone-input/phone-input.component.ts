import {
    Component, forwardRef, signal, computed, HostListener,
    ElementRef, inject
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR, FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';

export interface Country {
    name: string;
    iso2: string;
    dialCode: string;
    flag: string;
}

const COUNTRIES: Country[] = [
    // ── Americas ──────────────────────────────────────────────
    { name: 'México',              iso2: 'mx', dialCode: '52',  flag: '🇲🇽' },
    { name: 'Estados Unidos',      iso2: 'us', dialCode: '1',   flag: '🇺🇸' },
    { name: 'Canadá',              iso2: 'ca', dialCode: '1',   flag: '🇨🇦' },
    { name: 'Argentina',           iso2: 'ar', dialCode: '54',  flag: '🇦🇷' },
    { name: 'Brasil',              iso2: 'br', dialCode: '55',  flag: '🇧🇷' },
    { name: 'Chile',               iso2: 'cl', dialCode: '56',  flag: '🇨🇱' },
    { name: 'Colombia',            iso2: 'co', dialCode: '57',  flag: '🇨🇴' },
    { name: 'Venezuela',           iso2: 've', dialCode: '58',  flag: '🇻🇪' },
    { name: 'Perú',                iso2: 'pe', dialCode: '51',  flag: '🇵🇪' },
    { name: 'Ecuador',             iso2: 'ec', dialCode: '593', flag: '🇪🇨' },
    { name: 'Guatemala',           iso2: 'gt', dialCode: '502', flag: '🇬🇹' },
    { name: 'Costa Rica',          iso2: 'cr', dialCode: '506', flag: '🇨🇷' },
    { name: 'El Salvador',         iso2: 'sv', dialCode: '503', flag: '🇸🇻' },
    { name: 'Honduras',            iso2: 'hn', dialCode: '504', flag: '🇭🇳' },
    { name: 'Nicaragua',           iso2: 'ni', dialCode: '505', flag: '🇳🇮' },
    { name: 'Panamá',              iso2: 'pa', dialCode: '507', flag: '🇵🇦' },
    { name: 'Cuba',                iso2: 'cu', dialCode: '53',  flag: '🇨🇺' },
    { name: 'República Dominicana',iso2: 'do', dialCode: '1809',flag: '🇩🇴' },
    { name: 'Uruguay',             iso2: 'uy', dialCode: '598', flag: '🇺🇾' },
    { name: 'Paraguay',            iso2: 'py', dialCode: '595', flag: '🇵🇾' },
    { name: 'Bolivia',             iso2: 'bo', dialCode: '591', flag: '🇧🇴' },
    // ── Europe ────────────────────────────────────────────────
    { name: 'España',              iso2: 'es', dialCode: '34',  flag: '🇪🇸' },
    { name: 'Francia',             iso2: 'fr', dialCode: '33',  flag: '🇫🇷' },
    { name: 'Alemania',            iso2: 'de', dialCode: '49',  flag: '🇩🇪' },
    { name: 'Italia',              iso2: 'it', dialCode: '39',  flag: '🇮🇹' },
    { name: 'Reino Unido',         iso2: 'gb', dialCode: '44',  flag: '🇬🇧' },
    { name: 'Portugal',            iso2: 'pt', dialCode: '351', flag: '🇵🇹' },
    // ── Other ─────────────────────────────────────────────────
    { name: 'China',               iso2: 'cn', dialCode: '86',  flag: '🇨🇳' },
    { name: 'Japón',               iso2: 'jp', dialCode: '81',  flag: '🇯🇵' },
    { name: 'India',               iso2: 'in', dialCode: '91',  flag: '🇮🇳' },
];

@Component({
    selector: 'app-phone-input',
    standalone: true,
    imports: [CommonModule, FormsModule],
    providers: [{
        provide: NG_VALUE_ACCESSOR,
        useExisting: forwardRef(() => PhoneInputComponent),
        multi: true
    }],
    template: `
<div class="phone-wrapper" [class.open]="open()">
    <!-- Country trigger -->
    <button type="button" class="country-trigger" (click)="toggleDropdown()" tabindex="0">
        <span class="flag">{{ selected().flag }}</span>
        <span class="dial">+{{ selected().dialCode }}</span>
        <span class="caret">▾</span>
    </button>

    <!-- Country dropdown -->
    @if (open()) {
        <div class="country-dropdown" (click)="$event.stopPropagation()">
            <div class="search-wrap">
                <input #searchInput class="country-search" type="text"
                       [(ngModel)]="searchTerm" placeholder="Buscar país…"
                       autofocus (click)="$event.stopPropagation()">
            </div>
            <div class="country-list">
                @for (c of filtered(); track c.iso2) {
                    <button type="button" class="country-opt"
                            [class.is-selected]="c.iso2 === selected().iso2"
                            (click)="selectCountry(c)">
                        <span class="opt-flag">{{ c.flag }}</span>
                        <span class="opt-name">{{ c.name }}</span>
                        <span class="opt-dial">+{{ c.dialCode }}</span>
                    </button>
                }
                @if (filtered().length === 0) {
                    <p class="no-results">Sin resultados</p>
                }
            </div>
        </div>
    }

    <!-- Phone number input -->
    <input class="phone-number-input"
           type="tel"
           [value]="localNumber"
           (input)="onNumberChange($event)"
           placeholder="Número completo"
           inputmode="tel">
</div>
    `,
    styles: [`
        .phone-wrapper { display: flex; align-items: center; position: relative; background: #0f172a; border: 1px solid #334155; border-radius: 8px; transition: border-color .2s; }
        .phone-wrapper:focus-within { border-color: rgba(99,102,241,.5); }
        .phone-wrapper.open { border-color: rgba(99,102,241,.5); }

        .country-trigger { display: flex; align-items: center; gap: .3rem; padding: .5rem .5rem .5rem .65rem; background: transparent; border: none; border-right: 1px solid #334155; cursor: pointer; color: #f8fafc; white-space: nowrap; flex-shrink: 0; }
        .country-trigger:focus { outline: none; }
        .flag { font-size: 1.1rem; line-height: 1; }
        .dial { font-size: .82rem; font-weight: 600; color: #a5b4fc; }
        .caret { font-size: .55rem; color: #71717a; transition: transform .18s; }
        .phone-wrapper.open .caret { transform: rotate(180deg); }

        .phone-number-input { flex: 1; background: transparent; border: none; padding: .5rem .75rem; color: #f8fafc; font-size: .85rem; font-family: inherit; outline: none; min-width: 0; }
        .phone-number-input::placeholder { color: #52525b; }

        /* Dropdown */
        .country-dropdown { position: absolute; top: calc(100% + 4px); left: 0; min-width: 260px; background: #1e293b; border: 1px solid #334155; border-radius: 10px; z-index: 9999; box-shadow: 0 12px 40px rgba(0,0,0,.45); overflow: hidden; }
        .search-wrap { padding: .6rem .6rem .3rem; }
        .country-search { width: 100%; background: #0f172a; border: 1px solid #334155; border-radius: 7px; padding: .45rem .7rem; color: #f8fafc; font-size: .82rem; outline: none; box-sizing: border-box; }
        .country-search:focus { border-color: rgba(99,102,241,.5); }
        .country-list { max-height: 240px; overflow-y: auto; padding: .25rem 0; }
        .country-list::-webkit-scrollbar { width: 4px; }
        .country-list::-webkit-scrollbar-thumb { background: rgba(255,255,255,.08); border-radius: 2px; }

        .country-opt { display: flex; align-items: center; gap: .6rem; width: 100%; padding: .5rem .75rem; background: transparent; border: none; cursor: pointer; color: #d4d4d8; font-size: .82rem; text-align: left; transition: background .14s; }
        .country-opt:hover { background: rgba(255,255,255,.06); }
        .country-opt.is-selected { background: rgba(99,102,241,.15); color: #a5b4fc; }
        .opt-flag { font-size: 1.1rem; flex-shrink: 0; }
        .opt-name { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .opt-dial { font-size: .75rem; color: #52525b; flex-shrink: 0; }
        .no-results { padding: 1rem; text-align: center; color: #52525b; font-size: .8rem; margin: 0; }
    `]
})
export class PhoneInputComponent implements ControlValueAccessor {
    private el = inject(ElementRef);

    open      = signal(false);
    selected  = signal<Country>(COUNTRIES[0]); // Mexico default
    searchTerm = '';
    localNumber = '';

    private onChange: (val: string) => void = () => {};
    private onTouched: () => void = () => {};

    filtered = computed(() => {
        const q = this.searchTerm.toLowerCase();
        if (!q) return COUNTRIES;
        return COUNTRIES.filter(c =>
            c.name.toLowerCase().includes(q) ||
            c.dialCode.includes(q) ||
            c.iso2.includes(q)
        );
    });

    // Close dropdown when clicking outside
    @HostListener('document:click', ['$event'])
    onDocumentClick(e: MouseEvent) {
        if (!this.el.nativeElement.contains(e.target)) {
            this.open.set(false);
        }
    }

    toggleDropdown() {
        this.open.update(v => !v);
        if (this.open()) this.searchTerm = '';
    }

    selectCountry(c: Country) {
        this.selected.set(c);
        this.open.set(false);
        this.emit();
    }

    onNumberChange(e: Event) {
        this.localNumber = (e.target as HTMLInputElement).value;
        this.emit();
    }

    private emit() {
        const num = this.localNumber.trim();
        this.onChange(num ? `+${this.selected().dialCode}${num}` : '');
    }

    // ── ControlValueAccessor ───────────────────────────────────────────────────
    writeValue(value: string): void {
        if (!value) { this.localNumber = ''; return; }
        // Parse existing +dialCode format
        const match = value.match(/^\+(\d+)(\d{7,})$/);
        if (match) {
            const dc = match[1];
            const found = COUNTRIES.find(c => dc.startsWith(c.dialCode));
            if (found) {
                this.selected.set(found);
                this.localNumber = dc.slice(found.dialCode.length) + match[2];
            } else {
                this.localNumber = value;
            }
        } else {
            this.localNumber = value.replace(/^\+\d{1,4}/, '');
        }
    }

    registerOnChange(fn: any): void { this.onChange = fn; }
    registerOnTouched(fn: any): void { this.onTouched = fn; }
    setDisabledState?(isDisabled: boolean): void {}
}
