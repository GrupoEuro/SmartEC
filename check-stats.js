const fs = require('fs');
const stats = JSON.parse(fs.readFileSync('./dist/storefront/stats.json', 'utf8'));

// 1. Find the exact chunk that contains firebase/firestore
let targetChunk = null;
let targetChunkData = null;

for (const [chunkName, chunkData] of Object.entries(stats.outputs)) {
    if (chunkData.inputs && typeof chunkData.inputs === 'object') {
        for (const inputName of Object.keys(chunkData.inputs)) {
            if (inputName.includes('@firebase/firestore') || inputName.includes('@angular/fire/firestore')) {
                targetChunk = chunkName;
                targetChunkData = chunkData;
                break;
            }
        }
    }
}

if (!targetChunk) {
    console.log('Firebase Firestore is not in any chunk. Something is very wrong.');
    process.exit(1);
}

console.log('Firestore is compiled into chunk:', targetChunk);

// Is it an initial chunk? (main or polyfills)
if (targetChunk.includes('main') || targetChunkData.isEntry || (targetChunkData.imports && targetChunkData.imports.length === 0 /* sometimes root */)) {
    console.log('WARNING: Firestore is in the MAIN/INITIAL chunk.');

    // Now trace ALL app source files that ended up in this chunk that also import firestore
    console.log('\nApp files in this chunk that might be causing this:');
    const appInputs = Object.keys(targetChunkData.inputs).filter(name => name.includes('projects/storefront/src'));

    for (const file of appInputs) {
        console.log(' - ' + file);
    }
} else {
    console.log('SUCCESS: Firestore is correctly isolated in a lazy chunk.');
}
