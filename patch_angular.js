const fs = require('fs');
const path = './angular.json';
const data = JSON.parse(fs.readFileSync(path, 'utf8'));

// Internal App
const buildOptions = data.projects['internal-app'].architect.build.options;
if (!buildOptions.styles.includes("node_modules/ag-grid-community/styles/ag-grid.css")) {
    buildOptions.styles.unshift("node_modules/ag-grid-community/styles/ag-grid.css");
    buildOptions.styles.unshift("node_modules/ag-grid-community/styles/ag-theme-alpine.css");
}

fs.writeFileSync(path, JSON.stringify(data, null, 2));
console.log("Successfully patched angular.json");
