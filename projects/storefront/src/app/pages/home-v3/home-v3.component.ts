import { Component, OnInit, OnDestroy, inject, signal } from '@angular/core';
import { CommonModule, CurrencyPipe } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { CartService } from '../../core/services/cart.service';
import { MetaService } from '../../core/services/meta.service';
import { Product } from '../../core/models/product.model';

export interface FeaturedDeal {
  id: string;
  name: string;
  brand: 'Praxis' | 'Michelin' | 'Continental' | 'Pirelli';
  sku: string;
  slug: string;
  size: string;
  application: string;
  originalPrice: number;
  promoPrice: number;
  discountPct: number;
  rating: number;
  reviewsCount: number;
  inStock: boolean;
  image: string;
  badge?: string;
  isFlash?: boolean;
}

export interface HeroSlide {
  id: number;
  badge: string;
  title: string;
  highlight: string;
  subtitle: string;
  ctaText: string;
  ctaLink: string;
  bgImage: string;
  bgGradient: string;
}

@Component({
  selector: 'app-home-v3',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule, CurrencyPipe],
  templateUrl: './home-v3.component.html',
  styleUrl: './home-v3.component.css'
})
export class HomeV3Component implements OnInit, OnDestroy {
  private router = inject(Router);
  private cartService = inject(CartService);
  private meta = inject(MetaService);

  // Hero Carousel Signals
  currentSlide = signal<number>(0);
  private slideTimer: any;

  heroSlides: HeroSlide[] = [
    {
      id: 0,
      badge: 'OFERTA VERANO 2026 ⚡',
      title: 'Encuentra la Llanta Exacta para tu Moto con',
      highlight: 'Descuento Directo',
      subtitle: 'Distribuidor exclusivo de llantas Praxis en México. Hasta 6 MSI con MercadoPago y garantía directa de fábrica por 1 año.',
      ctaText: 'EXPLORAR OPORTUNIDADES →',
      ctaLink: '/catalogo',
      bgImage: 'assets/images/banners/hero-carousel-praxis.png',
      bgGradient: 'radial-gradient(circle at 70% 20%, rgba(0, 172, 216, 0.25) 0%, transparent 60%)'
    },
    {
      id: 1,
      badge: 'MICHELIN PREMIUM 🛡️',
      title: 'Máxima Adherencia y Seguridad Urbana con',
      highlight: 'Michelin City & Pilot',
      subtitle: 'Tecnología de compuesto de sílice para frenado superior en superficies húmedas y mayor rendimiento por kilómetro.',
      ctaText: 'VER LLANTAS MICHELIN →',
      ctaLink: '/catalogo?brand=Michelin',
      bgImage: 'assets/images/banners/hero-carousel-michelin.png',
      bgGradient: 'radial-gradient(circle at 70% 20%, rgba(255, 215, 0, 0.2) 0%, transparent 60%)'
    },
    {
      id: 2,
      badge: 'MAYOREO & FLOTILLAS 📦',
      title: 'Surtido Directo de Importador para',
      highlight: 'Talleres y Refaccionarias',
      subtitle: 'Descuentos escalonados por volumen, facturación inmediata CFDI 4.0 y atención personalizada a flotillas en todo México.',
      ctaText: 'COTIZAR COMERCIOS →',
      ctaLink: '/nosotros',
      bgImage: 'assets/images/banners/hero-carousel-b2b.png',
      bgGradient: 'radial-gradient(circle at 70% 20%, rgba(56, 239, 125, 0.2) 0%, transparent 60%)'
    }
  ];

  // ZIP Delivery Calculator Signals
  userZip = signal<string>('');
  calculatedDelivery = signal<string>('');

  // Social Proof Sales Ticker Toast Signal
  recentSale = signal<{ name: string; city: string; item: string; time: string } | null>({
    name: 'Roberto M.',
    city: 'Guadalajara, JAL',
    item: '2x Praxis Raptor 120/70-17',
    time: 'hace 4 min'
  });

  // Tire Finder Filter Form Signals
  selectedRim = signal<string>('');
  selectedWidth = signal<string>('');
  selectedAspect = signal<string>('');
  selectedPosition = signal<string>('');
  selectedUsage = signal<string>('');

  // Dropdown options
  rimOptions = ['10', '12', '13', '14', '15', '16', '17', '18', '19', '21'];
  widthOptions = ['70', '80', '90', '100', '110', '120', '130', '140', '150', '180'];
  aspectOptions = ['60', '70', '80', '90', '100'];

