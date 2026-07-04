import { initializeApp } from "firebase/app";
import { getFirestore, collection, doc, getDoc, setDoc, getDocs } from "firebase/firestore";

// Your web app's Firebase configuration
// REPLACE THIS WITH YOUR FIREBASE CONFIG
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "YOUR_API_KEY",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "YOUR_AUTH_DOMAIN",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "YOUR_PROJECT_ID",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "YOUR_STORAGE_BUCKET",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "YOUR_MESSAGING_SENDER_ID",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "YOUR_APP_ID"
};

// Initialize Firebase
let app;
let db: any = null;

try {
  // Only initialize if a real key is provided
  if (firebaseConfig.apiKey && firebaseConfig.apiKey !== "YOUR_API_KEY") {
    app = initializeApp(firebaseConfig);
    db = getFirestore(app);
  }
} catch (e) {
  console.warn("Firebase not properly configured yet.", e);
}

export const getCachedFollowingsFromFirebase = async (username: string) => {
  if (!db) return null;
  try {
    const docRef = doc(db, "twitter_first_follows", username.toLowerCase());
    const docSnap = await getDoc(docRef);

    if (docSnap.exists()) {
      const data = docSnap.data();
      return { 
        followings: data.followings, 
        allFollowingsUsernames: data.allFollowingsUsernames || [] 
      };
    } else {
      return null;
    }
  } catch (error) {
    console.error("Error reading from Firebase cache:", error);
    return null;
  }
};

export const saveFollowingsToFirebaseCache = async (username: string, followings: any[], allFollowingsUsernames: string[]) => {
  if (!db) return;
  try {
    const docRef = doc(db, "twitter_first_follows", username.toLowerCase());
    await setDoc(docRef, { 
      followings, 
      allFollowingsUsernames,
      cachedAt: new Date().toISOString() 
    }, { merge: true });
  } catch (error) {
    console.error("Error writing to Firebase cache:", error);
  }
};

export const getCachedTweetFromFirebase = async (username: string, type: 'first' | 'popular') => {
  if (!db) return null;
  try {
    const docRef = doc(db, "twitter_first_tweets", `${username.toLowerCase()}_${type}_v2`);
    const docSnap = await getDoc(docRef);

    if (docSnap.exists()) {
      return docSnap.data().tweet;
    } else {
      return null;
    }
  } catch (error) {
    console.error("Error reading tweet from Firebase cache:", error);
    return null;
  }
};

export const saveTweetToFirebaseCache = async (username: string, type: 'first' | 'popular', tweet: any) => {
  if (!db) return;
  try {
    const docRef = doc(db, "twitter_first_tweets", `${username.toLowerCase()}_${type}_v2`);
    await setDoc(docRef, { 
      tweet, 
      cachedAt: new Date().toISOString() 
    }, { merge: true });
  } catch (error) {
    console.error("Error writing tweet to Firebase cache:", error);
  }
};

export interface SimilarUser {
  username: string;
  commonCount: number;
}

export const findSimilarUsersInFirebase = async (currentUsername: string, currentUsernamesSet: Set<string>): Promise<SimilarUser[]> => {
  if (!db) return [];
  try {
    const querySnapshot = await getDocs(collection(db, "twitter_first_follows"));
    const similarUsers: SimilarUser[] = [];

    querySnapshot.forEach((doc) => {
      const dbUsername = doc.id;
      if (dbUsername === currentUsername.toLowerCase()) return; // Skip self
      
      const data = doc.data();
      const otherUsernames = data.allFollowingsUsernames as string[] || [];
      
      let commonCount = 0;
      for (const username of otherUsernames) {
        if (currentUsernamesSet.has(username)) {
          commonCount++;
        }
      }

      if (commonCount > 0) {
        similarUsers.push({
          username: dbUsername,
          commonCount
        });
      }
    });

    // Sort by most common first, return top 3
    return similarUsers.sort((a, b) => b.commonCount - a.commonCount).slice(0, 3);
  } catch (error) {
    console.error("Error finding similar users:", error);
    return [];
  }
};
