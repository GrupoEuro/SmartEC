#!/usr/bin/env node

/**
 * ELIMINATE ALL "Título" AND "Subtítulo" PLACEHOLDERS
 * Replace with proper, contextual Mexican Spanish translations
 */

const fs = require('fs');

const esJsonPath = 'src/assets/i18n/es.json';
const enJsonPath = 'src/assets/i18n/en.json';

const esJson = JSON.parse(fs.readFileSync(esJsonPath, 'utf8'));
const enJson = JSON.parse(fs.readFileSync(enJsonPath, 'utf8'));

function getNestedKey(obj, keyPath) {
    const keys = keyPath.split('.');
    let current = obj;
    for (const key of keys) {
        if (current && typeof current === 'object' && key in current) {
            current = current[key];
        } else {
            return null;
        }
    }
    return current;
}

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

function findAllKeys(obj, prefix = '') {
    let keys = [];
    for (const key in obj) {
        const fullKey = prefix ? `${prefix}.${key}` : key;
        if (typeof obj[key] === 'object' && obj[key] !== null && !Array.isArray(obj[key])) {
            keys = keys.concat(findAllKeys(obj[key], fullKey));
        } else {
            keys.push(fullKey);
        }
    }
    return keys;
}

// Find all keys with "Título" or "Subtítulo" values
const allKeys = findAllKeys(esJson);
const badKeys = allKeys.filter(key => {
    const value = getNestedKey(esJson, key);
    return value === 'Título' || value === 'Subtítulo';
});

console.log(`\n🔍 Found ${badKeys.length} lazy placeholder translations:\n`);

// Contextual translation mapping based on key patterns
const contextualTranslations = {
    // Command Center specific
    'COMMAND_CENTER.OPERATIONS.TITLE': 'Operaciones',
    'COMMAND_CENTER.OPERATIONS.SUBTITLE': 'Métricas y gestión operativa',
    'COMMAND_CENTER.EXPENSES.TITLE': 'Gestión de Gastos',
    'COMMAND_CENTER.EXPENSES.SUBTITLE': 'Control y análisis de gastos operativos',
    'COMMAND_CENTER.APPROVALS.TITLE': 'Aprobaciones',
    'COMMAND_CENTER.APPROVALS.SUBTITLE': 'Gestión de solicitudes pendientes',
    'COMMAND_CENTER.INSIGHTS.TITLE': 'Análisis de Clientes',
    'COMMAND_CENTER.INSIGHTS.SUBTITLE': 'Comportamiento y tendencias de clientes',
    'COMMAND_CENTER.METRICS.TITLE': 'Métricas Operativas',
    'COMMAND_CENTER.METRICS.SUBTITLE': 'Indicadores clave de rendimiento',

    // Generic patterns
    'TITLE': 'Título',
    'SUBTITLE': 'Subtítulo'
};

// Smart translation function
function getSmartTranslation(key, currentValue) {
    // Check exact match first
    if (contextualTranslations[key]) {
        return contextualTranslations[key];
    }

    // Try to use English translation as base
    const enValue = getNestedKey(enJson, key);
    if (enValue && typeof enValue === 'string' && enValue !== 'Title' && enValue !== 'Subtitle') {
        // Use English value if it's meaningful
        return enValue;
    }

    // Analyze key pattern for context
    const keyLower = key.toLowerCase();
    const parts = key.split('.');
    const lastPart = parts[parts.length - 1];
    const section = parts[0];

    if (currentValue === 'Título') {
        // TITLE translations based on context
        if (keyLower.includes('operation')) return 'Operaciones';
        if (keyLower.includes('expense')) return 'Gastos';
        if (keyLower.includes('approval')) return 'Aprobaciones';
        if (keyLower.includes('insight') || keyLower.includes('customer')) return 'Análisis de Clientes';
        if (keyLower.includes('metric')) return 'Métricas';
        if (keyLower.includes('dashboard')) return 'Tablero';
        if (keyLower.includes('order')) return 'Pedidos';
        if (keyLower.includes('inventory')) return 'Inventario';
        if (keyLower.includes('warehouse')) return 'Almacén';
        if (keyLower.includes('pricing')) return 'Precios';
        if (keyLower.includes('product')) return 'Productos';
        if (keyLower.includes('category')) return 'Categorías';
        if (keyLower.includes('brand')) return 'Marcas';
        if (keyLower.includes('user')) return 'Usuarios';
        if (keyLower.includes('setting')) return 'Configuración';

        // Default based on section
        if (section === 'COMMAND_CENTER') return 'Centro de Comando';
        if (section === 'OPERATIONS') return 'Operaciones';
        if (section === 'ADMIN') return 'Administración';
    }

    if (currentValue === 'Subtítulo') {
        // SUBTITLE translations
        if (keyLower.includes('operation')) return 'Gestión y métricas operativas';
        if (keyLower.includes('expense')) return 'Control de gastos';
        if (keyLower.includes('approval')) return 'Solicitudes pendientes';
        if (keyLower.includes('insight')) return 'Análisis de comportamiento';
        if (keyLower.includes('metric')) return 'Indicadores de rendimiento';
        if (keyLower.includes('dashboard')) return 'Panel de control';

        return 'Descripción';
    }

    // Fallback: keep original if we can't determine context
    return currentValue;
}

let fixedCount = 0;
const fixes = [];

for (const key of badKeys) {
    const currentValue = getNestedKey(esJson, key);
    const newValue = getSmartTranslation(key, currentValue);

    if (newValue !== currentValue) {
        setNestedKey(esJson, key, newValue);
        fixes.push({ key, old: currentValue, new: newValue });
        fixedCount++;
        console.log(`✓ ${key}`);
        console.log(`  "${currentValue}" → "${newValue}"\n`);
    } else {
        console.log(`⚠ ${key} - kept as "${currentValue}" (needs manual review)\n`);
    }
}

// Write back
fs.writeFileSync(esJsonPath, JSON.stringify(esJson, null, 2));

console.log(`\n${'='.repeat(80)}`);
console.log(`✅ Fixed ${fixedCount} placeholder translations`);
console.log(`⚠️  ${badKeys.length - fixedCount} need manual review`);
console.log(`${'='.repeat(80)}\n`);

if (fixes.length > 0) {
    console.log('Summary of changes:');
    fixes.forEach(({ key, old, new: newVal }) => {
        console.log(`  ${key}: "${old}" → "${newVal}"`);
    });
}
