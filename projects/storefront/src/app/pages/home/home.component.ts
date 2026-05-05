import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule, NgOptimizedImage } from '@angular/common';
import { RouterModule } from '@angular/router';
import { HeroComponent } from '../../components/hero/hero.component';
import { StatsComponent } from '../../components/stats/stats.component';
import { AboutComponent } from '../../components/about/about.component';
import { WhyItComponent } from '../../components/why-it/why-it.component';
import { BrandsComponent } from '../../components/brands/brands.component';
import { ServicesComponent } from '../../components/services/services.component';
import { CoverageComponent } from '../../components/coverage/coverage.component';
import { ClientsComponent } from '../../components/clients/clients.component';
import { FaqComponent } from '../../components/faq/faq.component';
import { DistributorFormComponent } from '../../components/distributor-form/distributor-form.component';
import { ResourcesComponent } from '../../components/resources/resources.component';
import { CtaComponent } from '../../components/cta/cta.component';
import { MetaService } from '../../core/services/meta.service';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [
    CommonModule,
    NgOptimizedImage,
    RouterModule,
    HeroComponent,
    StatsComponent,
    AboutComponent,
    WhyItComponent,
    BrandsComponent,
    ServicesComponent,
    CoverageComponent,
    ClientsComponent,
    FaqComponent,
    DistributorFormComponent,
    ResourcesComponent,
    CtaComponent
  ],
  templateUrl: './home.component.html',
  styleUrl: './home.component.css'
})
export class HomeComponent implements OnInit, OnDestroy {
  private meta = inject(MetaService);

  ngOnInit(): void {
    // Update meta tags
    this.meta.updateTags({
      title: 'Distribuidora de Llantas Premium en México',
      description: 'Importadora Eurollantas - Distribuidor líder de llantas de alta calidad en México. Marcas premium, precios competitivos y servicio excepcional para distribuidores.',
      keywords: 'llantas, neumáticos, distribuidora, México, llantas premium, importadora, distribuidores',
      type: 'website'
    });

    // Add Organization structured data
    this.meta.addStructuredData({
      '@context': 'https://schema.org',
      '@type': 'Organization',
      'name': 'Importadora Eurollantas',
      'url': 'https://importadoraeuro.com',
      'logo': 'https://importadoraeuro.com/assets/images/euro-logo-new.png',
      'description': 'Distribuidor líder de llantas Praxis para motocicleta en México. Envíos nacionales en 1-3 días hábiles.',
      'address': {
        '@type': 'PostalAddress',
        'addressLocality': 'San Luis Potosí',
        'addressRegion': 'SLP',
        'addressCountry': 'MX'
      },
      'contactPoint': {
        '@type': 'ContactPoint',
        'telephone': '+52-444-194-6502',
        'contactType': 'customer service',
        'areaServed': 'MX',
        'availableLanguage': 'Spanish'
      },
      'sameAs': [
        'https://www.facebook.com/importadoraeuro',
        'https://www.instagram.com/importadoraeuromx'
      ]
    });
  }

  ngOnDestroy(): void {
    this.meta.removeStructuredData();
  }
}
