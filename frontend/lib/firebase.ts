/**
 * Firebase - auth + optional storage.
 * Project: backtestlab-5cbb7
 */

import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? "AIzaSyD4ezi08h7HDbh2XkG7UYFDSWoqVJRC0_M",
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? "backtestlab-5cbb7.firebaseapp.com",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "backtestlab-5cbb7",
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? "backtestlab-5cbb7.firebasestorage.app",
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? "1074967818683",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? "1:1074967818683:web:f1e135a3c06bfc064e949e",
};

let app: FirebaseApp | undefined;
let auth: Auth | undefined;

export function getFirebaseApp(): FirebaseApp {
  if (getApps().length === 0) {
    app = initializeApp(firebaseConfig);
  }
  return (app ?? getApps()[0]) as FirebaseApp;
}

export function getFirebaseAuth(): Auth {
  const firebaseApp = getFirebaseApp();
  auth = getAuth(firebaseApp);
  return auth;
}
