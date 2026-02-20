import { Injectable, inject } from '@angular/core';
import { Firestore, collection, writeBatch, doc, Timestamp, getDocs, limit, query } from '@angular/fire/firestore';
import { Coupon } from '../models/coupon.model';
import { GridLayoutService } from './grid-layout.service';

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
    endDate: new Date(2026, 0, 14),   // Jan 14, 2026 (Fixed End Date)
    chaosMode: false,
    scenario: 'CUSTOM'
};

@Injectable({
    providedIn: 'root'
})
export class DataSeederService {
    private firestore = inject(Firestore);
    private gridLayout = inject(GridLayoutService);

    // Version identifier for tracking seed data schema
    private readonly SEED_VERSION = 'v5.0.2-memory-patch';

    constructor() { }

    // --- LOGGING HELPER ---
    private log(message: string, onLog?: (message: string) => void): void {
        const timestamp = new Date().toLocaleTimeString('en-US', { hour12: false });
        console.log(`[${timestamp}] ${message}`);
        if (onLog) {
            onLog(message);
        }
    }

    // --- NEW: SEED HISTORY FOR EXISTING PRODUCTS ---
    /**
     * Generates "Sell Down" history for existing products.
     * Strategy:
     * 1. Read Current Stock (Target).
     * 2. Determine random Sales Volume (e.g., 20-50 units).
     * 3. Set Initial Stock = Current + Sales Volume.
     * 4. Generate Initial Load Entry (90 days ago).
     * 5. Generate Sales Orders/Entries distributed over 90 days.
     * Result: Charts light up, ABC gets revenue data, but Current Stock remains correct.
     */
    async seedPraxisHistory(onLog?: (message: string) => void): Promise<void> {
        this.log('========================================', onLog);
        this.log(`[Seeder] Backfilling History (v3.0.0)`, onLog);
        this.log('Strat: Sell Down (Preserve Current Stock)', onLog);
        this.log('========================================', onLog);

        const productsSnap = await getDocs(collection(this.firestore, 'products'));
        const products = productsSnap.docs.map(d => ({ id: d.id, ...d.data() } as any));
        this.log(`Found ${products.length} products.`, onLog);

        const batchLimit = 400; // Operations per batch
        let batch = writeBatch(this.firestore);
        let opsCount = 0;

        for (const p of products) {
            const currentStock = p.stockQuantity || 0;
            // Generate random sales volume (10% to 50% of Stock, or flat 10-50 if low stock)
            const salesVol = Math.floor(Math.random() * 30) + 5;
            const initialStock = currentStock + salesVol;

            // 1. Initial Load (90 days ago)
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - 90);

            // Ledger Entry: Initial
            const initialRef = doc(collection(this.firestore, 'inventory_ledger'));
            batch.set(initialRef, {
                productId: p.id,
                date: Timestamp.fromDate(startDate),
                type: 'INITIAL_LOAD',
                quantityChange: initialStock,
                balanceAfter: initialStock,
                referenceId: 'INIT-BACKFILL',
                referenceType: 'ADJUSTMENT',
                unitCost: p.costPrice || 0,
                notes: 'System Backfill Initialization',
                warehouseId: 'MAIN',
                userId: 'SYSTEM'
            });
            opsCount++;

            // 2. Generate Sales
            let runningBalance = initialStock;

            for (let i = 0; i < salesVol; i++) {
                // Random date between start and now
                const saleDate = new Date(startDate.getTime() + Math.random() * (Date.now() - startDate.getTime()));

                runningBalance--; // Sell 1

                // Ledger Entry: Sale
                const ledgerRef = doc(collection(this.firestore, 'inventory_ledger'));
                batch.set(ledgerRef, {
                    productId: p.id,
                    date: Timestamp.fromDate(saleDate),
                    type: 'SALE',
                    quantityChange: -1,
                    balanceAfter: runningBalance,
                    referenceId: `ORD-${Date.now()}-${i}`,
                    referenceType: 'ORDER',
                    unitCost: p.price || 0, // Using Price for 'Value' context
                    notes: 'Simulated Praxis Sale',
                    warehouseId: 'MAIN',
                    userId: 'SYSTEM'
                });
                opsCount++;

                if (opsCount >= batchLimit) {
                    await batch.commit();
                    batch = writeBatch(this.firestore);
                    opsCount = 0;
                }
            }
        }

        if (opsCount > 0) {
            await batch.commit();
        }

