#!/usr/bin/env node

/**
 * FINAL COMPREHENSIVE TRANSLATION FIX
 * Scans all HTML files for ANY translation keys and ensures they exist in es.json
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

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

function getNestedKey(obj, keyPath) {
    const keys = keyPath.split('.');
    let current = obj;

    for (const key of keys) {
        if (current && typeof current === 'object' && key in current) {
            current = current[key];
        } else {
            return undefined;
        }
    }

    return current;
}

// Find all HTML files
const htmlFiles = execSync('find src/app -name "*.html"', { encoding: 'utf8' })
    .trim()
    .split('\n')
    .filter(f => f);

console.log(`Scanning ${htmlFiles.length} HTML files...`);

const allKeys = new Set();

// Extract all translation keys
for (const file of htmlFiles) {
    const content = fs.readFileSync(file, 'utf8');

    // Pattern 1: {{ 'KEY' | translate }}
    const pattern1 = /{{\s*'([A-Z_][A-Z0-9_.]*?)'\s*\|\s*translate/g;
    let match;
    while ((match = pattern1.exec(content)) !== null) {
        allKeys.add(match[1]);
    }

    // Pattern 2: [attr]="'KEY' | translate"
    const pattern2 = /\[[\w-]+\]\s*=\s*"'([A-Z_][A-Z0-9_.]*?)'\s*\|\s*translate"/g;
    while ((match = pattern2.exec(content)) !== null) {
        allKeys.add(match[1]);
    }
}

console.log(`Found ${allKeys.size} unique translation keys\n`);

// Check which keys are missing in es.json
const missingKeys = [];
for (const key of allKeys) {
    if (getNestedKey(esJson, key) === undefined) {
        missingKeys.push(key);
    }
}

console.log(`Missing in es.json: ${missingKeys.length} keys\n`);

if (missingKeys.length === 0) {
    console.log('✅ All keys already exist!');
    process.exit(0);
}

// Add missing keys
let addedCount = 0;
for (const key of missingKeys) {
    // Try to get English value
    const enValue = getNestedKey(enJson, key);

    if (enValue && typeof enValue === 'string') {
        // Use English as base, will need manual translation
        setNestedKey(esJson, key, enValue);
        console.log(`✓ ${key} = "${enValue}" (from EN)`);
        addedCount++;
    } else {
        // Generate placeholder
        const lastPart = key.split('.').pop();
        const placeholder = lastPart.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, l => l.toUpperCase());
        setNestedKey(esJson, key, placeholder);
        console.log(`⚠ ${key} = "${placeholder}" (PLACEHOLDER - needs translation)`);
        addedCount++;
    }
}

// Write updated file
fs.writeFileSync(esJsonPath, JSON.stringify(esJson, null, 2));

console.log(`\n✅ Added ${addedCount} missing keys to es.json`);
console.log(`\n⚠️  IMPORTANT: ${missingKeys.length} keys need proper Mexican Spanish translation`);
