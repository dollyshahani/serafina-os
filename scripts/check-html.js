const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const match = html.match(/<script>([\s\S]*)<\/script>/);

if (!match) {
  throw new Error('Inline script not found in index.html');
}

new Function(match[1]);
console.log('Serafina OS inline JS syntax OK');