  // Categories Shortcuts
  categories = [
    { title: 'Trabajo / Reparto', subtitle: 'Llantas de alto kilometraje para Italika, Honda, Yamaha', icon: '🏍️', tag: 'Italika & Work', brand: 'Praxis', searchParam: 'trabajo' },
    { title: 'Deportiva & Pista', subtitle: 'Agarre extremo en curvas con compuesto Praxi-Grip', icon: '⚡', tag: 'Raptor Series', brand: 'Praxis', searchParam: 'deportiva' },
    { title: 'Doble Propósito', subtitle: 'Dominio en asfalto y terracería con tacos reforzados', icon: '🏔️', tag: 'All-Terrain', brand: 'Praxis', searchParam: 'doble-proposito' },
    { title: 'Scooters & Ciudad', subtitle: 'Maniobrabilidad urbana y frenado seguro en mojado', icon: '🛵', tag: 'City Commute', brand: 'Michelin', searchParam: 'scooter' },
    { title: 'Cámaras & Rines', subtitle: 'Refuerzo de butilo premium para máxima presión', icon: '🛠️', tag: 'Accesorios', brand: 'Praxis', searchParam: 'camaras' }
  ];

  // Flash Deals (Ofertas Relámpago)
  flashDeals: FeaturedDeal[] = [
    {
      id: 'praxis-raptor-120-70-17',
      name: 'Llanta Praxis Raptor 120/70-17 Tubeless',
      brand: 'Praxis',
      sku: 'PRX-RAP-1207017',
      slug: 'llanta-praxis-raptor-120-70-17',
      size: '120/70-17',
      application: 'Deportiva / Pista',
      originalPrice: 1650,
      promoPrice: 1299,
      discountPct: 21,
      rating: 4.9,
      reviewsCount: 84,
      inStock: true,
      image: 'assets/images/products/praxis-raptor.png',
      badge: 'MÁS VENDIDO ⚡',
      isFlash: true
    },
    {
      id: 'praxis-urban-90-90-18',
      name: 'Llanta Praxis Urban Pro 90/90-18 Reforzada',
      brand: 'Praxis',
      sku: 'PRX-URB-909018',
      slug: 'llanta-praxis-urban-pro-90-90-18',
      size: '90/90-18',
      application: 'Trabajo / Italika FT150',
      originalPrice: 1120,
      promoPrice: 889,
      discountPct: 20,
      rating: 4.8,
      reviewsCount: 142,
      inStock: true,
      image: 'assets/images/products/praxis-urban.png',
      badge: 'OFERTA EXPRESS 🔥',
      isFlash: true
    },
    {
      id: 'michelin-city-pro-110-80-14',
      name: 'Llanta Michelin City Pro 110/80-14 Scooter',
      brand: 'Michelin',
      sku: 'MCH-CTP-1108014',
      slug: 'llanta-michelin-city-pro-110-80-14',
      size: '110/80-14',
      application: 'Scooter / WS150',
      originalPrice: 1890,
      promoPrice: 1599,
      discountPct: 15,
      rating: 5.0,
      reviewsCount: 67,
      inStock: true,
      image: 'assets/images/products/michelin-city.png',
      badge: 'PREMIUM MICHELIN 🛡️',
      isFlash: true
    },
    {
      id: 'praxis-trail-110-90-16',
      name: 'Llanta Praxis Dual Trail 110/90-16 All-Terrain',
      brand: 'Praxis',
      sku: 'PRX-TRL-1109016',
      slug: 'llanta-praxis-dual-trail-110-90-16',
      size: '110/90-16',
      application: 'Doble Propósito / DM200',
      originalPrice: 1450,
      promoPrice: 1180,
      discountPct: 18,
      rating: 4.9,
      reviewsCount: 95,
      inStock: true,
      image: 'assets/images/products/praxis-trail.png',
      badge: 'NUEVA GENERACIÓN 🚀',
      isFlash: true
    }
  ];

  // Best Sellers (Más Vendidos)
  bestSellers: FeaturedDeal[] = [
    {
      id: 'praxis-raptor-140-70-17',
      name: 'Llanta Praxis Raptor Rear 140/70-17 Sports',
      brand: 'Praxis',
      sku: 'PRX-RAP-1407017',
      slug: 'llanta-praxis-raptor-140-70-17',
      size: '140/70-17',
      application: 'Pista / Trasera High-Grip',
      originalPrice: 1980,
      promoPrice: 1590,
      discountPct: 19,
      rating: 4.9,
      reviewsCount: 110,
      inStock: true,
      image: 'assets/images/products/praxis-raptor.png',
      badge: 'RECOMENDADO PILOTOS 🏁'
    },
    {
      id: 'praxis-work-300-18',
      name: 'Llanta Praxis Heavy Duty 3.00-18 6PR Cargo',
      brand: 'Praxis',
      sku: 'PRX-WRK-30018',
      slug: 'llanta-praxis-heavy-duty-300-18',
      size: '3.00-18',
      application: 'Carga & Reparto Intenso',
      originalPrice: 990,
      promoPrice: 799,
      discountPct: 19,
      rating: 4.7,
      reviewsCount: 204,
      inStock: true,
      image: 'assets/images/products/praxis-urban.png',
      badge: 'ALTO KILOMETRAJE 📦'
    },
    {
      id: 'praxis-supermotech-100-90-19',
      name: 'Llanta Praxis Supermotech 100/90-19 Front Dual',
      brand: 'Praxis',
      sku: 'PRX-SMT-1009019',
      slug: 'llanta-praxis-supermotech-100-90-19',
      size: '100/90-19',
      application: 'Enduro & On/Off-Road',
      originalPrice: 1540,
      promoPrice: 1250,
      discountPct: 18,
      rating: 4.8,
      reviewsCount: 78,
      inStock: true,
      image: 'assets/images/products/praxis-trail.png',
      badge: 'MAX RESISTENCIA 🛡️'
    },
    {
      id: 'michelin-pilot-street-130-70-17',
      name: 'Llanta Michelin Pilot Street 2 130/70-17',
      brand: 'Michelin',
      sku: 'MCH-PST-1307017',
      slug: 'llanta-michelin-pilot-street-130-70-17',
      size: '130/70-17',
      application: 'Sport Touring Urban',
      originalPrice: 2490,
      promoPrice: 2150,
      discountPct: 13,
      rating: 5.0,
      reviewsCount: 156,
      inStock: true,
      image: 'assets/images/products/michelin-city.png',
      badge: 'MÁXIMO AGARRE 🌧️'
    }
  ];

