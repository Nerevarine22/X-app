const fs = require('fs');

const lines = fs.readFileSync('src/App.tsx', 'utf-8').split('\n');

const startIndex = lines.findIndex(l => l.includes('{activeUser && ('));
const endIndex = lines.findIndex((l, i) => i > startIndex && l.includes('</>') && lines[i+1].includes(')}'));

if (startIndex === -1 || endIndex === -1) {
    console.error('Could not find bounds');
    process.exit(1);
}

// Extract the content
let feedBlocksLines = lines.slice(startIndex + 2, endIndex); // skip {activeUser && ( and <>

let content = feedBlocksLines.join('\n');

const keys = ['words', 'followings', 'firstTweet', 'popularTweet', 'mentions', 'sharedFollows'];

for (let key of keys) {
    const searchStr = '{toggles.' + key + ' && (';
    content = content.replace(searchStr, 'case "' + key + '": return (');
    
    // The block ends with `)}` at the same indentation level.
    // In our case it's 12 spaces usually.
    const endSearchStr = '            )}';
    let endIdx = content.indexOf(endSearchStr, content.indexOf('case "' + key + '": return ('));
    if (endIdx !== -1) {
        content = content.substring(0, endIdx) + '            );' + content.substring(endIdx + endSearchStr.length);
    }
}

content = content.replace(/<div className="tweet">/g, (match, offset, str) => {
    // Find which case we are in by looking backwards
    let sectionKey = '';
    for (let key of keys) {
        if (str.lastIndexOf('case "' + key + '":', offset) > str.lastIndexOf('return (', offset) - 30) {
            sectionKey = key;
            break;
        }
    }
    // Just replace the first one after the case
    return '<div key={key} className="tweet">';
});

// Now wrap it
const wrappedContent = `            {feedOrder.map(key => {
              if (!toggles[key as keyof typeof toggles]) return null;
              switch (key) {
` + content + `
                default: return null;
              }
            })}`;

const newLines = [
    ...lines.slice(0, startIndex + 1),
    '          <>',
    wrappedContent,
    '          </>',
    ...lines.slice(endIndex + 1)
];

fs.writeFileSync('src/App.tsx', newLines.join('\n'));
console.log('Success');
