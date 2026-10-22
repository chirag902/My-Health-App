
import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

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


export const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
