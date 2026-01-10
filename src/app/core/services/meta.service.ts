import { Injectable, inject, PLATFORM_ID } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { isPlatformBrowser } from '@angular/common';

export interface PageMeta {
  title: string;
  description: string;
  keywords?: string;
  image?: string;
  url?: string;
  type?: 'website' | 'article' | 'product';
  author?: string;
  publishedTime?: string;
  modifiedTime?: string;
}

@Injectable({
  providedIn: 'root'
})
export class MetaService {
  private titleService = inject(Title);
  private metaService = inject(Meta);
  private router = inject(Router);
  private platformId = inject(PLATFORM_ID);

  private readonly SITE_NAME = 'Importadora Eurollantas';
  private readonly DEFAULT_IMAGE = 'assets/social-share.jpg';
  private readonly DOMAIN = 'https://tiendapraxis.web.app';
  private readonly TWITTER_HANDLE = '@eurollantas';

  /**
   * Update all meta tags for a page
   */
  updateTags(pageMeta: PageMeta): void {
    const fullTitle = `${pageMeta.title} | ${this.SITE_NAME}`;
    const url = pageMeta.url || `${this.DOMAIN}${this.router.url}`;
    const image = pageMeta.image ?
      (pageMeta.image.startsWith('http') ? pageMeta.image : `${this.DOMAIN}/${pageMeta.image}`) :
      `${this.DOMAIN}/${this.DEFAULT_IMAGE}`;
    const type = pageMeta.type || 'website';

    // Update title
    this.titleService.setTitle(fullTitle);

    // Basic meta tags
    this.metaService.updateTag({ name: 'description', content: pageMeta.description });
    if (pageMeta.keywords) {
      this.metaService.updateTag({ name: 'keywords', content: pageMeta.keywords });
    }
    if (pageMeta.author) {
      this.metaService.updateTag({ name: 'author', content: pageMeta.author });
    }

    // Canonical URL
    this.updateCanonical(url);

    // Open Graph tags (Facebook, LinkedIn)
    this.metaService.updateTag({ property: 'og:title', content: fullTitle });
    this.metaService.updateTag({ property: 'og:description', content: pageMeta.description });
    this.metaService.updateTag({ property: 'og:image', content: image });
    this.metaService.updateTag({ property: 'og:url', content: url });
    this.metaService.updateTag({ property: 'og:type', content: type });
    this.metaService.updateTag({ property: 'og:site_name', content: this.SITE_NAME });
    this.metaService.updateTag({ property: 'og:locale', content: 'es_MX' });
    this.metaService.updateTag({ property: 'og:locale:alternate', content: 'en_US' });

    // Article-specific tags
    if (type === 'article') {
      if (pageMeta.publishedTime) {
        this.metaService.updateTag({ property: 'article:published_time', content: pageMeta.publishedTime });
      }
      if (pageMeta.modifiedTime) {
        this.metaService.updateTag({ property: 'article:modified_time', content: pageMeta.modifiedTime });
      }
      if (pageMeta.author) {
        this.metaService.updateTag({ property: 'article:author', content: pageMeta.author });
      }
    }

    // Twitter Card tags
    this.metaService.updateTag({ name: 'twitter:card', content: 'summary_large_image' });
    this.metaService.updateTag({ name: 'twitter:site', content: this.TWITTER_HANDLE });
    this.metaService.updateTag({ name: 'twitter:title', content: fullTitle });
    this.metaService.updateTag({ name: 'twitter:description', content: pageMeta.description });
    this.metaService.updateTag({ name: 'twitter:image', content: image });
    if (pageMeta.author) {
      this.metaService.updateTag({ name: 'twitter:creator', content: this.TWITTER_HANDLE });
    }
  }

  /**
   * Update canonical URL
   */
  private updateCanonical(url: string): void {
    if (!isPlatformBrowser(this.platformId)) {
      return; // Skip on server
    }

    let link: HTMLLinkElement | null = document.querySelector('link[rel="canonical"]');

    if (!link) {
      link = document.createElement('link');
      link.setAttribute('rel', 'canonical');
      document.head.appendChild(link);
    }

    link.setAttribute('href', url);
  }

  /**
   * Add structured data (JSON-LD)
   */
  addStructuredData(data: any): void {
    if (!isPlatformBrowser(this.platformId)) {
      return; // Skip on server
    }

    let script: HTMLScriptElement | null = document.querySelector('script[type="application/ld+json"]');

    if (!script) {
      script = document.createElement('script');
      script.type = 'application/ld+json';
      document.head.appendChild(script);
    }

    script.textContent = JSON.stringify(data);
  }

  /**
   * Remove structured data
   */
  removeStructuredData(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return; // Skip on server
    }

    const script = document.querySelector('script[type="application/ld+json"]');
    if (script) {
      script.remove();
    }
  }

  /**
   * Generate product meta tags
   */
  generateProductMeta(product: any, language: 'en' | 'es' = 'es'): PageMeta {
    const name = product.name[language];
    const description = product.description[language];
    const price = product.price;
    const brand = product.brand;

    return {
      title: `${name} - ${brand}`,
      description: `${description} Precio: $${price} MXN. ${product.inStock ? 'En stock' : 'Agotado'}. Envío gratis en México.`,
      keywords: `${name}, ${brand}, llantas motocicleta, ${product.specifications.width}/${product.specifications.aspectRatio}-${product.specifications.diameter}`,
      image: product.images.main,
      type: 'product',
      url: `${this.DOMAIN}/product/${product.slug}`
    };
  }

  /**
   * Generate catalog meta tags
   */
  generateCatalogMeta(filters?: any): PageMeta {
    let title = 'Catálogo de Llantas para Motocicleta';
    let description = 'Explora nuestro catálogo completo de llantas para motocicleta. Marcas premium: Michelin, Praxis, Pirelli, Dunlop, Bridgestone. Envío gratis en México.';

    if (filters?.categoryId) {
      title = `Llantas ${filters.categoryName || ''} para Motocicleta`;
    }

    if (filters?.brand && filters.brand.length > 0) {
      title = `Llantas ${filters.brand[0]} para Motocicleta`;
    }

    return {
      title,
      description,
      keywords: 'catálogo llantas, llantas motocicleta, Michelin, Praxis, Pirelli, comprar llantas',
      type: 'website'
    };
  }

  /**
   * Generate product structured data (JSON-LD)
   */
  generateProductStructuredData(product: any, language: 'en' | 'es' = 'es'): any {
    return {
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: product.name[language],
      description: product.description[language],
      image: product.images.main,
      brand: {
        '@type': 'Brand',
        name: product.brand
      },
      sku: product.sku,
      offers: {
        '@type': 'Offer',
        price: product.price,
        priceCurrency: 'MXN',
        availability: product.inStock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
        url: `${this.DOMAIN}/product/${product.slug}`
      }
    };
  }
}
