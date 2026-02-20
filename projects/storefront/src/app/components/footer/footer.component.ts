import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { SettingsService } from '../../core/services/settings.service';

@Component({
    selector: 'app-footer',
    standalone: true,
    imports: [CommonModule, TranslateModule, RouterModule],
    templateUrl: './footer.component.html',
    styleUrl: './footer.component.css'
})
export class FooterComponent {
    settingsService = inject(SettingsService);
    settings$ = this.settingsService.settings$;
    currentYear = new Date().getFullYear();
}
