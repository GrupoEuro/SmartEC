import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';

@Component({
  selector: 'app-resources',
  standalone: true,
  imports: [CommonModule, TranslateModule],
  templateUrl: './resources.component.html',
  styleUrl: './resources.component.css'
})
export class ResourcesComponent {

  downloadPDF(resource: string) {
    console.log(`Downloading ${resource}...`);
    // Implement actual download logic or link redirection
  }

  requestAccess(type: string) {
    const subject = type === 'price-list' ? 'Solicitud de Acceso a Lista de Precios' : 'Solicitud de Material Promocional';
    window.location.href = `mailto:contactomkt@importadoraeuro.com?subject=${encodeURIComponent(subject)}`;
  }
}