  ngOnInit(): void {
    this.meta.updateTags({
      title: 'Importadora Eurollantas | Tienda de Llantas para Moto en México',
      description: 'Compra llantas para motocicleta Praxis y Michelin con envío gratis a todo México en 1-3 días. Precios de fábrica y MSI con MercadoPago.',
      keywords: 'llantas moto, comprar llantas moto mexico, llantas praxis, llantas michelin moto, llantas italika, llantas 120 70 17',
      type: 'website'
    });

    // Auto-advance hero carousel every 6 seconds
    this.slideTimer = setInterval(() => {
      this.nextSlide();
    }, 6000);
  }

  ngOnDestroy(): void {
    if (this.slideTimer) {
      clearInterval(this.slideTimer);
    }
  }

  nextSlide(): void {
    this.currentSlide.update(idx => (idx + 1) % this.heroSlides.length);
  }

  setSlide(index: number): void {
    this.currentSlide.set(index);
  }

  // Delivery Estimator by Zip Code
  calculateDelivery(): void {
    const cp = this.userZip().trim();
    if (!cp || cp.length < 5) {
      this.calculatedDelivery.set('Por favor ingresa un C.P. válido de 5 dígitos.');
      return;
    }

    const statePrefix = cp.substring(0, 2);
    if (['78', '79'].includes(statePrefix)) {
      this.calculatedDelivery.set('🚚 Entrega Express local: ¡Llega mañana mismo a San Luis Potosí!');
    } else if (['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12', '13', '14', '15', '16', '44', '45', '64', '66'].includes(statePrefix)) {
      this.calculatedDelivery.set('🚚 Envío prioritario: Llega en 24 a 48 horas hábiles.');
    } else {
      this.calculatedDelivery.set('🚚 Envío nacional seguro: Llega en 2 a 3 días hábiles.');
    }
  }

  // Handle Image Fallback
  onImgError(event: Event): void {
    const target = event.target as HTMLImageElement;
    if (target) {
      target.src = 'assets/images/euro-logo-new.png';
    }
  }

  // Execute Tire Search Filter redirecting to catalog
  searchTires(): void {
    const queryParams: any = {};
    if (this.selectedRim()) queryParams.rim = this.selectedRim();
    if (this.selectedWidth()) queryParams.width = this.selectedWidth();
    if (this.selectedAspect()) queryParams.aspect = this.selectedAspect();
    if (this.selectedPosition()) queryParams.position = this.selectedPosition();
    if (this.selectedUsage()) queryParams.usage = this.selectedUsage();

    this.router.navigate(['/catalogo'], { queryParams });
  }

  // Add Item Directly to Cart
  addToCart(deal: FeaturedDeal, event: Event): void {
    event.preventDefault();
    event.stopPropagation();

    const product: Product = {
      id: deal.id,
      name: deal.name,
      slug: deal.slug,
      sku: deal.sku,
      brand: deal.brand,
      price: deal.promoPrice,
      originalPrice: deal.originalPrice,
      inStock: deal.inStock,
      images: [deal.image],
      mainImage: deal.image,
      specifications: {
        size: deal.size,
        application: deal.application
      }
    } as unknown as Product;

    this.cartService.addToCart(product, 1);
    this.cartService.openCart();
  }

  // Direct Buy Now CTA
  buyNow(deal: FeaturedDeal, event: Event): void {
    event.preventDefault();
    event.stopPropagation();

    const product: Product = {
      id: deal.id,
      name: deal.name,
      slug: deal.slug,
      sku: deal.sku,
      brand: deal.brand,
      price: deal.promoPrice,
      originalPrice: deal.originalPrice,
      inStock: deal.inStock,
      images: [deal.image],
      mainImage: deal.image,
      specifications: {
        size: deal.size,
        application: deal.application
      }
    } as unknown as Product;

    this.cartService.addToCart(product, 1);
    this.router.navigate(['/checkout']);
  }

  quickFilterBrand(brand: string): void {
    this.router.navigate(['/catalogo'], { queryParams: { brand } });
  }

  quickCategorySearch(param: string): void {
    this.router.navigate(['/catalogo'], { queryParams: { category: param } });
  }
}
