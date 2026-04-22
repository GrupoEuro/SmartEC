import { Injectable, signal } from '@angular/core';
import { DATE_RANGES, DateRange } from './metrics-analytics.service';

/**
 * Persists the active metrics timeframe across all metrics pages.
 * Selection survives navigation and page refresh via localStorage.
 *
 * Usage:
 *   private tf = inject(MetricsTimeframeService);
 *   readonly selectedRange = this.tf.selected;  // readonly signal
 *   this.tf.set(range);                          // updates + persists
 */
@Injectable({ providedIn: 'root' })
export class MetricsTimeframeService {

    private readonly STORAGE_KEY = 'ops_metrics_timeframe';

    /** Default = current month (MTD) */
    private readonly DEFAULT = DATE_RANGES.find(r => r.type === 'MTD') ?? DATE_RANGES[0];

    private _selected = signal<DateRange>(this.hydrate());

    /** Read-only signal — consume in components via this.tf.selected() */
    readonly selected = this._selected.asReadonly();

    set(range: DateRange) {
        this._selected.set(range);
        try { localStorage.setItem(this.STORAGE_KEY, range.type); } catch {}
    }

    private hydrate(): DateRange {
        try {
            const saved = localStorage.getItem(this.STORAGE_KEY);
            return DATE_RANGES.find(r => r.type === saved) ?? this.DEFAULT;
        } catch {
            return this.DEFAULT;
        }
    }
}
