const fs = require('fs');
const path = require('path');

const projectRoot = path.join(__dirname, '../src/app');

// Map of old file ending -> new package
const MIGRATIONS = [
    { suffix: 'core/services/auth.service', newPkg: '@lib/core' },
    { suffix: 'core/services/admin-log.service', newPkg: '@lib/core' },
    { suffix: 'core/services/toast.service', newPkg: '@lib/core' },
    { suffix: 'core/services/dev-config.service', newPkg: '@lib/core' },
    { suffix: 'core/services/state-registry.service', newPkg: '@lib/core' },
    { suffix: 'core/models/user.model', newPkg: '@lib/core' },
    { suffix: 'core/models/admin-log.model', newPkg: '@lib/core' },
    { suffix: 'pages/dev-tools/services/firestore-tracker.service', newPkg: '@lib/core' },
    // Batch 3
    { suffix: 'order.service', newPkg: '@lib/core' },
    { suffix: 'inventory-ledger.service', newPkg: '@lib/core' },
    { suffix: 'user-management.service', newPkg: '@lib/core' },
    { suffix: 'staff.service', newPkg: '@lib/core' },
    { suffix: 'customer-unification.service', newPkg: '@lib/core' },
    { suffix: 'order.model', newPkg: '@lib/core' },
    { suffix: 'inventory-ledger.model', newPkg: '@lib/core' },
    { suffix: 'unified-customer.model', newPkg: '@lib/core' },
    { suffix: 'staff.model', newPkg: '@lib/core' },
    { suffix: 'purchase-order.model', newPkg: '@lib/core' },

    // Batch 4.5: Integrations
    { suffix: 'meli-order.service', newPkg: '@lib/core' },
    { suffix: 'meli-sync.service', newPkg: '@lib/core' },
    { suffix: 'meli.service', newPkg: '@lib/core' },
    { suffix: 'secrets.service', newPkg: '@lib/core' },
    { suffix: 'meli-item.model', newPkg: '@lib/core' },

    // Batch 4.6: Admin Dependencies
    { suffix: 'language.service', newPkg: '@lib/core' },
    { suffix: 'has-role.directive', newPkg: '@lib/core' },
    { suffix: 'blog.model', newPkg: '@lib/core' },
    { suffix: 'sidebar.component', newPkg: '@lib/ui-kit' },
    { suffix: 'nav-item.model', newPkg: '@lib/ui-kit' },

    // Batch 4 (UI Kit)
    { suffix: 'app-icon.component', newPkg: '@lib/ui-kit' },
    { suffix: 'metric-chart.component', newPkg: '@lib/ui-kit' },
    { suffix: 'chart-card.component', newPkg: '@lib/ui-kit' },
    { suffix: 'chart-theme', newPkg: '@lib/ui-kit' },
    { suffix: 'icons', newPkg: '@lib/ui-kit' },
];

function scanDir(dir) {
    const files = fs.readdirSync(dir);

    files.forEach(file => {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);

        if (stat.isDirectory()) {
            scanDir(fullPath);
        } else if (file.endsWith('.ts')) {
            processFile(fullPath);
        }
    });
}

function processFile(filePath) {
    let content = fs.readFileSync(filePath, 'utf8');
    let modified = false;

    MIGRATIONS.forEach(migration => {
        // Regex to match imports: from '...suffix';
        // We use a regex that allows any relative prefix
        const regex = new RegExp(`from\\s+['"][^'"]*${migration.suffix.replace(/\./g, '\\.')}['"]`, 'g');

        if (regex.test(content)) {
            // Check if we are ALREADY importing from @lib/core in this file?
            // If so, we might need to merge imports, but for now let's just replace the path.
            // Be careful if multiple imports point to @lib/core, we might end up with duplicate lines.

            content = content.replace(regex, `from '${migration.newPkg}'`);
            modified = true;
            console.log(`Updated ${migration.suffix} in ${path.basename(filePath)}`);
        }
    });

    if (modified) {
        fs.writeFileSync(filePath, content, 'utf8');
    }
}

console.log('Starting Refactor...');
scanDir(projectRoot);
console.log('Refactor Complete.');
