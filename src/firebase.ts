import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyC8sMFtBf0taqZ_u80eKYLxwh8o1BEUluE",
  authDomain: "gen-lang-client-0531073633.firebaseapp.com",
  projectId: "gen-lang-client-0531073633",
  storageBucket: "gen-lang-client-0531073633.firebasestorage.app",
  messagingSenderId: "315307917879",
  appId: "1:315307917879:web:57582b97919c96df6475b2"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app, "ai-studio-ea93d4a7-6f15-4211-be1a-b9f073df6051");
