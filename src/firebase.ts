import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';

// Public Firebase WEB config is configured per environment at build time.
// Never include service-account JSON or secret material in VITE_* settings.
const firebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY || '',
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || '',
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || '',
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || '',
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '',
    appId: import.meta.env.VITE_FIREBASE_APP_ID || '',
};
if (!firebaseConfig.apiKey || !firebaseConfig.projectId || !firebaseConfig.appId) {
    throw new Error('Configure VITE_FIREBASE_* with your dedicated non-production Firebase project before building MEMS.');
}
export const firebaseApp = initializeApp(firebaseConfig);
export const firebaseAuth = getAuth(firebaseApp);
firebaseAuth.useDeviceLanguage();
