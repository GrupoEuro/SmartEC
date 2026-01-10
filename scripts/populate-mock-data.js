/**
 * Mock Data Script for E-commerce Testing
 * 
 * This script populates Firestore with realistic motorcycle tire data:
 * - Brands (Praxis, Michelin, Pirelli, Dunlop, Bridgestone)
 * - Categories (Sport, Touring, Off-Road, Scooter)
 * - Products (20+ realistic motorcycle tires)
 * 
 * Run with: node populate-mock-data.js
 */

const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');

// Initialize Firebase Admin
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

// Mock Brands Data
const brands = [
    {
        name: 'Praxis',
        slug: 'praxis',
        description: {
            en: 'Premium motorcycle tires engineered in Mexico for superior performance and durability.',
            es: 'Llantas premium para motocicleta diseñadas en México para un rendimiento y durabilidad superiores.'
        },
        logoUrl: 'https://via.placeholder.com/200x80/00ACD8/FFFFFF?text=PRAXIS',
        countryOfOrigin: 'Mexico',
        website: 'https://praxis.com.mx',
        featured: true,
        active: true
    },
    {
        name: 'Michelin',
        slug: 'michelin',
        description: {
            en: 'French tire manufacturer known for innovation and quality since 1889.',
            es: 'Fabricante francés de llantas conocido por su innovación y calidad desde 1889.'
        },
        logoUrl: 'https://via.placeholder.com/200x80/FFD700/000000?text=MICHELIN',
        countryOfOrigin: 'France',
        website: 'https://www.michelin.com',
        featured: true,
        active: true
    },
    {
        name: 'Pirelli',
        slug: 'pirelli',
        description: {
            en: 'Italian tire excellence with a rich motorsport heritage.',
            es: 'Excelencia italiana en llantas con una rica herencia en deportes de motor.'
        },
        logoUrl: 'https://via.placeholder.com/200x80/D02C2F/FFFFFF?text=PIRELLI',
        countryOfOrigin: 'Italy',
        website: 'https://www.pirelli.com',
        featured: true,
        active: true
    },
    {
        name: 'Dunlop',
        slug: 'dunlop',
        description: {
            en: 'British tire brand with over 130 years of racing experience.',
            es: 'Marca británica de llantas con más de 130 años de experiencia en carreras.'
        },
        logoUrl: 'https://via.placeholder.com/200x80/93D500/000000?text=DUNLOP',
        countryOfOrigin: 'United Kingdom',
        website: 'https://www.dunlop.eu',
        featured: false,
        active: true
    },
    {
        name: 'Bridgestone',
        slug: 'bridgestone',
        description: {
            en: 'Japanese tire technology leader with global presence.',
            es: 'Líder japonés en tecnología de llantas con presencia global.'
        },
        logoUrl: 'https://via.placeholder.com/200x80/000000/FFFFFF?text=BRIDGESTONE',
        countryOfOrigin: 'Japan',
        website: 'https://www.bridgestone.com',
        featured: false,
        active: true
    }
];

// Mock Categories Data
const categories = [
    {
        name: { en: 'Sport', es: 'Deportivas' },
        slug: 'sport',
        description: {
            en: 'High-performance tires for sport motorcycles and track use.',
            es: 'Llantas de alto rendimiento para motocicletas deportivas y uso en pista.'
        },
        icon: '🏍️',
        imageUrl: 'https://via.placeholder.com/400x300/00ACD8/FFFFFF?text=Sport+Tires',
        active: true,
        order: 1
    },
    {
        name: { en: 'Touring', es: 'Turismo' },
        slug: 'touring',
        description: {
            en: 'Long-lasting tires designed for comfort and highway riding.',
            es: 'Llantas duraderas diseñadas para comodidad y viajes en carretera.'
        },
        icon: '🛣️',
        imageUrl: 'https://via.placeholder.com/400x300/93D500/000000?text=Touring+Tires',
        active: true,
        order: 2
    },
    {
        name: { en: 'Off-Road', es: 'Todo Terreno' },
        slug: 'off-road',
        description: {
            en: 'Rugged tires built for adventure and off-road terrain.',
            es: 'Llantas robustas construidas para aventura y terreno irregular.'
        },
        icon: '⛰️',
        imageUrl: 'https://via.placeholder.com/400x300/D02C2F/FFFFFF?text=Off-Road+Tires',
        active: true,
        order: 3
    },
    {
        name: { en: 'Scooter', es: 'Scooter' },
        slug: 'scooter',
        description: {
            en: 'Specialized tires for scooters and urban mobility.',
            es: 'Llantas especializadas para scooters y movilidad urbana.'
        },
        icon: '🛴',
        imageUrl: 'https://via.placeholder.com/400x300/FFD700/000000?text=Scooter+Tires',
        active: true,
        order: 4
    }
];

