const fs = require('fs');
try {
    const raw = fs.readFileSync('src/assets/i18n/es.json', 'utf8');
    const data = JSON.parse(raw);
    console.log("JSON PARSE SUCCESS");

    const keysToCheck = [
        "ADMIN.CATALOG_OVERVIEW.TITLE",
        "ADMIN.COMMON.ACTIONS",
        "ADMIN.COMMON.EDIT",
        "ADMIN.COMMON.Loading",  // Often lowercase/uppercase mismatch
        "ADMIN.CATEGORIES.TITLE",
        "ADMIN.BRANDS.TITLE",
        "ADMIN.PRODUCTS.TITLE",
        "ADMIN.OPERATIONS.TITLE"
    ];

    console.log("Checking " + keysToCheck.length + " Critical Keys in " + process.argv[2] + "...");

    let missing = 0;
    keysToCheck.forEach(path => {
        const parts = path.split('.');
        let current = data;
        let valid = true;
        for (const part of parts) {
            if (current[part] === undefined) {
                valid = false;
                break;
            }
            current = current[part];
        }
        if (valid) {
            console.log("[OK] " + path);
        } else {
            console.log("[MISSING] " + path);
            missing++;
        }
    });

    if (missing > 0) console.log("FAILED: " + missing + " keys missing.");
    else console.log("SUCCESS: All critical keys found.");
} catch (e) {
    console.error("JSON ERROR:", e.message);
    // Print context of error if possible
    if (e.message.includes('position')) {
        const pos = parseInt(e.message.match(/position (\d+)/)[1]);
        const start = Math.max(0, pos - 50);
        const end = Math.min(require('fs').statSync('src/assets/i18n/es.json').size, pos + 50);
        const fd = fs.openSync('src/assets/i18n/es.json', 'r');
        const buffer = Buffer.alloc(end - start);
        fs.readSync(fd, buffer, 0, buffer.length, start);
        console.log("Context:\n" + buffer.toString());
    }
}
