import { Pipe, PipeTransform } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';

@Pipe({
    name: 'adminDate',
    standalone: true,
    pure: false
})
export class AdminDatePipe implements PipeTransform {
    constructor(private translate: TranslateService) { }

    transform(value: Date | string | null | undefined, includeTime: boolean = true): string {
        if (!value) return '';

        const date = value instanceof Date ? value : new Date(value);
        if (isNaN(date.getTime())) return '';

        const currentLang = this.translate.currentLang || 'en';

        const day = date.getDate().toString().padStart(2, '0');
        const monthNames = currentLang === 'es'
            ? ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
            : ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
        const month = monthNames[date.getMonth()];
        const year = date.getFullYear().toString().slice(-2);

        // Format: dec-12-25 (English) or 12-dic-25 (Spanish)
        const dateStr = currentLang === 'es'
            ? `${day}-${month}-${year}`
            : `${month}-${day}-${year}`;

        if (!includeTime) return dateStr;

        // Add time in 12-hour format
        let hours = date.getHours();
        const minutes = date.getMinutes().toString().padStart(2, '0');
        const ampm = hours >= 12 ? 'PM' : 'AM';
        hours = hours % 12 || 12;

        return `${dateStr} ${hours}:${minutes} ${ampm}`;
    }
}
