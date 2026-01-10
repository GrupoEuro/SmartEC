import { Injectable, inject } from '@angular/core';
import { Firestore, collection, writeBatch, doc, Timestamp, getDocs, limit, query } from '@angular/fire/firestore';

export interface SeederConfig {
    orderCount: number;
    customerCount: number;
    startDate: Date;
    endDate: Date;
    chaosMode: boolean; // Introducing randomness/errors
    scenario: 'GOLDEN_PATH' | 'STRESS_TEST' | 'NIGHTMARE' | 'CUSTOM';
}

export const DEFAULT_CONFIG: SeederConfig = {
    orderCount: 100,
    customerCount: 50,
    startDate: new Date(2025, 11, 1), // Dec 1, 2025
    endDate: new Date(), // Today (Jan 9, 2026)
    chaosMode: false,
    scenario: 'CUSTOM'
};

@Injectable({
    providedIn: 'root'
})
export class DataSeederService {
    private firestore = inject(Firestore);

    // Version identifier for tracking seed data schema
    private readonly SEED_VERSION = 'v2.5.0-kardex-schema-fix';

    constructor() { }

    // --- LOGGING HELPER ---
    private log(message: string, onLog?: (message: string) => void): void {
        console.log(message);
        if (onLog) {
            onLog(message);
        }
    }

    // --- SCENARIO ORCHESTRATOR ---
    async runScenario(scenario: 'GOLDEN_PATH' | 'STRESS_TEST' | 'NIGHTMARE', onLog?: (message: string) => void): Promise<void> {
        this.log('========================================', onLog);
        this.log(`[Seeder] Version: ${this.SEED_VERSION}`, onLog);
        this.log(`[Seeder] Running Scenario: ${scenario}`, onLog);
        this.log('========================================', onLog);

        let config: SeederConfig;

        switch (scenario) {
            case 'GOLDEN_PATH':
                config = { ...DEFAULT_CONFIG, orderCount: 150, customerCount: 50, chaosMode: false, scenario: 'GOLDEN_PATH' };
                break;
            case 'STRESS_TEST':
                config = { ...DEFAULT_CONFIG, orderCount: 2000, customerCount: 200, chaosMode: false, scenario: 'STRESS_TEST' };
                break;
            case 'NIGHTMARE':
                config = { ...DEFAULT_CONFIG, orderCount: 300, customerCount: 50, chaosMode: true, scenario: 'NIGHTMARE' };
                break;
            default:
                config = DEFAULT_CONFIG;
        }

        await this.clearAll(onLog); // Always start fresh for scenarios for now
        await this.seedAll(config, onLog);
    }

    // --- HELPER: DELETE COLLECTION ---
    async deleteCollection(path: string, batchSize = 100): Promise<number> {
        const q = query(collection(this.firestore, path), limit(batchSize));
        const snapshot = await getDocs(q);

        if (snapshot.size === 0) return 0;

        const batch = writeBatch(this.firestore);
        snapshot.docs.forEach(doc => {
            batch.delete(doc.ref);
        });
        await batch.commit();

        return snapshot.size + await this.deleteCollection(path, batchSize);
    }

    async clearAll(onLog?: (message: string) => void) {
        await this.deleteCollection('orders', 200);
        await this.deleteCollection('customers', 200);
        await this.deleteCollection('products', 200);
        await this.deleteCollection('locations'); // Clear locations
        await this.deleteCollection('brands');
        await this.deleteCollection('categories');
        await this.deleteCollection('coupons');
        await this.deleteCollection('expenses');
        await this.deleteCollection('approval_requests');
        await this.deleteCollection('notifications');
        await this.deleteCollection('orderAssignments');
        await this.deleteCollection('orderNotes'); // Clear order notes
        await this.deleteCollection('inventory_balances'); // Clear inventory
        await this.deleteCollection('inventory_ledger'); // Clear kardex
        this.log('[Seeder] Database Cleared.', onLog);
    }

    // --- 0. LOCATIONS ---
    async populateLocations(onLog?: (message: string) => void): Promise<void> {
        this.log('[Seeder] Seeding Locations...', onLog);
        const batch = writeBatch(this.firestore);

        const locs = [
            { id: 'MAIN', name: 'Almacén Principal', type: 'WAREHOUSE', isVirtual: false, active: true },
            { id: 'AMAZON_FBA', name: 'Amazon FBA', type: 'FBA', isVirtual: true, active: true },
            { id: 'MELI_FULL', name: 'Mercado Libre Full', type: 'FULFILLMENT_CENTER', isVirtual: true, active: true }
        ];

        locs.forEach(l => {
            const ref = doc(this.firestore, `locations/${l.id}`);
            batch.set(ref, { ...l, createdAt: Timestamp.now() });
        });

        await batch.commit();
        this.log('[Seeder] Locations Seeded.', onLog);
    }

