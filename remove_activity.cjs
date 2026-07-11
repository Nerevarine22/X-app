const fs = require('fs');
let content = fs.readFileSync('src/App.tsx', 'utf-8');

// 1. imports
content = content.replace("import { ActivityCalendar } from 'react-activity-calendar';\n", '');

// 2. runActivityAndWords -> runWords
content = content.replace(/const runActivityAndWords = async \((.*?)\) => {/, 'const runWords = async ($1) => {');
content = content.replace(/runActivityAndWords\(/g, 'runWords(');

// 3. getCachedActivityAndWordsFromFirebase
content = content.replace('getCachedActivityAndWordsFromFirebase, saveActivityAndWordsToFirebaseCache', 'getCachedWordsFromFirebase, saveWordsToFirebaseCache');
content = content.replace('await getCachedActivityAndWordsFromFirebase', 'await getCachedWordsFromFirebase');
content = content.replace('saveActivityAndWordsToFirebaseCache(cleanUsername, activityData, wordsData)', 'saveWordsToFirebaseCache(cleanUsername, wordsData)');

// 4. remove setActivity inside runWords
content = content.replace(/\\s*setActivity\\(\\{[^}]+\\}\\);/g, '');

// 5. numFound calculation
content = content.replace(', activity.status, words.status]', ', words.status]');

// 6. remove the whole activity generation block
const activityBlockStart = content.indexOf('      // Activity Map');
const activityBlockEnd = content.indexOf('      // Word Cloud');
if (activityBlockStart !== -1 && activityBlockEnd !== -1) {
  content = content.substring(0, activityBlockStart) + content.substring(activityBlockEnd);
}

// 7. remove from toggles and card options (some might be left if they were formatted differently)
content = content.replace(/, activity: false/g, '');
content = content.replace(/, activity: true/g, '');

// 8. remove the big JSX blocks
const jsxFeedStart = content.indexOf('{toggles.activity && (');
if (jsxFeedStart !== -1) {
  const wordsStart = content.indexOf('{toggles.words && (', jsxFeedStart);
  if (wordsStart !== -1) {
    content = content.substring(0, jsxFeedStart) + content.substring(wordsStart);
  }
}

const jsxCardStart = content.indexOf("{cardOptions.activity && activity.status === 'done' && activity.data && (");
if (jsxCardStart !== -1) {
  const cardEnd = content.indexOf('          <div className="label">Word Cloud</div>', jsxCardStart);
  if (cardEnd !== -1) {
    // Find previous {cardOptions.words...
    const wordsOptionStart = content.lastIndexOf('{cardOptions.words', cardEnd);
    if (wordsOptionStart > jsxCardStart) {
        content = content.substring(0, jsxCardStart) + content.substring(wordsOptionStart);
    }
  }
}

const jsxSidebarStart = content.indexOf('<div className="qitem" onClick={() => toggle(\'activity\')}>');
if (jsxSidebarStart !== -1) {
  const sidebarWordsStart = content.indexOf('<div className="qitem" onClick={() => toggle(\'words\')}>', jsxSidebarStart);
  if (sidebarWordsStart !== -1) {
    content = content.substring(0, jsxSidebarStart) + content.substring(sidebarWordsStart);
  }
}

// 9. remove from card generation map logic
content = content.replace("k === 'activity' ? 'Activity Map' : ", "");
content = content.replace("if (k === 'activity') return activity.status === 'done';\n", "");

fs.writeFileSync('src/App.tsx', content);
