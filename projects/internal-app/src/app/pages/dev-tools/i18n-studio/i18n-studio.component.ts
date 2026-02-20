import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { forkJoin } from 'rxjs';
import { AppIconComponent } from '../../../shared/components/app-icon/app-icon.component';

interface TranslationKey {
    key: string;
    en: string;
    es: string;
    status: 'ok' | 'missing-en' | 'missing-es';
}

@Component({
    selector: 'app-i18n-studio',
    standalone: true,
    imports: [CommonModule, AppIconComponent],
    template: `
    <div class="studio-container">
      <div class="header">
        <h1 class="page-title">I18n Studio</h1>
        <p class="page-subtitle">Localization management and missing key detector.</p>
      </div>

      <div class="stats-row glass-panel" *ngIf="comparison()">
        <div class="stat-badge" [class.success]="comparison()!.missingEs === 0">
            <span class="label">Missing ES</span>
            <span class="val">{{ comparison()!.missingEs }}</span>
        </div>
        <div class="stat-badge" [class.success]="comparison()!.missingEn === 0">
            <span class="label">Missing EN</span>
            <span class="val">{{ comparison()!.missingEn }}</span>
        </div>
        <div class="stat-badge neutral">
            <span class="label">Total Keys</span>
            <span class="val">{{ comparison()!.total }}</span>
        </div>
        <button (click)="load()" class="btn-refresh">
            <app-icon name="refresh" [size]="16"></app-icon>
        </button>
      </div>

      <div class="table-container glass-panel">
        <table class="trans-table">
            <thead>
                <tr>
                    <th width="30%">Key</th>
                    <th width="35%">English (Source)</th>
                    <th width="35%">Spanish (Target)</th>
                </tr>
            </thead>
            <tbody>
                <tr *ngFor="let row of filteredKeys()" [class.warning]="row.status !== 'ok'">
                    <td class="key-col">
                        <code class="key-code">{{ row.key }}</code>
                        <app-icon *ngIf="row.status !== 'ok'" name="alert-triangle" [size]="14" class="alert-icon"></app-icon>
                    </td>
                    <td>
                        <span *ngIf="row.en" class="trans-text">{{ row.en }}</span>
                        <span *ngIf="!row.en" class="missing-badge">MISSING</span>
                    </td>
                    <td>
                        <span *ngIf="row.es" class="trans-text">{{ row.es }}</span>
                        <span *ngIf="!row.es" class="missing-badge">MISSING</span>
                    </td>
                </tr>
            </tbody>
        </table>
      </div>
    </div>
  `,
    styleUrls: ['./i18n-studio.component.css']
})
export class I18nStudioComponent implements OnInit {
    private http = inject(HttpClient);

    keys = signal<TranslationKey[]>([]);
    comparison = signal<{ missingEn: number, missingEs: number, total: number } | null>(null);
    filter = signal<string>('');

    filteredKeys = computed(() => {
        return this.keys().filter(k => k.status !== 'ok' || this.filter() === '');
        // For now, default to showing everything, or maybe strictly errors?
        // Let's sort errors first
    });

    ngOnInit() {
        this.load();
    }

    load() {
        forkJoin({
            en: this.http.get<any>('/assets/i18n/en.json'),
            es: this.http.get<any>('/assets/i18n/es.json')
        }).subscribe({
            next: (res) => {
                this.analyze(res.en, res.es);
            },
            error: (err) => console.error('Failed to load translations', err)
        });
    }

    private analyze(en: any, es: any) {
        const allKeys = new Set([...this.flattenKeys(en), ...this.flattenKeys(es)]);
        const result: TranslationKey[] = [];
        let missingEn = 0;
        let missingEs = 0;

        const flatEn = this.flatten(en);
        const flatEs = this.flatten(es);

        allKeys.forEach(key => {
            const valEn = flatEn[key];
            const valEs = flatEs[key];
            let status: 'ok' | 'missing-en' | 'missing-es' = 'ok';

            if (!valEn) { status = 'missing-en'; missingEn++; }
            else if (!valEs) { status = 'missing-es'; missingEs++; }

            result.push({ key, en: valEn, es: valEs, status });
        });

        // Sort: Missing first
        result.sort((a, b) => {
            if (a.status !== 'ok' && b.status === 'ok') return -1;
            if (a.status === 'ok' && b.status !== 'ok') return 1;
            return a.key.localeCompare(b.key);
        });

        this.keys.set(result);
        this.comparison.set({ missingEn, missingEs, total: allKeys.size });
    }

    private flattenKeys(obj: any, prefix = ''): string[] {
        return Object.keys(this.flatten(obj));
    }

    private flatten(obj: any, prefix = ''): Record<string, string> {
        let result: Record<string, string> = {};
        for (const key in obj) {
            const newKey = prefix ? `${prefix}.${key}` : key;
            if (typeof obj[key] === 'object' && obj[key] !== null) {
                Object.assign(result, this.flatten(obj[key], newKey));
            } else {
                result[newKey] = String(obj[key]);
            }
        }
        return result;
    }
}
