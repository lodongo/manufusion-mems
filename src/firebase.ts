import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';

// Firebase web config is public by design; access to data is enforced by the MEMS backend.
const firebaseConfig = {
    apiKey: 'AIzaSyCqNrF3IqZGqR1ZvUrDROO-LQIz_p0Sr9w',
    authDomain: 'mems2026.firebaseapp.com',
    projectId: 'mems2026',
    storageBucket: 'mems2026.firebasestorage.app',
    messagingSenderId: '1071563215760',
    appId: '1:1071563215760:web:acf1c2a6ddcab4d50f5915',
};

export const firebaseApp = initializeApp(firebaseConfig);
export const firebaseAuth = getAuth(firebaseApp);
firebaseAuth.useDeviceLanguage();
