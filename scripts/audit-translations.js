const fs = require('fs');
const path = require('path');
const glob = require('glob');

const EN_PATH = path.join(__dirname, '../src/assets/i18n/en.json');
const ES_PATH = path.join(__dirname, '../src/assets/i18n/es.json');
const SRC_PATH = path.join(__dirname, '../src/app/**/*.+(html|ts)');

function flattenObject(ob) {
    var toReturn = {};
    for (var i in ob) {
        if (!ob.hasOwnProperty(i)) continue;

        if ((typeof ob[i]) == 'object' && ob[i] !== null) {
            var flatObject = flattenObject(ob[i]);
            for (var x in flatObject) {
                if (!flatObject.hasOwnProperty(x)) continue;
                toReturn[i + '.' + x] = flatObject[x];
            }
        } else {
            toReturn[i] = ob[i];
        }
    }
    return toReturn;
}

function auditTranslations() {
    console.log('🔍 Starting Deep Translation Audit...\n');

    if (!fs.existsSync(EN_PATH) || !fs.existsSync(ES_PATH)) {
        console.error('❌ Error: Translation files not found!');
        return;
    }

    const enRaw = JSON.parse(fs.readFileSync(EN_PATH, 'utf8'));
    const esRaw = JSON.parse(fs.readFileSync(ES_PATH, 'utf8'));

    const enFlat = flattenObject(enRaw);
    const esFlat = flattenObject(esRaw);

    const enKeys = Object.keys(enFlat);
    const esKeys = Object.keys(esFlat);

    const missingInEs = enKeys.filter(key => !esKeys.includes(key));
    const extraInEs = esKeys.filter(key => !enKeys.includes(key));
    const emptyInEs = esKeys.filter(key => esFlat[key] === '');
    const sameAsKey = esKeys.filter(key => {
        const lastPart = key.split('.').pop();
        return esFlat[key] === lastPart || esFlat[key] === key;
    });

    console.log(`📊 Stats:
    - English Keys: ${enKeys.length}
    - Spanish Keys: ${esKeys.length}
    `);

    if (missingInEs.length > 0) {
        console.log('🔴 MISSING IN SPANISH (Action Required):');
        missingInEs.forEach(k => console.log(`  - ${k}`));
        console.log('');
    }

    if (emptyInEs.length > 0) {
        console.log('🟠 EMPTY VALUES IN SPANISH (Action Required):');
        emptyInEs.forEach(k => console.log(`  - ${k}`));
        console.log('');
    }

    if (sameAsKey.length > 0) {
        console.log('🟡 POTENTIAL UNTRANSLATED (Value == Key):');
        sameAsKey.forEach(k => console.log(`  - ${k}`));
        console.log('');
    }

    if (extraInEs.length > 0) {
        console.log('⚪️ ORPHANED IN SPANISH (Cleanup Recommended):');
        extraInEs.forEach(k => console.log(`  - ${k}`));
        console.log('');
    }

    console.log('✅ Audit Complete.');
}

auditTranslations();
