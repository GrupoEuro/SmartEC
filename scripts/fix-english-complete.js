#!/usr/bin/env node

/**
 * COMPLETE ENGLISH TRANSLATIONS FIX
 * The English version is showing Spanish text because en.json is missing keys!
 */

const fs = require('fs');

const enJsonPath = 'src/assets/i18n/en.json';
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

// ALL ENGLISH TRANSLATIONS - PROPER ENGLISH
const englishTranslations = {
    // Operations Main
    "OPERATIONS.TITLE": "Operations",
    "OPERATIONS.LOGOUT": "Logout",
    "OPERATIONS.GO_HOME": "Go to Website",

    // Dashboard
    "OPERATIONS.DASHBOARD.TITLE": "Operations Dashboard",
    "OPERATIONS.DASHBOARD_TITLE": "Operations Dashboard",
    "OPERATIONS.DASHBOARD_SUBTITLE": "Activity overview and quick actions",

    // Order Fulfillment
    "OPERATIONS.SIDEBAR.FULFILLMENT": "Order Fulfillment",
    "OPERATIONS.SIDEBAR.ORDER_QUEUE": "Order Queue",
    "OPERATIONS.SIDEBAR.ORDERS": "Orders",
    "OPERATIONS.ORDERS.TITLE": "Order Management",

    // Inventory
    "OPERATIONS.SIDEBAR.INVENTORY": "Inventory & Logistics",
    "OPERATIONS.SIDEBAR.LOOKUP": "Inventory Lookup",
    "OPERATIONS.SIDEBAR.LOCATOR": "Product Locator",
    "OPERATIONS.SIDEBAR.CYCLE_COUNTS": "Cycle Counting",
    "OPERATIONS.SIDEBAR.ABC_ANALYSIS": "ABC Analysis",
    "OPERATIONS.SIDEBAR.REPLENISHMENT_PLANNER": "Replenishment Planner",

    // Warehouse
    "OPERATIONS.SIDEBAR.WAREHOUSE_OPERATIONS": "Warehouse Operations",
    "OPERATIONS.SIDEBAR.WAREHOUSES": "Warehouses",
    "OPERATIONS.SIDEBAR.RECEIVING": "Receiving",

    // Supply Chain
    "OPERATIONS.SIDEBAR.SUPPLY_CHAIN": "Supply Chain",
    "OPERATIONS.SIDEBAR.PURCHASE_ORDERS": "Purchase Orders",
    "OPERATIONS.SIDEBAR.PROCUREMENT": "Procurement",

    // Pricing
    "OPERATIONS.SIDEBAR.PRICING_MANAGEMENT": "Pricing Management",
    "OPERATIONS.SIDEBAR.PRICING_DASHBOARD": "Pricing Dashboard",
    "OPERATIONS.SIDEBAR.SMART_BUILDER": "Smart Builder",
    "OPERATIONS.SIDEBAR.CAMPAIGN_CALENDAR": "Campaign Calendar",
    "OPERATIONS.SIDEBAR.SMART_PRICE_GRID": "Smart Price Grid",

    // Commercial
    "OPERATIONS.SIDEBAR.COMMERCIAL": "Commercial",
    "OPERATIONS.SIDEBAR.CUSTOMERS": "Customers",
    "OPERATIONS.SIDEBAR.PROMOTIONS": "Promotions",

    // Admin Sidebar - Missing keys
    "ADMIN.SIDEBAR.PDF_LIBRARY": "PDF Library",
    "ADMIN.SIDEBAR.PDFS": "PDFs"
};

let addedCount = 0;
for (const [key, value] of Object.entries(englishTranslations)) {
    setNestedKey(enJson, key, value);
    addedCount++;
    console.log(`✓ EN: ${key} = "${value}"`);
}

fs.writeFileSync(enJsonPath, JSON.stringify(enJson, null, 2));

console.log(`\n✅ Added ${addedCount} English translations to en.json`);
