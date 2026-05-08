const fs = require('fs');
const path = require('path');

const srcDir = './projects/internal-app/src/app/pages/command-center';
const localeFile = './projects/storefront/src/assets/i18n/es.json';

const esData = JSON.parse(fs.readFileSync(localeFile, 'utf8'));

// Helper to get nested key
function hasNestedKey(obj, path) {
    const keys = path.split('.');
    let current = obj;
    for (let key of keys) {
        if (current === undefined || current === null) return false;
        current = current[key];
    }
    return current !== undefined;
}

// Read all files recursively
function walkSync(dir, filelist = []) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const filepath = path.join(dir, file);
        if (fs.statSync(filepath).isDirectory()) {
            filelist = walkSync(filepath, filelist);
        } else {
            filelist.push(filepath);
        }
    }
    return filelist;
}

const files = walkSync(srcDir);
const keyPattern = /'COMMAND_CENTER\.[A-Z0-Z_.]+'/g;
const missingKeys = new Set();

files.forEach(file => {
    if (!file.endsWith('.ts') && !file.endsWith('.html')) return;
    const content = fs.readFileSync(file, 'utf8');
    let match;
    while ((match = keyPattern.exec(content)) !== null) {
        let keyStr = match[0].replace(/'/g, '');
        if (!hasNestedKey(esData, keyStr)) {
            missingKeys.add(keyStr);
        }
    }
});

console.log("Missing Keys:", Array.from(missingKeys));
