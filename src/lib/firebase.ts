import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore, doc, onSnapshot, setDoc, getDoc } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();

const configAny = firebaseConfig as any;
const databaseId = configAny.firestoreDatabaseId || 'ai-studio-kurirpaketsess-4a73ca48-bc0b-4247-9da5-af0ae54aa232';

export const db = databaseId && databaseId !== '(default)'
  ? getFirestore(app, databaseId)
  : getFirestore(app);

export { doc, onSnapshot, setDoc, getDoc };
