import {
  collection,
  getDocs,
  serverTimestamp,
  query,
  where,
  limit,
  orderBy,
  startAfter,
  type QueryDocumentSnapshot,
  type DocumentData,
  doc,
  setDoc,
  addDoc,
} from "firebase/firestore";
import { signInAnonymously } from "firebase/auth";
import { auth, db } from "./firebase";
import type { Product } from "./types";

async function ensureUser() {
  if (!auth.currentUser) {
    await signInAnonymously(auth);
  }
  return auth.currentUser!;
}

// Maps Firestore docs to your existing Product type (fills missing fields safely)
function normalizeProduct(id: string, data: any): Product {
  return {
    id,
    name: data.name ?? data.title ?? "Untitled",
    brand: data.brand ?? "Home Decor",
    price: Number(data.price ?? 0),
    description: data.description ?? "No description yet.",
    category: data.category ?? "General",
    imageUrl: data.imageUrl ?? data.imageURL ?? "https://picsum.photos/seed/fallback/600/600",
    tags: Array.isArray(data.tags) ? data.tags : [],
    matchScore: Number(data.matchScore ?? 85),
    checkoutType: data.checkoutType,
    merchant: data.merchant,
    purchaseUrl: data.purchaseUrl,
  };
}

// Load products (tries to match tags with your selected interests)
export async function fetchProductsByInterests(interests: string[], take = 20): Promise<Product[]> {
  // Firestore allows up to 10 values in array-contains-any
  const interests10 = interests.slice(0, 10);

  const col = collection(db, "products");

  // If user chose interests, filter by tags; otherwise just load anything.
  const q = interests10.length > 0
    ? query(col, where("tags", "array-contains-any", interests10), limit(take))
    : query(col, limit(take));

  const snap = await getDocs(q);
  return snap.docs.map(d => normalizeProduct(d.id, d.data()));
}

// Save swipe to Firestore
// Load all products from Firestore (no interest filtering)
export async function fetchProducts(take = 30): Promise<Product[]> {
  const col = collection(db, "products");
  const q = query(col, limit(take));
  const snap = await getDocs(q);
  return snap.docs.map(d => normalizeProduct(d.id, d.data()));
}

export type ProductsPage = {
  items: Product[];
  cursor: QueryDocumentSnapshot<DocumentData> | null;
  hasMore: boolean;
};

export async function fetchProductsPage(
  take = 30,
  cursor: QueryDocumentSnapshot<DocumentData> | null = null
): Promise<ProductsPage> {
  const col = collection(db, "products");

  const q = cursor
    ? query(col, orderBy("__name__"), startAfter(cursor), limit(take))
    : query(col, orderBy("__name__"), limit(take));

  const snap = await getDocs(q);

  const items = snap.docs.map(d => normalizeProduct(d.id, d.data()));
  const nextCursor = snap.docs.length ? snap.docs[snap.docs.length - 1] : null;

  return {
    items,
    cursor: nextCursor,
    hasMore: snap.docs.length === take,
  };
}

export async function fetchProductsByInterestsPage(
  interests: string[],
  take = 20,
  cursor: QueryDocumentSnapshot<DocumentData> | null = null
): Promise<ProductsPage> {
  const interests10 = interests.slice(0, 10);
  const col = collection(db, "products");

  // if no interests, fallback to normal paging
  if (interests10.length === 0) return fetchProductsPage(take, cursor);

  const q = cursor
    ? query(
        col,
        where("tags", "array-contains-any", interests10),
        orderBy("__name__"),
        startAfter(cursor),
        limit(take)
      )
    : query(
        col,
        where("tags", "array-contains-any", interests10),
        orderBy("__name__"),
        limit(take)
      );

  const snap = await getDocs(q);

  const items = snap.docs.map(d => normalizeProduct(d.id, d.data()));
  const nextCursor = snap.docs.length ? snap.docs[snap.docs.length - 1] : null;

  return {
    items,
    cursor: nextCursor,
    hasMore: snap.docs.length === take,
  };
}

export async function fetchMySwipes() {
  const user = await ensureUser();
  const snap = await getDocs(collection(db, "users", user.uid, "swipes"));
  return snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
}

/**
 * Save a swipe event to a top-level `swipes` collection.
 * Payload example: { productId, direction: 'left'|'right', action?: 'wishlist'|'cart' }
 */
export const saveSwipe = async (payload: {
  productId: string;
  direction: "left" | "right";
  action?: "wishlist" | "cart" | null;
}) => {
  const user = await ensureUser();

  await setDoc(
    doc(db, "users", user.uid, "swipes", payload.productId),
    {
      ...payload,
      createdAt: serverTimestamp(),
    },
    { merge: true }
  );
};

export async function saveLead(payload: {
  email: string;
  subtotal: number;
  bagCount: number;
  wishlistCount: number;
}) {
  const user = await ensureUser();

  const email = payload.email.trim().toLowerCase();
  await setDoc(
    doc(db, "leads", email),
    {
      uid: user.uid,
      email,
      subtotal: payload.subtotal,
      bagCount: payload.bagCount,
      wishlistCount: payload.wishlistCount,
      createdAt: serverTimestamp(),
      source: "checkout_modal",
    },
    { merge: true }
  );
}

type EventType = "buy_click" | "wishlist_add" | "cart_add";

export async function logEvent(payload: {
  type: EventType;
  productId: string;
  purchaseUrl?: string;
  source?: string;
}) {
  const user = await ensureUser();

  const base: any = {
    type: payload.type,
    uid: user.uid,
    productId: payload.productId,
    source: payload.source ?? "unknown",
    createdAt: serverTimestamp(),
  };

  if (payload.type === "buy_click") {
    base.purchaseUrl = payload.purchaseUrl ?? "";
  }

  await addDoc(collection(db, "events"), base);
}

export async function logBuyClick(payload: {
  productId: string;
  purchaseUrl: string;
  source?: string;
}) {
  return logEvent({ type: "buy_click", ...payload, source: payload.source ?? "checkout_modal" });
}