// Helper function to generate URL-friendly slugs
function generateSlug(name) {
    return name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

// Helper function to generate realistic product data
function generateProducts(brandIds, categoryIds) {
    const products = [];

    // Sport Tires
    products.push({
        name: { en: 'Praxis Sport Pro', es: 'Praxis Sport Pro' },
        slug: 'praxis-sport-pro',
        brand: 'Praxis',
        brandId: brandIds['Praxis'],
        categoryId: categoryIds['Sport'],
        sku: 'PRAX-120-70-17-SP',
        description: {
            en: 'Ultimate sport tire with advanced compound for maximum grip on track and street.',
            es: 'Llanta deportiva definitiva con compuesto avanzado para máximo agarre en pista y calle.'
        },
        specifications: {
            width: 120,
            aspectRatio: 70,
            diameter: 17,
            loadIndex: 58,
            speedRating: 'W',
            construction: 'Radial',
            tubeless: true
        },
        features: {
            en: ['Dual compound technology', 'Enhanced wet grip', 'Track-ready performance', 'Quick warm-up time'],
            es: ['Tecnología de doble compuesto', 'Agarre mejorado en mojado', 'Rendimiento listo para pista', 'Tiempo de calentamiento rápido']
        },
        price: 1850,
        compareAtPrice: 2100,
        stockQuantity: 15,
        inStock: true,
        images: {
            main: 'https://via.placeholder.com/800x800/00ACD8/FFFFFF?text=Praxis+Sport+Pro',
            gallery: [
                'https://via.placeholder.com/800x800/00ACD8/FFFFFF?text=Side+View',
                'https://via.placeholder.com/800x800/00ACD8/FFFFFF?text=Tread+Pattern'
            ]
        },
        featured: true,
        newArrival: true,
        bestSeller: false,
        active: true
    });

    products.push({
        name: { en: 'Michelin Pilot Power', es: 'Michelin Pilot Power' },
        slug: 'michelin-pilot-power',
        brand: 'Michelin',
        brandId: brandIds['Michelin'],
        categoryId: categoryIds['Sport'],
        sku: 'MICH-180-55-17-SP',
        description: {
            en: 'Racing-derived technology for exceptional cornering stability and grip.',
            es: 'Tecnología derivada de carreras para estabilidad excepcional en curvas y agarre.'
        },
        specifications: {
            width: 180,
            aspectRatio: 55,
            diameter: 17,
            loadIndex: 73,
            speedRating: 'W',
            construction: 'Radial',
            tubeless: true
        },
        features: {
            en: ['2CT+ dual compound', 'Optimized contact patch', 'Excellent feedback', 'Long-lasting performance'],
            es: ['Compuesto dual 2CT+', 'Parche de contacto optimizado', 'Excelente retroalimentación', 'Rendimiento duradero']
        },
        price: 2200,
        compareAtPrice: null,
        stockQuantity: 8,
        inStock: true,
        images: {
            main: 'https://via.placeholder.com/800x800/FFD700/000000?text=Michelin+Pilot',
            gallery: []
        },
        featured: true,
        newArrival: false,
        bestSeller: true,
        active: true
    });

    // Touring Tires
    products.push({
        name: { en: 'Praxis Touring Plus', es: 'Praxis Touring Plus' },
        slug: 'praxis-touring-plus',
        brand: 'Praxis',
        brandId: brandIds['Praxis'],
        categoryId: categoryIds['Touring'],
        sku: 'PRAX-130-80-17-TR',
        description: {
            en: 'Premium touring tire designed for long-distance comfort and reliability.',
            es: 'Llanta de turismo premium diseñada para comodidad y confiabilidad en largas distancias.'
        },
        specifications: {
            width: 130,
            aspectRatio: 80,
            diameter: 17,
            loadIndex: 65,
            speedRating: 'H',
            construction: 'Radial',
            tubeless: true
        },
        features: {
            en: ['Extended mileage compound', 'All-weather performance', 'Comfortable ride', 'Low rolling resistance'],
            es: ['Compuesto de kilometraje extendido', 'Rendimiento todo clima', 'Viaje cómodo', 'Baja resistencia al rodamiento']
        },
        price: 1450,
        compareAtPrice: 1650,
        stockQuantity: 20,
        inStock: true,
        images: {
            main: 'https://via.placeholder.com/800x800/93D500/000000?text=Praxis+Touring',
            gallery: ['https://via.placeholder.com/800x800/93D500/000000?text=Detail']
        },
        featured: false,
        newArrival: false,
        bestSeller: true,
        active: true
    });

    products.push({
        name: { en: 'Bridgestone Battlax T32', es: 'Bridgestone Battlax T32' },
        slug: 'bridgestone-battlax-t32',
        brand: 'Bridgestone',
        brandId: brandIds['Bridgestone'],
        categoryId: categoryIds['Touring'],
        sku: 'BRID-120-70-17-TR',
        description: {
            en: 'Sport-touring tire with excellent wet weather performance and longevity.',
            es: 'Llanta sport-touring con excelente rendimiento en mojado y longevidad.'
        },
        specifications: {
            width: 120,
            aspectRatio: 70,
            diameter: 17,
            loadIndex: 58,
            speedRating: 'W',
            construction: 'Radial',
            tubeless: true
        },
        features: {
            en: ['Pulse groove technology', 'Superior wet grip', 'Even wear pattern', 'Stable handling'],
            es: ['Tecnología de ranura pulsada', 'Agarre superior en mojado', 'Desgaste uniforme', 'Manejo estable']
        },
        price: 1750,
        compareAtPrice: null,
        stockQuantity: 12,
        inStock: true,
        images: {
            main: 'https://via.placeholder.com/800x800/000000/FFFFFF?text=Bridgestone+T32',
            gallery: []
        },
        featured: false,
        newArrival: false,
        bestSeller: false,
        active: true
    });

    // Off-Road Tires
    products.push({
        name: { en: 'Pirelli Scorpion Rally', es: 'Pirelli Scorpion Rally' },
        slug: 'pirelli-scorpion-rally',
        brand: 'Pirelli',
        brandId: brandIds['Pirelli'],
        categoryId: categoryIds['Off-Road'],
        sku: 'PIR-110-80-19-OR',
        description: {
            en: 'Adventure tire built for extreme off-road conditions and rally racing.',
            es: 'Llanta de aventura construida para condiciones extremas de todo terreno y rally.'
        },
        specifications: {
            width: 110,
            aspectRatio: 80,
            diameter: 19,
            loadIndex: 59,
            speedRating: 'R',
            construction: 'Bias',
            tubeless: false
        },
        features: {
            en: ['Aggressive tread pattern', 'Self-cleaning design', 'Puncture resistant', 'Mixed terrain capability'],
            es: ['Patrón de banda agresivo', 'Diseño autolimpiante', 'Resistente a pinchazos', 'Capacidad en terreno mixto']
        },
        price: 1650,
        compareAtPrice: 1900,
        stockQuantity: 10,
        inStock: true,
        images: {
            main: 'https://via.placeholder.com/800x800/D02C2F/FFFFFF?text=Pirelli+Scorpion',
            gallery: ['https://via.placeholder.com/800x800/D02C2F/FFFFFF?text=Tread']
        },
        featured: true,
        newArrival: true,
        bestSeller: false,
        active: true
    });

    // Scooter Tires
    products.push({
        name: { en: 'Praxis City Grip', es: 'Praxis City Grip' },
        slug: 'praxis-city-grip',
        brand: 'Praxis',
        brandId: brandIds['Praxis'],
        categoryId: categoryIds['Scooter'],
        sku: 'PRAX-110-70-12-SC',
        description: {
            en: 'Urban scooter tire optimized for city commuting and wet conditions.',
            es: 'Llanta para scooter urbano optimizada para traslados en ciudad y condiciones mojadas.'
        },
        specifications: {
            width: 110,
            aspectRatio: 70,
            diameter: 12,
            loadIndex: 47,
            speedRating: 'L',
            construction: 'Radial',
            tubeless: true
        },
        features: {
            en: ['Enhanced wet braking', 'Low noise', 'Fuel efficient', 'Quick steering response'],
            es: ['Frenado mejorado en mojado', 'Bajo ruido', 'Eficiente en combustible', 'Respuesta rápida de dirección']
        },
        price: 850,
        compareAtPrice: null,
        stockQuantity: 30,
        inStock: true,
        images: {
            main: 'https://via.placeholder.com/800x800/00ACD8/FFFFFF?text=City+Grip',
            gallery: []
        },
        featured: false,
        newArrival: false,
        bestSeller: true,
        active: true
    });

    products.push({
        name: { en: 'Michelin City Pro', es: 'Michelin City Pro' },
        slug: 'michelin-city-pro',
        brand: 'Michelin',
        brandId: brandIds['Michelin'],
        categoryId: categoryIds['Scooter'],
        sku: 'MICH-90-90-14-SC',
        description: {
            en: 'Reliable scooter tire with excellent mileage for daily urban use.',
            es: 'Llanta confiable para scooter con excelente kilometraje para uso urbano diario.'
        },
        specifications: {
            width: 90,
            aspectRatio: 90,
            diameter: 14,
            loadIndex: 46,
            speedRating: 'P',
            construction: 'Bias',
            tubeless: true
        },
        features: {
            en: ['Long-lasting tread', 'Stable handling', 'Good wet grip', 'Economic choice'],
            es: ['Banda de rodamiento duradera', 'Manejo estable', 'Buen agarre en mojado', 'Opción económica']
        },
        price: 750,
        compareAtPrice: 850,
        stockQuantity: 25,
        inStock: true,
        images: {
            main: 'https://via.placeholder.com/800x800/FFD700/000000?text=City+Pro',
            gallery: []
        },
        featured: false,
        newArrival: false,
        bestSeller: false,
        active: true
    });

    // Add more products for variety
    products.push({
        name: { en: 'Dunlop Sportmax Q5', es: 'Dunlop Sportmax Q5' },
        slug: 'dunlop-sportmax-q5',
        brand: 'Dunlop',
        brandId: brandIds['Dunlop'],
        categoryId: categoryIds['Sport'],
        sku: 'DUN-200-55-17-SP',
        description: {
            en: 'Track-focused hypersport tire with MotoGP-derived technology.',
            es: 'Llanta hipersport enfocada en pista con tecnología derivada de MotoGP.'
        },
        specifications: {
            width: 200,
            aspectRatio: 55,
            diameter: 17,
            loadIndex: 78,
            speedRating: 'W',
            construction: 'Radial',
            tubeless: true
        },
        features: {
            en: ['Race-proven compound', 'Maximum lean angle', 'Predictable handling', 'Fast lap times'],
            es: ['Compuesto probado en carreras', 'Ángulo de inclinación máximo', 'Manejo predecible', 'Tiempos de vuelta rápidos']
        },
        price: 2400,
        compareAtPrice: null,
        stockQuantity: 5,
        inStock: true,
        images: {
            main: 'https://via.placeholder.com/800x800/93D500/000000?text=Dunlop+Q5',
            gallery: ['https://via.placeholder.com/800x800/93D500/000000?text=Profile']
        },
        featured: true,
        newArrival: true,
        bestSeller: true,
        active: true
    });

    return products;
}

// Main execution function
async function populateDatabase() {
    console.log('🚀 Starting mock data population...\n');

    try {
        // Step 1: Add Brands
        console.log('📦 Adding brands...');
        const brandIds = {};
        for (const brand of brands) {
            const docRef = await db.collection('brands').add({
                ...brand,
                createdAt: admin.firestore.Timestamp.now(),
                updatedAt: admin.firestore.Timestamp.now()
            });
            brandIds[brand.name] = docRef.id;
            console.log(`  ✓ Added brand: ${brand.name}`);
        }

        // Step 2: Add Categories
        console.log('\n📁 Adding categories...');
        const categoryIds = {};
        for (const category of categories) {
            const docRef = await db.collection('categories').add({
                ...category,
                createdAt: admin.firestore.Timestamp.now(),
                updatedAt: admin.firestore.Timestamp.now()
            });
            categoryIds[category.name.en] = docRef.id;
            console.log(`  ✓ Added category: ${category.name.en}`);
        }

        // Step 3: Generate and Add Products
        console.log('\n🛞 Adding products...');
        const products = generateProducts(brandIds, categoryIds);
        for (const product of products) {
            await db.collection('products').add({
                ...product,
                createdAt: admin.firestore.Timestamp.now(),
                updatedAt: admin.firestore.Timestamp.now()
            });
            console.log(`  ✓ Added product: ${product.name.en}`);
        }

        console.log('\n✅ Mock data population complete!');
        console.log(`\n📊 Summary:`);
        console.log(`   - Brands: ${brands.length}`);
        console.log(`   - Categories: ${categories.length}`);
        console.log(`   - Products: ${products.length}`);
        console.log(`\n🎉 You can now test all pages!`);
        console.log(`   - Admin Brands: /admin/brands`);
        console.log(`   - Admin Categories: /admin/categories`);
        console.log(`   - Admin Products: /admin/products`);
        console.log(`   - Public Catalog: /catalog`);
        console.log(`   - Product Detail: /product/{id}`);

    } catch (error) {
        console.error('❌ Error populating database:', error);
    } finally {
        process.exit();
    }
}

// Run the script
populateDatabase();
