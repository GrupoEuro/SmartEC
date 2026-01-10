import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';
import { AppIconComponent } from '../../../shared/components/app-icon/app-icon.component';

interface LibraryItem {
    name: string;
    version: string;
    category: 'CORE' | 'UI' | 'BACKEND' | 'UTILS' | 'VISUALIZATION';
    description: string;
    icon: string;
    color: string;
    size?: string;
    link?: string;
}

@Component({
    selector: 'app-library-explorer',
    standalone: true,
    imports: [CommonModule, TranslateModule, AppIconComponent],
    templateUrl: './library-explorer.component.html',
    styleUrls: ['./library-explorer.component.css']
})
export class LibraryExplorerComponent {

    libraries: LibraryItem[] = [
        // CORE
        { name: 'Angular', version: '17.3.0', category: 'CORE', description: 'The modern web developer\'s platform.', icon: 'layers', color: '#DD0031', size: 'Critical' },
        { name: 'TypeScript', version: '5.4.2', category: 'CORE', description: 'JavaScript with syntax for types.', icon: 'code', color: '#3178C6' },
        { name: 'RxJS', version: '7.8.0', category: 'CORE', description: 'Reactive extensions for JavaScript.', icon: 'activity', color: '#B7178C' },

        // UI & STYLING
        { name: 'Tailwind CSS', version: '3.4.10', category: 'UI', description: 'A utility-first CSS framework.', icon: 'wind', color: '#06B6D4' },
        { name: 'Lucide Icons', version: 'Latest', category: 'UI', description: 'Beautiful & consistent icon toolkit.', icon: 'image', color: '#F97316' },

        // BACKEND
        { name: 'Firebase', version: '10.14.1', category: 'BACKEND', description: 'App development platform by Google.', icon: 'database', color: '#FFCA28' },

        // VISUALIZATION
        { name: 'Chart.js', version: '4.5.1', category: 'VISUALIZATION', description: 'Simple yet flexible JavaScript charting.', icon: 'pie-chart', color: '#FF6384' },
        { name: 'Mermaid', version: '11.12.2', category: 'VISUALIZATION', description: 'Generation of diagrams and flowcharts.', icon: 'share-2', color: '#ff369b' },

        // UTILS
        { name: 'jsPDF', version: '3.0.4', category: 'UTILS', description: 'Client-side PDF generation.', icon: 'file-text', color: '#D32F2F' },
        { name: 'Driver.js', version: '1.4.0', category: 'UTILS', description: 'Overlay for tours and walkthroughs.', icon: 'navigation', color: '#2ecc71' },
        { name: 'NGX Translate', version: '15.0.0', category: 'UTILS', description: 'Internationalization library.', icon: 'globe', color: '#5C79FF' }
    ];

    get categories() {
        return Array.from(new Set(this.libraries.map(l => l.category)));
    }

    getLibrariesByCategory(cat: string) {
        return this.libraries.filter(l => l.category === cat);
    }
}
