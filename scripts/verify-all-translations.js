#!/usr/bin/env node

/**
 * COMPREHENSIVE KEY EXTRACTION AND VERIFICATION
 * Extract EVERY translation key from ALL HTML files
 * Cross-check against ACTUAL values in en.json and es.json
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

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

// Find all HTML files
const htmlFiles = execSync('find src/app -name "*.html" -type f', { encoding: 'utf8' })
    .trim()
    .split('\n')
    .filter(f => f);

console.log(`\n🔍 Scanning ${htmlFiles.length} HTML files for translation keys...\n`);

const allKeys = new Set();
const keyUsage = new Map();

// Extract all translation keys
for (const file of htmlFiles) {
    const content = fs.readFileSync(file, 'utf8');

    // Pattern 1: {{ 'KEY' | translate }}
    const pattern1 = /{{\s*'([A-Z_][A-Z0-9_.]*?)'\s*\|\s*translate/g;
    let match;
    while ((match = pattern1.exec(content)) !== null) {
        allKeys.add(match[1]);
        if (!keyUsage.has(match[1])) keyUsage.set(match[1], []);
        keyUsage.get(match[1]).push(file);
    }

    // Pattern 2: [attr]="'KEY' | translate"
    const pattern2 = /\[[\w-]+\]\s*=\s*"'([A-Z_][A-Z0-9_.]*?)'\s*\|\s*translate"/g;
    while ((match = pattern2.exec(content)) !== null) {
        allKeys.add(match[1]);
        if (!keyUsage.has(match[1])) keyUsage.set(match[1], []);
        keyUsage.get(match[1]).push(file);
    }

    // Pattern 3: translate pipe with parameters
    const pattern3 = /{{\s*'([A-Z_][A-Z0-9_.]*?)'\s*\|\s*translate\s*:/g;
    while ((match = pattern3.exec(content)) !== null) {
        allKeys.add(match[1]);
        if (!keyUsage.has(match[1])) keyUsage.set(match[1], []);
        keyUsage.get(match[1]).push(file);
    }
}

console.log(`📊 Found ${allKeys.size} unique translation keys\n`);

// Check each key
const missingInEN = [];
const missingInES = [];
const badSpanish = []; // Keys with "Título", "Subtítulo", or other placeholders

for (const key of allKeys) {
    const enValue = getNestedKey(enJson, key);
    const esValue = getNestedKey(esJson, key);

    if (!enValue) {
        missingInEN.push(key);
    }

    if (!esValue) {
        missingInES.push(key);
    } else if (typeof esValue === 'string') {
        // Check for lazy placeholders
        if (esValue === 'Título' || esValue === 'Subtítulo' ||
            esValue === 'Title' || esValue === 'Subtitle' ||
            esValue.includes('Placeholder') || esValue.includes('placeholder')) {
            badSpanish.push({ key, value: esValue, files: keyUsage.get(key) });
        }
    }
}

console.log(`\n${'='.repeat(80)}`);
console.log(`VERIFICATION RESULTS`);
console.log(`${'='.repeat(80)}\n`);

console.log(`✅ Total keys found: ${allKeys.size}`);
console.log(`❌ Missing in EN: ${missingInEN.length}`);
console.log(`❌ Missing in ES: ${missingInES.length}`);
console.log(`⚠️  Bad Spanish (placeholders): ${badSpanish.length}\n`);

if (missingInEN.length > 0) {
    console.log(`\n🚨 MISSING IN ENGLISH (en.json):\n`);
    missingInEN.forEach(key => {
        console.log(`  - ${key}`);
        console.log(`    Used in: ${keyUsage.get(key)[0]}`);
    });
}

if (missingInES.length > 0) {
    console.log(`\n🚨 MISSING IN SPANISH (es.json):\n`);
    missingInES.forEach(key => {
        console.log(`  - ${key}`);
        console.log(`    Used in: ${keyUsage.get(key)[0]}`);
    });
}

if (badSpanish.length > 0) {
    console.log(`\n⚠️  BAD SPANISH TRANSLATIONS (placeholders):\n`);
    badSpanish.forEach(({ key, value, files }) => {
        console.log(`  - ${key} = "${value}"`);
        console.log(`    Used in: ${files[0]}`);
    });
}

// Save detailed report
const report = {
    totalKeys: allKeys.size,
    missingInEN,
    missingInES,
    badSpanish: badSpanish.map(b => ({ key: b.key, value: b.value })),
    keyUsage: Object.fromEntries(keyUsage)
};

fs.writeFileSync('translation-verification-report.json', JSON.stringify(report, null, 2));

console.log(`\n📝 Detailed report saved to: translation-verification-report.json\n`);

if (missingInEN.length === 0 && missingInES.length === 0 && badSpanish.length === 0) {
    console.log(`✅ ALL TRANSLATIONS ARE COMPLETE AND PROPER!\n`);
} else {
    console.log(`❌ TRANSLATIONS NEED FIXING!\n`);
}
