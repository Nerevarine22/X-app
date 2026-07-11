const fs = require('fs');

let content = fs.readFileSync('src/App.tsx', 'utf-8');
content = content.replace(/\r\n/g, '\n');

const feedBlocksStart = content.indexOf('{activeUser && (\n          <>\n');
const feedBlocksEnd = content.indexOf('          </>\n        )}', feedBlocksStart);

const feedBlocksContent = content.substring(feedBlocksStart + '{activeUser && (\n          <>\n'.length, feedBlocksEnd);

let blocks = {};
const keys = ['words', 'followings', 'firstTweet', 'popularTweet', 'mentions', 'sharedFollows'];

let currentContent = feedBlocksContent;
for (let key of keys) {
    const searchStr = '{toggles.' + key + ' && (\n';
    const startIdx = currentContent.indexOf(searchStr);
    if (startIdx !== -1) {
        let endIdxStr = '            )}\n';
        let endIdx = currentContent.indexOf(endIdxStr, startIdx);
        if (endIdx === -1) endIdx = currentContent.lastIndexOf(')}');
        
        let blockContent = currentContent.substring(startIdx + searchStr.length, endIdx);
        blockContent = blockContent.replace('<div className="tweet">', '<div key="' + key + '" className="tweet">');
        blocks[key] = 'case "' + key + '": return (' + blockContent + ');';
    }
}

const switchContent = `
  const renderFeedBlock = (key: string) => {
    if (!toggles[key as keyof typeof toggles]) return null;
    switch (key) {
      ${keys.map(k => blocks[k] || '').join('\n      ')}
      default: return null;
    }
  };
`;

const returnStart = content.indexOf('  return (\n    <div className="shell">');
content = content.substring(0, returnStart) + switchContent + content.substring(returnStart);

const newFeedBlocksStart = content.indexOf('{activeUser && (\n          <>\n');
const newFeedBlocksEnd = content.indexOf('          </>\n        )}', newFeedBlocksStart);
content = content.substring(0, newFeedBlocksStart) + '{activeUser && (\n          <>\n            {feedOrder.map(key => renderFeedBlock(key))}\n' + content.substring(newFeedBlocksEnd);

fs.writeFileSync('src/App.tsx', content);
console.log('Success');
