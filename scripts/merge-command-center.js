const fs = require('fs');
const path = require('path');

const FILES = [
    path.join(__dirname, '../src/assets/i18n/en.json'),
    path.join(__dirname, '../src/assets/i18n/es.json')
];

function deepMerge(target, source) {
    for (const key in source) {
        if (source[key] instanceof Object && key in target) {
            Object.assign(source[key], deepMerge(target[key], source[key]));
        }
    }
    Object.assign(target || {}, source);
    return target;
}

function processFile(filePath) {
    console.log(`Processing ${path.basename(filePath)}...`);

    let content = fs.readFileSync(filePath, 'utf8');
    // Parse the JSON
    let data;
    try {
        data = JSON.parse(content);
    } catch (e) {
        console.error(`Error parsing JSON: ${e.message}`);
        // Read file again to debug if needed
        return;
    }

    if (data.OLD_COMMAND_CENTER && data.COMMAND_CENTER) {
        console.log('Found OLD_COMMAND_CENTER and COMMAND_CENTER. Merging...');

        // Merge OLD into NEW (Priority to NEW if conflict? No, priority to OLD for missing keys)
        // Actually, Block 1 (COMMAND_CENTER) has the structure.
        // Block 2 (OLD_COMMAND_CENTER) has the data (KPI, CHARTS, AI_ANALYST).
        // I want to keep Block 1's structure (MISSION_CONTROL, etc.) and ADD Block 2's data.

        // Let's merge OLD into NEW.
        // If key exists in both, which one wins?
        // Block 1: "DASHBOARD": "Main Dashboard"
        // Block 2: "DASHBOARD": "Executive Dashboard"
        // I prefer "Executive Dashboard". So OLD wins for DASHBOARD?
        // But Block 1 has "MISSION_CONTROL" (unique).
        // So Deep Merge OLD into NEW, overwriting NEW's shared keys with OLD's values?
        // Yes, Block 2 was the "Duplicate Root" one which seemed to have the specific metrics content.

        deepMerge(data.COMMAND_CENTER, data.OLD_COMMAND_CENTER);

        // Remove OLD_COMMAND_CENTER
        delete data.OLD_COMMAND_CENTER;

        console.log('Merge successful. Removed OLD_COMMAND_CENTER.');

        // Write back
        fs.writeFileSync(filePath, JSON.stringify(data, null, 4), 'utf8');
        console.log('File saved.');
    } else {
        console.log('Keys not found for merging.');
    }
}

FILES.forEach(processFile);
