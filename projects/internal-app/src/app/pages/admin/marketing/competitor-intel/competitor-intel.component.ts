import {
    Component, inject, signal, computed, OnInit, ChangeDetectionStrategy
} from '@angular/core';
import { CommonModule, CurrencyPipe, DecimalPipe, PercentPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { AppIconComponent } from '../../../../shared/components/app-icon/app-icon.component';
import { ToastService } from '../../../../core/services/toast.service';
import {
    CompetitorIntelligenceService,
    CompetitorIntelligenceData,
    CompetitorVelocityEntry,
    KeywordTrend,
} from './competitor-intelligence.service';

type TabId = 'velocity' | 'pricing' | 'keywords' | 'config';

@Component({
    selector: 'app-competitor-intel',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CommonModule, FormsModule, TranslateModule, AppIconComponent, CurrencyPipe, DecimalPipe, PercentPipe],
    templateUrl: './competitor-intel.component.html',
    styleUrls: ['./competitor-intel.component.css'],
})
export class CompetitorIntelComponent implements OnInit {
    private svc   = inject(CompetitorIntelligenceService);
    private toast = inject(ToastService);

    // ── State ────────────────────────────────────────────────────────────────
    loading      = signal(true);
    scanning     = signal(false);
    activeTab    = signal<TabId>('velocity');
    periodDays   = signal(7);
    data         = signal<CompetitorIntelligenceData | null>(null);

    // Config form
    configKeywords    = signal('');
    configSellers     = signal('');
    configOurSellerId = signal('');
    configMaxResults  = signal(50);
    configEnabled     = signal(true);
    savingConfig      = signal(false);

    // Search / filter
    velocitySearch = signal('');
    pricingKeyword = signal('all');

    // ── Computed ─────────────────────────────────────────────────────────────
    hasData = computed(() => this.data()?.hasData === true);
    snapshot = computed(() => this.data()?.latestSnapshot ?? null);

    filteredVelocity = computed<CompetitorVelocityEntry[]>(() => {
        const items = this.data()?.velocityRanking ?? [];
        const q = this.velocitySearch().toLowerCase();
        if (!q) return items;
        return items.filter(i =>
            i.title.toLowerCase().includes(q) ||
            i.sellerNickname.toLowerCase().includes(q) ||
            i.keyword.toLowerCase().includes(q)
        );
    });

    keywords = computed<string[]>(() => [
        'all',
        ...(this.data()?.trends ?? []).map(t => t.keyword),
    ]);

    pricingItems = computed<CompetitorVelocityEntry[]>(() => {
        const items  = this.data()?.velocityRanking ?? [];
        const kw     = this.pricingKeyword();
        const filtered = kw === 'all' ? items : items.filter(i => i.keyword === kw);
        return [...filtered].sort((a, b) => a.price - b.price);
    });

    priceStats = computed(() => {
        const items = this.pricingItems();
        if (!items.length) return null;
        const prices = items.map(i => i.price);
        const avg    = prices.reduce((a, b) => a + b, 0) / prices.length;
        const sorted = [...prices].sort((a, b) => a - b);
        const median = sorted.length % 2
            ? sorted[Math.floor(sorted.length / 2)]
            : (sorted[Math.floor(sorted.length / 2) - 1] + sorted[Math.floor(sorted.length / 2)]) / 2;
        return { min: Math.min(...prices), max: Math.max(...prices), avg, median };
    });

    // ── Lifecycle ─────────────────────────────────────────────────────────────
    async ngOnInit() {
        await this.loadData();
    }

    async loadData() {
        this.loading.set(true);
        try {
            const result = await this.svc.fetchIntelligence(this.periodDays());
            this.data.set(result);
        } catch (err: any) {
            this.toast.error('Error cargando datos: ' + err.message);
        } finally {
            this.loading.set(false);
        }
    }

    async runScan() {
        if (this.scanning()) return;
        this.scanning.set(true);
        this.toast.info('Iniciando escaneo de competidores...');
        try {
            const result = await this.svc.triggerManualScan();
            this.toast.success(`Escaneo completado: ${result.totalScanned} productos en ${(result.durationMs / 1000).toFixed(1)}s`);
            await this.loadData();
        } catch (err: any) {
            this.toast.error('Error en escaneo: ' + err.message);
        } finally {
            this.scanning.set(false);
        }
    }

    async saveConfig() {
        this.savingConfig.set(true);
        try {
            const keywords       = this.configKeywords().split('\n').map(s => s.trim()).filter(Boolean);
            const trackedSellers = this.configSellers().split('\n').map(s => s.trim()).filter(Boolean);
            await this.svc.updateConfig({
                keywords,
                trackedSellers,
                ourSellerId:          this.configOurSellerId().trim(),
                maxResultsPerKeyword: this.configMaxResults(),
                enabled:              this.configEnabled(),
            });
            this.toast.success('Configuración guardada');
        } catch (err: any) {
            this.toast.error('Error guardando: ' + err.message);
        } finally {
            this.savingConfig.set(false);
        }
    }

    setTab(tab: TabId) { this.activeTab.set(tab); }

    async changePeriod(days: number) {
        this.periodDays.set(days);
        await this.loadData();
    }

    sellerLevelLabel(level: string) { return this.svc.sellerLevelLabel(level); }
    sellerLevelColor(level: string) { return this.svc.sellerLevelColor(level); }

    priceBar(price: number): number {
        const stats = this.priceStats();
        if (!stats || stats.max === stats.min) return 50;
        return Math.round(((price - stats.min) / (stats.max - stats.min)) * 100);
    }

    openListing(url: string) { window.open(url, '_blank', 'noopener'); }

    trackByItem(_i: number, item: CompetitorVelocityEntry) { return item.itemId; }
    trackByKw(_i: number, kw: KeywordTrend)               { return kw.keyword; }
}
