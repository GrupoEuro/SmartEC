#!/usr/bin/env node

/**
 * Add remaining admin sidebar sub-menu translations
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

const remainingTranslations = {
    "ADMIN.SIDEBAR.CATALOG_OVERVIEW": "Resumen del Catálogo",
    "ADMIN.SIDEBAR.PRODUCT_TYPES": "Tipos de Producto",
    "ADMIN.SIDEBAR.STAFF": "Personal"
};

let addedCount = 0;
for (const [key, value] of Object.entries(remainingTranslations)) {
    setNestedKey(esJson, key, value);
    addedCount++;
    console.log(`✓ Added: ${key} = "${value}"`);
}

fs.writeFileSync(esJsonPath, JSON.stringify(esJson, null, 2));

console.log(`\n✅ Successfully added ${addedCount} remaining admin sidebar translations`);
