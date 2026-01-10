import { Injectable, signal, computed } from '@angular/core';

@Injectable({
    providedIn: 'root'
})
export class FirestoreTrackerService {
    // Signals for tracking session stats
    reads = signal(0);
    writes = signal(0);
    deletes = signal(0);

    // Cost Calculation (Approximate params based on Firebase pricing)
    // $0.06 per 100k reads, $0.18 per 100k writes (Example rates)
    estimatedCost = computed(() => {
        const r = this.reads() * (0.06 / 100000);
        const w = this.writes() * (0.18 / 100000);
        const d = this.deletes() * (0.02 / 100000);
        return (r + w + d).toFixed(6);
    });

    trackRead(count = 1) {
        this.reads.update(n => n + count);
    }

    trackWrite(count = 1) {
        this.writes.update(n => n + count);
    }

    trackDelete(count = 1) {
        this.deletes.update(n => n + count);
    }

    reset() {
        this.reads.set(0);
        this.writes.set(0);
        this.deletes.set(0);
    }
}
