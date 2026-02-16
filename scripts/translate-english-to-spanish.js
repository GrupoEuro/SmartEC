#!/usr/bin/env node

/**
 * TRANSLATE ALL ENGLISH PLACEHOLDERS TO PROPER SPANISH
 * The previous script replaced "Título" with English - now translate to Spanish
 */

const fs = require('fs');

const esJsonPath = 'src/assets/i18n/es.json';
const esJson = JSON.parse(fs.readFileSync(esJsonPath, 'utf8'));

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

// PROPER SPANISH TRANSLATIONS for all the English placeholders
const properSpanishTranslations = {
    // Command Center
    "COMMAND_CENTER.CUSTOMER_INSIGHTS.TITLE": "Análisis de Clientes",
    "COMMAND_CENTER.CUSTOMER_INSIGHTS.SUBTITLE": "Análisis de comportamiento y valor de clientes",
    "COMMAND_CENTER.CUSTOMER_INSIGHTS.RFM.TITLE": "Análisis RFM",
    "COMMAND_CENTER.CUSTOMER_INSIGHTS.RFM.SUBTITLE": "Recencia vs Frecuencia vs Valor Monetario",
    "COMMAND_CENTER.CUSTOMER_INSIGHTS.COHORTS.TITLE": "Mapa de Retención (Cohortes)",
    "COMMAND_CENTER.CUSTOMER_INSIGHTS.AT_RISK.TITLE": "Clientes de Alto Valor en Riesgo",

    // Operations
    "OPERATIONS.DASHBOARD.SUBTITLE": "Resumen de actividades y acciones rápidas",
    "OPERATIONS.INVENTORY.SUBTITLE": "Gestión de inventario",
    "OPERATIONS.PROMOTIONS.TITLE": "Promociones y Cupones",
    "OPERATIONS.PROCUREMENT.TITLE": "Adquisiciones",
    "OPERATIONS.PROCUREMENT.SUBTITLE": "Gestión de órdenes de compra e inventario entrante",

    // Admin
    "ADMIN.PRODUCTS.TITLE": "Productos",
    "ADMIN.BANNERS.TITLE": "Gestión de Banners",
    "ADMIN.BLOG.TITLE": "Gestión de Blog",
    "ADMIN.BRANDS.TITLE": "Marcas",
    "ADMIN.CATALOG_OVERVIEW.TITLE": "Resumen del Catálogo",
    "ADMIN.CATALOG_OVERVIEW.SUBTITLE": "Visualización jerárquica de todos los productos",
    "ADMIN.CATEGORIES.TITLE": "Categorías",
    "ADMIN.COUPONS.TITLE": "Cupones",
    "ADMIN.CUSTOMERS.TITLE": "Gestión de Clientes",
    "ADMIN.CUSTOMERS.DETAIL.SUBTITLE": "Información detallada del cliente",
    "ADMIN.ORDERS.TITLE": "Pedidos",
    "ADMIN.DISTRIBUTORS.TITLE": "Prospectos de Distribuidores",
    "ADMIN.KITS.TITLE": "Kits de Productos",
    "ADMIN.KITS.SUBTITLE": "Gestión de paquetes y combos de productos",
    "ADMIN.LOGS.TITLE": "Registros de Actividad",
    "ADMIN.MEDIA_LIBRARY.TITLE": "Biblioteca de Medios",
    "ADMIN.MEDIA_LIBRARY.EMPTY.TITLE": "No se encontraron recursos",
    "ADMIN.PDF_LIST.TITLE": "Biblioteca de PDFs",
    "ADMIN.USERS.TITLE": "Gestión de Usuarios",
    "ADMIN.WAREHOUSES.TITLE": "Almacenes",
    "ADMIN.WAREHOUSES.WIZARD.TITLE": "Crear Almacén",
    "ADMIN.WAREHOUSES.WIZARD.SUBTITLE": "Configurar detalles de ubicación de almacenamiento",

    // Pricing Strategy
    "PRICING_STRATEGY.DASHBOARD.TITLE": "Tablero Ejecutivo",
    "PRICING_STRATEGY.DASHBOARD.SUBTITLE": "Resumen de salud de precios y márgenes",
    "PRICING_STRATEGY.DASHBOARD_V2.ATTENTION.TITLE": "Requiere Atención",
    "PRICING_STRATEGY.DASHBOARD_V2.ACTIVITY.TITLE": "Actividad Reciente",

    // Product Types
    "PRODUCT_TYPES.TITLE": "Tipos de Producto",
    "PRODUCT_TYPES.SUBTITLE": "Gestión de plantillas de tipos de producto y sus especificaciones",
    "PRODUCT_TYPES.FORM.EMPTY_STATE.TITLE": "Construyamos el esquema de tu producto",

    // Website Settings
    "WEBSITE_SETTINGS.TITLE": "Configuración del Sitio Web",
    "WEBSITE_SETTINGS.SUBTITLE": "Configurar opciones generales e información de contacto",
    "WEBSITE_SETTINGS.GENERAL.TITLE": "Información General",
    "WEBSITE_SETTINGS.SOCIAL.TITLE": "Redes Sociales",
    "WEBSITE_SETTINGS.HOURS.TITLE": "Horario de Atención",
    "WEBSITE_SETTINGS.HOURS.SUBTITLE": "Define cuándo estás disponible para tus clientes",
    "WEBSITE_SETTINGS.FEATURES.TITLE": "Características y Extras",
    "WEBSITE_SETTINGS.SEO.TITLE": "SEO y Metadatos"
};

let translatedCount = 0;
for (const [key, value] of Object.entries(properSpanishTranslations)) {
    setNestedKey(esJson, key, value);
    translatedCount++;
    console.log(`✓ ${key} = "${value}"`);
}

fs.writeFileSync(esJsonPath, JSON.stringify(esJson, null, 2));

console.log(`\n✅ Translated ${translatedCount} English placeholders to proper Spanish`);
console.log(`\n🎯 All "Título" placeholders are now properly translated!`);
