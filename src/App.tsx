import React, { useState } from 'react';
import { Search, Loader2, Users, ArrowRight, MessageCircle, FileText, TrendingUp, Megaphone } from 'lucide-react';
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

type Mode = 'followings' | 'first_tweet' | 'popular_tweet' | 'mentions';

const App: React.FC = () => {
  const [mode, setMode] = useState<Mode>('followings');
  const [username, setUsername] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [progressText, setProgressText] = useState('');

  // States for followings mode
  const [followings, setFollowings] = useState<TwitterUser[]>([]);
  const [similarUsers, setSimilarUsers] = useState<SimilarUser[]>([]);

  // States for tweet modes
  // States for tweet modes
  const [foundTweet, setFoundTweet] = useState<Tweet | null>(null);
  const [author, setAuthor] = useState<TwitterUser | null>(null);

  // States for mentions mode
  const [topMentions, setTopMentions] = useState<MentionUser[]>([]);

  const getApiKey = () => {
    const apiKey = import.meta.env.VITE_TWITTERAPI_IO_KEY || import.meta.env.VITE_TWEXAPI_KEY;
    if (!apiKey) throw new Error('API key is not defined in .env');
    if (apiKey.includes('localhost')) throw new Error('Please update .env with your real TwitterAPI.io key.');
    return apiKey;
  };

  const fetchFollowings = async (cleanUsername: string) => {
    setFollowings([]);
    setSimilarUsers([]);
    setProgressText('Підключаюся до TwitterAPI.io...');

    const cacheKey = `twitter_first_follows_v2_${cleanUsername.toLowerCase()}`;
    const cachedData = localStorage.getItem(cacheKey);
    if (cachedData) {
      try {
        const parsedCache = JSON.parse(cachedData);
        if (parsedCache && parsedCache.length > 0) {
          setProgressText('Завантажено з локального кешу ⚡');
          setFollowings(parsedCache);
          
          // Check Firebase in background to get similar users
          const firebaseCache = await getCachedFollowingsFromFirebase(cleanUsername);
          if (firebaseCache && firebaseCache.allFollowingsUsernames && firebaseCache.allFollowingsUsernames.length > 0) {
             const similar = await findSimilarUsersInFirebase(cleanUsername, new Set(firebaseCache.allFollowingsUsernames as string[]));
             setSimilarUsers(similar);
          }
          
          setLoading(false);
          return;
        }
      } catch(e) {}
    }

    setProgressText('Перевіряю глобальний кеш (Firebase)...');
    const firebaseCache = await getCachedFollowingsFromFirebase(cleanUsername);
    if (firebaseCache && firebaseCache.followings && firebaseCache.followings.length > 0) {
      setProgressText('Завантажено з глобального кешу 🔥. Шукаю збіги...');
      setFollowings(firebaseCache.followings);
      try { localStorage.setItem(cacheKey, JSON.stringify(firebaseCache.followings)); } catch (e) {}
      
      const usernamesSet = new Set(firebaseCache.allFollowingsUsernames || []);
      if (usernamesSet.size > 0) {
        const similar = await findSimilarUsersInFirebase(cleanUsername, usernamesSet as Set<string>);
        setSimilarUsers(similar);
      }
      return;
    }

    setProgressText('Перевіряю існування профілю...');
    const userCheckResponse = await fetch(`/api/twitter/user/info?userName=${cleanUsername}`, {
      headers: { 'X-API-Key': getApiKey() }
    });
    
    if (userCheckResponse.ok) {
      const userData = await userCheckResponse.json();
      if (userData.user?.friendsCount > 3000) {
        throw new Error(`User has ${userData.user.friendsCount} followings. Limit is 3000 to save API credits.`);
      }
    }

    setProgressText('Починаю завантаження списку...');
    await new Promise(resolve => setTimeout(resolve, 200));

    const allFollowings: TwitterUser[] = [];
    const seenUserIds = new Set();
    let cursor = '';
    let hasNextPage = true;
    let pageCount = 0;

    while (hasNextPage) {
      pageCount++;
      setProgressText(`Завантаження сторінки ${pageCount}... Отримано ${allFollowings.length}`);

      let url = `/api/twitter/user/followings?userName=${cleanUsername}`;
      if (cursor) url += `&cursor=${encodeURIComponent(cursor)}`;

      const response = await fetch(url, { headers: { 'X-API-Key': getApiKey() } });
      const data = await response.json();

      if (!response.ok || (data.code !== 0 && data.status !== 'success' && data.code !== 200)) {
        throw new Error(`API Error: ${data?.msg || data?.message || 'Unknown error'}`);
      }

      const items = data.followings || data.users || data.data || [];
      for (const user of items) {
        const userId = user.id || user.userId || user.user_id;
        if (userId && !seenUserIds.has(userId)) {
          seenUserIds.add(userId);
          allFollowings.push({
            userId,
            name: user.name || '',
            username: user.userName || user.username || user.screen_name || '',
            profileImageUrlHttps: user.profilePicture || user.profileImageUrlHttps || user.profile_image_url_https || user.profile_image_url || '',
            description: user.description || ''
          });
        }
      }

      hasNextPage = data.has_next_page === true || data.hasNextPage === true;
      cursor = data.next_cursor || data.nextCursor;
      if (!hasNextPage || !cursor) break;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    
    setProgressText(`Завершено! Отримано ${allFollowings.length} підписок.`);
    const oldestFollowings = allFollowings.slice(-5).reverse();
    setFollowings(oldestFollowings);
    
    try { localStorage.setItem(cacheKey, JSON.stringify(oldestFollowings)); } catch(e) {}

    const allUsernames = allFollowings.map(u => u.username);
    await saveFollowingsToFirebaseCache(cleanUsername, oldestFollowings, allUsernames);
    
    setProgressText('Шукаю схожі профілі в базі...');
    const similar = await findSimilarUsersInFirebase(cleanUsername, new Set(allUsernames));
    setSimilarUsers(similar);
  };

  const findTweet = async (cleanUsername: string, isPopular: boolean) => {
    setFoundTweet(null);
    setAuthor(null);
    setProgressText('Перевіряю кеш...');
    
    const type = isPopular ? 'popular' : 'first';
    const cachedTweet = await getCachedTweetFromFirebase(cleanUsername, type);
    if (cachedTweet) {
      setProgressText('Завантажено з глобального кешу 🔥');
      setFoundTweet(cachedTweet.tweet);
      setAuthor(cachedTweet.author);
      return;
    }

    setProgressText('Отримую дані профілю...');
    const userInfoRes = await fetch(`/api/twitter/user/info?userName=${cleanUsername}`, {
      headers: { 'X-API-Key': getApiKey() }
    });
    
    if (!userInfoRes.ok) throw new Error('Не вдалося знайти користувача');
    const userData = await userInfoRes.json();
    const user = userData.data || userData.user || userData;
    if (!user || !user.createdAt) throw new Error('Не вдалося отримати дату реєстрації');
    
    const authorData = {
      userId: user.id || user.rest_id,
      name: user.name,
      username: user.userName || user.screen_name,
      profileImageUrlHttps: user.profilePicture || user.profile_image_url_https
    };
    setAuthor(authorData);

    const createdYear = new Date(user.createdAt).getFullYear();
    const currentYear = new Date().getFullYear();
    
    // We search from the year they created the account
    const startYear = createdYear;

    let targetYear = null;
    
    // Step 1: Find the Year
    for (let y = startYear; y <= currentYear; y++) {
      setProgressText(`Сканую рік: ${y}...`);
      const query = `from:${cleanUsername} ${isPopular ? 'min_faves:100' : ''} -filter:replies since:${y}-01-01 until:${y}-12-31`;
      const res = await fetch(`/api/twitter/tweet/advanced_search?query=${encodeURIComponent(query)}`, {
        headers: { 'X-API-Key': getApiKey() }
      });
      const data = await res.json();
      const tweets = data.tweets || [];
      if (tweets.length > 0) {
        targetYear = y;
        break;
      }
    }

    if (!targetYear) {
      throw new Error(isPopular ? 'Не знайдено твітів з 100+ лайків' : 'Твітів не знайдено');
    }

    // Step 2: Find the Month
    for (let m = 1; m <= 12; m++) {
      const monthStr = m.toString().padStart(2, '0');
      const nextMonthStr = m === 12 ? '01' : (m + 1).toString().padStart(2, '0');
      const nextYearStr = m === 12 ? targetYear + 1 : targetYear;
      
      setProgressText(`Сканую місяць: ${monthStr}.${targetYear}...`);
      const query = `from:${cleanUsername} ${isPopular ? 'min_faves:100' : ''} -filter:replies since:${targetYear}-${monthStr}-01 until:${nextYearStr}-${nextMonthStr}-01`;
      const res = await fetch(`/api/twitter/tweet/advanced_search?query=${encodeURIComponent(query)}`, {
        headers: { 'X-API-Key': getApiKey() }
      });
      const data = await res.json();
      const tweets = data.tweets || [];
      if (tweets.length > 0) {
        // Since we found the month, we just fetch all pages for this month and find the absolute oldest
        setProgressText(`Знайдено місяць! Завантажую всі твіти за ${monthStr}.${targetYear}...`);
        
        let allMonthTweets: any[] = [];
        let cursor = '';
        let hasNext = true;
        
        while (hasNext) {
          let url = `/api/twitter/tweet/advanced_search?query=${encodeURIComponent(query)}`;
          if (cursor) url += `&cursor=${encodeURIComponent(cursor)}`;
          const r = await fetch(url, { headers: { 'X-API-Key': getApiKey() } });
          const d = await r.json();
          const pagedTweets = d.tweets || [];
          allMonthTweets = [...allMonthTweets, ...pagedTweets];
          
          if (d.has_next_page && d.next_cursor) {
            cursor = d.next_cursor;
          } else {
            hasNext = false;
          }
        }
        
        // Twitter returns newest first, so the oldest is the very last one
        const oldestTweet = allMonthTweets[allMonthTweets.length - 1];
        
        const finalTweet: Tweet = {
          id: oldestTweet.id || oldestTweet.tweet_id || oldestTweet.rest_id,
          text: oldestTweet.text || oldestTweet.full_text,
          createdAt: oldestTweet.createdAt || oldestTweet.created_at,
          viewCount: oldestTweet.viewCount || oldestTweet.views || 0,
          likeCount: oldestTweet.likeCount || oldestTweet.favorite_count || 0,
          retweetCount: oldestTweet.retweetCount || oldestTweet.retweet_count || 0,
        };
        
        setFoundTweet(finalTweet);
        await saveTweetToFirebaseCache(cleanUsername, type, { tweet: finalTweet, author: authorData });
        return;
      }
    }
  };

  const fetchMentions = async (cleanUsername: string) => {
    setTopMentions([]);
    setProgressText('Перевіряю глобальний кеш (Firebase)...');
    
    const cachedMentions = await getCachedMentionsFromFirebase(cleanUsername);
    if (cachedMentions) {
      setProgressText('Завантажено з глобального кешу 🔥');
      setTopMentions(cachedMentions);
      return;
    }

    setProgressText('Завантажую згадки (це може зайняти до хвилини)...');
    
    let allMentions: any[] = [];
    let cursor = '';
    let hasNext = true;
    let pageCount = 0;
    const maxPages = 10;
    const query = `@${cleanUsername}`;
    
    while (hasNext && pageCount < maxPages) {
      pageCount++;
      setProgressText(`Завантажую сторінку ${pageCount} з ${maxPages}...`);
      
      let url = `/api/twitter/tweet/advanced_search?query=${encodeURIComponent(query)}`;
      if (cursor) url += `&cursor=${encodeURIComponent(cursor)}`;
      
      const r = await fetch(url, { headers: { 'X-API-Key': getApiKey() } });
      const d = await r.json();
      
      if (!r.ok || d.tweets === undefined) {
        throw new Error(`API Error: ${d?.msg || d?.message || 'Unknown error'}`);
      }

      const pagedTweets = d.tweets || [];
      allMentions = [...allMentions, ...pagedTweets];
      
      if (d.has_next_page && d.next_cursor) {
        cursor = d.next_cursor;
      } else {
        hasNext = false;
      }
      
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    
    setProgressText('Аналізую авторів...');
    const userMap = new Map<string, MentionUser>();
    
    for (const tweet of allMentions) {
      const authorObj = tweet.author;
      if (authorObj) {
        const authorUsername = authorObj.userName || authorObj.screen_name;
        if (authorUsername && authorUsername.toLowerCase() !== cleanUsername.toLowerCase()) {
          if (!userMap.has(authorUsername)) {
            userMap.set(authorUsername, {
              user: {
                userId: authorObj.id || authorObj.rest_id,
                name: authorObj.name,
                username: authorUsername,
                profileImageUrlHttps: authorObj.profilePicture || authorObj.profile_image_url_https
              },
              count: 0
            });
          }
          userMap.get(authorUsername)!.count++;
        }
      }
    }
    
    const sortedMentions = Array.from(userMap.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
      
    if (sortedMentions.length === 0) {
      throw new Error('Не знайдено жодної згадки (або профіль прихований)');
    }
      
    setTopMentions(sortedMentions);
    await saveMentionsToFirebaseCache(cleanUsername, sortedMentions);
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanUsername = username.trim().replace(/^@/, '');
    if (!cleanUsername) return;
    
    setLoading(true);
    setError(null);
    setHasSearched(true);
    
    try {
      if (mode === 'followings') {
        await fetchFollowings(cleanUsername);
      } else if (mode === 'mentions') {
        await fetchMentions(cleanUsername);
      } else {
        await findTweet(cleanUsername, mode === 'popular_tweet');
      }
    } catch (err: any) {
      setError(err.message || 'An error occurred while fetching data');
      setProgressText('');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container animate-fade-in">
      <header style={{ textAlign: 'center', marginBottom: '2rem' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '64px', height: '64px', borderRadius: '20px', background: 'rgba(29, 161, 242, 0.1)', color: 'var(--primary)', marginBottom: '1.5rem' }}>
          <MessageCircle size={32} />
        </div>
        <h1 style={{ fontSize: '2.5rem', fontWeight: 700, marginBottom: '1rem', letterSpacing: '-0.02em' }}>
          Twitter <span style={{ color: 'var(--primary)' }}>Explorer</span>
        </h1>
      </header>

      <div style={{ display: 'flex', justifyContent: 'center', gap: '1rem', marginBottom: '2rem' }}>
        <button 
          onClick={() => { setMode('followings'); setHasSearched(false); }}
          style={{ padding: '0.75rem 1.5rem', borderRadius: '12px', background: mode === 'followings' ? 'var(--primary)' : 'rgba(255,255,255,0.05)', color: 'white', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem', transition: 'all 0.2s' }}
        >
          <Users size={18} /> Підписки
        </button>
        <button 
          onClick={() => { setMode('first_tweet'); setHasSearched(false); }}
          style={{ padding: '0.75rem 1.5rem', borderRadius: '12px', background: mode === 'first_tweet' ? 'var(--primary)' : 'rgba(255,255,255,0.05)', color: 'white', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem', transition: 'all 0.2s' }}
        >
          <FileText size={18} /> Перший Твіт
        </button>
        <button 
          onClick={() => { setMode('popular_tweet'); setHasSearched(false); }}
          style={{ padding: '0.75rem 1.5rem', borderRadius: '12px', background: mode === 'popular_tweet' ? 'var(--primary)' : 'rgba(255,255,255,0.05)', color: 'white', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem', transition: 'all 0.2s' }}
        >
          <TrendingUp size={18} /> 100 Лайків
        </button>
        <button 
          onClick={() => { setMode('mentions'); setHasSearched(false); }}
          style={{ padding: '0.75rem 1.5rem', borderRadius: '12px', background: mode === 'mentions' ? 'var(--primary)' : 'rgba(255,255,255,0.05)', color: 'white', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem', transition: 'all 0.2s' }}
        >
          <Megaphone size={18} /> Топ Згадки
        </button>
      </div>

      <form onSubmit={handleSearch} className="glass-panel delay-100" style={{ display: 'flex', padding: '0.75rem', gap: '0.75rem', marginBottom: '2.5rem', animation: 'fadeIn 0.4s ease-out 100ms forwards' }}>
        <div style={{ position: 'relative', flex: 1 }}>
          <div style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }}>
            <Search size={20} />
          </div>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Введіть @username"
            style={{ 
              width: '100%', 
              padding: '1rem 1rem 1rem 3rem', 
              background: 'rgba(0,0,0,0.2)', 
              border: '1px solid rgba(255,255,255,0.05)', 
              borderRadius: '12px',
              color: 'white',
              fontSize: '1rem',
              outline: 'none',
              transition: 'all 0.2s'
            }}
            onFocus={(e) => e.target.style.borderColor = 'var(--primary)'}
            onBlur={(e) => e.target.style.borderColor = 'rgba(255,255,255,0.05)'}
          />
        </div>
        <button 
          type="submit" 
          disabled={loading || !username.trim()}
          style={{
            background: 'var(--primary)',
            color: 'white',
            border: 'none',
            borderRadius: '12px',
            padding: '0 1.5rem',
            fontWeight: 600,
            fontSize: '1rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            opacity: (loading || !username.trim()) ? 0.7 : 1,
            cursor: (loading || !username.trim()) ? 'not-allowed' : 'pointer'
          }}
        >
          {loading ? <Loader2 size={20} style={{ animation: 'spin 1s linear infinite' }} /> : 'Пошук'}
        </button>
      </form>

      {loading && progressText && (
        <div style={{ textAlign: 'center', color: 'var(--primary)', marginBottom: '2rem', animation: 'fadeIn 0.3s' }}>
          {progressText}
        </div>
      )}

      {error && (
        <div className="glass-panel" style={{ padding: '1.5rem', borderLeft: '4px solid #ef4444', backgroundColor: 'rgba(239, 68, 68, 0.05)' }}>
          <h3 style={{ color: '#ef4444', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>Error</h3>
          <p style={{ color: 'rgba(255,255,255,0.8)' }}>{error}</p>
        </div>
      )}

      {/* Render Followings Mode */}
      {mode === 'followings' && hasSearched && !loading && !error && followings.length === 0 && (
        <div className="glass-panel" style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
          <Users size={48} style={{ opacity: 0.2, margin: '0 auto 1rem' }} />
          <p>Немає підписок або профіль закритий.</p>
        </div>
      )}

      {mode === 'followings' && followings.length > 0 && (
        <div className="delay-200" style={{ animation: 'fadeIn 0.4s ease-out 200ms forwards' }}>
          <h2 style={{ fontSize: '1.25rem', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Users size={20} color="var(--primary)" /> 
            Найстаріші Підписки
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {followings.map((user, index) => (
              <div key={user.userId} className="glass-panel" style={{ padding: '1.5rem', display: 'flex', alignItems: 'center', gap: '1.5rem', cursor: 'pointer' }}>
                <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: 'rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                  {index + 1}
                </div>
                
                {user.profileImageUrlHttps ? (
                  <img src={user.profileImageUrlHttps} alt={user.name} style={{ width: '56px', height: '56px', borderRadius: '50%', objectFit: 'cover' }} />
                ) : (
                  <div style={{ width: '56px', height: '56px', borderRadius: '50%', background: 'linear-gradient(45deg, var(--primary), #8a2be2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.5rem', fontWeight: 'bold' }}>
                    {user.name.charAt(0)}
                  </div>
                )}
                
                <div style={{ flex: 1 }}>
                  <h3 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '0.25rem' }}>{user.name}</h3>
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>@{user.username}</p>
                </div>
                
                <a href={`https://twitter.com/${user.username}`} target="_blank" rel="noopener noreferrer" style={{ width: '40px', height: '40px', borderRadius: '50%', background: 'rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', transition: 'all 0.2s' }}>
                  <ArrowRight size={20} />
                </a>
              </div>
            ))}
          </div>
        </div>
      )}

      {mode === 'followings' && similarUsers.length > 0 && (
        <div className="mt-8 delay-300" style={{ animation: 'fadeIn 0.4s ease-out 300ms forwards', marginTop: '2.5rem' }}>
          <h2 style={{ fontSize: '1.25rem', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Users size={20} color="var(--primary)" />
            Схожі профілі з бази
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {similarUsers.map((su, index) => (
              <div key={su.username} className="glass-panel" style={{ padding: '1.5rem', display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
                <div style={{ width: '40px', height: '40px', borderRadius: '50%', background: 'linear-gradient(45deg, var(--primary), #8a2be2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', color: 'white', fontSize: '1rem' }}>
                  {index + 1}
                </div>
                
                <div style={{ flex: 1 }}>
                  <h3 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '0.25rem', color: 'var(--primary)' }}>@{su.username}</h3>
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>{su.commonCount} спільних підписок</p>
                </div>
                
                <a href={`https://twitter.com/${su.username}`} target="_blank" rel="noopener noreferrer" style={{ width: '40px', height: '40px', borderRadius: '50%', background: 'rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
                  <ArrowRight size={20} />
                </a>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Render Tweet Mode */}
      {mode !== 'followings' && foundTweet && author && (
        <div className="glass-panel delay-200" style={{ padding: '2rem', animation: 'fadeIn 0.4s ease-out 200ms forwards' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem' }}>
             {author.profileImageUrlHttps && <img src={author.profileImageUrlHttps} alt={author.name} style={{ width: '48px', height: '48px', borderRadius: '50%', objectFit: 'cover' }} />}
             <div>
               <h3 style={{ fontSize: '1.1rem', fontWeight: 600 }}>{author.name}</h3>
               <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>@{author.username}</p>
             </div>
          </div>
          
          <p style={{ fontSize: '1.25rem', lineHeight: 1.5, marginBottom: '1.5rem', whiteSpace: 'pre-wrap' }}>
            {foundTweet.text}
          </p>
          
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '1.5rem' }}>
            {new Date(foundTweet.createdAt).toLocaleString('uk-UA')}
          </p>
          
          <div style={{ display: 'flex', gap: '2rem', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-muted)' }}>
               <TrendingUp size={18} /> {foundTweet.viewCount?.toLocaleString() || 0}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-muted)' }}>
               ❤️ {foundTweet.likeCount?.toLocaleString() || 0}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-muted)' }}>
               🔁 {foundTweet.retweetCount?.toLocaleString() || 0}
            </div>
          </div>
          
          <a href={`https://twitter.com/${author.username}/status/${foundTweet.id}`} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-block', marginTop: '1.5rem', padding: '0.5rem 1rem', background: 'rgba(255,255,255,0.05)', borderRadius: '8px', color: 'var(--primary)', textDecoration: 'none' }}>
            Відкрити в Twitter →
          </a>
        </div>
      )}

      {/* Render Mentions Mode */}
      {mode === 'mentions' && hasSearched && !loading && !error && topMentions.length === 0 && (
        <div className="glass-panel" style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
          <Megaphone size={48} style={{ opacity: 0.2, margin: '0 auto 1rem' }} />
          <p>Не знайдено жодної згадки.</p>
        </div>
      )}

      {mode === 'mentions' && topMentions.length > 0 && (
        <div className="delay-200" style={{ animation: 'fadeIn 0.4s ease-out 200ms forwards' }}>
          <h2 style={{ fontSize: '1.25rem', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Megaphone size={20} color="var(--primary)" /> 
            Топ-10 Фанатів (найчастіші згадки)
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {topMentions.map((mention, index) => {
              const u = mention.user;
              let medal = '';
              if (index === 0) medal = '🥇 ';
              else if (index === 1) medal = '🥈 ';
              else if (index === 2) medal = '🥉 ';

              return (
                <div key={u.userId} className="glass-panel" style={{ padding: '1.5rem', display: 'flex', alignItems: 'center', gap: '1.5rem', cursor: 'pointer' }}>
                  <div style={{ width: '40px', height: '40px', borderRadius: '50%', background: index < 3 ? 'linear-gradient(45deg, var(--primary), #8a2be2)' : 'rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', color: index < 3 ? 'white' : 'var(--text-muted)', fontSize: '1.1rem' }}>
                    {medal || (index + 1)}
                  </div>
                  
                  {u.profileImageUrlHttps ? (
                    <img src={u.profileImageUrlHttps} alt={u.name} style={{ width: '56px', height: '56px', borderRadius: '50%', objectFit: 'cover' }} />
                  ) : (
                    <div style={{ width: '56px', height: '56px', borderRadius: '50%', background: 'rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.5rem', fontWeight: 'bold' }}>
                      {u.name?.charAt(0) || '?'}
                    </div>
                  )}
                  
                  <div style={{ flex: 1 }}>
                    <h3 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '0.25rem' }}>{u.name}</h3>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>@{u.username}</p>
                  </div>
                  
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'rgba(29, 161, 242, 0.1)', color: 'var(--primary)', padding: '0.5rem 1rem', borderRadius: '20px', fontWeight: 'bold' }}>
                    {mention.count} згадок
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <style>
        {`
          @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
          }
        `}
      </style>
    </div>
  );
};

export default App;
