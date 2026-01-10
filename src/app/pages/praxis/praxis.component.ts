import { Component } from '@angular/core';
import { CommonModule, NgOptimizedImage } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';
import { NavbarComponent } from '../../components/navbar/navbar.component';
import { FooterComponent } from '../../components/footer/footer.component';

@Component({
    selector: 'app-praxis',
    standalone: true,
    imports: [
        CommonModule,
        NavbarComponent,
        FooterComponent,
        TranslateModule,
        NgOptimizedImage
    ],
    templateUrl: './praxis.component.html',
    styleUrls: ['./praxis.component.css']
})
export class PraxisComponent {
    openUrl(url: string, target: string = '_self'): void {
        window.open(url, target);
    }
}