        this.log('[Seeder] History Backfill Complete.', onLog);
    }

    // --- SEED PRODUCTS ---
    async seedProducts(onLog?: (message: string) => void): Promise<void> {
        // Wrapper for populateCatalog to reuse consistent Praxis logic
        await this.populateCatalog(DEFAULT_CONFIG, onLog);
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
        await this.deleteCollection('staff_profiles'); // Clear staff profiles
        this.log('[Seeder] Database Cleared.', onLog);
    }

    // --- SEED STAFF PROFILES ---
    async seedStaffProfiles(onLog?: (message: string) => void): Promise<void> {
        this.log('[Seeder] Seeding Operations Staff...', onLog);
        const batch = writeBatch(this.firestore);

        // 1. Create Base Users (if they don't exist, we usually assume Auth service handles this, 
        // but here we create profiles linked to hypothetical or known UIDs)

        // Define Staff Roster
        const roster = [
            {
                uid: 'ops_user_1', displayName: 'Carlos Ruiz', email: 'carlos.ruiz@example.com', role: 'OPERATIONS',
                profile: {
                    department: 'WAREHOUSE', jobTitle: 'Senior Picker', employeeId: 'EMP-101',
                    assignedWarehouseId: 'MAIN', status: 'ONLINE', skills: ['PICKING', 'FORKLIFT']
                }
            },
            {
                uid: 'ops_user_2', displayName: 'Ana Torres', email: 'ana.torres@example.com', role: 'OPERATIONS',
                profile: {
                    department: 'WAREHOUSE', jobTitle: 'Packer', employeeId: 'EMP-102',
                    assignedWarehouseId: 'MAIN', status: 'BUSY', skills: ['PACKING']
                }
            },
            {
                uid: 'manager_1', displayName: 'Roberto Gomez', email: 'roberto.g@example.com', role: 'MANAGER',
                profile: {
                    department: 'ADMIN', jobTitle: 'Warehouse Manager', employeeId: 'MGR-01',
                    assignedWarehouseId: 'MAIN', status: 'ONLINE', allowedWarehouseIds: ['MAIN', 'AMAZON_FBA']
                }
            },
            {
                uid: 'support_1', displayName: 'Elena Volkov', email: 'elena.v@example.com', role: 'OPERATIONS',
                profile: {
                    department: 'SUPPORT', jobTitle: 'Support Specialist', employeeId: 'SUP-01',
                    assignedWarehouseId: null, status: 'ONLINE', skills: ['RETURNS', 'ZENDESK']
                }
            }
        ];

        // Seed Users Collection + Staff Profiles
        for (const staff of roster) {
            // User Doc
            const userRef = doc(this.firestore, `users/${staff.uid}`);
            batch.set(userRef, {
                uid: staff.uid,
                displayName: staff.displayName,
                email: staff.email,
                role: staff.role,
                isActive: true,
                createdAt: Timestamp.now(),
                photoURL: `https://ui-avatars.com/api/?name=${staff.displayName}&background=random`
            });

            // Profile Doc
            const profileRef = doc(this.firestore, `staff_profiles/${staff.uid}`);
            batch.set(profileRef, {
                uid: staff.uid,
                email: staff.email,
                displayName: staff.displayName,
                ...staff.profile,
                created_at: Timestamp.now(),
                updated_at: Timestamp.now()
            });
        }

        await batch.commit();
        this.log(`[Seeder] Created ${roster.length} staff profiles (Ops & Support).`, onLog);
    }

    // --- WAREHOUSE DATA CLEANUP ---
    private async clearWarehouseData(onLog?: (message: string) => void): Promise<void> {
        this.log('[Seeder] Clearing warehouse data...', onLog);

        const collections = [
            'warehouses',
            'warehouse_zones',
            'warehouse_structures',
            'warehouse_locations',
            'warehouse_doors',
            'warehouse_obstacles',
            'warehouse_scale_markers'
        ];

        let totalDeleted = 0;
        for (const collectionName of collections) {
            const deleted = await this.deleteCollection(collectionName);
            if (deleted > 0) {
                this.log(`[Seeder] Deleted ${deleted} documents from ${collectionName}`, onLog);
                totalDeleted += deleted;
            }
        }

        this.log(`[Seeder] Warehouse data cleared. Total: ${totalDeleted} documents deleted.`, onLog);
    }

    // --- 0. PRICING RULES (NEW) ---
    async populatePricingRules(onLog?: (message: string) => void): Promise<void> {
        this.log('[Seeder] Seeding Pricing Rules (Mexico 2025)...', onLog);
        const batch = writeBatch(this.firestore);

        const rules: any[] = [
            // MELI CLASSIC
            {
                id: 'meli_classic_mx',
                channel: 'MELI_CLASSIC',
                country: 'MX',
                referralFeePercent: 17.5, // Avg category
                fulfillmentType: 'SELF',
                paymentProcessingPercent: 0, // Included in referral
                active: true,
                minReferralFee: 0,
                source: 'MercadoLibre 2025 Standard',
                createdAt: Timestamp.now(),
                updatedAt: Timestamp.now()
            },
            // MELI PREMIUM (Installments)
            {
                id: 'meli_premium_mx',
                channel: 'MELI_PREMIUM',
                country: 'MX',
                referralFeePercent: 22.5, // Avg category (+5%)
                fulfillmentType: 'SELF',
                paymentProcessingPercent: 0,
                active: true,
                minReferralFee: 0,
                source: 'MercadoLibre 2025 Premium',
                createdAt: Timestamp.now(),
                updatedAt: Timestamp.now()
            },
            // MELI FULL (FBA equiv)
            {
                id: 'meli_full_mx',
                channel: 'MELI_FULL',
                country: 'MX',
                referralFeePercent: 17.5,
                fulfillmentType: 'FULL',
                paymentProcessingPercent: 0,
                active: true,
                // Simplified Fulfillment Tiers (approx)
                fulfillmentTiers: [
                    {
                        sizeCategory: 'standard',
                        weightTiers: [
                            { maxWeight: 0.5, baseFee: 65, perKgOver: 0 },
                            { maxWeight: 1, baseFee: 75, perKgOver: 0 },
                            { maxWeight: 2, baseFee: 85, perKgOver: 0 },
                            { maxWeight: 5, baseFee: 110, perKgOver: 15 }, // +15 per kg over 2 (simplified)
                            { maxWeight: 10, baseFee: 160, perKgOver: 12 },
                            { maxWeight: 20, baseFee: 250, perKgOver: 10 }
                        ]
                    }
                ],
                monthlyStoragePerCubicMeter: 350, // Approx
                createdAt: Timestamp.now(),
                updatedAt: Timestamp.now()
            },
            // AMAZON FBA
            {
                id: 'amazon_fba_mx',
                channel: 'AMAZON_FBA',
                country: 'MX',
                referralFeePercent: 15.0, // Standard
                fulfillmentType: 'FBA',
                paymentProcessingPercent: 0, // Amazon pays this
                active: true,
                fulfillmentTiers: [
                    {
                        sizeCategory: 'standard',
                        weightTiers: [
                            { maxWeight: 0.25, baseFee: 62, perKgOver: 0 },
                            { maxWeight: 0.5, baseFee: 66, perKgOver: 0 },
                            { maxWeight: 1.0, baseFee: 74, perKgOver: 0 },
                            { maxWeight: 2.0, baseFee: 91, perKgOver: 0 },
                            { maxWeight: 3.0, baseFee: 112, perKgOver: 0 }
                        ]
                    },
                    {
                        sizeCategory: 'large',
                        weightTiers: [
                            { maxWeight: 5.0, baseFee: 145, perKgOver: 9 }, // Base for 5kg + 9 per extra kg? Simplified logic
                            { maxWeight: 10.0, baseFee: 190, perKgOver: 9 },
                            { maxWeight: 20.0, baseFee: 280, perKgOver: 9 },
                            { maxWeight: 30.0, baseFee: 370, perKgOver: 9 }
                        ]
                    }
                ],
                monthlyStoragePerCubicMeter: 450, // High season avg
                closingFee: 0,
                createdAt: Timestamp.now(),
                updatedAt: Timestamp.now()
            },
            // AMAZON FBM (Merchant Fulfilled)
            {
                id: 'amazon_fbm_mx',
                channel: 'AMAZON_FBM',
                country: 'MX',
                referralFeePercent: 15.0,
                fulfillmentType: 'FBM',
                paymentProcessingPercent: 0,
                active: true,
                createdAt: Timestamp.now(),
                updatedAt: Timestamp.now()
            },
            // POS (Terminal)
            {
                id: 'pos_clip_mx',
                channel: 'POS',
                country: 'MX',
                referralFeePercent: 0,
                fulfillmentType: 'SELF',
                paymentProcessingPercent: 3.5, // 3.5%
                paymentProcessingFixed: 0,
                active: true,
                source: 'Clip/Zettle Standard',
                createdAt: Timestamp.now(),
                updatedAt: Timestamp.now()
            },
            // WEB (Stripe/MP)
            {
                id: 'web_stripe_mx',
                channel: 'WEB',
                country: 'MX',
                referralFeePercent: 0,
                fulfillmentType: 'SELF',
                paymentProcessingPercent: 3.6,
                paymentProcessingFixed: 4.00, // $4 MXN
                active: true,
                source: 'Stripe Mexico',
                createdAt: Timestamp.now(),
                updatedAt: Timestamp.now()
            }
        ];

        rules.forEach(r => {
            const ref = doc(this.firestore, `channel_commission_rules/${r.id}`);
            batch.set(ref, r);
        });

        await batch.commit();
        this.log('[Seeder] Pricing Rules Seeded.', onLog);
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
                phone: data['phone'] || '+52 444 123 4567',
                acquisitionChannel: data['acquisitionChannel'] || 'DIRECT'
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
            let channel: 'WEB' | 'POS' | 'ON_BEHALF' | 'AMAZON_MFN' | 'MELI_CLASSIC' | 'AMAZON_FBA' | 'MELI_FULL';
            let externalId: string | null = null;
            let metadata: { enteredBy?: string; enteredAt?: Date; source?: string } | undefined = undefined;

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
                    phone: customer.phone,
                    acquisitionChannel: customer.acquisitionChannel
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

    // --- 4. EXPENSES (Operational Costs for P&L) ---
    async populateExpenses(config: SeederConfig = DEFAULT_CONFIG, onLog?: (message: string) => void): Promise<void> {
        this.log('[Seeder] Seeding Operational Expenses...', onLog);
        const batch = writeBatch(this.firestore);

        // Expense Categories and approximate monthly costs (MXN)
        const expenseTypes = [
            { category: 'RENT', description: 'Monthly Warehouse Rent', amount: 45000, dayOfMonth: 5, fixed: true },
            { category: 'PAYROLL', description: 'Staff Salaries (Operations)', amount: 120000, dayOfMonth: 15, fixed: true },
            { category: 'PAYROLL', description: 'Staff Salaries (Admin)', amount: 85000, dayOfMonth: 15, fixed: true },
            { category: 'UTILITIES', description: 'CFE Electricity Bill', amount: 8500, dayOfMonth: 10, fixed: false }, // Variable
            { category: 'INTERNET', description: 'Fiber Optic Internet', amount: 1200, dayOfMonth: 2, fixed: true },
            { category: 'MARKETING', description: 'Google Ads Campaign', amount: 15000, dayOfMonth: 28, fixed: false },
            { category: 'MARKETING', description: 'Facebook/Instagram Ads', amount: 8000, dayOfMonth: 28, fixed: false },
            { category: 'SOFTWARE', description: 'ERP & Cloud Subscriptions', amount: 4500, dayOfMonth: 1, fixed: true },
            { category: 'PACKAGING', description: 'Boxing & Tape Supplies', amount: 12000, dayOfMonth: 20, fixed: false }
        ];

        // Generate expenses for Dec 2025 and Jan 2026
        const months = [
            { year: 2025, month: 11 }, // Dec
            { year: 2026, month: 0 }   // Jan
        ];

        let count = 0;

        months.forEach(m => {
            expenseTypes.forEach(exp => {
                // Skip future dates if we are in Jan and day is passed
                if (m.year === 2026 && m.month === 0 && exp.dayOfMonth > 14) return;

                const id = `exp_${m.year}_${m.month}_${exp.category}_${Math.floor(Math.random() * 1000)}`;
                const ref = doc(this.firestore, `expenses/${id}`);

                // Add some variance to variable costs
                const finalAmount = exp.fixed ? exp.amount : Math.round(exp.amount * (0.9 + Math.random() * 0.2));

                const date = new Date(m.year, m.month, exp.dayOfMonth, 10, 0, 0);

                batch.set(ref, {
                    id: id,
                    category: exp.category,
                    description: `${exp.description} - ${date.toLocaleString('default', { month: 'short' })} ${m.year}`,
                    amount: finalAmount,
                    date: Timestamp.fromDate(date),
                    status: 'PAID',
                    paymentMethod: 'TRANSFER',
                    reference: `REF-${Math.floor(Math.random() * 90000) + 10000}`,
                    createdAt: Timestamp.fromDate(date),
                    updatedAt: Timestamp.fromDate(date)
                });
                count++;
            });
        });

        await batch.commit();
        this.log(`[Seeder] Created ${count} expense records for P&L analysis.`, onLog);
    }

    // --- 3.5 WAREHOUSE LAYOUT (The Wow Factor v4.0) ---
    async populateWarehouseLayout(onLog?: (message: string) => void): Promise<void> {
        // Step 1: Clear existing warehouse data first
        await this.clearWarehouseData(onLog);

        this.log('[Seeder] Generating Professional Warehouse Layout (v4.0)...', onLog);
        const batch = writeBatch(this.firestore);

        // ========================================
        // 1. CREATE WAREHOUSES (Physical + Virtual)
        // ========================================
        const warehouses = [
            {
                id: 'MAIN',
                name: 'Almacén Principal',
                code: 'MAIN',
                type: 'physical',
                address: 'Av. Industrial 2450, Zona Franca, Montevideo',
                isActive: true,
                totalArea: 5000, // sq meters
                createdAt: Timestamp.now(),
                updatedAt: Timestamp.now()
            },
            {
                id: 'VIRTUAL_FBA',
                name: 'Amazon FBA Virtual',
                code: 'VFBA',
                type: 'virtual',
                isActive: true,
                processType: 'fba-reserved',
                createdAt: Timestamp.now(),
                updatedAt: Timestamp.now()
            },
            {
                id: 'VIRTUAL_MELI',
                name: 'MercadoLibre Full Virtual',
                code: 'VMELI',
                type: 'virtual',
                isActive: true,
                processType: 'fba-reserved',
                createdAt: Timestamp.now(),
                updatedAt: Timestamp.now()
            },
            {
                id: 'VIRTUAL_RETURNS',
                name: 'Returns Processing',
                code: 'VRET',
                type: 'virtual',
                isActive: true,
                processType: 'returns',
                createdAt: Timestamp.now(),
                updatedAt: Timestamp.now()
            }
        ];

        // CRITICAL: Save warehouses to Firestore
        warehouses.forEach(wh => {
            batch.set(doc(this.firestore, `warehouses/${wh.id}`), wh);
        });

        this.log(`[Seeder] Created ${warehouses.length} warehouses (1 Physical, ${warehouses.length - 1} Virtual)`, onLog);

        // ========================================
        // 2. MAIN WAREHOUSE LAYOUT (800x600 Canvas - Unified Grid System)
        // ========================================
        const warehouseId = 'MAIN';

        // --- ZONES (6 Professional Zones) - Aligned with 800x600 Grid ---
        const zones = [
            {
                id: 'zone_picking',
                warehouseId,
                name: 'Picking Zone (Fast-Moving)',
                code: 'PICK',
                type: 'racking',
                color: '#3b82f6', // Blue
                x: 20, y: 40, width: 480, height: 400,
                createdAt: Timestamp.now()
            },
            {
                id: 'zone_reserve',
                warehouseId,
                name: 'Reserve Storage',
                code: 'RSV',
                type: 'racking',
                color: '#8b5cf6', // Purple
                x: 520, y: 40, width: 260, height: 250,
                createdAt: Timestamp.now()
            },
            {
                id: 'zone_bulk',
                warehouseId,
                name: 'Bulk / Pallet Storage',
                code: 'BULK',
                type: 'bulk-stack',
                color: '#f59e0b', // Amber
                x: 520, y: 310, width: 260, height: 150,
                createdAt: Timestamp.now()
            },
            {
                id: 'zone_packing',
                warehouseId,
                name: 'Packing / Staging',
                code: 'PACK',
                type: 'packing',
                color: '#14b8a6', // Teal
                x: 20, y: 470, width: 480, height: 100,
                createdAt: Timestamp.now()
            },
            {
                id: 'zone_receiving',
                warehouseId,
                name: 'Receiving / Inbound',
                code: 'REC',
                type: 'receiving',
                color: '#10b981', // Emerald Green
                x: 520, y: 480, width: 260, height: 90,
                createdAt: Timestamp.now()
            },
            {
                id: 'zone_office',
                warehouseId,
                name: 'Office / Quality Control',
                code: 'OFC',
                type: 'staging',
                color: '#6b7280', // Gray
                x: 680, y: 10, width: 110, height: 20, // Minimized - edge label only
                createdAt: Timestamp.now()
            }
        ];

        zones.forEach(z => {
            batch.set(doc(this.firestore, `warehouse_zones/${z.id}`), z);
        });

        this.log(`[Seeder] Created ${zones.length} operational zones`, onLog);

        // --- DOORS (6 Access Points) - Positioned for 800x600 Canvas ---
        const doors = [
            {
                id: 'door_inbound_1',
                warehouseId,
                name: 'Dock 1 (Inbound)',
                type: 'inbound',
                x: 50, y: 585, width: 80, height: 10,
                rotation: 0,
                active: true,
                createdAt: Timestamp.now()
            },
            {
                id: 'door_inbound_2',
                warehouseId,
                name: 'Dock 2 (Inbound)',
                type: 'inbound',
                x: 150, y: 585, width: 80, height: 10,
                rotation: 0,
                active: true,
                createdAt: Timestamp.now()
            },
            {
                id: 'door_outbound_1',
                warehouseId,
                name: 'Shipping Door 1',
                type: 'outbound',
                x: 400, y: 585, width: 80, height: 10,
                rotation: 0,
                active: true,
                createdAt: Timestamp.now()
            },
            {
                id: 'door_outbound_2',
                warehouseId,
                name: 'Shipping Door 2',
                type: 'outbound',
                x: 520, y: 585, width: 80, height: 10,
                rotation: 0,
                active: true,
                createdAt: Timestamp.now()
            },
            {
                id: 'door_personnel',
                warehouseId,
                name: 'Personnel Entry',
                type: 'inbound',
                x: 785, y: 450, width: 10, height: 40,
                rotation: 90,
                active: true,
                createdAt: Timestamp.now()
            },
            {
                id: 'door_emergency',
                warehouseId,
                name: 'Emergency Exit',
                type: 'emergency',
                x: 5, y: 270, width: 10, height: 50,
                rotation: 0,
                active: true,
                createdAt: Timestamp.now()
            }
        ];

        doors.forEach(d => {
            batch.set(doc(this.firestore, `warehouse_doors/${d.id}`), d);
        });

        this.log(`[Seeder] Created ${doors.length} doors and access points`, onLog);

        // --- OBSTACLES (5 Structures) - Scaled for 800x600 Canvas ---
        const obstacles = [
            {
                id: 'obs_office',
                warehouseId,
                name: 'Office Structure',
                type: 'office',
                x: 680, y: 5, width: 110, height: 25,
                rotation: 0,
                createdAt: Timestamp.now()
            },
            {
                id: 'obs_qc',
                warehouseId,
                name: 'Quality Control Area',
                type: 'equipment',
                x: 360, y: 465, width: 80, height: 15,
                rotation: 0,
                createdAt: Timestamp.now()
            },
            {
                id: 'obs_loading_equipment',
                warehouseId,
                name: 'Loading Equipment Zone',
                type: 'equipment',
                x: 250, y: 490, width: 100, height: 30,
                rotation: 0,
                createdAt: Timestamp.now()
            },
            {
                id: 'obs_pillar_1',
                warehouseId,
                name: 'Support Column A',
                type: 'pillar',
                x: 510, y: 70, width: 15, height: 15,
                rotation: 0,
                createdAt: Timestamp.now()
            },
            {
                id: 'obs_pillar_2',
                warehouseId,
                name: 'Support Column B',
                type: 'pillar',
                x: 510, y: 430, width: 15, height: 15,
                rotation: 0,
                createdAt: Timestamp.now()
            }
        ];

        obstacles.forEach(o => {
            batch.set(doc(this.firestore, `warehouse_obstacles/${o.id}`), o);
        });

        this.log(`[Seeder] Created ${obstacles.length} obstacles and restricted areas`, onLog);

        // --- SCALE MARKERS (Real-world measurements) - For 800x600 Canvas ---
        const scaleMarkers = [];
        const pixelsPerMeter = 20; // Scale: 1 meter = 20 pixels approx (adjusted for 800px width)
        const canvasWidth = 800;
        const canvasHeight = 600;

        // Horizontal markers (bottom edge) - every 10 meters
        for (let meters = 0; meters <= 50; meters += 10) {
            const xPos = meters * pixelsPerMeter;
            if (xPos <= canvasWidth) {
                scaleMarkers.push({
                    id: `scale_h_${meters}`,
                    warehouseId,
                    type: 'scale_marker',
                    orientation: 'horizontal',
                    x: xPos,
                    y: canvasHeight - 10,
                    label: `${meters}m`,
                    createdAt: Timestamp.now()
                });
            }
        }

        // Vertical markers (left edge) - every 10 meters  
        for (let meters = 0; meters <= 35; meters += 10) {
            const yPos = canvasHeight - (meters * pixelsPerMeter);
            if (yPos >= 0) {
                scaleMarkers.push({
                    id: `scale_v_${meters}`,
                    warehouseId,
                    type: 'scale_marker',
                    orientation: 'vertical',
                    x: 5,
                    y: yPos,
                    label: `${meters}m`,
                    createdAt: Timestamp.now()
                });
            }
        }

        scaleMarkers.forEach(marker => {
            batch.set(doc(this.firestore, `warehouse_scale_markers/${marker.id}`), marker);
        });

        this.log(`[Seeder] Created ${scaleMarkers.length} scale markers for measurement reference`, onLog);

        // ========================================
        // 3. RACKS/STRUCTURES (72 Total)
        // ========================================
        const structures: any[] = [];

        // --- PICKING ZONE RACKS: 6 rows × 8 cols = 48 racks (GRID-BASED) ---
        this.log('[Seeder] Generating Picking Zone racks (48) using GRID LAYOUT...', onLog);
        const pickingRows = 6;
        const pickingCols = 8;

        for (let r = 0; r < pickingRows; r++) {
            for (let c = 0; c < pickingCols; c++) {
                const structId = `rack_pick_${r}_${c}`;
                const rackLetter = String.fromCharCode(65 + r); // A-F
                const rackNumber = c + 1; // 1-8

                // Use GridLayoutService for perfect alignment
                const gridPos = this.gridLayout.gridToPixels({ row: r, col: c });

                structures.push({
                    id: structId,
                    warehouseId,
                    zoneId: 'zone_picking',
                    name: `Rack ${rackLetter}-${rackNumber}`,
                    code: `${rackLetter}-${rackNumber}`,
                    type: 'standard-rack',
                    x: gridPos.x,
                    y: gridPos.y,
                    width: gridPos.width,
                    height: gridPos.height,
                    rotation: 0,
                    bays: 3, // 3 horizontal sections
                    levels: 5, // 5 vertical shelves
                    totalLocations: 15,
                    active: true,
                    createdAt: Timestamp.now()
                });
            }
        }

        // --- RESERVE STORAGE RACKS: Positioned after picking zone (GRID-BASED) ---
        this.log('[Seeder] Generating Reserve Storage racks (16) using GRID LAYOUT...', onLog);
        const reserveRows = 4;
        const reserveCols = 4;
        const reserveStartRow = 0;
        const reserveStartCol = 8; // Start after picking zone columns

        for (let r = 0; r < reserveRows; r++) {
            for (let c = 0; c < reserveCols; c++) {
                const structId = `rack_reserve_${r}_${c}`;
                const rackNum = (r * reserveCols) + c + 1; // R-1 through R-16

                const gridPos = this.gridLayout.gridToPixels({
                    row: reserveStartRow + r,
                    col: reserveStartCol + c
                });

                structures.push({
                    id: structId,
                    warehouseId,
                    zoneId: 'zone_reserve',
                    name: `Reserve R-${rackNum}`,
                    code: `R-${rackNum}`,
                    type: 'standard-rack',
                    x: gridPos.x,
                    y: gridPos.y,
                    width: gridPos.width,
                    height: gridPos.height,
                    rotation: 0,
                    bays: 2, // 2 horizontal sections
                    levels: 6, // 6 vertical shelves (taller)
                    totalLocations: 12,
                    active: true,
                    createdAt: Timestamp.now()
                });
            }
        }

        // --- BULK STORAGE: Below reserve zone (GRID-BASED) ---
        this.log('[Seeder] Generating Bulk Storage positions (8) using GRID LAYOUT...', onLog);
        const bulkRows = 2;
        const bulkCols = 4;
        const bulkStartRow = 4; // Below reserve
        const bulkStartCol = 8;

        for (let r = 0; r < bulkRows; r++) {
            for (let c = 0; c < bulkCols; c++) {
                const structId = `bulk_${r}_${c}`;
                const bulkNum = (r * bulkCols) + c + 1; // B-1 through B-8

                const gridPos = this.gridLayout.gridToPixels({
                    row: bulkStartRow + r,
                    col: bulkStartCol + c
                });

                structures.push({
                    id: structId,
                    warehouseId,
                    zoneId: 'zone_bulk',
                    name: `Bulk B-${bulkNum}`,
                    code: `B-${bulkNum}`,
                    type: 'floor-stack',
                    x: gridPos.x,
                    y: gridPos.y,
                    width: gridPos.width,
                    height: gridPos.height,
                    rotation: 0,
                    bays: 1,
                    levels: 1, // Floor stack is single level
                    totalLocations: 1,
                    active: true,
                    createdAt: Timestamp.now()
                });
            }
        }

        // Save all structures
        structures.forEach(struct => {
            batch.set(doc(this.firestore, `warehouse_structures/${struct.id}`), struct);
        });

        await batch.commit();
        this.log(`[Seeder] Created ${structures.length} storage structures (48 picking + 16 reserve + 8 bulk)`, onLog);

        // ========================================
        // 4. BINS/LOCATIONS & PRODUCT ASSIGNMENT
        // ========================================
        this.log('[Seeder] Generating storage bins and assigning products...', onLog);

        // Fetch all products
        const productsSnap = await getDocs(collection(this.firestore, 'products'));
        const products = productsSnap.docs.map(d => ({ id: d.id, ...d.data() } as any));

        if (products.length === 0) {
            this.log('[Seeder] WARNING: No products found. Bins will be empty.', onLog);
        }

        // CREATE NEW BATCH for bins (after committing structures)
        let locBatch = writeBatch(this.firestore); // Changed to 'let' to allow reassignment
        let locCount = 0;
        let occupiedCount = 0;
        let prodIndex = 0;

        // Create Bins for each rack
        for (const rack of structures) {
            const isPickingZone = rack.zoneId === 'zone_picking';
            const isReserveZone = rack.zoneId === 'zone_reserve';
            const isBulkZone = rack.zoneId === 'zone_bulk';

            // Different occupancy rates per zone
            let occupancyRate = 0.65; // Default 65%
            if (isPickingZone) occupancyRate = 0.70; // 70% in picking
            if (isReserveZone) occupancyRate = 0.60; // 60% in reserve
            if (isBulkZone) occupancyRate = 0.80; // 80% in bulk

            for (let bay = 1; bay <= rack.bays; bay++) {
                for (let level = 1; level <= rack.levels; level++) {
                    const locId = `${rack.id}_B${bay}_L${level}`;
                    const binCode = `${rack.code}-${String(bay).padStart(2, '0')}-${level}`;

                    // Assign product based on occupancy rate
                    let assignedProduct = null;
                    if (products.length > 0 && Math.random() < occupancyRate) {
                        assignedProduct = products[prodIndex % products.length];
                        prodIndex++;

                        // Skip products with 0 stock
                        if ((assignedProduct.stockQuantity || 0) <= 0) {
                            assignedProduct = null;
                        }
                    }

                    const quantity = assignedProduct
                        ? (assignedProduct.inventory?.MAIN?.stock || Math.floor(Math.random() * 25) + 5)
                        : 0;

                    const utilization = assignedProduct ? Math.floor(Math.random() * 40) + 60 : 0; // 60-100%

                    const loc = {
                        id: locId,
                        warehouseId,
                        zoneId: rack.zoneId,
                        structureId: rack.id,
                        name: `Bin ${binCode}`,
                        code: binCode,
                        barcode: `LOC-${binCode}`,
                        bay,
                        level,
                        position: 1,
                        status: assignedProduct ? 'full' : 'empty',
                        currentUtilization: utilization,

                        // Enhanced 3D positioning data
                        width: 30,
                        height: 20,
                        depth: 40,
                        maxWeight: isBulkZone ? 1000 : 200, // kg
                        maxVolume: isBulkZone ? 2.0 : 0.5, // cubic meters

                        // Product assignment
                        productId: assignedProduct?.id || null,
                        productName: assignedProduct?.name?.es || null,
                        productSku: assignedProduct?.sku || null,
                        quantity,

                        createdAt: Timestamp.now()
                    };

                    locBatch.set(doc(this.firestore, `warehouse_locations/${locId}`), loc);
                    locCount++;
                    if (assignedProduct) occupiedCount++;

                    // Commit in batches of 500
                    if (locCount % 500 === 0) {
                        await locBatch.commit();
                        this.log(`[Seeder] Created ${locCount} bins...`, onLog);
                        locBatch = writeBatch(this.firestore); // CREATE NEW BATCH
                    }
                }
            }
        }

        // Only commit if there are uncommitted items (not already committed at the 500 mark)
        if (locCount % 500 !== 0) {
            await locBatch.commit();
        }

        const occupancyPercentage = Math.round((occupiedCount / locCount) * 100);

        // ========================================
        // 5. FINAL SUMMARY
        // ========================================
        this.log('[Seeder] ========================================', onLog);
        this.log('[Seeder] 🎉 WAREHOUSE LAYOUT COMPLETE!', onLog);
        this.log('[Seeder] ========================================', onLog);
        this.log(`[Seeder] Version: ${this.SEED_VERSION}`, onLog);
        this.log(`[Seeder] Canvas: 800×600 pixels (Unified Grid System)`, onLog);
        this.log(`[Seeder] Warehouses: ${warehouses.length} (1 Physical + ${warehouses.length - 1} Virtual)`, onLog);
        this.log(`[Seeder] Zones: ${zones.length} operational zones`, onLog);
        this.log(`[Seeder] Doors: ${doors.length} access points`, onLog);
        this.log(`[Seeder] Obstacles: ${obstacles.length} restricted areas`, onLog);
        this.log(`[Seeder] Structures: ${structures.length} total (48 picking + 16 reserve + 8 bulk)`, onLog);
        this.log(`[Seeder] Bins: ${locCount} storage locations`, onLog);
        this.log(`[Seeder] Occupancy: ${occupiedCount}/${locCount} (${occupancyPercentage}%)`, onLog);
        this.log(`[Seeder] Products Distributed: ${products.length > 0 ? 'Yes' : 'No products available'}`, onLog);
        this.log('[Seeder] ========================================', onLog);
    }

    // --- 3.6 MULTI-LEVEL WAREHOUSE GENERATOR v5.0 ---
    async populateMultiLevelWarehouse(onLog?: (message: string) => void): Promise<void> {
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



    // Stub methods for other collections to prevent errors if UI calls them directly
    async populateCoupons(onLog?: (message: string) => void) {
        this.log('[Seeder] Seeding Coupons...', onLog);
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
        this.log(`[Seeder] Created ${count} coupons`, onLog);
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

            this.log('[Seeder] Step 4.5: Inbound Logistics (International POs)', onLog);
            await this.seedInboundOrders(onLog);

            this.log('[Seeder] Step 4.6: Unified CRM (Cross-Channel)', onLog);
            await this.seedUnifiedCustomers(onLog);

            this.log('[Seeder] Step 5: Operational Expenses (P&L)', onLog);
            await this.populateExpenses(config, onLog);

            // Inventory seeding
            this.log('[Seeder] Step 6: Inventory Balances', onLog);
            await this.populateInventoryBalances(config, onLog);

            this.log('[Seeder] Step 7: Inventory Ledger', onLog);
            await this.populateInventoryLedger(config, onLog);

            // Inventory enhancements
            this.log('[Seeder] Step 8: Inventory Enhancements (Adjustments, Transfers)', onLog);
            await this.populateInventoryEnhancements(config, onLog);

            this.log('[Seeder] Step 9: Warehouse Layout (Zones, Racks, Bins)', onLog);
            await this.populateWarehouseLayout(onLog);

            this.log('[Seeder] Step 10: Coupons', onLog);
            await this.populateCoupons(onLog);

            this.log('[Seeder] Step 11: Order Enhancements (Returns, Notes)', onLog);
            await this.enhanceOrders(config, onLog);

            // Channel Rules
            this.log('[Seeder] Step 12: Channel Rules', onLog);
            await this.seedChannelCommissionRules(onLog);

            // Save seed metadata
            this.log('[Seeder] Step 13: Saving Metadata', onLog);
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

    /**
     * Seed Channel Commission Rules for Multi-Channel Pricing
     * Based on official Amazon FBA and MercadoLibre fee structures (2024)
     */
    async seedChannelCommissionRules(onLog?: (message: string) => void): Promise<void> {
        this.log('========================================', onLog);
        this.log(`[Seeder] Seeding Channel Commission Rules`, onLog);
        this.log('========================================', onLog);

        const batch = writeBatch(this.firestore);
        let count = 0;

        try {
            // 0. CLEAR EXISTING RULES
            this.log('[Seeder] Cleaning old commission rules...', onLog);
            await this.deleteCollection('channel_commission_rules');

            // 1. AMAZON FBA - Standard Categories (15% referral)
            // 1. AMAZON FBM (Merchant Fulfilled) - Preferred for Tires
            const amazonFbmRef = doc(collection(this.firestore, 'channel_commission_rules'));
            batch.set(amazonFbmRef, {
                channel: 'AMAZON_FBM',
                country: 'MX',
                category: 'Automotriz / Llantas Moto',
                referralFeePercent: 10.0, // 10% for Tires
                fulfillmentType: 'SELF',
                paymentProcessingPercent: 0, // Bundled
                active: true,
                effectiveDate: Timestamp.now(),
                source: 'Amazon MX 2024 Fees',
                notes: 'Merchant Fulfilled (Recommended). 10% Referral.',
                createdAt: Timestamp.now(),
                updatedAt: Timestamp.now()
            });
            this.log('[Seeder] Added rule: AMAZON_FBM (Moto Tires)', onLog);
            count++;

            // 1.5 AMAZON FBA (Simulated) - User requested to keep
            const amazonFbaRef = doc(collection(this.firestore, 'channel_commission_rules'));
            batch.set(amazonFbaRef, {
                channel: 'AMAZON_FBA',
                country: 'MX',
                category: 'Automotriz / Llantas Moto',
                referralFeePercent: 10.0, // 10% for Tires
                minReferralFee: 10,
                fulfillmentType: 'FBA', // Simulated since Tires are usually restricted
                fulfillmentTiers: [
                    {
                        sizeCategory: 'standard', // Moto tires might fit here if not too huge
                        weightTiers: [
                            { maxWeight: 3, baseFee: 85, perKgOver: 0 },
                            { maxWeight: 10, baseFee: 120, perKgOver: 9 }
                        ]
                    },
                    {
                        sizeCategory: 'oversized',
                        weightTiers: [
                            { maxWeight: 30, baseFee: 165, perKgOver: 8 }
                        ]
                    }
                ],
                monthlyStoragePerCubicMeter: 350,
                paymentProcessingPercent: 0,
                active: true,
                effectiveDate: Timestamp.now(),
                source: 'Amazon Seller Central MX 2024',
                notes: 'FBA Simulated (Tires typically restricted). 10% Referral.',
                createdAt: Timestamp.now(),
                updatedAt: Timestamp.now()
            });
            this.log('[Seeder] Added rule: AMAZON_FBA (Simulated)', onLog);
            count++;

            // 2. MERCADOLIBRE CLASSIC - Mexico (17.5% average)
            const meliClassicRef = doc(collection(this.firestore, 'channel_commission_rules'));
            batch.set(meliClassicRef, {
                channel: 'MELI_CLASSIC',
                country: 'MX',
                category: 'Autopartes', // Llantas falls under Autopartes
                referralFeePercent: 16.0, // Avg for Tires in Classic
                fulfillmentType: 'SELF',
                paymentProcessingPercent: 0, // Bundled in Commission
                perUnitFee: 25, // MXN fixed fee for items under $299 (most tires are above, but good fallback)
                active: true,
                effectiveDate: Timestamp.now(),
                source: 'MercadoLibre Mexico 2025',
                notes: 'Classic listing. Payment fee included. Shipping separate.',
                createdAt: Timestamp.now(),
                updatedAt: Timestamp.now()
            });
            this.log('[Seeder] Added rule: MELI_CLASSIC (General)', onLog);
            count++;

            // 2.5 MERCADOLIBRE PREMIUM - Mexico (Higher fee, ~22.5% + Installments)
            const meliPremiumRef = doc(collection(this.firestore, 'channel_commission_rules'));
            batch.set(meliPremiumRef, {
                channel: 'MELI_PREMIUM',
                country: 'MX',
                category: 'Autopartes',
                referralFeePercent: 21.0, // Avg for Tires in Premium (includes MSI)
                fulfillmentType: 'SELF',
                paymentProcessingPercent: 0, // Bundled in Commission
                perUnitFee: 25,
                active: true,
                effectiveDate: Timestamp.now(),
                source: 'MercadoLibre Mexico 2025',
                notes: 'Premium with MSI. Payment fee included. Shipping separate.',
                createdAt: Timestamp.now(),
                updatedAt: Timestamp.now()
            });
            this.log('[Seeder] Added rule: MELI_PREMIUM (General)', onLog);
            count++;

            // 3. MERCADOLIBRE FULL - Mexico (18% + fulfillment)
            const meliFullRef = doc(collection(this.firestore, 'channel_commission_rules'));
            batch.set(meliFullRef, {
                channel: 'MELI_FULL',
                country: 'MX',
                category: 'Autopartes',
                referralFeePercent: 21.0, // Usually listed as Premium in Full
                fulfillmentType: 'FULL',
                fulfillmentTiers: [
                    {
                        sizeCategory: 'standard',
                        weightTiers: [
                            { maxWeight: 3, baseFee: 65, perKgOver: 0 },
                            // Simplified tire tiers
                            { maxWeight: 10, baseFee: 90, perKgOver: 8 },
                            { maxWeight: 20, baseFee: 150, perKgOver: 6 }
                        ]
                    }
                ],
                monthlyStoragePerCubicMeter: 250, // Updated 2025 rate
                paymentProcessingPercent: 0, // Bundled
                active: true,
                effectiveDate: Timestamp.now(),
                source: 'MercadoLibre Full 2025',
                notes: 'Full Fulfillment. Premium listing rates.',
                createdAt: Timestamp.now(),
                updatedAt: Timestamp.now()
            });
            this.log('[Seeder] Added rule: MELI_FULL (General)', onLog);
            count++;

            // 4. POS / In-Store
            const posRef = doc(collection(this.firestore, 'channel_commission_rules'));
            batch.set(posRef, {
                channel: 'POS',
                country: 'MX',
                referralFeePercent: 0, // No marketplace commission
                fulfillmentType: 'SELF',
                paymentProcessingPercent: 2.75, // Card terminal fees
                paymentProcessingFixed: 0.50,
                active: true,
                effectiveDate: Timestamp.now(),
                source: 'Internal POS System',
                notes: 'In-store sales with card processing fees',
                createdAt: Timestamp.now(),
                updatedAt: Timestamp.now()
            });
            this.log('[Seeder] Added rule: POS (General)', onLog);
            count++;

            // 5. Web Store
            const webRef = doc(collection(this.firestore, 'channel_commission_rules'));
            batch.set(webRef, {
                channel: 'WEB',
                country: 'MX',
                referralFeePercent: 0, // No marketplace commission
                fulfillmentType: 'SELF',
                paymentProcessingPercent: 3.0, // Stripe/PayPal
                paymentProcessingFixed: 0.30,
                active: true,
                effectiveDate: Timestamp.now(),
                source: 'Payment Gateway Docs',
                notes: 'Direct web store sales with payment gateway fees',
                createdAt: Timestamp.now(),
                updatedAt: Timestamp.now()
            });
            this.log('[Seeder] Added rule: WEB (General)', onLog);
            count++;

            await batch.commit();
            this.log(`[Seeder] SUCCESS: Created ${count} commission rules.`, onLog);
            this.log('[Seeder] Commission rule seeding complete!', onLog);

        } catch (error: any) {
            this.log(`[Seeder] ERROR seeding commission rules: ${error.message}`, onLog);
            throw error;
        }
    }

    // --- 9. SEED INBOUND ORDERS (INTERNATIONAL) ---
    async seedInboundOrders(onLog?: (message: string) => void): Promise<void> {
        this.log('[Seeder] Seeding Inbound Purchase Orders...', onLog);
        const batch = writeBatch(this.firestore);


        // Simulation Scenarios
        const pos = [
            {
                id: 'PO-MX-2024-001',
                supplierName: 'Michelin France HQ',
                originCountry: 'FR',
                status: 'customs_hold',
                totalItems: 1200,
                totalCost: 145000,
                estimatedArrival: -2, // 2 days ago (DELAYED)
                containerId: 'MSCU-1928374',
                pedimento: 'PENDING',
                timeline: [
                    { status: 'placed', daysOffset: -45, note: 'Order Placed' },
                    { status: 'manufacturing', daysOffset: -40, note: 'Production Started' },
                    { status: 'ready_to_ship', daysOffset: -15, note: 'Container Loaded' },
                    { status: 'shipped', daysOffset: -14, note: 'Vessel Departed Le Havre' },
                    { status: 'customs_hold', daysOffset: -1, note: 'Held for inspection' }
                ]
            },
            {
                id: 'PO-CN-2024-088',
                supplierName: 'Praxis Manufacturing Shenzen',
                originCountry: 'CN',
                status: 'shipped',
                totalItems: 5000,
                totalCost: 85000,
                estimatedArrival: 12, // 12 days to go
                containerId: 'COSU-99887766',
                pedimento: null,
                timeline: [
                    { status: 'placed', daysOffset: -20, note: 'Order Placed' },
                    { status: 'manufacturing', daysOffset: -10, note: 'Production Complete' },
                    { status: 'shipped', daysOffset: -5, note: 'Vessel Departed Shanghai' }
                ]
            },
            {
                id: 'PO-IT-2024-003',
                supplierName: 'Pirelli Italia S.p.A.',
                originCountry: 'IT',
                status: 'manufacturing',
                totalItems: 450,
                totalCost: 65000,
                estimatedArrival: 25,
                containerId: null,
                pedimento: null,
                timeline: [
                    { status: 'placed', daysOffset: -5, note: 'Order Placed' },
                    { status: 'manufacturing', daysOffset: 0, note: 'Production Started' }
                ]
            },
            {
                id: 'PO-US-2024-102',
                supplierName: 'Dunlop North America',
                originCountry: 'US',
                status: 'customs_cleared',
                totalItems: 800,
                totalCost: 42000,
                estimatedArrival: 1, // Arriving tomorrow
                containerId: 'TRUCK-992',
                pedimento: '24-23-3323-223123',
                timeline: [
                    { status: 'placed', daysOffset: -10, note: 'Order Placed' },
                    { status: 'shipped', daysOffset: -3, note: 'Truck Departed Texas' },
                    { status: 'customs_cleared', daysOffset: 0, note: 'Customs Cleared at Laredo' }
                ]
            }
        ];

        for (const po of pos) {
            const ref = doc(this.firestore, `purchase_orders/${po.id}`);

            // Calculate Dates relative to NOW
            const eta = new Date();
            eta.setDate(eta.getDate() + po.estimatedArrival); // + or - days

            const timelineEvents = po.timeline.map(t => {
                const d = new Date();
                d.setDate(d.getDate() + t.daysOffset);
                return {
                    status: t.status,
                    timestamp: Timestamp.fromDate(d),
                    description: t.note,
                    completed: true
                };
            });

            const data = {
                id: po.id,
                supplierId: po.supplierName.replace(/\s+/g, '_').toUpperCase(),
                supplierName: po.supplierName,
                originCountry: po.originCountry,
                destinationWarehouseId: 'MAIN',
                status: po.status,
                createdAt: timelineEvents[0].timestamp,
                updatedAt: Timestamp.now(),
                estimatedArrivalDate: Timestamp.fromDate(eta),
                totalItems: po.totalItems,
                totalCost: po.totalCost,
                currency: 'USD',
                containerId: po.containerId,
                pedimento: po.pedimento,
                timeline: timelineEvents
            };

            batch.set(ref, data);
        }

        await batch.commit();
        this.log('[Seeder] Inbound POs Seeded.', onLog);
    }


    // --- 10. SEED UNIFIED CUSTOMERS (CRM) ---
    async seedUnifiedCustomers(onLog?: (message: string) => void): Promise<void> {
        this.log('[Seeder] Seeding Cross-Channel Customer Data...', onLog);
        const batch = writeBatch(this.firestore);

        const now = new Date();
        const past = new Date(); past.setDate(now.getDate() - 30);

        // Scenario: Carlos Mendez (VIP Cross-channel)
        const email = 'carlos.mendez.vip@example.com';

        // 1. Web Order
        const ord1Ref = doc(collection(this.firestore, 'orders'));
        batch.set(ord1Ref, {
            orderNumber: 'WEB-99102',
            status: 'delivered',
            channel: 'WEB',
            total: 2500,
            customer: { name: 'Carlos Mendez', email: email, phone: '555-0100' },
            createdAt: Timestamp.fromDate(past),
            items: [],
            updatedAt: Timestamp.fromDate(past)
        });

        // 2. Amazon Order (Matched by Email)
        const ord2Ref = doc(collection(this.firestore, 'orders'));
        batch.set(ord2Ref, {
            orderNumber: '114-3829102-48291',
            status: 'shipped',
            channel: 'AMAZON_FBA',
            total: 1800,
            customer: { name: 'Carlos Mendez', email: email, phone: '555-0100' },
            createdAt: Timestamp.fromDate(now),
            items: [],
            updatedAt: Timestamp.fromDate(now)
        });

        // Scenario: Sarah Connor (Web Only)
        batch.set(doc(collection(this.firestore, 'orders')), {
            orderNumber: 'WEB-2009',
            status: 'processing',
            channel: 'WEB',
            total: 500,
            customer: { name: 'Sarah Connor', email: 'sarah@skynet.com', phone: '555-1010' },
            createdAt: Timestamp.now(), items: [], updatedAt: Timestamp.now()
        });

        await batch.commit();
        this.log('[Seeder] Unified Customers Seeded.', onLog);
    }
}
