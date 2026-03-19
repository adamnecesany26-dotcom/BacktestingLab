/**
 * Firebase - auth + optional storage.
 * Project: backtestlab-5cbb7
 */

import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import { getAuth, signInAnonymously, type Auth, type User } from "firebase/auth";

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

/** Explicit opt-in via env (1/true/yes/on). */
export function isAnonymousSignInEnvEnabled(): boolean {
  if (typeof window === "undefined") return false;
  const v = (process.env.NEXT_PUBLIC_FIREBASE_ANONYMOUS_SIGNIN || "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

/** On localhost, try anonymous auth automatically so Run history / save works without .env (unless disabled). */
export function isLocalhostAutoAnonymous(): boolean {
  if (typeof window === "undefined") return false;
  const off = (process.env.NEXT_PUBLIC_FIREBASE_DISABLE_AUTO_ANONYMOUS || "").trim().toLowerCase();
  if (off === "1" || off === "true" || off === "yes") return false;
  const h = window.location.hostname;
  return h === "localhost" || h === "127.0.0.1";
}

export function shouldTryAnonymousSignIn(): boolean {
  return isAnonymousSignInEnvEnabled() || isLocalhostAutoAnonymous();
}

/**
 * Ensures a Firebase user exists for Firestore writes (anonymous).
 * Call once on app load; safe to call repeatedly.
 */
export async function ensureAnonymousSession(): Promise<{ user: User } | { error: string }> {
  try {
    const a = getFirebaseAuth();
    if (a.currentUser?.uid) {
      return { user: a.currentUser };
    }
    if (!shouldTryAnonymousSignIn()) {
      return {
        error:
          "Anonymous sign-in není zapnutý. Na localhostu se zkouší automaticky — pokud jsi na jiné doméně, nastav NEXT_PUBLIC_FIREBASE_ANONYMOUS_SIGNIN=1 ve frontend/.env.local a v Firebase Console zapni Authentication → Anonymous.",
      };
    }
    const cred = await signInAnonymously(a);
    if (!cred.user?.uid) {
      return { error: "Anonymous sign-in vrátil prázdného uživatele." };
    }
    return { user: cred.user };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const code = typeof e === "object" && e !== null && "code" in e ? String((e as { code?: string }).code) : "";
    return {
      error: [code, msg].filter(Boolean).join(" — ") || "signInAnonymously failed",
    };
  }
}
