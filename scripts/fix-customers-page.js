#!/usr/bin/env node

/**
 * FIX ALL CUSTOMER PAGE TRANSLATIONS
 * Based on actual usage in customer-lookup.component.html
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
    "OPERATIONS.CUSTOMERS.TITLE": "Customer Management",
    "OPERATIONS.CUSTOMERS.COUNT_LABEL": "customers",
    "OPERATIONS.CUSTOMERS.SEARCH_PLACEHOLDER": "Search by name, email, or phone...",
    "OPERATIONS.CUSTOMERS.TYPE_ALL": "All Types",
    "OPERATIONS.CUSTOMERS.TYPE_NEW": "New Customers",
    "OPERATIONS.CUSTOMERS.TYPE_RETURNING": "Returning Customers",
    "OPERATIONS.CUSTOMERS.SPEND_ALL": "All Spend Levels",
    "OPERATIONS.CUSTOMERS.SPEND_HIGH": "High Value",
    "OPERATIONS.CUSTOMERS.SPEND_STANDARD": "Standard",
    "OPERATIONS.CUSTOMERS.CLEAR_FILTERS": "Clear Filters",
    "OPERATIONS.CUSTOMERS.EXPORT_CSV": "Export CSV",
    "OPERATIONS.CUSTOMERS.NAME": "Name",
    "OPERATIONS.CUSTOMERS.EMAIL": "Email",
    "OPERATIONS.CUSTOMERS.PHONE": "Phone",
    "OPERATIONS.CUSTOMERS.TOTAL_ORDERS": "Total Orders",
    "OPERATIONS.CUSTOMERS.TOTAL_SPEND": "Total Spend",
    "OPERATIONS.CUSTOMERS.LAST_ORDER": "Last Order",
    "OPERATIONS.CUSTOMERS.ACTIONS": "Actions",
    "OPERATIONS.CUSTOMERS.VIEW_DETAILS": "View Details",
    "OPERATIONS.CUSTOMERS.NO_DATA": "No customers found",
    "OPERATIONS.CUSTOMERS.RETRY": "Retry",
    "OPERATIONS.CUSTOMERS.AVG_ORDER_VALUE": "Avg. Order Value",
    "OPERATIONS.CUSTOMERS.LOOKUP": "Customer Lookup",
    "OPERATIONS.CUSTOMERS.ITEMS_PER_PAGE": "Items per page",
    "OPERATIONS.CUSTOMERS.SHOWING_ITEMS": "Showing {{start}} to {{end}} of {{total}} items"
};

// SPANISH translations
const esTranslations = {
    "OPERATIONS.CUSTOMERS.TITLE": "Gestión de Clientes",
    "OPERATIONS.CUSTOMERS.COUNT_LABEL": "clientes",
    "OPERATIONS.CUSTOMERS.SEARCH_PLACEHOLDER": "Buscar por nombre, correo o teléfono...",
    "OPERATIONS.CUSTOMERS.TYPE_ALL": "Todos los Tipos",
    "OPERATIONS.CUSTOMERS.TYPE_NEW": "Clientes Nuevos",
    "OPERATIONS.CUSTOMERS.TYPE_RETURNING": "Clientes Recurrentes",
    "OPERATIONS.CUSTOMERS.SPEND_ALL": "Todos los Niveles de Gasto",
    "OPERATIONS.CUSTOMERS.SPEND_HIGH": "Alto Valor",
    "OPERATIONS.CUSTOMERS.SPEND_STANDARD": "Estándar",
    "OPERATIONS.CUSTOMERS.CLEAR_FILTERS": "Limpiar Filtros",
    "OPERATIONS.CUSTOMERS.EXPORT_CSV": "Exportar CSV",
    "OPERATIONS.CUSTOMERS.NAME": "Nombre",
    "OPERATIONS.CUSTOMERS.EMAIL": "Correo Electrónico",
    "OPERATIONS.CUSTOMERS.PHONE": "Teléfono",
    "OPERATIONS.CUSTOMERS.TOTAL_ORDERS": "Total de Pedidos",
    "OPERATIONS.CUSTOMERS.TOTAL_SPEND": "Gasto Total",
    "OPERATIONS.CUSTOMERS.LAST_ORDER": "Último Pedido",
    "OPERATIONS.CUSTOMERS.ACTIONS": "Acciones",
    "OPERATIONS.CUSTOMERS.VIEW_DETAILS": "Ver Detalles",
    "OPERATIONS.CUSTOMERS.NO_DATA": "No se encontraron clientes",
    "OPERATIONS.CUSTOMERS.RETRY": "Reintentar",
    "OPERATIONS.CUSTOMERS.AVG_ORDER_VALUE": "Valor Promedio de Pedido",
    "OPERATIONS.CUSTOMERS.LOOKUP": "Búsqueda de Clientes",
    "OPERATIONS.CUSTOMERS.ITEMS_PER_PAGE": "Elementos por página",
    "OPERATIONS.CUSTOMERS.SHOWING_ITEMS": "Mostrando {{start}} a {{end}} de {{total}} elementos"
};

// Apply English
let enCount = 0;
for (const [key, value] of Object.entries(enTranslations)) {
    setNestedKey(enJson, key, value);
    enCount++;
    console.log(`✓ EN: ${key} = "${value}"`);
}

// Apply Spanish
let esCount = 0;
for (const [key, value] of Object.entries(esTranslations)) {
    setNestedKey(esJson, key, value);
    esCount++;
    console.log(`✓ ES: ${key} = "${value}"`);
}

fs.writeFileSync(enJsonPath, JSON.stringify(enJson, null, 2));
fs.writeFileSync(esJsonPath, JSON.stringify(esJson, null, 2));

console.log(`\n✅ Added ${enCount} English translations`);
console.log(`✅ Added ${esCount} Spanish translations`);
console.log(`\n🎯 Customer page is now fully translated!`);
