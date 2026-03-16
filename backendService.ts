
import { collection, getDocs, limit, query } from "firebase/firestore";
import { db } from "./firebase";
import { Product, UserPreferences } from "./types";

const STORAGE_KEY = "swipeshop_data";

// --- Local save/load (keeps your wishlist/cart between refreshes) ---
export const saveUserData = (data: UserPreferences) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
};

export const loadUserData = (): UserPreferences | null => {
  const data = localStorage.getItem(STORAGE_KEY);
  return data ? JSON.parse(data) : null;
};

// --- Firestore: load products ---
const toProduct = (docId: string, data: any): Product => {
  const displayName = data.displayName ?? data.title ?? data.name ?? "Untitled";

  return {
    id: docId,
    name: displayName,
    displayName,
    brand: data.brand ?? "Unknown",
    price: typeof data.price === "number" ? data.price : Number(data.price ?? 0),
    description: data.description ?? "",
    category: data.category ?? "Other",
    imageUrl: data.imageUrl ?? data.imageURL ?? "",
    tags: Array.isArray(data.tags) ? data.tags : [],
    roomTags: Array.isArray(data.roomTags) ? data.roomTags : [],
    styleTags: Array.isArray(data.styleTags) ? data.styleTags : [],
    matchScore: typeof data.matchScore === "number" ? data.matchScore : 85,
    primaryType: typeof data.primaryType === "string" ? data.primaryType : undefined,
    isCurated: typeof data.isCurated === "boolean" ? data.isCurated : undefined,
    swipeEligible: typeof data.swipeEligible === "boolean" ? data.swipeEligible : undefined,
    imageApproved: typeof data.imageApproved === "boolean" ? data.imageApproved : undefined,
    isLaunch: typeof data.isLaunch === "boolean" ? data.isLaunch : undefined,
    active: typeof data.active === "boolean" ? data.active : undefined,
  };
};

export const fetchProductsFromFirestore = async (max = 30): Promise<Product[]> => {
  const q = query(collection(db, "products"), limit(max));
  const snap = await getDocs(q);
  return snap.docs.map((d) => toProduct(d.id, d.data()));
};

// Backwards-compatible alias
export const fetchProducts = fetchProductsFromFirestore;