const fs = require('fs');
const path = require('path');
const glob = require('glob');

const EN_PATH = path.join(__dirname, '../src/assets/i18n/en.json');
const ES_PATH = path.join(__dirname, '../src/assets/i18n/es.json');
const SRC_PATH = path.join(__dirname, '../src/app/pages/admin/**/*.+(html|ts)');

function auditUsage() {
    console.log('📂 Scanning files in /admin...');

    // 1. Load Translation Files
    let enJson, esJson;
    try {
        enJson = JSON.parse(fs.readFileSync(EN_PATH, 'utf8'));
        esJson = JSON.parse(fs.readFileSync(ES_PATH, 'utf8'));
    } catch (e) {
        console.error('❌ Error reading JSON files:', e.message);
        process.exit(1);
    }

    // 2. Scan Code for Keys
    const codeKeys = new Set();
    const files = glob.sync(SRC_PATH);

    const patterns = [
        /['"]([A-Z0-9_.]+)['"]\s*\|\s*translate/g,
        /translate\.get\(['"]([A-Z0-9_.]+)['"]\)/g,
        /translate\.instant\(['"]([A-Z0-9_.]+)['"]\)/g,
        /translate\.stream\(['"]([A-Z0-9_.]+)['"]\)/g
    ];

    files.forEach(file => {
        const content = fs.readFileSync(file, 'utf8');
        patterns.forEach(regex => {
            let match;
            while ((match = regex.exec(content)) !== null) {
                const key = match[1];
                // basic filter to avoid noise
                if (key && key.length > 2 && !key.includes(' ') && !key.startsWith('http') && !key.startsWith('/')) {
                    if (!key.includes('{{') && !key.includes('}}')) { // Ignore dynamic keys
                        codeKeys.add(key);
                    }
                }
            }
        });
    });

    console.log(`📊 Found ${codeKeys.size} unique keys in source code.`);

    // 3. Verify Keys
    const missingInEn = [];
    const missingInEs = [];

    // Helper to check deep keys
    const getValue = (obj, path) => {
        return path.split('.').reduce((acc, part) => acc && acc[part], obj);
    };

    codeKeys.forEach(key => {
        const inEn = getValue(enJson, key);
        const inEs = getValue(esJson, key);

        if (!inEn) missingInEn.push(key);
        if (!inEs) missingInEs.push(key);
    });

    // 4. Report Code Scan Results
    if (missingInEn.length > 0) {
        console.log('\n🔴 MISSING IN EN (Code vs EN):');
        missingInEn.forEach(k => console.log(`  - ${k}`));
    } else {
        console.log('\n✅ EN Code Coverage: 100%');
    }

    if (missingInEs.length > 0) {
        console.log('\n🔴 MISSING IN ES (Code vs ES - THESE SHOW AS RAW KEYS):');
        missingInEs.forEach(k => console.log(`  - ${k}`));
    } else {
        console.log('\n✅ ES Code Coverage: 100%');
    }

    // 5. Parity Check (Keys present in EN but not in ES)
    // This helps identify keys that might be unused in code scan (dynamic) but still missing in ES
    console.log('\n⚠️  PARITY CHECK (In EN but missing in ES):');

    function flatten(obj, prefix = '') {
        let acc = {};
        for (const k in obj) {
            if (typeof obj[k] === 'object' && obj[k] !== null) {
                Object.assign(acc, flatten(obj[k], prefix + k + '.'));
            } else {
                acc[prefix + k] = obj[k];
            }
        }
        return acc;
    }

    const flatEn = flatten(enJson);
    const parityMissing = [];

    Object.keys(flatEn).forEach(key => {
        // Only check ADMIN and COMMON to verify the relevant sections
        if (key.startsWith('ADMIN.') || key.startsWith('COMMON.')) {
            if (!getValue(esJson, key)) {
                parityMissing.push(key);
            }
        }
    });

    if (parityMissing.length > 0) {
        console.log(`Found ${parityMissing.length} keys in EN that are missing in ES:`);
        parityMissing.forEach(k => console.log(`  - ${k}`));
    } else {
        console.log('✅ EN <-> ES Parity Check Passed for ADMIN/COMMON');
    }

}

auditUsage();
