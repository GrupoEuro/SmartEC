#!/usr/bin/env node

/**
 * Manual Translation Fixes for Admin Section
 * Adds missing ADMIN.SIDEBAR and other critical admin keys
 */

const fs = require('fs');
const path = require('path');

// Load existing translations
const esJsonPath = 'src/assets/i18n/es.json';
const esJson = JSON.parse(fs.readFileSync(esJsonPath, 'utf8'));

// Helper to set nested key
function setNestedKey(obj, keyPath, value) {
    const keys = keyPath.split('.');
    let current = obj;

    for (let i = 0; i < keys.length - 1; i++) {
        const key = keys[i];
        if (!current[key]) {
            current[key] = {};
        }
        current = current[key];
    }

    current[keys[keys.length - 1]] = value;
}

// Ensure ADMIN object exists
if (!esJson.ADMIN) {
    esJson.ADMIN = {};
}

// Add ADMIN.SIDEBAR translations
const sidebarTranslations = {
    "ADMIN.SIDEBAR.DASHBOARD": "Tablero",
    "ADMIN.SIDEBAR.SECTION_BUSINESS": "Negocio",
    "ADMIN.SIDEBAR.SECTION_ECOMMERCE": "E-Commerce",
    "ADMIN.SIDEBAR.SECTION_CONTENT": "Contenido",
    "ADMIN.SIDEBAR.SECTION_MARKETING": "Marketing",
    "ADMIN.SIDEBAR.INTEGRATIONS": "Integraciones",
    "ADMIN.SIDEBAR.SECTION_SYSTEM": "Sistema",
    "ADMIN.SIDEBAR.PRODUCTS": "Productos",
    "ADMIN.SIDEBAR.CATEGORIES": "Categorías",
    "ADMIN.SIDEBAR.BRANDS": "Marcas",
    "ADMIN.SIDEBAR.CUSTOMERS": "Clientes",
    "ADMIN.SIDEBAR.DISTRIBUTORS": "Distribuidores",
    "ADMIN.SIDEBAR.ORDERS": "Pedidos",
    "ADMIN.SIDEBAR.BANNERS": "Banners",
    "ADMIN.SIDEBAR.BLOG": "Blog",
    "ADMIN.SIDEBAR.PDFS": "PDFs",
    "ADMIN.SIDEBAR.MEDIA": "Medios",
    "ADMIN.SIDEBAR.COUPONS": "Cupones",
    "ADMIN.SIDEBAR.PROMOTIONS": "Promociones",
    "ADMIN.SIDEBAR.USERS": "Usuarios",
    "ADMIN.SIDEBAR.SETTINGS": "Configuración",
    "ADMIN.SIDEBAR.WAREHOUSES": "Almacenes"
};

// Add ADMIN.PRODUCTS pagination
const paginationTranslations = {
    "ADMIN.PRODUCTS.ITEMS_PER_PAGE": "Elementos por página",
    "ADMIN.PRODUCTS.SHOWING_ITEMS": "Mostrando {{start}} a {{end}} de {{total}} elementos"
};

// Add all translations
const allTranslations = {
    ...sidebarTranslations,
    ...paginationTranslations
};

let addedCount = 0;
for (const [key, value] of Object.entries(allTranslations)) {
    setNestedKey(esJson, key, value);
    addedCount++;
    console.log(`✓ Added: ${key} = "${value}"`);
}

// Write updated file
fs.writeFileSync(esJsonPath, JSON.stringify(esJson, null, 2));

console.log(`\n✅ Successfully added ${addedCount} admin translations to es.json`);
