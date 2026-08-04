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
  selector: 'app-nosotros',
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
  templateUrl: './nosotros.component.html',
  styleUrl: './nosotros.component.css'
})
export class NosotrosComponent implements OnInit, OnDestroy {
  private meta = inject(MetaService);

  ngOnInit(): void {
    this.meta.updateTags({
      title: 'Nosotros | Importadora Eurollantas México',
      description: 'Conoce más sobre Importadora Eurollantas — Distribuidor líder de llantas de alta calidad para motocicleta en México.',
      keywords: 'sobre nosotros, importadora euro, empresa llantas mexico, distribuidora llantas',
      type: 'website'
    });

    this.meta.addStructuredData({
      '@context': 'https://schema.org',
      '@type': 'AboutPage',
      'name': 'Sobre Importadora Eurollantas',
      'description': 'Distribuidor oficial de llantas Praxis para motocicleta en México.',
      'url': 'https://importadoraeuro.com/nosotros'
    });
  }

  ngOnDestroy(): void {
    this.meta.removeStructuredData();
  }
}
