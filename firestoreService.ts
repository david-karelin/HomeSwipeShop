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
  deleteDoc,
  setDoc,
  addDoc,
  writeBatch,
} from "firebase/firestore";
import { signInAnonymously } from "firebase/auth";
import { auth, db } from "./firebase";
import type { Product } from "./types";

async function ensureUser() {
  if (!auth.currentUser) {
    await signInAnonymously(auth);
  }
  const user = auth.currentUser!;
  console.log("[SELIGO] uid:", user.uid);
  return user;
}

// Maps Firestore docs to your existing Product type (fills missing fields safely)
function normalizeProduct(id: string, data: any): Product {
  return {
    id,
    name: data.name ?? data.title ?? "Untitled",
    brand: data.brand && String(data.brand).trim().length > 0 ? String(data.brand) : "Seligo.AI",
    price: Number(data.price ?? 0),
    description: data.description ?? "No description yet.",
    category: data.category ?? "General",
    imageUrl: data.imageUrl ?? data.imageURL ?? "https://picsum.photos/seed/fallback/600/600",
    tags: Array.isArray(data.tags) ? data.tags : [],
    matchScore: Number(data.matchScore ?? 85),
    checkoutType: data.checkoutType,
    merchant: data.merchant,
    purchaseUrl: data.purchaseUrl,
    asin: data.asin,
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

export async function clearMySwipes() {
  const user = await ensureUser();
  const snap = await getDocs(collection(db, "users", user.uid, "swipes"));

  if (snap.empty) return;

  let batch = writeBatch(db);
  let inBatch = 0;

  for (const docSnap of snap.docs) {
    batch.delete(docSnap.ref);
    inBatch++;

    if (inBatch >= 450) {
      await batch.commit();
      batch = writeBatch(db);
      inBatch = 0;
    }
  }

  if (inBatch > 0) {
    await batch.commit();
  }
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

export async function deleteMySwipe(productId: string) {
  const user = await ensureUser();
  await deleteDoc(doc(db, "users", user.uid, "swipes", productId));
}

export async function saveLead(payload: {
  email: string;
  subtotal: number;
  bagCount: number;
  wishlistCount: number;
  source?: string;
  view?: string;
}) {
  const user = await ensureUser();

  const email = payload.email.trim().toLowerCase();

  const key = `seligo_firstLeadMs_${email}`;
  const existing = localStorage.getItem(key);
  const firstLeadMs = existing ? Number(existing) : Date.now();
  if (!existing) localStorage.setItem(key, String(firstLeadMs));

  await setDoc(
    doc(db, "leads", email),
    {
      uid: user.uid,
      email,
      subtotal: payload.subtotal,
      bagCount: payload.bagCount,
      wishlistCount: payload.wishlistCount,
      firstSubmittedAtClientMs: firstLeadMs,
      lastSubmittedAt: serverTimestamp(),
      source: payload.source ?? "checkout_modal",
      view: payload.view ?? "cart",
    },
    { merge: true }
  );
}

type EventType =
  | "buy_click"
  | "share_click"
  | "checkout_item_open"
  | "lead_submit"
  | "wishlist_add"
  | "cart_add"
  | "session_start"
  | "view_change"
  | "scan_start"
  | "scan_success"
  | "scan_apply"
  | "pick_save"
  | "pick_impression"
  | "pick_dismiss"
  | "checkout_open"
  | "swipe_pass"
  | "product_open"
  | "card_impression";

type UTM = Partial<{
  utm_source: string;
  utm_medium: string;
  utm_campaign: string;
  utm_content: string;
  utm_term: string;
}>;

function getOrCreateSessionId() {
  const key = "seligo_session_id";
  let id = localStorage.getItem(key);
  if (!id) {
    id = (crypto as any).randomUUID
      ? crypto.randomUUID()
      : String(Date.now()) + Math.random().toString(16).slice(2);
    localStorage.setItem(key, id);
  }
  return id;
}

function readUtmFromUrl(): UTM {
  const params = new URLSearchParams(window.location.search);
  const utm: UTM = {};
  for (const k of ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"] as const) {
    const v = params.get(k);
    if (v) (utm as any)[k] = v;
  }
  return utm;
}

function persistUtmIfPresent() {
  const key = "seligo_utm";
  const now = readUtmFromUrl();
  if (Object.keys(now).length) localStorage.setItem(key, JSON.stringify(now));
}

function getPersistedUtm(): UTM {
  try {
    return sanitizeUtm(JSON.parse(localStorage.getItem("seligo_utm") || "{}"));
  } catch {
    return {};
  }
}

function sanitizeUtm(obj: any) {
  const allowed = new Set(["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"]);
  const out: any = {};
  for (const k of Object.keys(obj || {})) {
    if (allowed.has(k)) out[k] = obj[k];
  }
  return out;
}

export async function logEvent(payload: {
  type: EventType;
  productId?: string;
  purchaseUrl?: string;
  source?: string;
  view?: string;
  meta?: Record<string, any>;
}) {
  persistUtmIfPresent();

  const user = await ensureUser();
  const sessionId = getOrCreateSessionId();
  const utm = getPersistedUtm();
  const category = payload.meta?.category ?? null;
  const price = payload.meta?.price ?? null;

  const base: any = {
    type: payload.type,
    uid: user.uid,
    sessionId,
    view: payload.view ?? "unknown",
    productId: payload.productId ?? null,
    source: payload.source ?? "unknown",
    category,
    price,
    utm,
    meta: payload.meta ?? {},
    createdAt: serverTimestamp(),
  };

  if (payload.type === "buy_click" || payload.type === "checkout_item_open") {
    if (payload.purchaseUrl) base.purchaseUrl = payload.purchaseUrl;
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

