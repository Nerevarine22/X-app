const fs = require('fs');
const html = fs.readFileSync('C:/Users/taras/.gemini/antigravity-ide/brain/7041f38a-b0a2-4a22-b41b-b4cb6b888e30/.system_generated/steps/58/content.md', 'utf8');
const regex = /href="(\/[a-z0-9\-]+)"/g;
let m;
const matches = new Set();
while ((m = regex.exec(html)) !== null) {
  matches.add(m[1]);
}
console.log(Array.from(matches).join('\n'));
