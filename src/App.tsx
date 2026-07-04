import React, { useState, useRef } from 'react';
import { Search, Loader2, Play, Bookmark, Download, Settings, Clock, BadgeCheck, CheckCircle2 } from 'lucide-react';
import { toPng } from 'html-to-image';
import { getCachedFollowingsFromFirebase, saveFollowingsToFirebaseCache, findSimilarUsersInFirebase, getCachedTweetFromFirebase, saveTweetToFirebaseCache, getCachedMentionsFromFirebase, saveMentionsToFirebaseCache } from './firebase';
import type { SimilarUser, MentionUser } from './firebase';

interface TwitterUser {
  userId: string;
  name: string;
  username: string;
  profileImageUrlHttps: string;
  description?: string;
}

interface Tweet {
  id: string;
  text: string;
  createdAt: string;
  viewCount: number;
  likeCount: number;
  retweetCount: number;
}

type QueryStatus = 'idle' | 'loading' | 'done' | 'error';

interface QueryState<T> {
  status: QueryStatus;
  data: T | null;
  error?: string;
}

const App: React.FC = () => {
  const [searchInput, setSearchInput] = useState('');
  const [activeUser, setActiveUser] = useState('');
  const [activeUserAvatar, setActiveUserAvatar] = useState(''); // Fetch on search

  // States for 4 queries
  const [followings, setFollowings] = useState<QueryState<TwitterUser[]>>({ status: 'idle', data: null });
  const [firstTweet, setFirstTweet] = useState<QueryState<Tweet>>({ status: 'idle', data: null });
  const [popularTweet, setPopularTweet] = useState<QueryState<Tweet>>({ status: 'idle', data: null });
  const [mentions, setMentions] = useState<QueryState<MentionUser[]>>({ status: 'idle', data: null });
  const [sharedFollows, setSharedFollows] = useState<QueryState<SimilarUser[]>>({ status: 'idle', data: null });

  // Toggles for card
  const [toggles, setToggles] = useState({ followings: true, firstTweet: false, popularTweet: false, mentions: false, sharedFollows: false });

  const posterRef = useRef<HTMLDivElement>(null);
  const [isDownloading, setIsDownloading] = useState(false);

  const getApiKey = () => {
    const apiKey = import.meta.env.VITE_TWITTERAPI_IO_KEY || import.meta.env.VITE_TWEXAPI_KEY;
    if (!apiKey) throw new Error('API key is not defined in .env');
    return apiKey;
  };

  const initSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = searchInput.trim().replace(/^@/, '');
    if (!clean) return;
    setActiveUser(clean);
    
    // Reset states
    setFollowings({ status: 'idle', data: null });
    setFirstTweet({ status: 'idle', data: null });
    setPopularTweet({ status: 'idle', data: null });
    setMentions({ status: 'idle', data: null });
    setSharedFollows({ status: 'idle', data: null });
    setActiveUserAvatar('');

    // Auto-run selected toggle(s)
    if (toggles.followings) runFollowings(clean);
    if (toggles.firstTweet) runTweet(false, clean);
    if (toggles.popularTweet) runTweet(true, clean);
    if (toggles.mentions) runMentions(clean);
    if (toggles.sharedFollows) runSharedFollows(clean);

    // Fetch avatar just for UI
    try {
      const res = await fetch(`/api/twitter/user/info?userName=${clean}`, { headers: { 'X-API-Key': getApiKey() } });
      const data = await res.json();
      const u = data.data || data.user || data;
      if (u) setActiveUserAvatar(u.profilePicture || u.profile_image_url_https || '');
    } catch(e) {}
  };

  // 1. Fetch Followings
  const runFollowings = async (usernameToFetch = activeUser) => {
    if (!usernameToFetch) return;
    setFollowings({ status: 'loading', data: null });
    try {
      const cleanUsername = usernameToFetch;
      const cacheKey = `twitter_first_follows_v2_${cleanUsername.toLowerCase()}`;
      const cachedData = localStorage.getItem(cacheKey);
      if (cachedData) {
        try {
          const parsed = JSON.parse(cachedData);
          if (parsed && parsed.length > 0) {
            setFollowings({ status: 'done', data: parsed });
            return;
          }
        } catch(e) {}
      }

      const fbCache = await getCachedFollowingsFromFirebase(cleanUsername);
      if (fbCache && fbCache.followings && fbCache.followings.length > 0) {
        setFollowings({ status: 'done', data: fbCache.followings });
        return;
      }

      const userCheck = await fetch(`/api/twitter/user/info?userName=${cleanUsername}`, { headers: { 'X-API-Key': getApiKey() } });
      if (userCheck.ok) {
        const d = await userCheck.json();
        if (d.user?.friendsCount > 3000) throw new Error('Limit is 3000 followings.');
      }

      const allFollowings: TwitterUser[] = [];
      const seenUserIds = new Set();
      let cursor = '';
      let hasNextPage = true;

      while (hasNextPage) {
        let url = `/api/twitter/user/followings?userName=${cleanUsername}`;
        if (cursor) url += `&cursor=${encodeURIComponent(cursor)}`;
        const res = await fetch(url, { headers: { 'X-API-Key': getApiKey() } });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.msg || 'Error');
        
        const items = data.followings || data.users || data.data || [];
        for (const user of items) {
          const userId = user.id || user.userId || user.user_id;
          if (userId && !seenUserIds.has(userId)) {
            seenUserIds.add(userId);
            allFollowings.push({
              userId,
              name: user.name || '',
              username: user.userName || user.username || user.screen_name || '',
              profileImageUrlHttps: user.profilePicture || user.profileImageUrlHttps || user.profile_image_url_https || user.avatar || ''
            });
          }
        }
        hasNextPage = data.has_next_page === true || data.hasNextPage === true;
        cursor = data.next_cursor || data.nextCursor;
        if (!hasNextPage || !cursor) break;
      }
      
      const oldest = allFollowings.slice(-5).reverse();
      setFollowings({ status: 'done', data: oldest });
      try { localStorage.setItem(cacheKey, JSON.stringify(oldest)); } catch(e) {}
      await saveFollowingsToFirebaseCache(cleanUsername, oldest, allFollowings.map(u=>u.username));
    } catch(e: any) {
      setFollowings({ status: 'error', data: null, error: e.message });
    }
  };

  // 2. Fetch Tweet (First or Popular)
  const runTweet = async (isPopular: boolean, usernameToFetch = activeUser) => {
    if (!usernameToFetch) return;
    const setter = isPopular ? setPopularTweet : setFirstTweet;
    setter({ status: 'loading', data: null });
    try {
      const type = isPopular ? 'popular' : 'first';
      const cleanUsername = usernameToFetch;
      
      const cached = await getCachedTweetFromFirebase(cleanUsername, type);
      if (cached) {
        if (cached.notFound) throw new Error('Not found');
        setter({ status: 'done', data: cached.tweet });
        return;
      }

      const uRes = await fetch(`/api/twitter/user/info?userName=${cleanUsername}`, { headers: { 'X-API-Key': getApiKey() } });
      const uData = await uRes.json();
      const user = uData.data || uData.user || uData;
      if (!user || !user.createdAt) throw new Error('No date');
      
      const authorData = { userId: user.id||user.rest_id, name: user.name, username: user.userName||user.screen_name, profileImageUrlHttps: user.profilePicture||user.profile_image_url_https };
      
      const startYear = new Date(user.createdAt).getFullYear();
      const currentYear = new Date().getFullYear();
      let targetYear = null;
      
      for (let y = startYear; y <= currentYear; y++) {
        const query = `from:${cleanUsername} ${isPopular ? 'min_faves:100' : ''} -filter:replies since:${y}-01-01 until:${y}-12-31`;
        const res = await fetch(`/api/twitter/tweet/advanced_search?query=${encodeURIComponent(query)}`, { headers: { 'X-API-Key': getApiKey() } });
        const d = await res.json();
        if ((d.tweets || []).length > 0) { targetYear = y; break; }
      }

      if (!targetYear) {
        await saveTweetToFirebaseCache(cleanUsername, type, { notFound: true, author: authorData });
        throw new Error('Not found');
      }

      for (let m = 1; m <= 12; m++) {
        const ms = m.toString().padStart(2, '0');
        const nms = m===12 ? '01' : (m+1).toString().padStart(2,'0');
        const ny = m===12 ? targetYear+1 : targetYear;
        const query = `from:${cleanUsername} ${isPopular ? 'min_faves:100' : ''} -filter:replies since:${targetYear}-${ms}-01 until:${ny}-${nms}-01`;
        const res = await fetch(`/api/twitter/tweet/advanced_search?query=${encodeURIComponent(query)}`, { headers: { 'X-API-Key': getApiKey() } });
        const d = await res.json();
        if ((d.tweets || []).length > 0) {
          let allT: any[] = [];
          let cursor = '';
          let hasNext = true;
          while(hasNext) {
            let url = `/api/twitter/tweet/advanced_search?query=${encodeURIComponent(query)}`;
            if(cursor) url += `&cursor=${encodeURIComponent(cursor)}`;
            const r = await fetch(url, { headers: { 'X-API-Key': getApiKey() } });
            const pData = await r.json();
            allT = [...allT, ...(pData.tweets||[])];
            if(pData.has_next_page && pData.next_cursor) cursor = pData.next_cursor;
            else hasNext = false;
          }
          const oldest = allT[allT.length - 1];
          const finalTweet: Tweet = {
            id: oldest.id || oldest.tweet_id || oldest.rest_id,
            text: oldest.text || oldest.full_text,
            createdAt: oldest.createdAt || oldest.created_at,
            viewCount: oldest.viewCount || oldest.views || 0,
            likeCount: oldest.likeCount || oldest.favorite_count || 0,
            retweetCount: oldest.retweetCount || oldest.retweet_count || 0,
          };
          setter({ status: 'done', data: finalTweet });
          await saveTweetToFirebaseCache(cleanUsername, type, { tweet: finalTweet, author: authorData });
          return;
        }
      }
      throw new Error('Not found');
    } catch(e: any) {
      setter({ status: 'error', data: null, error: e.message });
    }
  };

  // 3. Fetch Mentions
  const runMentions = async (usernameToFetch = activeUser) => {
    if (!usernameToFetch) return;
    setMentions({ status: 'loading', data: null });
    try {
      const cleanUsername = usernameToFetch;
      const cached = await getCachedMentionsFromFirebase(cleanUsername);
      if (cached) {
        setMentions({ status: 'done', data: cached });
        return;
      }

      let all: any[] = [];
      let cursor = '';
      let hasNext = true;
      let pageCount = 0;
      const maxPages = 10;
      const query = `@${cleanUsername}`;
      
      while (hasNext && pageCount < maxPages) {
        pageCount++;
        let url = `/api/twitter/tweet/advanced_search?query=${encodeURIComponent(query)}`;
        if (cursor) url += `&cursor=${encodeURIComponent(cursor)}`;
        const r = await fetch(url, { headers: { 'X-API-Key': getApiKey() } });
        const d = await r.json();
        all = [...all, ...(d.tweets||[])];
        if (d.has_next_page && d.next_cursor) cursor = d.next_cursor;
        else hasNext = false;
      }
      
      const userMap = new Map<string, MentionUser>();
      for (const tweet of all) {
        const a = tweet.author;
        if (a) {
          const uName = a.userName || a.screen_name;
          if (uName && uName.toLowerCase() !== cleanUsername.toLowerCase()) {
            if (!userMap.has(uName)) userMap.set(uName, { user: { userId: a.id||a.rest_id, name: a.name, username: uName, profileImageUrlHttps: a.profilePicture||a.profile_image_url_https }, count: 0 });
            userMap.get(uName)!.count++;
          }
        }
      }
      const sorted = Array.from(userMap.values()).sort((a, b) => b.count - a.count).slice(0, 10);
      if (sorted.length === 0) throw new Error('No mentions found');
      
      setMentions({ status: 'done', data: sorted });
      await saveMentionsToFirebaseCache(cleanUsername, sorted);
    } catch(e: any) {
      setMentions({ status: 'error', data: null, error: e.message });
    }
  };

  // 4. Fetch Shared Follows
  const runSharedFollows = async (usernameToFetch = activeUser) => {
    if (!usernameToFetch) return;
    setSharedFollows({ status: 'loading', data: null });
    try {
      const cleanUsername = usernameToFetch;
      const fbCache = await getCachedFollowingsFromFirebase(cleanUsername);
      if (!fbCache || !fbCache.allFollowingsUsernames) {
        throw new Error('Followings data not found. Run Oldest Follow first.');
      }
      const similar = await findSimilarUsersInFirebase(cleanUsername, new Set(fbCache.allFollowingsUsernames));
      if (!similar || similar.length === 0) {
        throw new Error('No shared follows found in database.');
      }
      setSharedFollows({ status: 'done', data: similar.slice(0, 5) });
    } catch(e: any) {
      setSharedFollows({ status: 'error', data: null, error: e.message });
    }
  };

  const runAll = () => {
    if(followings.status !== 'done') runFollowings(activeUser);
    if(firstTweet.status !== 'done') runTweet(false, activeUser);
    if(popularTweet.status !== 'done') runTweet(true, activeUser);
    if(mentions.status !== 'done') runMentions(activeUser);
    if(sharedFollows.status !== 'done') runSharedFollows(activeUser);
  };

  const downloadCard = async () => {
    if (!posterRef.current) return;
    try {
      setIsDownloading(true);
      const dataUrl = await toPng(posterRef.current, { quality: 1, pixelRatio: 2, backgroundColor: '#1d1f23', style: { transform: 'scale(1)' } });
      const link = document.createElement('a');
      link.download = `archive-${activeUser || 'card'}.png`;
      link.href = dataUrl;
      link.click();
    } catch (err) {
      alert('Error generating image');
    } finally {
      setIsDownloading(false);
    }
  };

  const toggle = (key: keyof typeof toggles) => {
    setToggles(prev => {
      if (prev[key]) return { ...prev, [key]: false }; // turn off

      const newState = { ...prev };
      const statuses = {
        followings: followings.status,
        firstTweet: firstTweet.status,
        popularTweet: popularTweet.status,
        mentions: mentions.status,
        sharedFollows: sharedFollows.status,
      };

      // Turn off other idle/loading/error switches
      for (const k in newState) {
        if (k !== key && statuses[k as keyof typeof statuses] !== 'done') {
          newState[k as keyof typeof toggles] = false;
        }
      }
      newState[key] = true;
      return newState;
    });
  };

  const numFound = [followings.status, firstTweet.status, popularTweet.status, mentions.status, sharedFollows.status].filter(s => s === 'done').length;

  return (
    <div className="shell">
      {/* LEFT RAIL */}
      <div className="rail">
        <div className="mark">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
            <path d="M7 3h10M7 21h10M8 3c0 4.5 8 4.5 8 9s-8 4.5-8 9M16 3c0 4.5-8 4.5-8 9s8 4.5 8 9"/>
          </svg>
        </div>
        <div className="rail-item active"><span className="rail-icon"><Search /></span> Search</div>
        <div className="rail-item"><span className="rail-icon"><Clock /></span> History</div>
        <div className="rail-item"><span className="rail-icon"><Bookmark /></span> Saved findings</div>
        <div className="rail-item"><span className="rail-icon"><Download /></span> Downloads</div>
        <div className="rail-item"><span className="rail-icon"><Settings /></span> Settings</div>
        
        <button className="rail-post" onClick={() => document.getElementById('search-input')?.focus()}>Search</button>
        
        <div className="rail-account">
          <div className="av"></div>
          <div className="info">
            <div className="n">User <BadgeCheck size={14} color="var(--accent)" /></div>
            <div className="h">@user</div>
          </div>
        </div>
      </div>

      {/* CENTER FEED */}
      <div className="feed">
        <div className="feed-header">
          <h1>{activeUser ? `@${activeUser}` : 'X Archive'}</h1>
          <p>{activeUser ? `4 queries available · ${numFound} findings on record` : 'Enter a username to begin'}</p>
        </div>

        <form className="compose" onSubmit={initSearch}>
          {activeUserAvatar ? <img src={activeUserAvatar} className="av" crossOrigin="anonymous" style={{ objectFit: 'cover' }} /> : <div className="av"></div>}
          <div className="compose-body">
            <input 
              id="search-input"
              type="text" 
              value={searchInput} 
              onChange={e => setSearchInput(e.target.value)} 
              placeholder="Look up a handle... (@username)"
              autoComplete="off"
              spellCheck="false"
            />
            <div className="compose-actions">
              <button type="submit" className="post-btn" disabled={!searchInput}>Search</button>
            </div>
          </div>
        </form>

        {activeUser && (
          <>
            {/* Oldest Follow */}
            {(toggles.followings || followings.status !== 'idle') && (
            <div className="tweet">
              {activeUserAvatar ? <img src={activeUserAvatar} className="av" /> : <div className="av"></div>}
              <div className="tweet-body">
                <div className="tweet-head">
                  <span className="name">{activeUser}</span>
                  <span className="badge blue">✓</span>
                  <span className="handle">@{activeUser}</span>
                  <span className="dot">·</span>
                  <span className="time">{followings.status === 'done' ? 'Found' : followings.status === 'error' ? 'Error' : 'Pending'}</span>
                </div>
                <div className="tweet-tag" style={{ color: followings.status === 'done' ? 'var(--accent)' : 'var(--muted)' }}>OLDEST FOLLOW</div>
                <div className="tweet-text" style={{ color: followings.status === 'done' ? 'var(--text)' : 'var(--muted)' }}>
                  {followings.status === 'done' && followings.data && followings.data.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '10px' }}>
                      {followings.data.map((u, i) => (
                        <a href={`https://x.com/${u.username}`} target="_blank" rel="noopener noreferrer" key={u.userId} style={{ display: 'flex', alignItems: 'center', gap: '10px', background: 'rgba(255,255,255,0.03)', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border)', textDecoration: 'none', color: 'inherit' }}>
                          <div style={{ width: '20px', fontSize: '12px', color: 'var(--muted)', fontWeight: 'bold' }}>{i + 1}</div>
                          {u.profileImageUrlHttps ? (
                            <img src={u.profileImageUrlHttps} crossOrigin="anonymous" style={{ width: '32px', height: '32px', borderRadius: '50%', objectFit: 'cover' }} />
                          ) : (
                            <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold' }}>{u.name.charAt(0)}</div>
                          )}
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 'bold', fontSize: '14px', color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.name}</div>
                            <div style={{ fontSize: '12.5px', color: 'var(--muted)' }}>@{u.username}</div>
                          </div>
                        </a>
                      ))}
                    </div>
                  ) : followings.status === 'loading' ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : followings.status === 'error' ? (
                    <>Error: {followings.error}</>
                  ) : (
                    <>Run this query to find out the 5 oldest followed accounts.</>
                  )}
                </div>
                <div className="tweet-actions">
                  {followings.status === 'idle' || followings.status === 'error' ? (
                    <div className="action" onClick={() => runFollowings(activeUser)}><Play size={18} /><span>Run query</span></div>
                  ) : (
                    <div className="action" style={{ color: 'var(--accent)' }}><CheckCircle2 size={18} /><span>Completed</span></div>
                  )}
                </div>
              </div>
            </div>
            )}

            {/* First Post */}
            {(toggles.firstTweet || firstTweet.status !== 'idle') && (
            <div className="tweet">
              {activeUserAvatar ? <img src={activeUserAvatar} className="av" /> : <div className="av"></div>}
              <div className="tweet-body">
                <div className="tweet-head">
                  <span className="name">{activeUser}</span>
                  <span className="badge blue">✓</span>
                  <span className="handle">@{activeUser}</span>
                  <span className="dot">·</span>
                  <span className="time">{firstTweet.status === 'done' && firstTweet.data ? new Date(firstTweet.data.createdAt).toLocaleDateString() : 'Pending'}</span>
                </div>
                <div className="tweet-tag" style={{ color: firstTweet.status === 'done' ? 'var(--accent)' : 'var(--muted)' }}>FIRST POST</div>
                <div className="tweet-text" style={{ color: firstTweet.status === 'done' ? 'var(--text)' : 'var(--muted)', whiteSpace: 'pre-wrap' }}>
                  {firstTweet.status === 'done' && firstTweet.data ? (
                    <>"{firstTweet.data.text}"</>
                  ) : firstTweet.status === 'loading' ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : firstTweet.status === 'error' ? (
                    <>Error: {firstTweet.error}</>
                  ) : (
                    <>Run this query to find the earliest preserved tweet.</>
                  )}
                </div>
                <div className="tweet-actions">
                  {firstTweet.status === 'idle' || firstTweet.status === 'error' ? (
                    <div className="action" onClick={() => runTweet(false)}><Play size={18} /><span>Run query</span></div>
                  ) : (
                    <div className="action" style={{ color: 'var(--accent)' }}><CheckCircle2 size={18} /><span>Completed</span></div>
                  )}
                </div>
              </div>
            </div>
            )}

            {/* 100 Likes */}
            {(toggles.popularTweet || popularTweet.status !== 'idle') && (
            <div className="tweet">
              {activeUserAvatar ? <img src={activeUserAvatar} className="av" /> : <div className="av"></div>}
              <div className="tweet-body">
                <div className="tweet-head">
                  <span className="name">{activeUser}</span>
                  <span className="badge gold">✓</span>
                  <span className="handle">@{activeUser}</span>
                  <span className="dot">·</span>
                  <span className="time">{popularTweet.status === 'done' && popularTweet.data ? new Date(popularTweet.data.createdAt).toLocaleDateString() : 'Pending'}</span>
                </div>
                <div className="tweet-tag" style={{ color: popularTweet.status === 'done' ? 'var(--accent)' : 'var(--muted)' }}>FIRST TO 100 LIKES</div>
                <div className="tweet-text" style={{ color: popularTweet.status === 'done' ? 'var(--text)' : 'var(--muted)', whiteSpace: 'pre-wrap' }}>
                  {popularTweet.status === 'done' && popularTweet.data ? (
                    <>"{popularTweet.data.text}"</>
                  ) : popularTweet.status === 'loading' ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : popularTweet.status === 'error' ? (
                    <>Error: {popularTweet.error}</>
                  ) : (
                    <>Run this query to find the first tweet that hit 100+ likes.</>
                  )}
                </div>
                <div className="tweet-actions">
                  {popularTweet.status === 'idle' || popularTweet.status === 'error' ? (
                    <div className="action" onClick={() => runTweet(true)}><Play size={18} /><span>Run query</span></div>
                  ) : (
                    <div className="action heart-active"><svg viewBox="0 0 24 24"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.8 1-1a5.5 5.5 0 0 0 0-7.8z"/></svg><span>{popularTweet.data?.likeCount || 100}</span></div>
                  )}
                </div>
              </div>
            </div>
            )}

            {/* Mentions */}
            {(toggles.mentions || mentions.status !== 'idle') && (
            <div className="tweet">
              {activeUserAvatar ? <img src={activeUserAvatar} className="av" /> : <div className="av"></div>}
              <div className="tweet-body">
                <div className="tweet-head">
                  <span className="name">{activeUser}</span>
                  <span className="badge outline">?</span>
                  <span className="handle">@{activeUser}</span>
                  <span className="dot">·</span>
                  <span className="time">{mentions.status === 'done' ? 'Found' : 'Pending'}</span>
                </div>
                <div className="tweet-tag" style={{ color: mentions.status === 'done' ? 'var(--accent)' : 'var(--muted)' }}>TOP TAGGER</div>
                <div className="tweet-text" style={{ color: mentions.status === 'done' ? 'var(--text)' : 'var(--muted)' }}>
                  {mentions.status === 'done' && mentions.data && mentions.data.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '10px' }}>
                      {mentions.data.map((m, i) => (
                        <a href={`https://x.com/${m.user.username}`} target="_blank" rel="noopener noreferrer" key={m.user.userId} style={{ display: 'flex', alignItems: 'center', gap: '10px', background: 'rgba(255,255,255,0.03)', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border)', textDecoration: 'none', color: 'inherit' }}>
                          <div style={{ width: '20px', fontSize: '12px', color: 'var(--muted)', fontWeight: 'bold' }}>{i + 1}</div>
                          {m.user.profileImageUrlHttps ? (
                            <img src={m.user.profileImageUrlHttps} crossOrigin="anonymous" style={{ width: '32px', height: '32px', borderRadius: '50%', objectFit: 'cover' }} />
                          ) : (
                            <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold' }}>{m.user.name.charAt(0)}</div>
                          )}
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 'bold', fontSize: '14px', color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.user.name}</div>
                            <div style={{ fontSize: '12.5px', color: 'var(--muted)' }}>@{m.user.username}</div>
                          </div>
                          <div style={{ fontSize: '13px', color: 'var(--accent)', fontWeight: 'bold' }}>{m.count} tags</div>
                        </a>
                      ))}
                    </div>
                  ) : mentions.status === 'loading' ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : mentions.status === 'error' ? (
                    <>Error: {mentions.error}</>
                  ) : (
                    <>Run this query to find out who tags this account the most.</>
                  )}
                </div>
                <div className="tweet-actions">
                  {mentions.status === 'idle' || mentions.status === 'error' ? (
                    <div className="action" onClick={() => runMentions(activeUser)}><Play size={18} /><span>Run query</span></div>
                  ) : (
                    <div className="action" style={{ color: 'var(--accent)' }}><CheckCircle2 size={18} /><span>Completed</span></div>
                  )}
                </div>
              </div>
            </div>
            )}

            {/* Shared Follows */}
            {(toggles.sharedFollows || sharedFollows.status !== 'idle') && (
            <div className="tweet">
              {activeUserAvatar ? <img src={activeUserAvatar} className="av" /> : <div className="av"></div>}
              <div className="tweet-body">
                <div className="tweet-head">
                  <span className="name">{activeUser}</span>
                  <span className="badge outline">∞</span>
                  <span className="handle">@{activeUser}</span>
                  <span className="dot">·</span>
                  <span className="time">{sharedFollows.status === 'done' ? 'Found' : 'Pending'}</span>
                </div>
                <div className="tweet-tag" style={{ color: sharedFollows.status === 'done' ? 'var(--accent)' : 'var(--muted)' }}>SHARED FOLLOWS</div>
                <div className="tweet-text" style={{ color: sharedFollows.status === 'done' ? 'var(--text)' : 'var(--muted)' }}>
                  {sharedFollows.status === 'done' && sharedFollows.data && sharedFollows.data.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '10px' }}>
                      {sharedFollows.data.map((u, i) => (
                        <a href={`https://x.com/${u.username}`} target="_blank" rel="noopener noreferrer" key={u.username} style={{ display: 'flex', alignItems: 'center', gap: '10px', background: 'rgba(255,255,255,0.03)', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border)', textDecoration: 'none', color: 'inherit' }}>
                          <div style={{ width: '20px', fontSize: '12px', color: 'var(--muted)', fontWeight: 'bold' }}>{i + 1}</div>
                          <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold' }}>{u.username.charAt(0)}</div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 'bold', fontSize: '14px', color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>@{u.username}</div>
                            <div style={{ fontSize: '12.5px', color: 'var(--muted)' }}>{u.commonCount} shared follows</div>
                          </div>
                        </a>
                      ))}
                    </div>
                  ) : sharedFollows.status === 'loading' ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : sharedFollows.status === 'error' ? (
                    <>Error: {sharedFollows.error}</>
                  ) : (
                    <>Run this query to find out who follows the same accounts.</>
                  )}
                </div>
                <div className="tweet-actions">
                  {sharedFollows.status === 'idle' || sharedFollows.status === 'error' ? (
                    <div className="action" onClick={() => runSharedFollows(activeUser)}><Play size={18} /><span>Run query</span></div>
                  ) : (
                    <div className="action" style={{ color: 'var(--accent)' }}><CheckCircle2 size={18} /><span>Completed</span></div>
                  )}
                </div>
              </div>
            </div>
            )}
          </>
        )}
      </div>

      {/* RIGHT SIDEBAR */}
      <div className="side">
        <div className="side-search">
          <Search size={16} /> Search another handle
        </div>

        <div className="widget">
          <h3>Your queries</h3>
          <div className="qitem" onClick={() => toggle('followings')}>
            <div><div className="ql">Oldest follow</div><div className="qm">{followings.status}</div></div>
            <div className={`toggle ${toggles.followings ? 'on' : ''}`}></div>
          </div>
          <div className="qitem" onClick={() => toggle('firstTweet')}>
            <div><div className="ql">First post</div><div className="qm">{firstTweet.status}</div></div>
            <div className={`toggle ${toggles.firstTweet ? 'on' : ''}`}></div>
          </div>
          <div className="qitem" onClick={() => toggle('popularTweet')}>
            <div><div className="ql">First 100 likes</div><div className="qm">{popularTweet.status}</div></div>
            <div className={`toggle ${toggles.popularTweet ? 'on' : ''}`}></div>
          </div>
          <div className="qitem" onClick={() => toggle('mentions')}>
            <div><div className="ql">Top tagger</div><div className="qm">{mentions.status}</div></div>
            <div className={`toggle ${toggles.mentions ? 'on' : ''}`}></div>
          </div>
          <div className="qitem" onClick={() => toggle('sharedFollows')}>
            <div><div className="ql">Shared follows</div><div className="qm">{sharedFollows.status}</div></div>
            <div className={`toggle ${toggles.sharedFollows ? 'on' : ''}`}></div>
          </div>
          
          <button className="see-more" onClick={runAll}>Run all queries</button>
        </div>

        <div className="widget">
          <h3 style={{ fontSize: '16px' }}>Share card preview</h3>
          <div className="poster" ref={posterRef} style={{ background: 'var(--bg-3)' }}>
            <div className="poster-top"><span>X Archive</span><span>@{activeUser || 'username'}</span></div>
            <div className="poster-grid">
              {toggles.followings && (
                <div className="poster-item">
                  <div className="k">Oldest follow</div>
                  <div className="v">{followings.status === 'done' && followings.data ? `@${followings.data[0].username}` : '-'}</div>
                </div>
              )}
              {toggles.firstTweet && (
                <div className="poster-item">
                  <div className="k">First post</div>
                  <div className="v">{firstTweet.status === 'done' && firstTweet.data ? new Date(firstTweet.data.createdAt).toLocaleDateString() : '-'}</div>
                </div>
              )}
              {toggles.popularTweet && (
                <div className="poster-item">
                  <div className="k">100 likes</div>
                  <div className="v">{popularTweet.status === 'done' && popularTweet.data ? new Date(popularTweet.data.createdAt).toLocaleDateString() : '-'}</div>
                </div>
              )}
              {toggles.mentions && (
                <div className="poster-item">
                  <div className="k">Top tagger</div>
                  <div className="v">{mentions.status === 'done' && mentions.data ? `@${mentions.data[0].user.username}` : '-'}</div>
                </div>
              )}
              {toggles.sharedFollows && (
                <div className="poster-item">
                  <div className="k">Shared follows</div>
                  <div className="v">{sharedFollows.status === 'done' && sharedFollows.data ? `@${sharedFollows.data[0].username}` : '-'}</div>
                </div>
              )}
              <div className="poster-item">
                <div className="k">Findings</div>
                <div className="v">{numFound} of 5</div>
              </div>
            </div>
          </div>
          <button className="share-btn" onClick={downloadCard} disabled={isDownloading || !activeUser}>
            {isDownloading ? 'Processing...' : 'Combine & download'}
          </button>
          <div className="foot-note">Includes only toggled-on findings</div>
        </div>
      </div>
    </div>
  );
};

export default App;
