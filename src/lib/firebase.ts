
import { initializeApp, getApps, getApp, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";

// Your web app's Firebase configuration is now sourced from environment variables.
// See the .env file for configuration.
// For more information on how to get this, visit:
// https://firebase.google.com/docs/web/setup#available-libraries
const firebaseConfig = {
  apiKey: "AIzaSyDHIeeMnfxHiMeRIYL3MIzWH1BXVuTL1jU",
  authDomain: "myhealthapp-17gwa.firebaseapp.com",
  projectId: "myhealthapp-17gwa",
  storageBucket: "myhealthapp-17gwa.firebasestorage.app",
  messagingSenderId: "428306892297",
  appId: "1:428306892297:web:d089eb981d62e24c795ad8"
};


let app: FirebaseApp | null = null;
let auth: Auth | null = null;

// This check prevents Firebase from initializing if the environment variables are not set
// or are still the placeholder values.
if (firebaseConfig.apiKey && firebaseConfig.projectId && !firebaseConfig.apiKey.includes("YOUR_")) {
  try {
    app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
    auth = getAuth(app);
  } catch (e) {
    console.error("Failed to initialize Firebase. Please check your .env file configuration values.", e);
    // Set auth to null if initialization fails
    auth = null;
  }
} else {
  // This message is helpful for server-side logs.
  // The UI will guide the user on the client-side.
  if (typeof window === 'undefined') {
    console.warn("Firebase environment variables are not set in .env. Firebase will not be initialized.");
  }
}

export { app, auth };
