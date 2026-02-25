import { Component, inject } from '@angular/core';
import { CommonModule, NgOptimizedImage } from '@angular/common';
import { RouterModule, RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { LanguageService } from '../../core/services/language.service';
import { CountdownTimerComponent } from '../../shared/components/countdown-timer/countdown-timer.component';
import { SearchBarComponent } from '../../shared/components/search-bar/search-bar.component';
import { NavbarCartWidgetComponent } from './navbar-cart-widget.component';
import { NavbarUserWidgetComponent } from './navbar-user-widget.component';

@Component({
    selector: 'app-navbar',
    standalone: true,
    imports: [
        TranslateModule,
        CommonModule,
        RouterLink,
        RouterModule,
        CountdownTimerComponent,
        SearchBarComponent,
        NgOptimizedImage,
        NavbarCartWidgetComponent,
        NavbarUserWidgetComponent
    ],
    templateUrl: './navbar.component.html',
    styleUrl: './navbar.component.css'
})
export class NavbarComponent {
    languageService = inject(LanguageService);
    isMobileMenuOpen = false;

    toggleMobileMenu() {
        this.isMobileMenuOpen = !this.isMobileMenuOpen;
    }

    toggleLanguage() {
        this.languageService.toggleLanguage();
    }

    closeMobileMenu() {
        this.isMobileMenuOpen = false;
    }
}
