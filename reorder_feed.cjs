const fs = require('fs');

let content = fs.readFileSync('src/App.tsx', 'utf-8');

// 1. Add feedOrder state
if (!content.includes('feedOrder')) {
  content = content.replace(
    'const [toggles, setToggles] = useState({ followings: true, firstTweet: false, popularTweet: false, mentions: false, sharedFollows: false, words: false });',
    `const [toggles, setToggles] = useState({ followings: true, firstTweet: false, popularTweet: false, mentions: false, sharedFollows: false, words: false });
  const [feedOrder, setFeedOrder] = useState<string[]>(['words', 'followings', 'firstTweet', 'popularTweet', 'mentions', 'sharedFollows']);`
  );
}

// 2. Update toggle function to reorder
const toggleOld = `    setToggles(prev => {`;
const toggleNew = `    setFeedOrder(prevOrder => {
      const newOrder = prevOrder.filter(k => k !== key);
      newOrder.unshift(key);
      return newOrder;
    });
    setToggles(prev => {`;
content = content.replace(toggleOld, toggleNew);

// 3. Find the feed blocks
const feedBlocksStart = content.indexOf('{activeUser && (\n          <>\n');
if (feedBlocksStart !== -1) {
  // Find the end of the feed blocks
  // It should end with `</>\n        )}`
  const feedBlocksEnd = content.indexOf('          </>\n        )}', feedBlocksStart);
  
  if (feedBlocksEnd !== -1) {
    const feedBlocksContent = content.substring(feedBlocksStart + '{activeUser && (\n          <>\n'.length, feedBlocksEnd);
    
    // We'll wrap each block inside a switch case
    // First, split by `{toggles.XXXX && (`
    let blocks = {};
    const keys = ['words', 'followings', 'firstTweet', 'popularTweet', 'mentions', 'sharedFollows'];
    
    let currentContent = feedBlocksContent;
    for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        const searchStr = `{toggles.${key} && (`;
        const startIdx = currentContent.indexOf(searchStr);
        if (startIdx !== -1) {
            // Find the matching closing bracket for this block
            // It ends with `)}` at the correct indentation
            const endIdxStr = '            )}\n';
            let endIdx = currentContent.indexOf(endIdxStr, startIdx);
            // It might end differently for the last block
            if (endIdx === -1) {
                endIdx = currentContent.lastIndexOf(')}');
            }
            
            if (endIdx !== -1) {
                let blockContent = currentContent.substring(startIdx + searchStr.length, endIdx);
                // We need to add `key="${key}"` to the main div
                blockContent = blockContent.replace('<div className="tweet">', `<div key="${key}" className="tweet">`);
                blocks[key] = `case '${key}': return (${blockContent});`;
            }
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

    // Insert the switch function before the `return (` statement
    const returnStart = content.indexOf('  return (\n    <div className="shell">');
    content = content.substring(0, returnStart) + switchContent + content.substring(returnStart);
    
    // Recalculate feedBlocksStart/End since indices changed
    const newFeedBlocksStart = content.indexOf('{activeUser && (\n          <>\n');
    const newFeedBlocksEnd = content.indexOf('          </>\n        )}', newFeedBlocksStart);
    
    content = content.substring(0, newFeedBlocksStart) + `{activeUser && (\n          <>\n            {feedOrder.map(key => renderFeedBlock(key))}\n` + content.substring(newFeedBlocksEnd);
  }
}

fs.writeFileSync('src/App.tsx', content);
