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
  
  if (content.includes('inject(Firestore)')) {
    content = content.replace(/inject\(Firestore\)/g, "inject('FIRESTORE') as Firestore");
    changed = true;
  }
  if (content.includes('inject(Auth)')) {
    content = content.replace(/inject\(Auth\)/g, "inject('AUTH') as Auth");
    changed = true;
  }
  if (content.includes('inject(Storage)')) {
    content = content.replace(/inject\(Storage\)/g, "inject('STORAGE') as Storage");
    changed = true;
  }
  
  if (changed) {
    fs.writeFileSync(file, content);
    count++;
  }
});
console.log('Updated ' + count + ' files');
