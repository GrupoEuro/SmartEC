import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AppIconComponent } from '../../../shared/components/app-icon/app-icon.component';

@Component({
    selector: 'app-project-stats',
    standalone: true,
    imports: [CommonModule, AppIconComponent],
    templateUrl: './project-stats.component.html',
    styleUrls: ['./project-stats.component.css']
})
export class ProjectStatsComponent {
    // Snapshot metrics (Jan 9, 2026)
    stats = {
        loc: 43424,
        components: 181,
        services: 64,
        modules: 12, // Estimated
        routes: 45,  // Estimated from manual map

        // Calculated
        estimatedHours: 1450, // ~30 LOC/hr
        devDays: 181, // Assuming 8h days

        // Distribution
        techStack: [
            { label: 'TypeScript', pct: 65, color: '#3178C6' },
            { label: 'HTML', pct: 20, color: '#E44D26' },
            { label: 'CSS/SCSS', pct: 15, color: '#264DE4' }
        ]
    };

    get formattedLoc() {
        return new Intl.NumberFormat().format(this.stats.loc);
    }
}
