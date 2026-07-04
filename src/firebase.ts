import { initializeApp } from "firebase/app";
import { getFirestore, collection, doc, getDoc, setDoc } from "firebase/firestore";

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
  app = initializeApp(firebaseConfig);
  db = getFirestore(app);
} catch (e) {
  console.warn("Firebase not properly configured yet.", e);
}

export const getCachedFollowingsFromFirebase = async (username: string) => {
  if (!db) return null;
  try {
    const docRef = doc(db, "twitter_first_follows", username.toLowerCase());
    const docSnap = await getDoc(docRef);

    if (docSnap.exists()) {
      return docSnap.data().followings;
    } else {
      return null;
    }
  } catch (error) {
    console.error("Error reading from Firebase cache:", error);
    return null;
  }
};

export const saveFollowingsToFirebaseCache = async (username: string, followings: any[]) => {
  if (!db) return;
  try {
    const docRef = doc(db, "twitter_first_follows", username.toLowerCase());
    await setDoc(docRef, { followings, cachedAt: new Date().toISOString() });
  } catch (error) {
    console.error("Error writing to Firebase cache:", error);
  }
};