    // --- 1. CATALOG ---
    async populateCatalog(config: SeederConfig = DEFAULT_CONFIG, onLog?: (message: string) => void): Promise<void> {
        this.log('[Seeder] Starting Catalog...', onLog);
        // Brands
        const batch1 = writeBatch(this.firestore);
        const brands = [
            { id: 'brand_praxis', name: 'Praxis', slug: 'praxis', countryOfOrigin: 'Mexico', active: true },
            { id: 'brand_michelin', name: 'Michelin', slug: 'michelin', countryOfOrigin: 'France', active: true },
            { id: 'brand_pirelli', name: 'Pirelli', slug: 'pirelli', countryOfOrigin: 'Italy', active: true },
            { id: 'brand_dunlop', name: 'Dunlop', slug: 'dunlop', countryOfOrigin: 'United Kingdom', active: true },
            { id: 'brand_bridgestone', name: 'Bridgestone', slug: 'bridgestone', countryOfOrigin: 'Japan', active: true }
        ];

        brands.forEach(b => {
            const ref = doc(this.firestore, `brands/${b.id}`);
            batch1.set(ref, {
                ...b,
                description: { en: `${b.name} Tires`, es: `Llantas ${b.name}` },
                logoUrl: `https://via.placeholder.com/200x80/0f172a/FFFFFF?text=${b.name}`,
                createdAt: Timestamp.now(), updatedAt: Timestamp.now()
            });
        });
        await batch1.commit();

        // Categories
        const batch2 = writeBatch(this.firestore);
        const categories = [
            { id: 'cat_sport', name: { en: 'Sport', es: 'Deportivas' }, slug: 'sport', icon: '🏍️' },
            { id: 'cat_touring', name: { en: 'Touring', es: 'Turismo' }, slug: 'touring', icon: '🛣️' },
            { id: 'cat_offroad', name: { en: 'Off-Road', es: 'Todo Terreno' }, slug: 'off-road', icon: '⛰️' },
            { id: 'cat_scooter', name: { en: 'Scooter', es: 'Scooter' }, slug: 'scooter', icon: '🛴' }
        ];
        categories.forEach(c => {
            const ref = doc(this.firestore, `categories/${c.id}`);
            batch2.set(ref, { ...c, active: true, createdAt: Timestamp.now(), updatedAt: Timestamp.now() });
        });
        await batch2.commit();

        // Products - Realistic Praxis Tire Catalog
        const batch3 = writeBatch(this.firestore);

        // Real Praxis tire models with actual specifications
        const realTireModels = [
            { model: 'PR-100', size: '90/90-18', type: 'sport', price: 850, desc: 'Sport performance tire' },
            { model: 'PR-200', size: '110/90-17', type: 'sport', price: 920, desc: 'High-grip sport tire' },
            { model: 'PR-300', size: '130/70-17', type: 'sport', price: 1050, desc: 'Premium sport radial' },
            { model: 'PR-400', size: '100/90-18', type: 'touring', price: 780, desc: 'Long-distance touring' },
            { model: 'PR-500', size: '120/80-17', type: 'touring', price: 890, desc: 'All-weather touring' },
            { model: 'PR-600', size: '140/70-17', type: 'touring', price: 1120, desc: 'Premium touring radial' },
            { model: 'PR-700', size: '2.75-18', type: 'scooter', price: 650, desc: 'Urban scooter tire' },
            { model: 'PR-800', size: '3.50-10', type: 'scooter', price: 580, desc: 'Compact scooter tire' },
            { model: 'PR-900', size: '110/90-16', type: 'scooter', price: 720, desc: 'Large scooter tire' },
            { model: 'PR-1000', size: '4.10-18', type: 'offroad', price: 950, desc: 'Off-road enduro tire' },
            { model: 'PR-1100', size: '80/100-21', type: 'offroad', price: 1080, desc: 'Motocross front tire' },
            { model: 'PR-1200', size: '120/90-18', type: 'offroad', price: 1150, desc: 'Dual-sport adventure' },
            { model: 'PR-1300', size: '100/80-17', type: 'sport', price: 880, desc: 'Street sport tire' },
            { model: 'PR-1400', size: '150/70-17', type: 'sport', price: 1280, desc: 'Wide sport rear tire' },
            { model: 'PR-1500', size: '90/80-17', type: 'touring', price: 750, desc: 'Economy touring tire' }
        ];

        const products = [];
        const multiplier = config.scenario === 'STRESS_TEST' ? 3 : 1;

        for (let i = 0; i < realTireModels.length * multiplier; i++) {
            const tireSpec = realTireModels[i % realTireModels.length];
            const brand = brands[0]; // Praxis is primary brand

            // Map tire type to category
            const catMap: any = {
                'sport': categories.find(c => c.id === 'cat_sport'),
                'touring': categories.find(c => c.id === 'cat_touring'),
                'scooter': categories.find(c => c.id === 'cat_scooter'),
                'offroad': categories.find(c => c.id === 'cat_offroad')
            };
            const cat = catMap[tireSpec.type] || categories[0];

            const nameEn = `Praxis ${tireSpec.model} ${tireSpec.size}`;
            const nameEs = `Praxis ${tireSpec.model} ${tireSpec.size}`;

            // Realistic stock levels
            let stock = 25;
            if (config.scenario === 'STRESS_TEST') stock = Math.random() < 0.3 ? 3 : 80;
            if (config.scenario === 'NIGHTMARE') stock = Math.random() < 0.2 ? 0 : 8;

            const price = tireSpec.price;
            const cost = config.scenario === 'NIGHTMARE' && Math.random() < 0.1 ? price + 150 : price * 0.58;

            // Multi-location distribution
            let stockMain = stock;
            let stockFba = 0;
            let stockFull = 0;

            if (config.scenario !== 'GOLDEN_PATH') {
                stockMain = Math.floor(stock * 0.65);
                stockFba = Math.floor(stock * 0.25);
                stockFull = stock - stockMain - stockFba;
            }

            products.push({
                id: `prod_praxis_${tireSpec.model.toLowerCase()}`,
                name: { en: nameEn, es: nameEs },
                slug: `praxis-${tireSpec.model.toLowerCase()}-${tireSpec.size.replace(/\//g, '-')}`,
                brandId: brand.id,
                categoryId: cat.id,
                sku: `PRAXIS-${tireSpec.model}`,

                // Tire specifications
                specifications: {
                    width: tireSpec.size.split('/')[0] || tireSpec.size.split('-')[0],
                    aspectRatio: tireSpec.size.split('/')[1]?.split('-')[0] || '',
                    rimDiameter: tireSpec.size.split('-')[1] || tireSpec.size.split('/')[1],
                    loadIndex: '54',
                    speedRating: 'P',
                    construction: 'Bias',
                    tubeless: tireSpec.type === 'sport' || tireSpec.type === 'touring'
                },

                description: {
                    en: `${tireSpec.desc}. Premium quality motorcycle tire designed for Mexican road conditions.`,
                    es: `${tireSpec.desc}. Llanta de motocicleta de calidad premium diseñada para las condiciones de las carreteras mexicanas.`
                },

                features: {
                    en: ['Extended warranty', 'Superior grip', 'Long-lasting tread', 'All-weather performance'],
                    es: ['Garantía extendida', 'Agarre superior', 'Banda de rodadura duradera', 'Rendimiento todo clima']
                },

                applications: ['Honda', 'Yamaha', 'Suzuki', 'Kawasaki', 'Italika'],

                images: {
                    main: `https://via.placeholder.com/800x800/1a1a1a/FFFFFF?text=${tireSpec.model}`,
                    gallery: []
                },

                price: Math.round(price),
                costPrice: Math.round(cost),
                margin: Math.round(((price - cost) / price) * 100),
                averageCost: Math.round(cost),
                totalInventoryValue: Math.round(cost * stock),

                // Aggregates
                stockQuantity: stock,
                availableStock: stock,
                inStock: stock > 0,

                // Multi-Location Map
                inventory: {
                    MAIN: { stock: stockMain, reserved: 0, available: stockMain },
                    AMAZON_FBA: { stock: stockFba, reserved: 0, available: stockFba },
                    MELI_FULL: { stock: stockFull, reserved: 0, available: stockFull }
                },

                active: true,
                createdAt: Timestamp.now(),
                updatedAt: Timestamp.now()
            });
        }

        products.forEach(p => {
            const ref = doc(this.firestore, `products/${p.id}`);
            batch3.set(ref, p);
        });
        await batch3.commit();
        this.log('[Seeder] Catalog Seeded with realistic Praxis products.', onLog);
    }

