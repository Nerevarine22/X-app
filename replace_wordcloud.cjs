const fs = require('fs');

let content = fs.readFileSync('src/App.tsx', 'utf-8');

const widgetCode = `
const WordCloudWidget = ({ wordsData, hideFooter = false }: { wordsData: any[], hideFooter?: boolean }) => {
  const topWord = wordsData[0];
  return (
    <div style={{ width: '100%', fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', padding: '10px 0' }}>
      <div style={{ color: 'var(--accent)', fontSize: '13px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '16px' }}>MOST USED WORDS</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '20px' }}>
        <div style={{ fontSize: '42px', fontWeight: 900, color: '#fff', letterSpacing: '-1.5px' }}>"{topWord.value}"</div>
        <div style={{ fontSize: '15px', color: 'var(--muted)' }}>used <span style={{color:'#fff', fontWeight:'bold'}}>{topWord.count} times</span> · most frequent word</div>
      </div>
      <div style={{ background: '#16181c', borderRadius: '16px', padding: '40px 20px', textAlign: 'center', minHeight: '280px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <TagCloud 
          minSize={16} 
          maxSize={60} 
          tags={wordsData} 
          renderer={(tag: any, size: number, color: string) => {
             const rank = wordsData.findIndex((t: any) => t.value === tag.value);
             let tagColor = '#71767b';
             let weight = 600;
             if (rank === 0) { tagColor = '#ffffff'; weight = 800; }
             else if (rank < 5) { tagColor = 'var(--accent)'; weight = 700; }
             
             return (
               <span key={tag.value} style={{ color: tagColor, fontSize: \`\${size}px\`, fontWeight: weight, padding: '4px 8px', display: 'inline-block', lineHeight: 1.2 }}>
                 {tag.value}
               </span>
             );
          }} 
        />
      </div>
      {!hideFooter && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '16px', fontSize: '13px' }}>
          <div style={{ color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 500 }}>
            <CheckCircle2 size={14} /> Verified across last 100 posts
          </div>
          <div style={{ color: 'var(--muted)' }}>x-archive.app</div>
        </div>
      )}
    </div>
  );
};
`;

// Insert the widget before "const App: React.FC = () => {"
content = content.replace("const App: React.FC = () => {", widgetCode + "\nconst App: React.FC = () => {");

// Replace the feed Word Cloud section
const feedStartIdx = content.indexOf('{toggles.words && (');
const feedEndIdxStr = '              </div>\n            </div>\n            )}';
let feedEndIdx = content.indexOf(feedEndIdxStr, feedStartIdx);
if (feedStartIdx !== -1 && feedEndIdx !== -1) {
  const replacementFeed = `{toggles.words && (
              <div style={{ paddingBottom: '20px', borderBottom: '1px solid var(--border)' }}>
                {words.status === 'done' && words.data && words.data.length > 0 ? (
                  <WordCloudWidget wordsData={words.data} />
                ) : (
                  <div className="tweet" style={{ borderBottom: 'none' }}>
                    {activeUserAvatar ? <img crossOrigin="anonymous" referrerPolicy="no-referrer" src={activeUserAvatar} className="av" /> : <div className="av"></div>}
                    <div className="tweet-body">
                      <div className="tweet-head">
                        <span className="name">{activeUser}</span>
                        <span className="badge outline">∞</span>
                        <span className="handle">@{activeUser}</span>
                        <span className="dot">·</span>
                        <span className="time">{words.status === 'loading' ? 'Pending' : 'Pending'}</span>
                      </div>
                      <div className="tweet-tag" style={{ color: 'var(--muted)' }}>WORD CLOUD</div>
                      <div className="tweet-text" style={{ color: 'var(--muted)' }}>
                        {words.status === 'loading' ? <Loader2 size={16} className="animate-spin" /> : words.status === 'error' ? <>Error: {words.error}</> : <>Run this query to build a word cloud from recent posts.</>}
                      </div>
                      <div className="tweet-actions">
                        {words.status === 'idle' || words.status === 'error' ? (
                          <div className="action" onClick={() => runWords(activeUser)}><Play size={18} /><span>Run query</span></div>
                        ) : null}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}`;
  
  content = content.substring(0, feedStartIdx) + replacementFeed + content.substring(feedEndIdx + feedEndIdxStr.length);
} else {
  console.log("Could not find feed block", feedStartIdx, feedEndIdx);
}

// Replace the poster Word Cloud section
const posterStartIdx = content.indexOf('{cardOptions.words && words.status === \'done\'');
const posterEndIdxStr = '        </div>\n      )}';
let posterEndIdx = content.indexOf(posterEndIdxStr, posterStartIdx);

if (posterStartIdx !== -1 && posterEndIdx !== -1) {
    const replacementPoster = `{cardOptions.words && words.status === 'done' && words.data && words.data.length > 0 && (
        <WordCloudWidget wordsData={words.data} hideFooter={true} />
      )}`;
    content = content.substring(0, posterStartIdx) + replacementPoster + content.substring(posterEndIdx + posterEndIdxStr.length);
} else {
    console.log("Could not find poster block");
}

fs.writeFileSync('src/App.tsx', content);
