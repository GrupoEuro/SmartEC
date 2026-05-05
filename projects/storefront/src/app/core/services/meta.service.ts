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
  private readonly DEFAULT_IMAGE = 'assets/images/social-share.jpg';
  private readonly DOMAIN = 'https://importadoraeuro.com';
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
   * Add or update a named structured data block (JSON-LD).
   * Uses an id attribute so multiple schemas can coexist on the same page
   * (e.g., Product + BreadcrumbList) without removing each other.
   */
  addStructuredData(data: any, schemaId = 'schema-page'): void {
    if (!isPlatformBrowser(this.platformId)) return;

    let script = document.getElementById(schemaId) as HTMLScriptElement | null;
    if (!script) {
      script = document.createElement('script');
      script.type = 'application/ld+json';
      script.id = schemaId;
      document.head.appendChild(script);
    }
    script.textContent = JSON.stringify(data);
  }

  removeStructuredData(schemaId = 'schema-page'): void {
    if (!isPlatformBrowser(this.platformId)) return;
    document.getElementById(schemaId)?.remove();
  }

  /**
   * Generate product meta tags
   */
  generateProductMeta(product: any, language: 'en' | 'es' = 'es'): PageMeta {
    const name = product.name[language];
    const description = product.description[language];
    const price = product.price;
    const brand = product.brand;
    const specs = product.specifications || {};
    const medida = specs.width && specs.aspectRatio && specs.diameter
      ? `${specs.width}/${specs.aspectRatio}R${specs.diameter}`
      : '';

    return {
      title: `${name}${medida ? ' ' + medida : ''} - ${brand} | Importadora Euro`,
      description: `Compra ${name} ${brand}${medida ? ' medida ' + medida : ''} en línea. ${description.substring(0, 80)}. Precio: $${price} MXN. ${product.inStock ? 'En stock, envío inmediato' : 'Agotado'}. Envío a toda la República.`,
      keywords: `${name}, ${brand}, llantas para moto${medida ? ', llanta ' + medida + ', medida ' + medida : ''}, comprar llantas moto México, ${brand} precio México`,
      image: product.images.main,
      type: 'product',
      url: `${this.DOMAIN}/product/${product.slug}`
    };
  }

  /**
   * Generate catalog meta tags
   */
  generateCatalogMeta(filters?: any): PageMeta {
    let title = 'Llantas Praxis para Motocicleta';
    let description = 'Catálogo de llantas Praxis para motocicleta. Deportivas, naked, touring, scooter. Envío a toda la República Mexicana en 1-3 días.';

    if (filters?.categoryId) {
      title = `Llantas ${(filters.categoryName || '').substring(0, 20)} para Moto en México`;
    }

    if (filters?.brand && filters.brand.length > 0) {
      title = `Llantas ${filters.brand[0]} para Moto en México`;
    }

    return {
      title,
      description,
      keywords: 'llantas para moto, comprar llantas para moto, llantas para motocicleta México, llantas Praxis, medida de llanta moto, llantas deportivas moto, llantas doble propósito, talla de llanta moto, llantas moto San Luis Potosí, envío gratis llantas México',
      type: 'website',
      // Always pin canonical to /catalogo regardless of which alias URL was used
      url: `${this.DOMAIN}/catalogo`
    };
  }

  /**
   * Generate product structured data (JSON-LD)
   */
  generateProductStructuredData(product: any, language: 'en' | 'es' = 'es'): any {
    const specs = product.specifications || {};
    const sizeLabel = specs.width && specs.aspectRatio && specs.diameter
      ? `${specs.width}/${specs.aspectRatio}R${specs.diameter}`
      : '';

    return {
      '@context': 'https://schema.org',
      '@type': 'Product',
      '@id': `${this.DOMAIN}/product/${product.slug}#product`,
      name: product.name[language],
      description: product.description?.[language] || '',
      image: [product.images.main, ...(product.images.gallery || [])].filter(Boolean),
      brand: {
        '@type': 'Brand',
        name: product.brand
      },
      sku: product.sku,
      mpn: product.sku,
      ...(sizeLabel ? { size: sizeLabel } : {}),
      offers: {
        '@type': 'Offer',
        price: product.price,
        priceCurrency: 'MXN',
        availability: product.inStock
          ? 'https://schema.org/InStock'
          : 'https://schema.org/OutOfStock',
        itemCondition: 'https://schema.org/NewCondition',
        url: `${this.DOMAIN}/product/${product.slug}`,
        seller: {
          '@type': 'Organization',
          name: 'Importadora Eurollantas',
          url: this.DOMAIN
        },
        priceValidUntil: new Date(new Date().setFullYear(new Date().getFullYear() + 1))
          .toISOString().split('T')[0],
        shippingDetails: {
          '@type': 'OfferShippingDetails',
          shippingRate: {
            '@type': 'MonetaryAmount',
            currency: 'MXN'
          },
          shippingDestination: {
            '@type': 'DefinedRegion',
            addressCountry: 'MX'
          },
          deliveryTime: {
            '@type': 'ShippingDeliveryTime',
            handlingTime: {
              '@type': 'QuantitativeValue',
              minValue: 0,
              maxValue: 1,
              unitCode: 'DAY'
            },
            transitTime: {
              '@type': 'QuantitativeValue',
              minValue: 1,
              maxValue: 3,
              unitCode: 'DAY'
            }
          }
        },
        hasMerchantReturnPolicy: {
          '@type': 'MerchantReturnPolicy',
          applicableCountry: 'MX',
          returnPolicyCategory: 'https://schema.org/MerchantReturnFiniteReturnWindow',
          merchantReturnDays: 30,
          returnMethod: 'https://schema.org/ReturnByMail',
          returnFees: 'https://schema.org/FreeReturn'
        }
      },
      dateModified: new Date().toISOString().split('T')[0],
      ...(product.rating ? {
        aggregateRating: {
          '@type': 'AggregateRating',
          ratingValue: product.rating,
          reviewCount: product.reviewCount || 1
        }
      } : {})
    };
  }

  /**
   * Generate catalog structured data (ItemList)
   */
  generateCatalogStructuredData(products: any[], language: 'en' | 'es' = 'es'): any {
    return {
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      itemListElement: products.map((product, index) => ({
        '@type': 'ListItem',
        position: index + 1,
        item: {
          '@type': 'Product',
          name: product.name[language] || product.name['es'],
          description: (product.description[language] || product.description['es'] || '').substring(0, 150),
          image: product.images.main,
          url: `${this.DOMAIN}/product/${product.slug}`,
          sku: product.sku,
          brand: {
            '@type': 'Brand',
            name: product.brand
          },
          offers: {
            '@type': 'Offer',
            price: product.price,
            priceCurrency: 'MXN',
            availability: product.inStock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock'
          }
        }
      }))
    };
  }

  /**
   * Generate BreadcrumbList structured data (JSON-LD).
   * Usage: this.metaService.addStructuredData(
   *   this.metaService.generateBreadcrumbSchema([
   *     { name: 'Inicio', url: 'https://importadoraeuro.com' },
   *     { name: 'Catálogo', url: 'https://importadoraeuro.com/catalogo' },
   *     { name: 'Michelin' }   ← last item: no url (current page)
   *   ]), 'schema-breadcrumb'
   * );
   */
  generateBreadcrumbSchema(items: { name: string; url?: string }[]): any {
    return {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: items.map((item, index) => ({
        '@type': 'ListItem',
        position: index + 1,
        name: item.name,
        ...(item.url ? { item: item.url } : {}),
      })),
    };
  }
}
