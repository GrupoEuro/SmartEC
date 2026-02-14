#!/usr/bin/env node

/**
 * COMPREHENSIVE FIX - All visible raw translation keys
 * Based on user screenshots showing actual problems
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

// ALL OPERATIONS SIDEBAR TRANSLATIONS
const operationsSidebar = {
    "OPERATIONS.SIDEBAR.TITLE": "Operaciones",
    "OPERATIONS.SIDEBAR.FULFILLMENT": "Cumplimiento de Pedidos",
    "OPERATIONS.SIDEBAR.ORDER_QUEUE": "Cola de Pedidos",
    "OPERATIONS.SIDEBAR.INVENTORY": "Inventario",
    "OPERATIONS.SIDEBAR.LOOKUP": "Búsqueda de Inventario",
    "OPERATIONS.SIDEBAR.KARDEX": "Kardex",
    "OPERATIONS.SIDEBAR.CYCLE_COUNT": "Conteo Cíclico",
    "OPERATIONS.SIDEBAR.ADJUSTMENTS": "Ajustes",
    "OPERATIONS.SIDEBAR.WAREHOUSE": "Almacén",
    "OPERATIONS.SIDEBAR.PROCUREMENT": "Adquisiciones",
    "OPERATIONS.SIDEBAR.RECEIVING": "Recepción",
    "OPERATIONS.SIDEBAR.PUTAWAY": "Almacenamiento"
};

// REMAINING ADMIN SIDEBAR
const adminSidebar = {
    "ADMIN.SIDEBAR.THEMES": "Temas",
    "ADMIN.SIDEBAR.LOGS": "Registros de Actividad"
};

// COMMAND CENTER - OPERATIONAL METRICS
const commandCenterOperations = {
    "COMMAND_CENTER.OPERATIONS.TITLE": "Métricas Operacionales",
    "COMMAND_CENTER.OPERATIONS.SUBTITLE": "Rendimiento y eficiencia de operaciones"
};

// COMMAND CENTER - EXPENSE MANAGEMENT
const commandCenterExpenses = {
    "COMMAND_CENTER.EXPENSES.TITLE": "Gestión de Gastos",
    "COMMAND_CENTER.EXPENSES.SUBTITLE": "Control y análisis de gastos operativos",
    "COMMAND_CENTER.EXPENSES.ADD_EXPENSE": "Agregar Gasto",
    "COMMAND_CENTER.EXPENSES.CATEGORY": "Categoría",
    "COMMAND_CENTER.EXPENSES.AMOUNT": "Monto",
    "COMMAND_CENTER.EXPENSES.DATE": "Fecha",
    "COMMAND_CENTER.EXPENSES.DESCRIPTION": "Descripción",
    "COMMAND_CENTER.EXPENSES.RECURRING": "Recurrente",
    "COMMAND_CENTER.EXPENSES.TOTAL_EXPENSES": "Gastos Totales",
    "COMMAND_CENTER.EXPENSES.MONTHLY_AVG": "Promedio Mensual",
    "COMMAND_CENTER.EXPENSES.TOP_CATEGORY": "Categoría Principal",
    "COMMAND_CENTER.EXPENSES.CATEGORIES.RENT": "Renta",
    "COMMAND_CENTER.EXPENSES.CATEGORIES.UTILITIES": "Servicios",
    "COMMAND_CENTER.EXPENSES.CATEGORIES.SALARIES": "Salarios",
    "COMMAND_CENTER.EXPENSES.CATEGORIES.MARKETING": "Marketing",
    "COMMAND_CENTER.EXPENSES.CATEGORIES.SUPPLIES": "Suministros",
    "COMMAND_CENTER.EXPENSES.CATEGORIES.INSURANCE": "Seguros",
    "COMMAND_CENTER.EXPENSES.CATEGORIES.MAINTENANCE": "Mantenimiento",
    "COMMAND_CENTER.EXPENSES.CATEGORIES.OTHER": "Otros"
};

// Combine all translations
const allTranslations = {
    ...operationsSidebar,
    ...adminSidebar,
    ...commandCenterOperations,
    ...commandCenterExpenses
};

let addedCount = 0;
for (const [key, value] of Object.entries(allTranslations)) {
    setNestedKey(esJson, key, value);
    addedCount++;
    console.log(`✓ ${key} = "${value}"`);
}

fs.writeFileSync(esJsonPath, JSON.stringify(esJson, null, 2));

console.log(`\n✅ Successfully added ${addedCount} translations`);
console.log(`\n🔍 Next: Check browser to verify all raw keys are gone`);