    // --- 2. CUSTOMERS ---
    async populateCustomers(config: SeederConfig = DEFAULT_CONFIG, onLog?: (message: string) => void): Promise<void> {
        this.log('[Seeder] Starting Customers...', onLog);

        // Realistic Mexican names
        const firstNames = [
            'Miguel', 'José', 'Juan', 'Luis', 'Carlos', 'Jorge', 'Pedro', 'Francisco', 'Alejandro', 'Antonio',
            'María', 'Guadalupe', 'Rosa', 'Ana', 'Juana', 'Carmen', 'Patricia', 'Laura', 'Elena', 'Sofía',
            'Ricardo', 'Fernando', 'Roberto', 'Raúl', 'Sergio', 'Diego', 'Arturo', 'Manuel', 'Héctor', 'Andrés'
        ];

        const lastNames = [
            'García', 'Rodríguez', 'Martínez', 'Hernández', 'López', 'González', 'Pérez', 'Sánchez', 'Ramírez', 'Torres',
            'Flores', 'Rivera', 'Gómez', 'Díaz', 'Cruz', 'Morales', 'Reyes', 'Gutiérrez', 'Ortiz', 'Chávez',
            'Ruiz', 'Jiménez', 'Mendoza', 'Vargas', 'Castro', 'Romero', 'Álvarez', 'Medina', 'Aguilar', 'Vega'
        ];

        // Mexican cities and neighborhoods
        const cities = [
            { city: 'Ciudad de México', state: 'CDMX', colonias: ['Polanco', 'Roma Norte', 'Condesa', 'Coyoacán', 'Del Valle'] },
            { city: 'Guadalajara', state: 'Jalisco', colonias: ['Providencia', 'Chapalita', 'Americana', 'Centro', 'Zapopan'] },
            { city: 'Monterrey', state: 'Nuevo León', colonias: ['San Pedro', 'Valle Oriente', 'Contry', 'Centro', 'Santa Catarina'] },
            { city: 'Puebla', state: 'Puebla', colonias: ['Angelópolis', 'La Paz', 'Centro Histórico', 'Cholula', 'Zavaleta'] },
            { city: 'Querétaro', state: 'Querétaro', colonias: ['Juriquilla', 'Centro Sur', 'El Refugio', 'Milenio III', 'Corregidora'] }
        ];

        const batch = writeBatch(this.firestore);

        for (let i = 0; i < config.customerCount; i++) {
            const id = `cust_user_${i + 1}`;
            const ref = doc(this.firestore, `customers/${id}`);

            const firstName = firstNames[Math.floor(Math.random() * firstNames.length)];
            const lastName1 = lastNames[Math.floor(Math.random() * lastNames.length)];
            const lastName2 = lastNames[Math.floor(Math.random() * lastNames.length)];
            const fullName = `${firstName} ${lastName1} ${lastName2}`;

            // Customer Acquisition Channel (where they first came from)
            const acquisitionRoll = Math.random();
            let acquisitionChannel: string;
            let acquisitionDate = new Date(2024, Math.floor(Math.random() * 12), Math.floor(Math.random() * 28) + 1);

            if (acquisitionRoll < 0.35) {
                acquisitionChannel = 'WEB'; // 35% discovered via website
            } else if (acquisitionRoll < 0.50) {
                acquisitionChannel = 'WALK_IN'; // 15% walked into store
            } else if (acquisitionRoll < 0.65) {
                acquisitionChannel = 'REFERRAL'; // 15% referred by friend
            } else if (acquisitionRoll < 0.75) {
                acquisitionChannel = 'SOCIAL_MEDIA'; // 10% from social media
            } else if (acquisitionRoll < 0.85) {
                acquisitionChannel = 'GOOGLE_ADS'; // 10% from Google Ads
            } else if (acquisitionRoll < 0.92) {
                acquisitionChannel = 'AMAZON'; // 7% discovered via Amazon
            } else {
                acquisitionChannel = 'MERCADOLIBRE'; // 8% discovered via MercadoLibre
            }

            const location = cities[Math.floor(Math.random() * cities.length)];
            const colonia = location.colonias[Math.floor(Math.random() * location.colonias.length)];
            const streetNumber = Math.floor(Math.random() * 500) + 1;
            const postalCode = 10000 + Math.floor(Math.random() * 90000);

            const hasAlert = config.scenario === 'NIGHTMARE' && Math.random() < 0.3;

            batch.set(ref, {
                uid: id,
                displayName: fullName,
                email: `${firstName.toLowerCase()}.${lastName1.toLowerCase()}${i + 1}@gmail.com`,
                phone: `+52 ${Math.floor(Math.random() * 900) + 100} ${Math.floor(Math.random() * 900) + 100} ${Math.floor(Math.random() * 9000) + 1000}`,
                role: 'CUSTOMER',
                tags: hasAlert ? ['BAD_CREDIT'] : (Math.random() < 0.3 ? ['VIP'] : ['REGULAR']),
                isActive: true,
                address: {
                    street: `Calle ${streetNumber}`,
                    colonia: colonia,
                    city: location.city,
                    state: location.state,
                    postalCode: postalCode.toString(),
                    country: 'México'
                },
                // Customer Acquisition Tracking
                acquisitionChannel: acquisitionChannel,
                acquisitionDate: Timestamp.fromDate(acquisitionDate),
                createdAt: Timestamp.now(),
                stats: { totalOrders: 0, totalSpend: 0, lastOrderDate: null }
            });
        }
        await batch.commit();
        this.log('[Seeder] Customers Seeded with realistic Mexican data.', onLog);
    }

