#!/usr/bin/env node

/**
 * Translation Key Generator
 * Generates all missing translation keys from audit report
 */

const fs = require('fs');
const path = require('path');

// Load audit report
const auditReport = JSON.parse(fs.readFileSync('translation-audit-report.json', 'utf8'));

// Load existing translations
const enJson = JSON.parse(fs.readFileSync('src/assets/i18n/en.json', 'utf8'));
const esJson = JSON.parse(fs.readFileSync('src/assets/i18n/es.json', 'utf8'));

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

// Generate English translation from key
function generateEnglishTranslation(key) {
    const lastPart = key.split('.').pop();
    return lastPart
        .replace(/_/g, ' ')
        .toLowerCase()
        .replace(/\b\w/g, l => l.toUpperCase());
}

// Generate Spanish translation from English
function generateSpanishTranslation(englishText) {
    const translations = {
        'Title': 'Título',
        'Subtitle': 'Subtítulo',
        'Loading': 'Cargando',
        'Save': 'Guardar',
        'Cancel': 'Cancelar',
        'Delete': 'Eliminar',
        'Edit': 'Editar',
        'Create': 'Crear',
        'Search': 'Buscar',
        'Filter': 'Filtrar',
        'All': 'Todos',
        'Active': 'Activo',
        'Inactive': 'Inactivo',
        'Status': 'Estado',
        'Actions': 'Acciones',
        'Date': 'Fecha',
        'Total': 'Total',
        'Customer': 'Cliente',
        'Order': 'Pedido',
        'Product': 'Producto',
        'Price': 'Precio',
        'Quantity': 'Cantidad',
        'Name': 'Nombre',
        'Email': 'Correo Electrónico',
        'Phone': 'Teléfono',
        'Address': 'Dirección'
    };

    return translations[englishText] || englishText;
}

// Process missing keys
let enAdded = 0;
let esAdded = 0;

for (const section of ['operations', 'commandCenter', 'admin']) {
    const data = auditReport[section];

    // Add missing EN keys
    for (const item of data.missingInEn) {
        const translation = generateEnglishTranslation(item.key);
        setNestedKey(enJson, item.key, translation);
        enAdded++;
    }

    // Add missing ES keys
    for (const item of data.missingInEs) {
        const enValue = generateEnglishTranslation(item.key);
        const esValue = generateSpanishTranslation(enValue);
        setNestedKey(esJson, item.key, esValue);
        esAdded++;
    }
}

// Write updated files
fs.writeFileSync('src/assets/i18n/en.json', JSON.stringify(enJson, null, 2));
fs.writeFileSync('src/assets/i18n/es.json', JSON.stringify(esJson, null, 2));

console.log(`✅ Added ${enAdded} keys to en.json`);
console.log(`✅ Added ${esAdded} keys to es.json`);
console.log(`\n⚠️  Review and refine Spanish translations for accuracy`);
