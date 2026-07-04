import React, { useState } from 'react';
import { Search, Loader2, Users, ArrowRight, MessageCircle } from 'lucide-react';

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

  const fetchFollowings = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Clean username (remove @ if present)
    const cleanUsername = username.trim().replace(/^@/, '');
    
    if (!cleanUsername) return;
    
    setLoading(true);
    setError(null);
    setHasSearched(true);
    setFollowings([]);

    try {
      // NOTE: Replace this with the exact TwexAPI endpoint from their docs if different
      const apiKey = import.meta.env.VITE_TWEXAPI_KEY;
      
      if (!apiKey) {
        throw new Error('API key VITE_TWEXAPI_KEY is not defined in .env');
      }

      // If they really put http://localhost... as the key, let's warn them nicely
      if (apiKey.includes('localhost')) {
        throw new Error('You pasted "http://localhost:5173/" instead of your TwexAPI key in .env. Please update .env with your real key.');
      }

      let followingCount = 5000; // Default limit

      try {
        // 1. Check user info first to get friendCount (following count)
        const userCheckResponse = await fetch(`https://api.twexapi.io/twitter/users`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify([cleanUsername])
        });
        
        if (userCheckResponse.ok) {
          const userCheckData = await userCheckResponse.json();
          if (userCheckData.code === 200 && userCheckData.data?.[0]) {
            followingCount = userCheckData.data[0].friendCount || 0;
            
            if (followingCount > 5000) {
              throw new Error(`У користувача занадто багато підписок (${followingCount}). Запит найперших підписок для списку >5000 витратить занадто багато кредитів API.`);
            }
            
            if (followingCount === 0) {
              setFollowings([]);
              setLoading(false);
              return;
            }
          }
        }
      } catch (err: any) {
        // If the error is our custom > 5000 error, rethrow it
        if (err.message && err.message.includes('занадто багато підписок')) {
          throw err;
        }
        // Otherwise, it might be a CORS or network block (e.g. adblocker blocking POST requests).
        // In that case, we just ignore the pre-check and use the default 5000 limit.
        console.warn('Pre-check failed, falling back to default limit:', err);
      }

      // 2. Fetch followings
      const response = await fetch(`https://api.twexapi.io/twitter/following/${encodeURIComponent(cleanUsername)}/${Math.max(200, followingCount)}`, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
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
        throw new Error(`API Error: ${data?.msg || data?.code || response.status}`);
      }
      
      // TwexAPI returns custom error codes in JSON even on some 200s or on 403s
      if (data && data.code && data.code !== 200) {
        throw new Error(`API Error: ${data.msg || data.code}`);
      }
      
      const allFollowings: TwitterUser[] = data.data || [];
      
      // To get the absolute oldest followings, we fetch a large batch (5000) 
      // and take the ones at the end of the array, since Twitter returns newest first.
      // 5000 covers the entirety of followings for 99% of normal users.
      setFollowings(allFollowings.slice(-5).reverse());
      
    } catch (err: any) {
      setError(err.message || 'An error occurred while fetching data');
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
