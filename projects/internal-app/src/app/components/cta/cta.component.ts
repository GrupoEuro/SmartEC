import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';

@Component({
  selector: 'app-cta',
  standalone: true,
  imports: [CommonModule, TranslateModule],
  templateUrl: './cta.component.html',
  styleUrl: './cta.component.css'
})
export class CtaComponent {

  downloadCatalog() {
    console.log('Downloading catalog...');
  }

  callNow() {
    window.location.href = 'tel:+524442004677';
  }

  openWhatsapp() {
    window.open('https://wa.me/5214442004677', '_blank');
  }
}
