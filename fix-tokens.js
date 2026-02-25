const fs = require('fs');
const path = require('path');

function walk(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    file = path.join(dir, file);
    const stat = fs.statSync(file);
    if (stat && stat.isDirectory()) { 
      results = results.concat(walk(file));
    } else if (file.endsWith('.ts')) { 
      results.push(file);
    }
  });
  return results;
}

const files = [...walk('projects/storefront/src/app'), ...walk('projects/core/src/lib')];
let count = 0;
files.forEach(file => {
  let content = fs.readFileSync(file, 'utf8');
  let changed = false;
  
  if (content.includes("inject('FIRESTORE')")) {
    content = content.replace(/inject\('FIRESTORE'\)/g, "inject('FIRESTORE' as any)");
    changed = true;
  }
  if (content.includes("inject('AUTH')")) {
    content = content.replace(/inject\('AUTH'\)/g, "inject('AUTH' as any)");
    changed = true;
  }
  if (content.includes("inject('STORAGE')")) {
    content = content.replace(/inject\('STORAGE'\)/g, "inject('STORAGE' as any)");
    changed = true;
  }
  
  if (changed) {
    fs.writeFileSync(file, content);
    count++;
  }
});
console.log('Fixed types in ' + count + ' files');
