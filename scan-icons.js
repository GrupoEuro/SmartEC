const fs = require('fs');
const path = require('path');

// Configuration
const ROOT_DIR = path.resolve(__dirname, 'src/app'); // Adjust relative path as needed
const ICONS_FILE = path.resolve(__dirname, 'src/app/shared/components/app-icon/icons.ts');
const OUTPUT_FILE = path.resolve(__dirname, 'src/app/pages/dev-tools/icon-library/icon-data.ts');

console.log('--- Icon Scanner Started ---');

// 1. Read Defined Icons
let definedIcons = [];
try {
    const iconsContent = fs.readFileSync(ICONS_FILE, 'utf8');
    // Extract keys from object: export const ICONS: Record<string, string> = { 'key': ... }
    const match = iconsContent.match(/export const ICONS: Record<string, string> = {([\s\S]*?)};/);
    if (match && match[1]) {
        const body = match[1];
        const keyRegex = /'([^']+)'\s*:/g;
        let keyMatch;
        while ((keyMatch = keyRegex.exec(body)) !== null) {
            definedIcons.push(keyMatch[1]);
        }
    }
} catch (e) {
    console.error('Error reading icons.ts:', e);
    process.exit(1);
}

console.log(`Found ${definedIcons.length} defined icons.`);

// 2. Scan for Usage
const usageMap = new Map(); // Icon -> Set of files

function scanDir(dir) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);

        if (stat.isDirectory()) {
            scanDir(fullPath);
        } else if (file.endsWith('.html') || file.endsWith('.ts')) {
            const content = fs.readFileSync(fullPath, 'utf8');
            const relativePath = path.relative(ROOT_DIR, fullPath);

            // Patterns:
            // 1. <app-icon name="icon-name"
            // 2. [icon]="'icon-name'" (used in admin headers etc)
            // 3. icon="icon-name" (simple inputs)
            // 4. name="icon-name" (if inside app-icon, handled by #1 typically, but let's be safe with specific tag)

            // Regex 1: <app-icon ... name="XX"
            // Simple approach: Look for name="XX" or icon="XX" and check if XX is in definedIcons
            // This avoids complex parsing but might have false positives (low risk if matching exact known icons)

            // Refined Regex for typical Angular usage
            const patterns = [
                /name=["']([^"']+)["']/g, // name="icon"
                /icon=["']([^"']+)["']/g, // icon="icon"
                /['"]([^"']+)['"]\s*\|\s*translate/g // Ignore these (translation keys)
            ];

            // Scan all defined icons against the file content? 
            // Or extract strings and check if they are icons?
            // Extracting strings is better for finding "missing" icons but slower/noisier.
            // Checking defined icons against content is safer.

            // Let's iterate content with a broad regex for string literals and check against defined list
            // const stringRegex = /['"]([a-z0-9-]+)['"]/g; 

            // Actually, let's look for specific usage contexts
            const iconRegex = /(?:name|icon)\s*=\s*["']([a-z0-9-]+)["']|\[(?:name|icon)\]\s*=\s*["']([a-z0-9-]+)["']/g;

            let match;
            while ((match = iconRegex.exec(content)) !== null) {
                const iconName = match[1] || match[2]; // match[1] is standard, match[2] is binding value
                if (definedIcons.includes(iconName)) {
                    if (!usageMap.has(iconName)) usageMap.set(iconName, new Set());
                    usageMap.get(iconName).add(file); // Store filename only for brevity
                }
            }
        }
    }
}

scanDir(ROOT_DIR);

// 3. Categorize (Heuristic based on keywords or manual map)
const categories = {
    'modules': ['box', 'users', 'shopping-cart', 'file-text', 'settings', 'database', 'clipboard', 'tool', 'truck', 'gift', 'percent', 'tag'],
    'kpis': ['activity', 'trending-up', 'trending-down', 'trending-neutral', 'dollar-sign', 'pie-chart', 'bar-chart', 'trophy', 'target', 'zap', 'clock', 'wallet', 'credit-card', 'banknote'],
    'actions': ['edit', 'trash', 'trash-2', 'search', 'filter', 'download', 'upload', 'share', 'copy', 'plus', 'minus', 'x', 'check', 'refresh', 'refresh-cw', 'login', 'logout', 'eye', 'eye-off', 'save', 'bell', 'send', 'printer', 'lock', 'unlock'],
    'navigation': ['home', 'menu', 'arrow-left', 'arrow-right', 'arrow-up', 'arrow-down', 'chevron-left', 'chevron-right', 'chevron-up', 'chevron-down', 'grid', 'list', 'folder', 'map', 'globe', 'calendar'],
    'status': ['check-circle', 'x-circle', 'alert-circle', 'alert-triangle', 'info', 'help-circle', 'shield', 'wifi', 'wifi-off', 'server', 'battery', 'sun', 'moon', 'star', 'heart', 'flag']
};

// 4. Generate Output
const outputData = {
    usage: {},
    categories: categories,
    defined: definedIcons,
    stats: {
        total: definedIcons.length,
        used: usageMap.size,
        unused: definedIcons.length - usageMap.size
    }
};

usageMap.forEach((files, icon) => {
    outputData.usage[icon] = Array.from(files);
});

const fileContent = `
/**
 * AUTO-GENERATED FILE - DO NOT EDIT MANUALLY
 * Generated by scripts/scan-icons.js
 */
export const ICON_DATA = ${JSON.stringify(outputData, null, 4)};
`;

fs.writeFileSync(OUTPUT_FILE, fileContent);
console.log(`Scan complete. Data written to ${OUTPUT_FILE}`);
console.log(`Used: ${outputData.stats.used}, Unused: ${outputData.stats.unused}`);
