import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';
import { AppIconComponent } from '../../../shared/components/app-icon/app-icon.component';

@Component({
    selector: 'app-theme-playground',
    standalone: true,
    imports: [CommonModule, TranslateModule, AppIconComponent],
    templateUrl: './theme-playground.component.html',
    styleUrls: ['./theme-playground.component.css']
})
export class ThemePlaygroundComponent {
    currentTheme = 'default';

    setTheme(theme: string) {
        this.currentTheme = theme;
    }
}
