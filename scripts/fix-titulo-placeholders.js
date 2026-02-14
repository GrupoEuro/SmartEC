#!/usr/bin/env node

/**
 * Fix all "Título" and other placeholder translations
 * Replace with proper contextual Mexican Spanish
 */

const fs = require('fs');

const esJsonPath = 'src/assets/i18n/es.json';
let esJsonContent = fs.readFileSync(esJsonPath, 'utf8');
const esJson = JSON.parse(esJsonContent);

// Manual fixes for specific known bad translations
const manualFixes = {
    // Operations pages showing "Título"
    "OPERATIONS.FULFILLMENT.TITLE": "Cumplimiento de Pedidos",
    "OPERATIONS.FULFILLMENT.SUBTITLE": "Gestión y procesamiento de pedidos",

    // Pricing pages
    "OPERATIONS.PRICING.TITLE": "Gestión de Precios",
    "OPERATIONS.PRICING.SUBTITLE": "Constructor inteligente de estrategias de precios",

    // Any other "Título" instances
    "COMMAND_CENTER.TITLE": "Centro de Comando",
    "COMMAND_CENTER.SUBTITLE": "Panel de control y análisis de negocio"
};

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

// Apply manual fixes
let fixedCount = 0;
for (const [key, value] of Object.entries(manualFixes)) {
    setNestedKey(esJson, key, value);
    fixedCount++;
    console.log(`✓ Fixed: ${key} = "${value}"`);
}

// Write back
fs.writeFileSync(esJsonPath, JSON.stringify(esJson, null, 2));

console.log(`\n✅ Fixed ${fixedCount} placeholder translations`);
console.log(`\n📝 Note: Generic "Título" entries remain - they need context to translate properly`);
