#!/usr/bin/env node

/**
 * COMPLETE OPERATIONS SIDEBAR TRANSLATIONS
 * Based on actual operations-navigation.config.ts file
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

// ALL OPERATIONS TRANSLATIONS - COMPLETE AND PROPER
const operationsTranslations = {
    // Main sections
    "OPERATIONS.TITLE": "Operaciones",
    "OPERATIONS.LOGOUT": "Cerrar Sesión",
    "OPERATIONS.GO_HOME": "Ir al Inicio",

    // Dashboard
    "OPERATIONS.DASHBOARD.TITLE": "Tablero de Operaciones",
    "OPERATIONS.DASHBOARD_TITLE": "Tablero de Operaciones",
    "OPERATIONS.DASHBOARD_SUBTITLE": "Resumen de actividades y acciones rápidas",

    // Order Fulfillment Section
    "OPERATIONS.SIDEBAR.FULFILLMENT": "Cumplimiento de Pedidos",
    "OPERATIONS.SIDEBAR.ORDER_QUEUE": "Cola de Pedidos",
    "OPERATIONS.SIDEBAR.ORDERS": "Pedidos",
    "OPERATIONS.ORDERS.TITLE": "Gestión de Pedidos",

    // Inventory Section
    "OPERATIONS.SIDEBAR.INVENTORY": "Inventario",
    "OPERATIONS.SIDEBAR.LOOKUP": "Búsqueda de Inventario",
    "OPERATIONS.SIDEBAR.LOCATOR": "Localizador de Productos",
    "OPERATIONS.SIDEBAR.CYCLE_COUNTS": "Conteos Cíclicos",
    "OPERATIONS.SIDEBAR.ABC_ANALYSIS": "Análisis ABC",
    "OPERATIONS.SIDEBAR.REPLENISHMENT_PLANNER": "Planificador de Reabastecimiento",

    // Warehouse Operations Section
    "OPERATIONS.SIDEBAR.WAREHOUSE_OPERATIONS": "Operaciones de Almacén",
    "OPERATIONS.SIDEBAR.WAREHOUSES": "Almacenes",
    "OPERATIONS.SIDEBAR.RECEIVING": "Recepción de Mercancía",

    // Supply Chain Section
    "OPERATIONS.SIDEBAR.SUPPLY_CHAIN": "Cadena de Suministro",
    "OPERATIONS.SIDEBAR.PURCHASE_ORDERS": "Órdenes de Compra",
    "OPERATIONS.SIDEBAR.PROCUREMENT": "Adquisiciones",

    // Pricing Management Section
    "OPERATIONS.SIDEBAR.PRICING_MANAGEMENT": "Gestión de Precios",
    "OPERATIONS.SIDEBAR.PRICING_DASHBOARD": "Tablero de Precios",
    "OPERATIONS.SIDEBAR.SMART_BUILDER": "Constructor Inteligente",
    "OPERATIONS.SIDEBAR.CAMPAIGN_CALENDAR": "Calendario de Campañas",
    "OPERATIONS.SIDEBAR.SMART_PRICE_GRID": "Cuadrícula Inteligente de Precios",

    // Commercial Section
    "OPERATIONS.SIDEBAR.COMMERCIAL": "Comercial",
    "OPERATIONS.SIDEBAR.CUSTOMERS": "Clientes",
    "OPERATIONS.SIDEBAR.PROMOTIONS": "Promociones"
};

let addedCount = 0;
for (const [key, value] of Object.entries(operationsTranslations)) {
    setNestedKey(esJson, key, value);
    addedCount++;
    console.log(`✓ ${key} = "${value}"`);
}

fs.writeFileSync(esJsonPath, JSON.stringify(esJson, null, 2));

console.log(`\n✅ Added ${addedCount} Operations translations to es.json`);
console.log(`\n🔧 IMPORTANT: You must also update operations-navigation.config.ts`);
console.log(`   Replace hardcoded English strings with translation keys!`);
