
'use client';

import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyDHIeeMnfxHiMeRIYL3MIzWH1BXVuTL1jU",
  authDomain: "myhealthapp-17gwa.firebaseapp.com",
  projectId: "myhealthapp-17gwa",
  storageBucket: "myhealthapp-17gwa.firebasestorage.app",
  messagingSenderId: "428306892297",
  appId: "1:428306892297:web:d089eb981d62e24c795ad8"
};

export function initializeFirebase() {
  const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
  const auth = getAuth(app);
  const firestore = getFirestore(app);

  return { app, auth, firestore };
}