    // --- 3. ORDERS (The Engine) ---
    async populateOrders(config: SeederConfig = DEFAULT_CONFIG, onLog?: (message: string) => void): Promise<void> {
        this.log(`[Seeder] Starting Orders (${config.orderCount})...`, onLog);
        const productsSnapshot = await getDocs(collection(this.firestore, 'products'));

        if (productsSnapshot.empty) {
            this.log('[Seeder] ERROR: No products found! Cannot seed orders.', onLog);
            throw new Error('Catalog is empty. Cannot seed orders.');
        }

        const products = productsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() as any }));

        // Fetch actual customer data for realistic names, emails, and phones
        const customersSnapshot = await getDocs(collection(this.firestore, 'customers'));
        const customers: any[] = [];
        customersSnapshot.docs.forEach(doc => {
            const data = doc.data();
            customers.push({
                id: doc.id,
                name: data['displayName'] || 'Unknown Customer',
                email: data['email'] || `${doc.id}@example.com`,
                phone: data['phone'] || '+52 444 123 4567'
            });
        });

        const customerIds = Array.from({ length: config.customerCount }, (_, i) => `cust_user_${i + 1}`);

        const batchSize = 500;
        let batch = writeBatch(this.firestore);
        let count = 0;

        const customerStats: any = {};

        // Mexican cities and states for realistic addresses
        const mexicanAddresses = [
            { city: 'San Luis Potosí', state: 'San Luis Potosí', zipCode: '78000' },
            { city: 'Guadalajara', state: 'Jalisco', zipCode: '44100' },
            { city: 'Monterrey', state: 'Nuevo León', zipCode: '64000' },
            { city: 'Ciudad de México', state: 'CDMX', zipCode: '06000' },
            { city: 'Querétaro', state: 'Querétaro', zipCode: '76000' }
        ];

        const streets = ['Av. Carranza', 'Av. Salvador Nava', 'Blvd. Antonio Rocha Cordero', 'Calle Hidalgo', 'Av. Venustiano Carranza'];
        const colonias = ['Centro', 'Lomas', 'Jardines', 'Del Valle', 'Polanco'];

        for (let i = 0; i < config.orderCount; i++) {
            const orderId = `ord_${1000 + i}`;
            const ref = doc(this.firestore, `orders/${orderId}`);

            // Random Date within Range
            const start = config.startDate.getTime();
            const end = config.endDate.getTime();
            const date = new Date(start + Math.random() * (end - start));
            const ts = Timestamp.fromDate(date);

            // Scenarios
            let status = 'delivered';
            if (config.scenario === 'STRESS_TEST') {
                // Recent orders are pending/shipping
                const isRecent = (end - date.getTime()) < (1000 * 60 * 60 * 24 * 2); // 2 days
                if (isRecent) status = Math.random() < 0.5 ? 'processing' : 'shipped';
            }
            if (config.scenario === 'NIGHTMARE') {
                const r = Math.random();
                if (r < 0.2) status = 'payment_failed';
                else if (r < 0.3) status = 'cancelled';
                else if (r < 0.4) status = 'returned';
            }

            // Items
            const prod = products[Math.floor(Math.random() * products.length)];
            const qty = Math.floor(Math.random() * 4) + 1;
            const subtotal = prod.price * qty;
            const shippingCost = Math.random() < 0.3 ? 0 : 150; // 30% free shipping
            const tax = subtotal * 0.16; // 16% IVA
            const total = subtotal + shippingCost + tax;

            // Customer
            const custId = customerIds[Math.floor(Math.random() * customerIds.length)];
            const customer = customers.find(c => c.id === custId) || customers[0];

            // Shipping Address
            const address = mexicanAddresses[Math.floor(Math.random() * mexicanAddresses.length)];
            const shippingAddress = {
                street: streets[Math.floor(Math.random() * streets.length)],
                exteriorNumber: String(Math.floor(Math.random() * 900) + 100),
                interiorNumber: Math.random() < 0.3 ? String(Math.floor(Math.random() * 20) + 1) : '',
                colonia: colonias[Math.floor(Math.random() * colonias.length)],
                city: address.city,
                state: address.state,
                zipCode: address.zipCode,
                country: 'México',
                references: Math.random() < 0.5 ? 'Casa azul con portón negro' : ''
            };

            // Channel Distribution (Realistic proportions)
            const channelRoll = Math.random();
            let channel: string;
            let externalId: string | null = null;
            let metadata: any = undefined;

            if (channelRoll < 0.40) {
                // 40% WEB orders
                channel = 'WEB';
            } else if (channelRoll < 0.55) {
                // 15% POS orders
                channel = 'POS';
            } else if (channelRoll < 0.65) {
                // 10% ON_BEHALF orders
                channel = 'ON_BEHALF';
                const sources = ['PHONE', 'EMAIL', 'B2B', 'WALK_IN'];
                const staffMembers = ['ops_user_1', 'ops_user_2', 'ops_user_3'];
                metadata = {
                    enteredBy: staffMembers[Math.floor(Math.random() * staffMembers.length)],
                    enteredAt: date,
                    source: sources[Math.floor(Math.random() * sources.length)]
                };
            } else if (channelRoll < 0.75) {
                // 10% AMAZON_MFN orders (you fulfill from MAIN)
                channel = 'AMAZON_MFN';
                externalId = `114-${Math.floor(Math.random() * 9000000) + 1000000}-${Math.floor(Math.random() * 9000000) + 1000000}`;
            } else if (channelRoll < 0.85) {
                // 10% MELI_CLASSIC orders (you fulfill from MAIN)
                channel = 'MELI_CLASSIC';
                externalId = `${2000000000 + Math.floor(Math.random() * 1000000000)}`;
            } else if (channelRoll < 0.92) {
                // 7% AMAZON_FBA orders (for reporting/visibility only)
                channel = 'AMAZON_FBA';
                externalId = `114-${Math.floor(Math.random() * 9000000) + 1000000}-${Math.floor(Math.random() * 9000000) + 1000000}`;
            } else {
                // 8% MELI_FULL orders (for reporting/visibility only)
                channel = 'MELI_FULL';
                externalId = `${2000000000 + Math.floor(Math.random() * 1000000000)}`;
            }

            // Build order data (conditionally include metadata)
            const orderData: any = {
                id: orderId,
                orderNumber: `ORD-${2025000 + i}`,
                customer: {
                    id: custId,
                    name: customer.name,
                    email: customer.email,
                    phone: customer.phone
                },
                shippingAddress: shippingAddress,
                status,
                subtotal,
                shippingCost,
                tax,
                discount: 0,
                total,
                paymentStatus: ['cancelled', 'payment_failed'].includes(status) ? 'failed' : 'paid',
                paymentMethod: Math.random() < 0.7 ? 'card' : 'transfer',
                createdAt: ts,
                updatedAt: ts,
                items: [{
                    productId: prod.id,
                    productName: prod.name.en,
                    productImage: prod.images?.[0] || '/assets/placeholder.jpg',
                    sku: prod.sku || `SKU-${prod.id}`,
                    brand: prod.brand || 'Generic',
                    price: prod.price,
                    quantity: qty,
                    subtotal: prod.price * qty
                }],

                // Order History Timeline (realistic status progression)
                history: (() => {
                    const timeline: any[] = [];
                    const orderDate = date.getTime();

                    // Always start with order created
                    timeline.push({
                        status: 'pending',
                        timestamp: Timestamp.fromDate(new Date(orderDate)),
                        note: 'Order placed',
                        user: { name: 'System', role: 'SYSTEM' }
                    });

                    // Add progression based on final status
                    if (status === 'processing' || status === 'shipped' || status === 'delivered') {
                        timeline.push({
                            status: 'processing',
                            timestamp: Timestamp.fromDate(new Date(orderDate + 1000 * 60 * 30)), // 30 min later
                            note: 'Payment confirmed, order in processing',
                            user: { name: 'ops_user_1', role: 'OPERATIONS' }
                        });
                    }

                    if (status === 'shipped' || status === 'delivered') {
                        timeline.push({
                            status: 'shipped',
                            timestamp: Timestamp.fromDate(new Date(orderDate + 1000 * 60 * 60 * 24)), // 1 day later
                            note: 'Package shipped via Estafeta',
                            user: { name: 'ops_user_2', role: 'OPERATIONS' }
                        });
                    }

                    if (status === 'delivered') {
                        timeline.push({
                            status: 'delivered',
                            timestamp: Timestamp.fromDate(new Date(orderDate + 1000 * 60 * 60 * 24 * 3)), // 3 days later
                            note: 'Package delivered successfully',
                            user: { name: 'System', role: 'SYSTEM' }
                        });
                    }

                    if (status === 'cancelled') {
                        timeline.push({
                            status: 'cancelled',
                            timestamp: Timestamp.fromDate(new Date(orderDate + 1000 * 60 * 60 * 2)), // 2 hours later
                            note: 'Order cancelled by customer request',
                            user: { name: 'ops_user_1', role: 'OPERATIONS' }
                        });
                    }

                    return timeline;
                })(),
                carrier: status === 'shipped' || status === 'delivered' ? 'Estafeta' : null,
                trackingNumber: status === 'shipped' || status === 'delivered' ? `EST${Math.floor(Math.random() * 900000000) + 100000000}` : null,

                // Multi-Channel Fields
                channel: channel,
                externalOrderId: externalId,
                shippingLabelUrl: (status === 'shipped' && externalId) ? 'https://example.com/label.pdf' : null
            };

            // Only add metadata if it exists (avoid undefined)
            if (metadata) {
                orderData.metadata = metadata;
            }

            batch.set(ref, orderData);

            // Log progress every 25 orders
            if ((i + 1) % 25 === 0) {
                this.log(`[Seeder] Created ${i + 1}/${config.orderCount} orders...`, onLog);
            }

            // Stats
            if (!['cancelled', 'payment_failed'].includes(status)) {
                if (!customerStats[custId]) customerStats[custId] = { spend: 0, count: 0, lastDate: null };
                customerStats[custId].spend += total;
                customerStats[custId].count++;
                if (!customerStats[custId].lastDate || date > customerStats[custId].lastDate) {
                    customerStats[custId].lastDate = date;
                }
            }

            count++;
            if (count % batchSize === 0) {
                await batch.commit();
                batch = writeBatch(this.firestore);
            }
        }
        await batch.commit(); // Final batch

        // Update Customers
        this.log('[Seeder] Updating Customer Stats...', onLog);
        let statsBatch = writeBatch(this.firestore);
        let sCount = 0;
        for (const [uid, stats] of Object.entries(customerStats)) {
            const ref = doc(this.firestore, `customers/${uid}`);
            statsBatch.update(ref, {
                'stats.totalOrders': (stats as any).count,
                'stats.totalSpend': (stats as any).spend,
                'stats.lastOrderDate': Timestamp.fromDate((stats as any).lastDate)
            });
            sCount++;
            if (sCount % batchSize === 0) {
                await statsBatch.commit();
                statsBatch = writeBatch(this.firestore);
            }
        }
        await statsBatch.commit();

        // Log final summary with channel breakdown
        this.log('[Seeder] ========================================', onLog);
        this.log('[Seeder] Orders Seeded Successfully!', onLog);
        this.log('[Seeder] ========================================', onLog);
        this.log(`[Seeder] Total Orders Created: ${config.orderCount}`, onLog);
        this.log('[Seeder] Channel Distribution:', onLog);
        this.log('[Seeder]   - WEB: ~40%', onLog);
        this.log('[Seeder]   - POS: ~15%', onLog);
        this.log('[Seeder]   - ON_BEHALF: ~10%', onLog);
        this.log('[Seeder]   - AMAZON_MFN: ~10%', onLog);
        this.log('[Seeder]   - MELI_CLASSIC: ~10%', onLog);
        this.log('[Seeder]   - AMAZON_FBA: ~7%', onLog);
        this.log('[Seeder]   - MELI_FULL: ~8%', onLog);
        this.log('[Seeder] ========================================', onLog);
    }

    // --- 4. INVENTORY BALANCES ---
    async populateInventoryBalances(config: SeederConfig = DEFAULT_CONFIG, onLog?: (message: string) => void): Promise<void> {
        this.log('[Seeder] Creating inventory balances...', onLog);

        const productsSnapshot = await getDocs(collection(this.firestore, 'products'));
        const locationsSnapshot = await getDocs(collection(this.firestore, 'locations'));

        if (productsSnapshot.empty || locationsSnapshot.empty) {
            this.log('[Seeder] ERROR: No products or locations found!', onLog);
            return;
        }

        const products = productsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() as any }));
        const locations = locationsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() as any }));

        let batch = writeBatch(this.firestore);
        let count = 0;

        for (const product of products) {
            // Determine base stock level for this product
            const stockRoll = Math.random();
            let baseStock: number;

            if (stockRoll < 0.60) {
                baseStock = Math.floor(Math.random() * 51) + 50; // 50-100 (Good stock)
            } else if (stockRoll < 0.85) {
                baseStock = Math.floor(Math.random() * 21) + 10; // 10-30 (Low stock)
            } else if (stockRoll < 0.95) {
                baseStock = Math.floor(Math.random() * 9) + 1; // 1-9 (Very low)
            } else {
                baseStock = 0; // Out of stock
            }

            for (const location of locations) {
                const balanceId = `${product.id}_${location.id}`;
                const ref = doc(this.firestore, `inventory_balances/${balanceId}`);

                // Distribute stock across locations
                let available: number;
                if (location.id === 'loc_main') {
                    available = Math.floor(baseStock * 0.70); // 70% in MAIN
                } else if (location.id === 'loc_amazon_fba') {
                    available = Math.floor(baseStock * 0.20); // 20% in AMAZON_FBA
                } else if (location.id === 'loc_meli_full') {
                    available = Math.floor(baseStock * 0.10); // 10% in MELI_FULL
                } else {
                    available = baseStock;
                }

                const reorderPoint = Math.max(5, Math.floor(available * 0.25));
                const reorderQuantity = Math.max(20, Math.floor(available * 0.5));

                batch.set(ref, {
                    productId: product.id,
                    locationId: location.id,
                    available,
                    reserved: 0,
                    onHand: available,
                    reorderPoint,
                    reorderQuantity,
                    lastUpdated: Timestamp.now()
                });

                count++;
                if (count % 500 === 0) {
                    await batch.commit();
                    batch = writeBatch(this.firestore);
                }
            }
        }

        await batch.commit();
        this.log(`[Seeder] Created ${count} inventory balance records`, onLog);
        this.log('[Seeder] Stock Distribution: 60% good, 25% low, 10% very low, 5% out of stock', onLog);
    }

    // --- 5. INVENTORY LEDGER (KARDEX) ---
    async populateInventoryLedger(config: SeederConfig = DEFAULT_CONFIG, onLog?: (message: string) => void): Promise<void> {
        this.log('[Seeder] Creating inventory ledger entries (Kardex)...', onLog);

        const ordersSnapshot = await getDocs(collection(this.firestore, 'orders'));
        const productsSnapshot = await getDocs(collection(this.firestore, 'products'));

        if (ordersSnapshot.empty) {
            this.log('[Seeder] No orders found, skipping ledger creation', onLog);
            return;
        }

        const orders = ordersSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() as any }));
        const products = productsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() as any }));

        let batch = writeBatch(this.firestore);
        let count = 0;

        // Create INITIAL_LOAD transactions (opening stock)
        for (const product of products) {
            const ledgerId = `ledger_initial_${product.id}`;
            const ref = doc(this.firestore, `inventory_ledger/${ledgerId}`);

            const quantity = Math.floor(Math.random() * 151) + 50; // 50-200 units
            const unitCost = product.costPrice || product.price * 0.6 || 100;

            batch.set(ref, {
                id: ledgerId,
                productId: product.id,
                warehouseId: 'MAIN',
                type: 'INITIAL_LOAD',
                date: Timestamp.fromDate(new Date(2025, 10, 1)), // Nov 1, 2025
                quantityChange: quantity,
                balanceAfter: quantity,
                unitCost: unitCost,
                averageCostBefore: 0,
                averageCostAfter: unitCost,
                referenceId: `INIT-${product.sku}`,
                referenceType: 'PURCHASE_ORDER',
                userId: 'SYSTEM',
                notes: 'Initial stock load - Opening balance',
                createdAt: Timestamp.fromDate(new Date(2025, 10, 1))
            });

            count++;
            if (count % 500 === 0) {
                await batch.commit();
                batch = writeBatch(this.firestore);
            }
        }

        // Create PURCHASE transactions (restocking)
        const purchaseCount = Math.floor(products.length * 0.3); // 30% of products get purchases
        const productsForPurchase = products.sort(() => Math.random() - 0.5).slice(0, purchaseCount);

        for (const product of productsForPurchase) {
            const ledgerId = `ledger_purchase_${product.id}_${Date.now()}`;
            const ref = doc(this.firestore, `inventory_ledger/${ledgerId}`);

            const quantity = Math.floor(Math.random() * 51) + 10; // 10-60 units
            const unitCost = product.costPrice || product.price * 0.6 || 100;
            const currentBalance = product.stockQuantity || 100;

            batch.set(ref, {
                id: ledgerId,
                productId: product.id,
                warehouseId: 'MAIN',
                type: 'PURCHASE',
                date: Timestamp.fromDate(new Date(2025, 11, 15)), // Dec 15, 2025
                quantityChange: quantity,
                balanceAfter: currentBalance + quantity,
                unitCost: unitCost,
                averageCostBefore: unitCost,
                averageCostAfter: unitCost,
                referenceId: `PO-${Math.floor(Math.random() * 9000) + 1000}`,
                referenceType: 'PURCHASE_ORDER',
                userId: 'ops_user_1',
                notes: 'Supplier restock - Regular purchase order',
                createdAt: Timestamp.fromDate(new Date(2025, 11, 15))
            });

            count++;
            if (count % 500 === 0) {
                await batch.commit();
                batch = writeBatch(this.firestore);
            }
        }

        // Create SALE transactions for fulfilled orders
        for (const order of orders) {
            if (order.status === 'processing' || order.status === 'shipped' || order.status === 'delivered') {
                for (const item of order.items) {
                    const ledgerId = `ledger_sale_${order.id}_${item.productId}`;
                    const ref = doc(this.firestore, `inventory_ledger/${ledgerId}`);

                    const product = products.find(p => p.id === item.productId);
                    const unitCost = product?.costPrice || product?.price * 0.6 || 100;
                    const currentBalance = product?.stockQuantity || 100;

                    batch.set(ref, {
                        id: ledgerId,
                        productId: item.productId,
                        warehouseId: 'MAIN',
                        type: 'SALE',
                        date: order.createdAt,
                        quantityChange: -item.quantity, // Negative for outbound
                        balanceAfter: currentBalance - item.quantity,
                        unitCost: unitCost,
                        averageCostBefore: unitCost,
                        averageCostAfter: unitCost,
                        referenceId: order.id,
                        referenceType: 'ORDER',
                        userId: 'ops_user_2',
                        notes: `Order fulfilled: ${order.orderNumber}`,
                        createdAt: order.createdAt
                    });

                    count++;
                    if (count % 500 === 0) {
                        await batch.commit();
                        batch = writeBatch(this.firestore);
                    }
                }
            }
        }

        await batch.commit();
        this.log(`[Seeder] Created ${count} inventory ledger entries (Kardex)`, onLog);
        this.log('[Seeder] Ledger includes: INITIAL_LOAD, PURCHASE, SALE transactions', onLog);
    }

    // --- 6. INVENTORY ENHANCEMENTS ---
    async populateInventoryEnhancements(config: SeederConfig = DEFAULT_CONFIG, onLog?: (message: string) => void): Promise<void> {
        this.log('[Seeder] Adding inventory enhancements...', onLog);

        await this.addInventoryAdjustments(config, onLog);
        await this.addInventoryTransfers(config, onLog);
    }

    private async addInventoryAdjustments(config: SeederConfig, onLog?: (message: string) => void): Promise<void> {
        this.log('[Seeder] Creating inventory adjustments...', onLog);

        const productsSnapshot = await getDocs(collection(this.firestore, 'products'));
        const products = productsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() as any }));

        let batch = writeBatch(this.firestore);
        let count = 0;

        // 10% of products get adjustments
        const adjustmentCount = Math.floor(products.length * 0.10);
        const selectedProducts = products.sort(() => Math.random() - 0.5).slice(0, adjustmentCount);

        for (const product of selectedProducts) {
            const ledgerId = `ledger_adj_${product.id}_${Date.now()}`;
            const ref = doc(this.firestore, `inventory_ledger/${ledgerId}`);

            // Random adjustment quantity (±5 to ±10)
            const isPositive = Math.random() > 0.5;
            const quantity = (Math.floor(Math.random() * 6) + 5) * (isPositive ? 1 : -1);

            // Adjustment reason
            const reasonRoll = Math.random();
            let reason: string;
            if (reasonRoll < 0.70) {
                reason = 'Physical count adjustment';
            } else if (reasonRoll < 0.90) {
                reason = 'Damaged inventory write-off';
            } else if (reasonRoll < 0.95) {
                reason = 'Theft/loss adjustment';
            } else {
                reason = 'Found inventory - count correction';
            }

            // Random date in Dec 2025 - Jan 2026
            const startDate = new Date(2025, 11, 1).getTime();
            const endDate = new Date().getTime();
            const randomDate = new Date(startDate + Math.random() * (endDate - startDate));

            batch.set(ref, {
                id: ledgerId,
                productId: product.id,
                locationId: 'loc_main',
                type: 'ADJUSTMENT',
                quantity: quantity,
                reason: reason,
                referenceType: 'ADJUSTMENT',
                referenceId: `ADJ-${Math.floor(Math.random() * 9000) + 1000}`,
                timestamp: Timestamp.fromDate(randomDate),
                user: { name: 'ops_user_1', role: 'OPERATIONS' }
            });

            count++;
            if (count % 500 === 0) {
                await batch.commit();
                batch = writeBatch(this.firestore);
            }
        }

        await batch.commit();
        this.log(`[Seeder] Created ${count} adjustment transactions`, onLog);
    }

    private async addInventoryTransfers(config: SeederConfig, onLog?: (message: string) => void): Promise<void> {
        this.log('[Seeder] Creating inventory transfers...', onLog);

        const productsSnapshot = await getDocs(collection(this.firestore, 'products'));
        const products = productsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() as any }));

        let batch = writeBatch(this.firestore);
        let count = 0;

        // Create 12-15 transfers
        const transferCount = Math.floor(Math.random() * 4) + 12;

        for (let i = 0; i < transferCount; i++) {
            const product = products[Math.floor(Math.random() * products.length)];
            const transferId = `TRANS-${Date.now()}-${i}`;
            const quantity = Math.floor(Math.random() * 41) + 10; // 10-50 units

            // 70% MAIN → AMAZON_FBA, 30% MAIN → MELI_FULL
            const toLocation = Math.random() < 0.70 ? 'loc_amazon_fba' : 'loc_meli_full';
            const toLocationName = toLocation === 'loc_amazon_fba' ? 'AMAZON_FBA' : 'MELI_FULL';

            // Random date in Dec 2025 - Jan 2026
            const startDate = new Date(2025, 11, 1).getTime();
            const endDate = new Date().getTime();
            const randomDate = new Date(startDate + Math.random() * (endDate - startDate));

            // OUT from MAIN
            const outRef = doc(this.firestore, `inventory_ledger/ledger_trans_out_${transferId}`);
            batch.set(outRef, {
                id: `ledger_trans_out_${transferId}`,
                productId: product.id,
                locationId: 'loc_main',
                type: 'TRANSFER',
                quantity: -quantity,
                reason: `Transfer to ${toLocationName}`,
                referenceType: 'TRANSFER',
                referenceId: transferId,
                timestamp: Timestamp.fromDate(randomDate),
                user: { name: 'ops_user_2', role: 'OPERATIONS' }
            });

            // IN to destination
            const inRef = doc(this.firestore, `inventory_ledger/ledger_trans_in_${transferId}`);
            batch.set(inRef, {
                id: `ledger_trans_in_${transferId}`,
                productId: product.id,
                locationId: toLocation,
                type: 'TRANSFER',
                quantity: quantity,
                reason: `Transfer from MAIN`,
                referenceType: 'TRANSFER',
                referenceId: transferId,
                timestamp: Timestamp.fromDate(randomDate),
                user: { name: 'ops_user_2', role: 'OPERATIONS' }
            });

            count += 2; // Two entries per transfer
            if (count % 500 === 0) {
                await batch.commit();
                batch = writeBatch(this.firestore);
            }
        }

        await batch.commit();
        this.log(`[Seeder] Created ${count / 2} transfers (${count} ledger entries)`, onLog);
    }

    // --- 7. ORDER ENHANCEMENTS ---
    async enhanceOrders(config: SeederConfig = DEFAULT_CONFIG, onLog?: (message: string) => void): Promise<void> {
        this.log('[Seeder] Enhancing orders with returns, notes, tags...', onLog);

        const ordersSnapshot = await getDocs(collection(this.firestore, 'orders'));
        if (ordersSnapshot.empty) {
            this.log('[Seeder] No orders found to enhance', onLog);
            return;
        }

        let batch = writeBatch(this.firestore);
        let count = 0;
        let returnsCount = 0;
        let refundsCount = 0;
        let notesCount = 0;
        let tagsCount = 0;
        let partialShipmentsCount = 0;

        for (const orderDoc of ordersSnapshot.docs) {
            const order = orderDoc.data() as any;
            const updates: any = {};

            // 3-5% of delivered orders become returns
            if (order.status === 'delivered' && Math.random() < 0.04) {
                const returnReasons = ['DEFECTIVE', 'WRONG_ITEM', 'NOT_AS_DESCRIBED', 'CHANGED_MIND'];
                const reasonRoll = Math.random();
                let returnReason: string;

                if (reasonRoll < 0.40) returnReason = 'DEFECTIVE';
                else if (reasonRoll < 0.70) returnReason = 'WRONG_ITEM';
                else if (reasonRoll < 0.90) returnReason = 'NOT_AS_DESCRIBED';
                else returnReason = 'CHANGED_MIND';

                const restockFee = returnReason === 'CHANGED_MIND' ? order.total * 0.10 : 0;
                const refundAmount = order.total - restockFee;

                updates.status = 'returned';
                updates.returnReason = returnReason;
                updates.returnDate = Timestamp.fromDate(new Date(order.createdAt.toDate().getTime() + 1000 * 60 * 60 * 24 * 5)); // 5 days after order
                updates.refundAmount = refundAmount;
                updates.refundStatus = 'PROCESSED';
                updates.restockFee = restockFee;

                // Add return event to history
                if (!updates.history) updates.history = order.history || [];
                updates.history.push({
                    status: 'returned',
                    timestamp: updates.returnDate,
                    note: `Return requested: ${returnReason.replace('_', ' ').toLowerCase()}`,
                    user: { name: 'ops_user_1', role: 'OPERATIONS' }
                });

                returnsCount++;
            }

            // 2-3% of cancelled orders get refunded
            if (order.status === 'cancelled' && Math.random() < 0.025) {
                const refundReasons = ['PAYMENT_FAILED', 'OUT_OF_STOCK', 'CUSTOMER_REQUEST'];
                const refundReason = refundReasons[Math.floor(Math.random() * refundReasons.length)];

                updates.refundReason = refundReason;
                updates.refundDate = Timestamp.fromDate(new Date(order.createdAt.toDate().getTime() + 1000 * 60 * 60 * 2)); // 2 hours after
                updates.refundAmount = order.total;
                updates.refundStatus = 'PROCESSED';

                refundsCount++;
            }

            // 30% get tags
            if (Math.random() < 0.30) {
                const tags: string[] = [];
                if (Math.random() < 0.10) tags.push('URGENT');
                if (Math.random() < 0.05) tags.push('WHOLESALE');
                if (Math.random() < 0.08) tags.push('VIP');
                if (Math.random() < 0.05) tags.push('GIFT');
                if (Math.random() < 0.02) tags.push('INTERNATIONAL');

                if (tags.length > 0) {
                    updates.tags = tags;
                    tagsCount++;
                }
            }

            // 5% of multi-item orders get partial shipments
            if (order.items && order.items.length >= 3 && Math.random() < 0.05 && order.status === 'shipped') {
                const shipments = [];
                const midpoint = Math.ceil(order.items.length / 2);

                // First shipment
                shipments.push({
                    shipmentId: `SHIP-1-${orderDoc.id}`,
                    items: order.items.slice(0, midpoint),
                    carrier: 'Estafeta',
                    trackingNumber: `EST${Math.floor(Math.random() * 900000000) + 100000000}`,
                    shippedDate: Timestamp.fromDate(new Date(order.createdAt.toDate().getTime() + 1000 * 60 * 60 * 24)), // 1 day
                    deliveredDate: Timestamp.fromDate(new Date(order.createdAt.toDate().getTime() + 1000 * 60 * 60 * 24 * 3)) // 3 days
                });

                // Second shipment
                shipments.push({
                    shipmentId: `SHIP-2-${orderDoc.id}`,
                    items: order.items.slice(midpoint),
                    carrier: 'Estafeta',
                    trackingNumber: `EST${Math.floor(Math.random() * 900000000) + 100000000}`,
                    shippedDate: Timestamp.fromDate(new Date(order.createdAt.toDate().getTime() + 1000 * 60 * 60 * 24 * 2)), // 2 days
                    deliveredDate: Timestamp.fromDate(new Date(order.createdAt.toDate().getTime() + 1000 * 60 * 60 * 24 * 4)) // 4 days
                });

                updates.shipments = shipments;
                partialShipmentsCount++;
            }

            // Apply updates if any
            if (Object.keys(updates).length > 0) {
                const ref = doc(this.firestore, `orders/${orderDoc.id}`);
                batch.update(ref, updates);
                count++;

                if (count % 500 === 0) {
                    await batch.commit();
                    batch = writeBatch(this.firestore);
                }
            }
        }

        // Add order notes for 20% of orders
        const orderDocs = ordersSnapshot.docs;
        const notesOrderCount = Math.floor(orderDocs.length * 0.20);
        const selectedOrders = orderDocs.sort(() => Math.random() - 0.5).slice(0, notesOrderCount);

        for (const orderDoc of selectedOrders) {
            const noteId = `note_${orderDoc.id}_${Date.now()}`;
            const ref = doc(this.firestore, `orderNotes/${noteId}`);

            const isCustomer = Math.random() < 0.5;
            const customerNotes = [
                'Please deliver after 5pm',
                'Ring doorbell twice',
                'Leave package with neighbor if not home',
                'Call before delivery',
                'Fragile - handle with care'
            ];
            const internalNotes = [
                'VIP customer - priority handling',
                'Fragile items - extra packaging',
                'Customer requested gift wrap',
                'Rush order - expedite shipping',
                'Wholesale customer - invoice separately'
            ];

            const message = isCustomer
                ? customerNotes[Math.floor(Math.random() * customerNotes.length)]
                : internalNotes[Math.floor(Math.random() * internalNotes.length)];

            batch.set(ref, {
                orderId: orderDoc.id,
                noteId,
                type: isCustomer ? 'CUSTOMER' : 'INTERNAL',
                message,
                createdAt: Timestamp.now(),
                createdBy: { name: isCustomer ? 'Customer' : 'ops_user_1', role: isCustomer ? 'CUSTOMER' : 'OPERATIONS' }
            });

            notesCount++;
            count++;

            if (count % 500 === 0) {
                await batch.commit();
                batch = writeBatch(this.firestore);
            }
        }

        await batch.commit();
        this.log(`[Seeder] Enhanced ${count} orders:`, onLog);
        this.log(`  - ${returnsCount} returns`, onLog);
        this.log(`  - ${refundsCount} refunds`, onLog);
        this.log(`  - ${tagsCount} tagged orders`, onLog);
        this.log(`  - ${partialShipmentsCount} partial shipments`, onLog);
        this.log(`  - ${notesCount} order notes`, onLog);
    }

    async populateExpenses(config: SeederConfig = DEFAULT_CONFIG): Promise<void> {
        // ... (Keep simpler for now)
    }

    // Stub methods for other collections to prevent errors if UI calls them directly
    async populateCoupons() {
        const batch = writeBatch(this.firestore);
        const couponsRef = collection(this.firestore, 'coupons');
        let count = 0;

        const coupons: Coupon[] = [
            {
                code: 'WELCOME10',
                type: 'percentage',
                value: 10,
                description: '10% off your first order',
                startDate: Timestamp.now(),
                usageLimit: 0, // Unlimited
                usageCount: 45,
                isActive: true,
                createdAt: Timestamp.now(),
                updatedAt: Timestamp.now()
            },
            {
                code: 'SUMMER2024',
                type: 'percentage',
                value: 15,
                description: 'Summer Sale - 15% off all tyres',
                startDate: Timestamp.now(),
                endDate: Timestamp.fromDate(new Date(Date.now() + 1000 * 60 * 60 * 24 * 30)), // 30 days
                usageLimit: 100,
                usageCount: 12,
                isActive: true,
                createdAt: Timestamp.now(),
                updatedAt: Timestamp.now()
            },
            {
                code: 'VIP25',
                type: 'percentage',
                value: 25,
                description: 'Exclusve VIP 25% discount',
                startDate: Timestamp.now(),
                usageLimit: 50,
                usageCount: 48, // Almost used up
                isActive: true,
                createdAt: Timestamp.now(),
                updatedAt: Timestamp.now()
            },
            {
                code: 'FREESHIP',
                type: 'fixed_amount',
                value: 250, // 250 MXN off (shipping cost)
                description: 'Free Shipping on orders over $2000',
                minPurchaseAmount: 2000,
                startDate: Timestamp.now(),
                usageLimit: 0,
                usageCount: 156,
                isActive: true,
                createdAt: Timestamp.now(),
                updatedAt: Timestamp.now()
            },
            {
                code: 'MOTO500',
                type: 'fixed_amount',
                value: 500,
                description: '$500 off on Michelin sets',
                minPurchaseAmount: 4000,
                startDate: Timestamp.now(),
                usageLimit: 20,
                usageCount: 5,
                isActive: true,
                createdAt: Timestamp.now(),
                updatedAt: Timestamp.now()
            }
        ];

        for (const coupon of coupons) {
            const ref = doc(couponsRef);
            batch.set(ref, { ...coupon, id: ref.id });
            count++;
        }

        await batch.commit();
        this.log(`[Seeder] Created ${count} coupons`);
    }
    async populateProductCosts() { }
    async populateOperationsData() { }
    async populateApprovalRequests() { }
    async populateNotifications() { }

    // --- AGGREGATE SEED ---
    async seedAll(config: SeederConfig = DEFAULT_CONFIG, onLog?: (message: string) => void): Promise<void> {
        this.log('[Seeder] Starting seedAll sequence...', onLog);

        try {
            this.log('[Seeder] Step 1: Locations', onLog);
            await this.populateLocations(onLog);

            this.log('[Seeder] Step 2: Catalog', onLog);
            await this.populateCatalog(config, onLog);

            this.log('[Seeder] Step 3: Customers', onLog);
            await this.populateCustomers(config, onLog);

            this.log('[Seeder] Step 4: Orders', onLog);
            await this.populateOrders(config, onLog);

            // Inventory seeding
            this.log('[Seeder] Step 5: Inventory Balances', onLog);
            await this.populateInventoryBalances(config, onLog);

            this.log('[Seeder] Step 6: Inventory Ledger', onLog);
            await this.populateInventoryLedger(config, onLog);

            // Inventory and Order enhancements
            this.log('[Seeder] Step 7: Inventory Enhancements', onLog);
            await this.populateInventoryEnhancements(config, onLog);

            this.log('[Seeder] Step 8: Order Enhancements', onLog);
            await this.enhanceOrders(config, onLog);

            // Save seed metadata
            this.log('[Seeder] Step 9: Saving Metadata', onLog);
            await this.saveSeedMetadata(config, onLog);

            this.log('[Seeder] seedAll Complete!', onLog);
        } catch (error) {
            this.log('[Seeder] CRITICAL FAILURE IN SEED SEQUENCE: ' + error, onLog);
            throw error; // Re-throw to be caught by Component
        }
    }

    // Save seed metadata to Firestore for tracking
    private async saveSeedMetadata(config: SeederConfig, onLog?: (message: string) => void): Promise<void> {
        const metadataRef = doc(this.firestore, '_metadata/seed_info');
        const batch = writeBatch(this.firestore);
        batch.set(metadataRef, {
            version: this.SEED_VERSION,
            timestamp: Timestamp.now(),
            scenario: config.scenario,
            orderCount: config.orderCount,
            customerCount: config.customerCount,
            dateRange: {
                start: Timestamp.fromDate(config.startDate),
                end: Timestamp.fromDate(config.endDate)
            }
        });
        await batch.commit();
        this.log(`[Seeder] Metadata saved: ${this.SEED_VERSION}`, onLog);
    }
}
