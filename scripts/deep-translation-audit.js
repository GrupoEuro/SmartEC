#!/usr/bin/env node

/**
 * Deep Translation Audit Script
 * Performs comprehensive line-by-line analysis of all templates
 * to find raw translation keys and missing translations
 */

const fs = require('fs');
const path = require('path');

const SECTIONS = {
    operations: 'src/app/pages/operations',
    commandCenter: 'src/app/pages/command-center',
    admin: 'src/app/pages/admin'
};

const EN_JSON_PATH = 'src/assets/i18n/en.json';
const ES_JSON_PATH = 'src/assets/i18n/es.json';

// Load translation files
let enTranslations = {};
let esTranslations = {};

try {
    enTranslations = JSON.parse(fs.readFileSync(EN_JSON_PATH, 'utf8'));
    esTranslations = JSON.parse(fs.readFileSync(ES_JSON_PATH, 'utf8'));
} catch (error) {
    console.error('Error loading translation files:', error.message);
    process.exit(1);
}

// Helper to check if a key exists in nested object
function keyExists(obj, keyPath) {
    const keys = keyPath.split('.');
    let current = obj;

    for (const key of keys) {
        if (current && typeof current === 'object' && key in current) {
            current = current[key];
        } else {
            return false;
        }
    }

    return true;
}

// Extract all translation keys from a file
function extractTranslationKeys(content, filePath) {
    const keys = new Set();

    // Pattern 1: {{ 'KEY' | translate }}
    const pattern1 = /{{\s*'([A-Z_][A-Z0-9_.]*?)'\s*\|\s*translate\s*}}/g;
    let match;
    while ((match = pattern1.exec(content)) !== null) {
        keys.add(match[1]);
    }

    // Pattern 2: [attribute]="'KEY' | translate"
    const pattern2 = /\[[\w-]+\]\s*=\s*"'([A-Z_][A-Z0-9_.]*?)'\s*\|\s*translate"/g;
    while ((match = pattern2.exec(content)) !== null) {
        keys.add(match[1]);
    }

    // Pattern 3: translate pipe in interpolation with parameters
    const pattern3 = /{{\s*'([A-Z_][A-Z0-9_.]*?)'\s*\|\s*translate\s*:\s*{/g;
    while ((match = pattern3.exec(content)) !== null) {
        keys.add(match[1]);
    }

    return Array.from(keys);
}

// Find all HTML files in a directory
function findHtmlFiles(dir) {
    const files = [];

    function walk(currentPath) {
        if (!fs.existsSync(currentPath)) return;

        const items = fs.readdirSync(currentPath);

        for (const item of items) {
            const fullPath = path.join(currentPath, item);
            const stat = fs.statSync(fullPath);

            if (stat.isDirectory()) {
                walk(fullPath);
            } else if (item.endsWith('.component.html')) {
                files.push(fullPath);
            }
        }
    }

    walk(dir);
    return files;
}

// Main audit function
function auditSection(sectionName, sectionPath) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`AUDITING: ${sectionName.toUpperCase()}`);
    console.log('='.repeat(80));

    const htmlFiles = findHtmlFiles(sectionPath);
    console.log(`Found ${htmlFiles.length} component templates\n`);

    const missingInEn = [];
    const missingInEs = [];
    const allKeys = new Set();

    for (const file of htmlFiles) {
        const relativePath = file.replace(process.cwd() + '/', '');
        const content = fs.readFileSync(file, 'utf8');
        const keys = extractTranslationKeys(content, file);

        if (keys.length === 0) continue;

        console.log(`\n📄 ${relativePath}`);
        console.log(`   Found ${keys.length} translation keys`);

        for (const key of keys) {
            allKeys.add(key);
            const inEn = keyExists(enTranslations, key);
            const inEs = keyExists(esTranslations, key);

            if (!inEn) {
                missingInEn.push({ file: relativePath, key });
                console.log(`   ❌ EN: ${key}`);
            }

            if (!inEs) {
                missingInEs.push({ file: relativePath, key });
                console.log(`   ❌ ES: ${key}`);
            }

            if (inEn && inEs) {
                console.log(`   ✅ ${key}`);
            } else if (inEn && !inEs) {
                console.log(`   ⚠️  ${key} (missing in ES only)`);
            }
        }
    }

    return {
        sectionName,
        totalFiles: htmlFiles.length,
        totalKeys: allKeys.size,
        missingInEn,
        missingInEs
    };
}

// Run audit
console.log('\n🔍 DEEP TRANSLATION AUDIT');
console.log('Starting comprehensive line-by-line analysis...\n');

const results = {};

for (const [name, path] of Object.entries(SECTIONS)) {
    results[name] = auditSection(name, path);
}

// Generate summary report
console.log('\n\n' + '='.repeat(80));
console.log('AUDIT SUMMARY');
console.log('='.repeat(80));

let totalMissingEn = 0;
let totalMissingEs = 0;

for (const [section, data] of Object.entries(results)) {
    console.log(`\n${section.toUpperCase()}:`);
    console.log(`  Files Scanned: ${data.totalFiles}`);
    console.log(`  Unique Keys Found: ${data.totalKeys}`);
    console.log(`  Missing in EN: ${data.missingInEn.length}`);
    console.log(`  Missing in ES: ${data.missingInEs.length}`);

    totalMissingEn += data.missingInEn.length;
    totalMissingEs += data.missingInEs.length;
}

console.log('\n' + '-'.repeat(80));
console.log(`TOTAL MISSING IN EN: ${totalMissingEn}`);
console.log(`TOTAL MISSING IN ES: ${totalMissingEs}`);
console.log('-'.repeat(80));

// Write detailed report to file
const reportPath = 'translation-audit-report.json';
fs.writeFileSync(reportPath, JSON.stringify(results, null, 2));
console.log(`\n✅ Detailed report saved to: ${reportPath}`);

// Exit with error code if missing translations found
if (totalMissingEn > 0 || totalMissingEs > 0) {
    console.log('\n⚠️  Translation gaps detected!');
    process.exit(1);
} else {
    console.log('\n✅ All translations are complete!');
    process.exit(0);
}
