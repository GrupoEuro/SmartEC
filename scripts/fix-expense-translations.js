#!/usr/bin/env node

/**
 * COMPLETE EXPENSE MANAGEMENT TRANSLATIONS
 * All keys found in expense-management.component.html
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

const expenseTranslations = {
    // Views
    "COMMAND_CENTER.EXPENSES.VIEW_CARDS": "Vista de Tarjetas",
    "COMMAND_CENTER.EXPENSES.VIEW_TABLE": "Vista de Tabla",

    // Actions
    "COMMAND_CENTER.EXPENSES.ACTIONS.EXPORT": "Exportar",
    "COMMAND_CENTER.EXPENSES.ACTIONS.EXPORT_CSV": "Exportar CSV",
    "COMMAND_CENTER.EXPENSES.ACTIONS.EXPORT_EXCEL": "Exportar Excel",
    "COMMAND_CENTER.EXPENSES.ACTIONS.DELETE": "Eliminar",
    "COMMAND_CENTER.EXPENSES.ACTIONS.CLEAR": "Limpiar Selección",

    // Search & Filters
    "COMMAND_CENTER.EXPENSES.SEARCH": "Buscar",
    "COMMAND_CENTER.EXPENSES.SEARCH_PLACEHOLDER": "Buscar por descripción, proveedor...",
    "COMMAND_CENTER.EXPENSES.ALL_CATEGORIES": "Todas las Categorías",

    // Metrics
    "COMMAND_CENTER.EXPENSES.EXPENSES": "Gastos",
    "COMMAND_CENTER.EXPENSES.SELECTED": "seleccionados",

    // Table Headers
    "COMMAND_CENTER.EXPENSES.TABLE.DATE": "Fecha",
    "COMMAND_CENTER.EXPENSES.TABLE.CATEGORY": "Categoría",
    "COMMAND_CENTER.EXPENSES.TABLE.DESCRIPTION": "Descripción",
    "COMMAND_CENTER.EXPENSES.TABLE.VENDOR": "Proveedor",
    "COMMAND_CENTER.EXPENSES.TABLE.AMOUNT": "Monto",
    "COMMAND_CENTER.EXPENSES.TABLE.RECURRING": "Recurrente",
    "COMMAND_CENTER.EXPENSES.TABLE.ACTIONS": "Acciones",

    // Pagination
    "COMMAND_CENTER.EXPENSES.PAGINATION.SHOWING": "Mostrando {{start}} a {{end}} de {{total}}",
    "COMMAND_CENTER.EXPENSES.PAGINATION.PREVIOUS": "Anterior",
    "COMMAND_CENTER.EXPENSES.PAGINATION.NEXT": "Siguiente",
    "COMMAND_CENTER.EXPENSES.PAGINATION.PAGE_OF": "Página {{current}} de {{total}}",
    "COMMAND_CENTER.EXPENSES.PAGINATION.PER_PAGE": "{{count}} por página",

    // Empty State
    "COMMAND_CENTER.EXPENSES.NO_EXPENSES": "No hay gastos registrados",
    "COMMAND_CENTER.EXPENSES.NO_EXPENSES_DESC": "Comienza agregando tu primer gasto para llevar un control de tus finanzas",
    "COMMAND_CENTER.EXPENSES.ADD_FIRST": "Agregar Primer Gasto",

    // Form
    "COMMAND_CENTER.EXPENSES.EDIT_EXPENSE": "Editar Gasto",
    "COMMAND_CENTER.EXPENSES.FORM.CATEGORY": "Categoría",
    "COMMAND_CENTER.EXPENSES.FORM.AMOUNT": "Monto",
    "COMMAND_CENTER.EXPENSES.FORM.DESCRIPTION": "Descripción",
    "COMMAND_CENTER.EXPENSES.FORM.DATE": "Fecha",
    "COMMAND_CENTER.EXPENSES.FORM.VENDOR": "Proveedor",
    "COMMAND_CENTER.EXPENSES.FORM.RECURRING": "Gasto Recurrente",
    "COMMAND_CENTER.EXPENSES.FORM.FREQUENCY": "Frecuencia",
    "COMMAND_CENTER.EXPENSES.FORM.MONTHLY": "Mensual",
    "COMMAND_CENTER.EXPENSES.FORM.QUARTERLY": "Trimestral",
    "COMMAND_CENTER.EXPENSES.FORM.YEARLY": "Anual",
    "COMMAND_CENTER.EXPENSES.FORM.NOTES": "Notas",
    "COMMAND_CENTER.EXPENSES.FORM.CANCEL": "Cancelar",
    "COMMAND_CENTER.EXPENSES.FORM.SAVE": "Guardar Gasto",

    // Additional Admin Sidebar
    "ADMIN.SIDEBAR.LOGOUT": "Cerrar Sesión",
    "ADMIN.SIDEBAR.SECTION_CATALOG": "Catálogo",
    "ADMIN.SIDEBAR.MEDIA_LIBRARY": "Biblioteca de Medios"
};

let addedCount = 0;
for (const [key, value] of Object.entries(expenseTranslations)) {
    setNestedKey(esJson, key, value);
    addedCount++;
}

fs.writeFileSync(esJsonPath, JSON.stringify(esJson, null, 2));

console.log(`✅ Added ${addedCount} expense management translations`);
