// Firebase integration disabled - using Gemini AI + localStorage instead
// This file is deprecated. Use backendService.ts and geminiService.ts instead.
//
// To re-enable Firebase, run: npm install firebase
// Then uncomment the code below and set VITE_FIREBASE_* environment variables

/*
import { collection, getDocs, doc, setDoc, serverTimestamp } from "firebase/firestore";
import { signInAnonymously } from "firebase/auth";
import { auth, db } from "./firebase";

export type Product = {
  id: string;
  title: string;
  price: number;
  category: string;
  imageUrl: string;
  tags: string[];
};

export async function ensureUser() {
  if (!auth.currentUser) {
    await signInAnonymously(auth);
  }
  return auth.currentUser!;
}

export async function fetchProducts(): Promise<Product[]> {
  const snap = await getDocs(collection(db, "products"));
  return snap.docs.map(d => ({ id: d.id, ...(d.data() as Omit<Product, "id">) }));
}

export async function saveSwipe(productId: string, direction: "right" | "left") {
  const user = await ensureUser();
  await setDoc(
    doc(db, "users", user.uid, "swipes", productId),
    { direction, createdAt: serverTimestamp() },
    { merge: true }
  );
}
*/

// Placeholder type for compatibility
export type Product = {
  id: string;
  title: string;
  price: number;
  category: string;
  imageUrl: string;
  tags: string[];
};

// Placeholder functions (disabled - use backendService.ts instead)
export const ensureUser = async () => null;
export const fetchProducts = async (): Promise<Product[]> => [];
export const saveSwipe = async (productId: string, direction: "right" | "left") => {};
