#!/usr/bin/env node

/**
 * FIX ALL REMAINING RAW KEYS
 * Based on user screenshots showing:
 * - ADMIN.SIDEBAR.PDF_LIBRARY (showing as raw key)
 * - OPERATIONS.ORDERS.* keys (showing in Orders page)
 */

const fs = require('fs');

const esJsonPath = 'src/assets/i18n/es.json';
const enJsonPath = 'src/assets/i18n/en.json';

const esJson = JSON.parse(fs.readFileSync(esJsonPath, 'utf8'));
const enJson = JSON.parse(fs.readFileSync(enJsonPath, 'utf8'));

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

// ENGLISH translations
const enTranslations = {
    "OPERATIONS.ORDERS.STATUS.ALL": "All Orders",
    "OPERATIONS.ORDERS.STATUS.UNASSIGNED": "Unassigned",
    "OPERATIONS.ORDERS.STATUS.PENDING": "Pending",
    "OPERATIONS.ORDERS.STATUS.PROCESSING": "Processing",
    "OPERATIONS.ORDERS.MY_ORDERS": "My Orders",
    "OPERATIONS.ORDERS.SEARCH_PLACEHOLDER": "Search orders...",
    "OPERATIONS.ORDERS.DATE_RANGE": "Date Range",
    "OPERATIONS.ORDERS.ALL_PRIORITIES": "All Priorities",
    "OPERATIONS.ORDERS.ALL_SLA": "All SLA",
    "OPERATIONS.ORDERS.ALL_CHANNELS": "All Channels",
    "OPERATIONS.ORDERS.EXPORT_CSV": "Export CSV",
    "OPERATIONS.ORDERS.CREATE_ORDER": "Create Order",
    "OPERATIONS.ORDERS.HELP": "Help"
};

// SPANISH translations
const esTranslations = {
    "OPERATIONS.ORDERS.STATUS.ALL": "Todos los Pedidos",
    "OPERATIONS.ORDERS.STATUS.UNASSIGNED": "Sin Asignar",
    "OPERATIONS.ORDERS.STATUS.PENDING": "Pendiente",
    "OPERATIONS.ORDERS.STATUS.PROCESSING": "En Proceso",
    "OPERATIONS.ORDERS.MY_ORDERS": "Mis Pedidos",
    "OPERATIONS.ORDERS.SEARCH_PLACEHOLDER": "Buscar pedidos...",
    "OPERATIONS.ORDERS.DATE_RANGE": "Rango de Fechas",
    "OPERATIONS.ORDERS.ALL_PRIORITIES": "Todas las Prioridades",
    "OPERATIONS.ORDERS.ALL_SLA": "Todos los SLA",
    "OPERATIONS.ORDERS.ALL_CHANNELS": "Todos los Canales",
    "OPERATIONS.ORDERS.EXPORT_CSV": "Exportar CSV",
    "OPERATIONS.ORDERS.CREATE_ORDER": "Crear Pedido",
    "OPERATIONS.ORDERS.HELP": "Ayuda"
};

// Apply English
let enCount = 0;
for (const [key, value] of Object.entries(enTranslations)) {
    setNestedKey(enJson, key, value);
    enCount++;
}

// Apply Spanish
let esCount = 0;
for (const [key, value] of Object.entries(esTranslations)) {
    setNestedKey(esJson, key, value);
    esCount++;
}

fs.writeFileSync(enJsonPath, JSON.stringify(enJson, null, 2));
fs.writeFileSync(esJsonPath, JSON.stringify(esJson, null, 2));

console.log(`✅ Added ${enCount} English translations`);
console.log(`✅ Added ${esCount} Spanish translations`);
console.log(`\n🔍 Total: ${enCount + esCount} translations added`);
