const fs = require('fs');
const path = require('path');

function walk(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    file = path.join(dir, file);
    if (fs.statSync(file).isDirectory()) { 
      results = results.concat(walk(file));
    } else if (file.endsWith('.ts')) { 
      results.push(file);
    }
  });
  return results;
}

const files = [...walk('projects/storefront/src/app'), ...walk('projects/core/src/lib')];
files.forEach(file => {
  let content = fs.readFileSync(file, 'utf8');
  let changed = false;
  
  if (content.includes("injector.get('FIRESTORE' as any)")) {
    content = content.replace(/injector\.get\('FIRESTORE' as any\)(?! as Firestore)/g, "injector.get('FIRESTORE' as any) as Firestore");
    changed = true;
  }
  if (content.includes("injector.get('AUTH' as any)")) {
    content = content.replace(/injector\.get\('AUTH' as any\)(?! as Auth)/g, "injector.get('AUTH' as any) as Auth");
    changed = true;
  }
  if (content.includes("injector.get('STORAGE' as any)")) {
    content = content.replace(/injector\.get\('STORAGE' as any\)(?! as Storage)/g, "injector.get('STORAGE' as any) as Storage");
    changed = true;
  }
  
  // also add ! to the return statement if it's there
  if (content.match(/return this\._firestore;/)) {
    content = content.replace(/return this\._firestore;/g, "return this._firestore!;");
    changed = true;
  }
  if (content.match(/return this\._auth;/)) {
    content = content.replace(/return this\._auth;/g, "return this._auth!;");
    changed = true;
  }
  if (content.match(/return this\._storage;/)) {
    content = content.replace(/return this\._storage;/g, "return this._storage!;");
    changed = true;
  }

  if (changed) {
    fs.writeFileSync(file, content);
  }
});
console.log('Fixed typescript casts');
