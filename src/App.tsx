import React, { useState } from 'react';
import { Search, Loader2, Users, ArrowRight, MessageCircle } from 'lucide-react';
import { getCachedFollowingsFromFirebase, saveFollowingsToFirebaseCache } from './firebase';

interface TwitterUser {
  userId: string;
  name: string;
  username: string;
  profileImageUrlHttps: string;
  description?: string;
}

const App: React.FC = () => {
  const [username, setUsername] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [followings, setFollowings] = useState<TwitterUser[]>([]);
  const [hasSearched, setHasSearched] = useState(false);

  const [progressText, setProgressText] = useState('');

  const fetchFollowings = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Clean username (remove @ if present)
    const cleanUsername = username.trim().replace(/^@/, '');
    
    if (!cleanUsername) return;
    
    setLoading(true);
    setError(null);
    setHasSearched(true);
    setFollowings([]);
    setProgressText('Підключаюся до TwitterAPI.io...');

    try {
      const apiKey = import.meta.env.VITE_TWITTERAPI_IO_KEY || import.meta.env.VITE_TWEXAPI_KEY;
      
      if (!apiKey) {
        throw new Error('API key is not defined in .env');
      }

      if (apiKey.includes('localhost')) {
        throw new Error('Please update .env with your real TwitterAPI.io key.');
      }

      // Check Local Storage Cache first
      const cacheKey = `twitter_first_follows_v2_${cleanUsername.toLowerCase()}`;
      const cachedData = localStorage.getItem(cacheKey);
      if (cachedData) {
        try {
          const parsedCache = JSON.parse(cachedData);
          if (parsedCache && parsedCache.length > 0) {
            setProgressText('Завантажено з локального кешу ⚡');
            setFollowings(parsedCache);
            setLoading(false);
            return;
          }
        } catch(e) {
          console.warn('Cache parsing failed', e);
        }
      }

      // Check Global Firebase Cache
      setProgressText('Перевіряю глобальний кеш (Firebase)...');
      const firebaseCache = await getCachedFollowingsFromFirebase(cleanUsername);
      if (firebaseCache && firebaseCache.length > 0) {
        setProgressText('Завантажено з глобального кешу 🔥');
        setFollowings(firebaseCache);
        
        // Update local storage too so next time it's instant
        try {
          localStorage.setItem(cacheKey, JSON.stringify(firebaseCache));
        } catch (e) {}
        
        setLoading(false);
        return;
      }

      try {
        // 1. Check user info first to get followingCount
        setProgressText('Перевіряю кількість підписок...');
        const userCheckResponse = await fetch(`/api/twitter/user/info?userName=${encodeURIComponent(cleanUsername)}`, {
          headers: {
            'x-api-key': apiKey
          }
        });
        
        if (userCheckResponse.ok) {
          const userCheckData = await userCheckResponse.json();
          const userInfo = userCheckData.user || userCheckData.data || userCheckData;
          
          let followingCount = -1; // -1 means unknown, prevents accidental exit
          if (userInfo && userInfo.following !== undefined) {
            followingCount = userInfo.following;
          } else if (userInfo && userInfo.followingCount !== undefined) {
            followingCount = userInfo.followingCount;
          } else if (userInfo && userInfo.friends_count !== undefined) {
             followingCount = userInfo.friends_count;
          }
          
          if (followingCount > 3000) {
            throw new Error(`У користувача занадто багато підписок (${followingCount}). Запит найперших підписок для списку >3000 витратить занадто багато кредитів API.`);
          }
          if (followingCount === 0) {
             setFollowings([]);
             setLoading(false);
             return;
          }
        }
      } catch (err: any) {
        if (err.message && err.message.includes('занадто багато підписок')) {
          throw err;
        }
        console.warn('Pre-check failed, continuing...', err);
      }

      // Add delay after pre-check to respect the 1 req / 5 seconds limit
      setProgressText('Очікування обходу лімітів API (5 сек)...');
      await new Promise(resolve => setTimeout(resolve, 5500));

      const allFollowings: TwitterUser[] = [];
      const seenUserIds = new Set();
      let cursor = null;
      let hasNextPage = true;
      let pageCount = 0;

      while (hasNextPage) {
        pageCount++;
        setProgressText(`Завантаження сторінки ${pageCount}... (Отримано: ${allFollowings.length})`);
        
        let url = `/api/twitter/user/followings?userName=${encodeURIComponent(cleanUsername)}&pageSize=200`;
        if (cursor) {
          url += `&cursor=${encodeURIComponent(cursor)}`;
        }

        const response = await fetch(url, {
          headers: {
            'x-api-key': apiKey,
            'Content-Type': 'application/json'
          }
        });

        let data;
        try {
          data = await response.json();
        } catch (e) {
          if (!response.ok) {
            throw new Error(`API Error: ${response.status}`);
          }
        }

        if (!response.ok) {
          throw new Error(`API Error: ${data?.msg || data?.message || response.status}`);
        }
        
        if (data.code !== 0 && data.status !== 'success' && data.code !== 200) {
          throw new Error(`API Error: ${data.msg || data.message || 'Unknown error'}`);
        }

        // Handle variations in how the array might be named in the response
        const items = data.followings || data.followers || data.users || data.data || [];
        
        for (const user of items) {
          const userId = user.id || user.userId || user.user_id;
          if (userId && !seenUserIds.has(userId)) {
            seenUserIds.add(userId);
            // Map twitterapi.io response fields to our interface
            allFollowings.push({
              userId: userId,
              name: user.name || '',
              username: user.userName || user.username || user.screen_name || '',
              profileImageUrlHttps: user.profilePicture || user.profileImageUrlHttps || user.profile_image_url_https || user.profile_image_url || '',
              description: user.description || ''
            });
          }
        }

        hasNextPage = data.has_next_page === true || data.hasNextPage === true;
        cursor = data.next_cursor || data.nextCursor;

        if (!hasNextPage || !cursor) {
          break;
        }

        // Delay 5.5 seconds to respect the free tier QPS limit (1 request every 5 seconds)
        setProgressText(`Отримано ${allFollowings.length}. Очікування 5 сек...`);
        await new Promise(resolve => setTimeout(resolve, 5500));
      }
      
      setProgressText(`Завершено! Отримано ${allFollowings.length} підписок.`);
      
      // Twitter typically returns newest first, so the absolute oldest are at the end of the full list
      const oldestFollowings = allFollowings.slice(-5).reverse();
      setFollowings(oldestFollowings);
      
      // Save to Local Storage cache
      try {
        localStorage.setItem(cacheKey, JSON.stringify(oldestFollowings));
      } catch(e) {
        console.warn('Could not save to local storage', e);
      }

      // Save to Global Firebase Cache
      await saveFollowingsToFirebaseCache(cleanUsername, oldestFollowings);
      
    } catch (err: any) {
      setError(err.message || 'An error occurred while fetching data');
      setProgressText('');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container animate-fade-in">
      <header style={{ textAlign: 'center', marginBottom: '3rem' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '64px', height: '64px', borderRadius: '20px', background: 'rgba(29, 161, 242, 0.1)', color: 'var(--primary)', marginBottom: '1.5rem' }}>
          <MessageCircle size={32} />
        </div>
        <h1 style={{ fontSize: '2.5rem', fontWeight: 700, marginBottom: '1rem', letterSpacing: '-0.02em' }}>
          Twitter <span style={{ color: 'var(--primary)' }}>First Follows</span>
        </h1>
        <p style={{ color: 'var(--text-muted)', fontSize: '1.1rem', maxWidth: '500px', margin: '0 auto', lineHeight: 1.6 }}>
          Find the 5 oldest followings of any Twitter (X) user using TwexAPI.
        </p>
      </header>

      <form onSubmit={fetchFollowings} className="glass-panel delay-100" style={{ display: 'flex', padding: '0.75rem', gap: '0.75rem', marginBottom: '2.5rem', animation: 'fadeIn 0.4s ease-out 100ms forwards', opacity: 0 }}>
        <div style={{ position: 'relative', flex: 1 }}>
          <div style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }}>
            <Search size={20} />
          </div>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Enter @username"
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
          {loading ? <Loader2 size={20} style={{ animation: 'spin 1s linear infinite' }} /> : 'Search'}
        </button>
      </form>

      {loading && progressText && (
        <div style={{ textAlign: 'center', color: 'var(--primary)', marginBottom: '2rem', animation: 'fadeIn 0.3s' }}>
          {progressText}
        </div>
      )}

      {error && (
        <div className="glass-panel" style={{ padding: '1.5rem', borderLeft: '4px solid #ef4444', backgroundColor: 'rgba(239, 68, 68, 0.05)' }}>
          <h3 style={{ color: '#ef4444', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            Error
          </h3>
          <p style={{ color: 'rgba(255,255,255,0.8)' }}>{error}</p>
        </div>
      )}

      {hasSearched && !loading && !error && followings.length === 0 && (
        <div className="glass-panel" style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
          <Users size={48} style={{ opacity: 0.2, margin: '0 auto 1rem' }} />
          <p>No followings found or profile is private.</p>
        </div>
      )}

      {followings.length > 0 && (
        <div className="delay-200" style={{ animation: 'fadeIn 0.4s ease-out 200ms forwards', opacity: 0 }}>
          <h2 style={{ fontSize: '1.25rem', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Users size={20} color="var(--primary)" /> 
            Oldest Followings
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {followings.map((user, index) => (
              <div key={user.userId} className="glass-panel" style={{ padding: '1.5rem', display: 'flex', alignItems: 'center', gap: '1.5rem', transition: 'transform 0.2s', cursor: 'pointer' }} onMouseEnter={(e) => e.currentTarget.style.transform = 'translateY(-2px)'} onMouseLeave={(e) => e.currentTarget.style.transform = 'translateY(0)'}>
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
                  {user.description && (
                    <p style={{ marginTop: '0.5rem', fontSize: '0.9rem', color: 'rgba(255,255,255,0.7)', display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                      {user.description}
                    </p>
                  )}
                </div>
                
                <a href={`https://twitter.com/${user.username}`} target="_blank" rel="noopener noreferrer" style={{ width: '40px', height: '40px', borderRadius: '50%', background: 'rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', transition: 'all 0.2s' }} onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--primary)'; e.currentTarget.style.color = 'white'; }} onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; e.currentTarget.style.color = 'var(--text-muted)'; }}>
                  <ArrowRight size={20} />
                </a>
              </div>
            ))}
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
