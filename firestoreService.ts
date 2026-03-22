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
import {
  browserLocalPersistence,
  browserSessionPersistence,
  inMemoryPersistence,
  onAuthStateChanged,
  setPersistence,
  signInAnonymously,
  type User,
} from "firebase/auth";
import { auth, db } from "./firebase";
import { INTEREST_QUERY_TAGS, SWIPE_FEED_RULES, normalizeInterestIds } from "./src/constants";
import { logDiscoveryDebug } from "./src/lib/debug";
import { filterLaunchCatalogProducts } from "./src/lib/launchCatalog";
import type { CanonicalCategory, PrimaryType, Product } from "./types";

export { db, auth };

let _ensureUserPromise: Promise<User> | null = null;
let readyPromise: Promise<User> | null = null;

export async function ensureUser(): Promise<User> {
  if (auth.currentUser) return auth.currentUser;

  if (!_ensureUserPromise) {
    _ensureUserPromise = (async () => {
      try {
        await setPersistence(auth, browserLocalPersistence);
      } catch {
        try {
          await setPersistence(auth, browserSessionPersistence);
        } catch {
          try {
            await setPersistence(auth, inMemoryPersistence);
          } catch {
            // ignore persistence failures
          }
        }
      }

      const cred = await signInAnonymously(auth);
      return cred.user;
    })().finally(() => {
      _ensureUserPromise = null;
    });
  }

  return _ensureUserPromise;
}

export function ensureUserReady(): Promise<User> {
  if (readyPromise) return readyPromise;

  readyPromise = (async () => {
    const user = await ensureUser();

    if (!auth.currentUser || auth.currentUser.uid !== user.uid) {
      await new Promise<void>((resolve, reject) => {
        const unsub = onAuthStateChanged(
          auth,
          (u) => {
            if (u && u.uid === user.uid) {
              unsub();
              resolve();
            }
          },
          (err) => {
            unsub();
            reject(err);
          }
        );

        setTimeout(() => {
          try {
            unsub();
          } catch {
            // ignore
          }
          reject(new Error("Auth state not ready (timeout)"));
        }, 8000);
      });
    }

    await user.getIdToken(true);

    await new Promise((r) => setTimeout(r, 0));

    return user;
  })().catch((e) => {
    readyPromise = null;
    throw e;
  });

  return readyPromise;
}

function normalizeTerm(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function canonicalizeTag(value: unknown) {
  return String(value ?? "")
    .toLowerCase()
    .trim()
    .replace(/&/g, "and")
    .replace(/[’']/g, "")
    .replace(/[_\s]+/g, "-")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function canonicalizeTagList(values: unknown) {
  if (!Array.isArray(values)) return [];

  return Array.from(new Set(values.map((value) => canonicalizeTag(value)).filter(Boolean)));
}

function withLegacyTagVariants(tags: string[]) {
  const out: string[] = [];
  const seen = new Set<string>();

  for (const raw of tags) {
    const canonical = canonicalizeTag(raw);
    const spaced = canonical.replace(/-/g, " ");

    for (const value of [canonical, spaced]) {
      if (!value || seen.has(value)) continue;
      seen.add(value);
      out.push(value);
    }
  }

  return out;
}

const ALLOWED_CATEGORIES: CanonicalCategory[] = [
  "lighting",
  "wall-decor",
  "storage",
  "mirrors",
  "plants",
  "shelf-styling",
  "desk-setup",
  "cozy-bedroom",
];

const CATEGORY_MAP: Record<string, CanonicalCategory> = {
  lighting: "lighting",
  lights: "lighting",
  lamp: "lighting",

  mirrors: "mirrors",
  mirror: "mirrors",

  storage: "storage",
  organizer: "storage",
  organizers: "storage",

  shelf: "shelf-styling",
  shelves: "shelf-styling",
  "shelf-styling": "shelf-styling",

  plants: "plants",
  plant: "plants",

  bedding: "cozy-bedroom",
  bedroom: "cozy-bedroom",
  pillows: "cozy-bedroom",
  pillow: "cozy-bedroom",

  "wall decor": "wall-decor",
  "wall-decor": "wall-decor",
  art: "wall-decor",
  poster: "wall-decor",

  desk: "desk-setup",
  workspace: "desk-setup",
};

function inferCanonicalCategory(blob: string, primaryType: PrimaryType, rawCategory: string): CanonicalCategory {
  const normalizedCategory = normalizeTerm(rawCategory);
  if (CATEGORY_MAP[normalizedCategory]) return CATEGORY_MAP[normalizedCategory];
  if ((ALLOWED_CATEGORIES as string[]).includes(normalizedCategory)) return normalizedCategory as CanonicalCategory;

  if (primaryType === "lamp" || primaryType === "sconce" || blob.includes(" sconce ") || blob.includes(" lighting ") || blob.includes(" light ")) return "lighting";
  if (primaryType === "mirror" || blob.includes(" mirror ")) return "mirrors";
  if (primaryType === "poster" || blob.includes(" wall art ") || blob.includes(" poster ") || blob.includes(" print ") || blob.includes(" canvas ")) {
    return "wall-decor";
  }
  if (["basket", "organizer", "tray", "hook", "bin", "box"].includes(primaryType) || blob.includes(" storage ")) {
    return "storage";
  }
  if (primaryType === "shelf" || blob.includes(" shelf ") || blob.includes(" ledge ") || blob.includes(" bookend ")) {
    return "shelf-styling";
  }
  if (primaryType === "plant" || blob.includes(" plant ") || blob.includes(" planter ") || blob.includes(" greenery ")) return "plants";
  if (primaryType === "pillow" || blob.includes(" pillow ") || blob.includes(" blanket ") || blob.includes(" throw ") || blob.includes(" bedroom ") || blob.includes(" nightstand ")) {
    return "cozy-bedroom";
  }
  if (blob.includes(" desk ") || blob.includes(" workspace ") || blob.includes(" pegboard ") || blob.includes(" monitor ")) return "desk-setup";

  return "storage";
}

function inferRoomTags(primaryType: PrimaryType, tags: string[]) {
  const out = [...tags];
  if (primaryType === "lamp") out.push("bedroom", "desk");
  if (primaryType === "sconce") out.push("wall", "bedroom");
  if (primaryType === "poster") out.push("wall", "bedroom");
  if (["basket", "organizer", "tray", "hook", "bin", "box"].includes(primaryType)) out.push("small-space", "desk");
  if (primaryType === "mirror") out.push("bedroom", "wall");
  if (primaryType === "shelf") out.push("wall", "small-space");
  if (primaryType === "pillow") out.push("bedroom");
  if (primaryType === "plant") out.push("bedroom", "desk");

  return Array.from(
    new Set(
      out
        .map((tag) => canonicalizeTag(tag))
        .filter((tag) => ["bedroom", "desk", "wall", "small-space", "living-room", "entryway"].includes(tag))
    )
  );
}

function inferStyleTags(blob: string) {
  const out = new Set<string>();

  if (blob.includes(" cozy ") || blob.includes(" soft ")) out.add("cozy");
  if (blob.includes(" minimal ") || blob.includes(" minimalist ")) out.add("minimal");
  if (blob.includes(" modern ") || blob.includes(" sleek ")) out.add("modern");
  if (blob.includes(" warm ")) out.add("warm");
  if (blob.includes(" neutral ")) out.add("neutral");
  if (blob.includes(" natural ") || blob.includes(" wood ") || blob.includes(" rattan ") || blob.includes(" linen ") || blob.includes(" jute ")) {
    out.add("natural");
  }

  return Array.from(out);
}

function buildStructuredTags(
  primaryType: PrimaryType,
  category: CanonicalCategory,
  price: number,
  oldTags: string[]
) {
  const tags = [primaryType, category, ...oldTags];

  if (price <= 30) tags.push("under-30", "budget");
  if (price <= 50) tags.push("under-50");
  if (price <= 80) tags.push("affordable");

  if (["basket", "organizer", "tray", "hook", "bin", "box", "shelf"].includes(primaryType)) {
    tags.push("small-space");
  }

  return Array.from(new Set(tags.map((tag) => canonicalizeTag(tag)).filter(Boolean)));
}

function isApprovedImageUrl(url: string) {
  const lower = String(url || "").trim().toLowerCase();
  return lower.startsWith("http") && !SWIPE_FEED_RULES.placeholderImageHosts.some((host) => lower.includes(host));
}

function isIndexFallbackError(error: unknown) {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "failed-precondition";
}

function normalizeProductsFromDocs(docs: Array<{ id: string; data(): any }>) {
  return filterLaunchCatalogProducts(
    docs
      .map((docSnap) => normalizeProduct(docSnap.id, docSnap.data()))
      .filter((product) => product.active !== false && product.swipeEligible !== false)
  );
}

function normalizeApprovedProductsFromDocs(docs: Array<{ id: string; data(): any }>) {
  return normalizeProductsFromDocs(docs).filter((product) => product.imageApproved === true);
}

function sliceInterestMatches(products: Product[], queryTags: string[], take: number) {
  const matched = queryTags.length > 0
    ? products.filter((product) => matchesInterestTags(product, queryTags))
    : products;

  return matched.slice(0, take);
}

async function fetchLooseInterestMatches(
  queryTags: string[],
  take: number,
  opts: { curatedOnly?: boolean } = {}
) {
  const col = collection(db, "products");
  const looseTake = Math.max(take * 4, 120);
  const constrainedQuery = opts.curatedOnly
    ? queryTags.length > 0
      ? query(col, where("isCurated", "==", true), where("tags", "array-contains-any", queryTags), limit(looseTake))
      : query(col, where("isCurated", "==", true), limit(looseTake))
    : queryTags.length > 0
      ? query(col, where("tags", "array-contains-any", queryTags), limit(looseTake))
      : query(col, limit(looseTake));

  const constrainedSnap = await getDocs(constrainedQuery);
  const constrainedItems = sliceInterestMatches(normalizeApprovedProductsFromDocs(constrainedSnap.docs), queryTags, take);
  if (constrainedItems.length > 0 || queryTags.length === 0) return constrainedItems;

  const broadQuery = opts.curatedOnly
    ? query(col, where("isCurated", "==", true), limit(looseTake))
    : query(col, limit(looseTake));
  const broadSnap = await getDocs(broadQuery);

  return sliceInterestMatches(normalizeApprovedProductsFromDocs(broadSnap.docs), queryTags, take);
}

function inferSwipeEligible(
  price: number,
  primaryType: PrimaryType,
  imageUrl: string,
  active: boolean,
  _blob: string
) {
  if (!active) return false;
  if (!isApprovedImageUrl(imageUrl)) return false;
  if (price <= 0 || price > 80) return false;
  if (["shelf"].includes(primaryType) && price > 60) return false;
  return true;
}

function inferPrimaryTypeFromBlob(blob: string) {
  if (blob.includes(" basket ")) return "basket";
  if (blob.includes(" organizer ")) return "organizer";
  if (blob.includes(" tray ")) return "tray";
  if (blob.includes(" shelf ")) return "shelf";
  if (blob.includes(" hook ")) return "hook";
  if (blob.includes(" bin ")) return "bin";
  if (blob.includes(" box ")) return "box";
  if (blob.includes(" mirror ")) return "mirror";
  if (blob.includes(" sconce ")) return "sconce";
  if (blob.includes(" lamp ") || blob.includes(" lighting ") || blob.includes(" light ")) return "lamp";
  if (blob.includes(" poster ") || blob.includes(" print ") || blob.includes(" wall art ") || blob.includes(" canvas ")) {
    return "poster";
  }
  if (blob.includes(" plant ") || blob.includes(" planter ") || blob.includes(" vase ")) return "plant";
  if (blob.includes(" pillow ") || blob.includes(" blanket ") || blob.includes(" throw ")) return "pillow";

  return "organizer";
}

function matchesInterestTags(product: Product, queryTags: string[]) {
  if (queryTags.length === 0) return true;

  const tagSet = new Set((product.tags || []).map((tag) => canonicalizeTag(tag)));
  const values = [
    product.displayName,
    product.name,
    product.category,
    product.description,
    product.primaryType,
    ...(product.roomTags || []),
    ...(product.styleTags || []),
    ...(product.tags || []),
  ];
  const canonicalBlob = values.map((value) => canonicalizeTag(value)).filter(Boolean).join(" ");
  const normalizedBlob = values.map((value) => normalizeTerm(String(value ?? ""))).filter(Boolean).join(" ");

  return queryTags.some((tag) => {
    const canonicalTag = canonicalizeTag(tag);
    const normalizedTag = normalizeTerm(String(tag ?? ""));
    return tagSet.has(canonicalTag) || canonicalBlob.includes(canonicalTag) || normalizedBlob.includes(normalizedTag);
  });
}

// Maps Firestore docs to your existing Product type (fills missing fields safely)
function normalizeProduct(id: string, data: any): Product {
  const price = toFiniteNumber(data.price, 0);

  const safeDisplayName = String(data.displayName ?? data.title ?? data.name ?? "Untitled").trim();
  const safeBrand =
    data.brand && String(data.brand).trim().length > 0
      ? String(data.brand).trim()
      : "Seligo.AI";
  const safeDescription = String(data.description ?? "No description yet.").trim();
  const hasBadDescription =
    !safeDescription ||
    safeDescription.toLowerCase().includes("placeholder") ||
    safeDescription.toLowerCase().includes("testing") ||
    safeDescription.toLowerCase().includes("no description");
  const betterDescription = hasBadDescription ? "" : safeDescription;
  const safeCategoryRaw = String(data.category ?? "General").trim();
  const rawImageUrl = String(data.imageUrl ?? data.imageURL ?? "").trim();
  const safeImageUrl = rawImageUrl || "https://picsum.photos/seed/fallback/600/600";
  const explicitPrimaryType = String(data.primaryType ?? "").trim().toLowerCase() as PrimaryType | "";
  const isCurated = Boolean(data.isCurated ?? data.isLaunch ?? false);
  const imageApproved =
    typeof data.imageApproved === "boolean"
      ? data.imageApproved
      : isApprovedImageUrl(rawImageUrl);
  const active = data.active !== false;

  const rawBaseTags = canonicalizeTagList(data.tags);
  const rawRoomTags = canonicalizeTagList(data.roomTags);
  const rawStyleTags = canonicalizeTagList(data.styleTags);

  const textBlob = `${safeDisplayName} ${safeCategoryRaw} ${betterDescription} ${rawBaseTags.join(" ")} ${rawRoomTags.join(" ")} ${rawStyleTags.join(" ")}`.toLowerCase();
  const normalizedBlob = ` ${normalizeTerm(textBlob)} `;
  const hasTerm = (term: string) => normalizedBlob.includes(` ${normalizeTerm(term)} `);
  const extraTags: string[] = [];

  // price tags
  if (price <= 30) extraTags.push("under-30", "budget");
  if (price <= 50) extraTags.push("under-50");
  if (price <= 80) extraTags.push("affordable");

  // room / use tags
  if (hasTerm("desk")) extraTags.push("desk", "desk-setup");
  if (hasTerm("workspace")) extraTags.push("desk", "desk-setup");
  if (hasTerm("bedroom")) extraTags.push("bedroom", "cozy-bedroom");
  if (hasTerm("nightstand")) extraTags.push("nightstand", "cozy-bedroom");
  if (hasTerm("wall")) extraTags.push("wall", "wall-decor");
  if (hasTerm("entryway")) extraTags.push("entryway");
  if (hasTerm("living room")) extraTags.push("living-room");

  // function tags
  if (hasTerm("lamp") || hasTerm("lighting") || hasTerm("light")) {
    extraTags.push("lighting", "lamp");
  }

  if (hasTerm("mirror")) {
    extraTags.push("mirror", "mirrors");
  }

  if (
    hasTerm("print") ||
    hasTerm("poster") ||
    hasTerm("wall art") ||
    hasTerm("framed")
  ) {
    extraTags.push("wall-decor", "art", "print");
  }

  if (
    hasTerm("storage") ||
    hasTerm("organizer") ||
    hasTerm("basket") ||
    hasTerm("bin") ||
    hasTerm("tray")
  ) {
    extraTags.push("storage", "organizer");
  }

  if (
    hasTerm("shelf") ||
    hasTerm("ledge") ||
    hasTerm("bookend")
  ) {
    extraTags.push("shelf-styling", "shelf");
  }

  if (
    hasTerm("plant") ||
    hasTerm("planter") ||
    hasTerm("greenery") ||
    hasTerm("vase")
  ) {
    extraTags.push("plants", "plant");
  }

  if (
    hasTerm("pillow") ||
    hasTerm("blanket") ||
    hasTerm("throw")
  ) {
    extraTags.push("cozy-bedroom", "cozy");
  }

  // style / vibe tags
  if (hasTerm("cozy")) extraTags.push("cozy");
  if (hasTerm("minimal")) extraTags.push("minimal");
  if (hasTerm("modern")) extraTags.push("modern");
  if (hasTerm("warm")) extraTags.push("warm");
  if (hasTerm("neutral")) extraTags.push("neutral");
  if (hasTerm("wood")) extraTags.push("wood");
  if (hasTerm("soft")) extraTags.push("soft");

  // fit / lifestyle tags
  if (hasTerm("small space")) extraTags.push("small-space-fixes", "small-space");
  if (hasTerm("compact")) extraTags.push("small-space-fixes", "compact");
  if (hasTerm("renter")) extraTags.push("small-space-fixes", "renter-friendly");

  const primaryType = (explicitPrimaryType || inferPrimaryTypeFromBlob(` ${normalizeTerm(`${safeDisplayName} ${safeCategoryRaw} ${betterDescription} ${rawBaseTags.join(" ")} ${extraTags.join(" ")}`)} `)) as PrimaryType;
  const canonicalCategory = inferCanonicalCategory(normalizedBlob, primaryType, safeCategoryRaw);
  const roomTags = Array.from(new Set([
    ...rawRoomTags,
    ...inferRoomTags(primaryType, [...rawBaseTags, ...extraTags]),
  ])).filter(Boolean);
  const styleTags = Array.from(
    new Set([
      ...rawStyleTags,
      ...inferStyleTags(normalizedBlob),
    ])
  ).filter(Boolean);
  const tags = buildStructuredTags(primaryType, canonicalCategory, price, [
    ...rawBaseTags,
    ...extraTags,
    ...roomTags,
    ...styleTags,
  ]);
  const swipeEligible =
    typeof data.swipeEligible === "boolean"
      ? data.swipeEligible
      : inferSwipeEligible(price, primaryType, rawImageUrl, active, normalizedBlob);

  return {
    id,
    name: safeDisplayName,
    displayName: safeDisplayName,
    brand: safeBrand,
    price,
    description: betterDescription,
    category: canonicalCategory,
    imageUrl: safeImageUrl,
    tags,
    roomTags,
    styleTags,
    matchScore: Number(data.matchScore ?? 85),
    primaryType,
    isCurated,
    swipeEligible,
    imageApproved,
    isLaunch: Boolean(data.isLaunch),
    active,
    checkoutType: data.checkoutType,
    merchant: data.merchant,
    purchaseUrl: data.purchaseUrl,
    asin: data.asin,
  };
}

function expandInterestTags(interests: string[]) {
  const normalizedInterests = normalizeInterestIds(interests);

  const mappedGroups = normalizedInterests.map((interest) => {
    const mapped = withLegacyTagVariants(INTEREST_QUERY_TAGS[interest] ?? []);
    return mapped.length ? mapped : [canonicalizeTag(interest)];
  });

  const expanded: string[] = [];
  const seen = new Set<string>();

  for (let tagIndex = 0; expanded.length < 10; tagIndex += 1) {
    let addedThisRound = false;

    for (const group of mappedGroups) {
      const tag = group[tagIndex];
      if (!tag || seen.has(tag)) continue;

      seen.add(tag);
      expanded.push(tag);
      addedThisRound = true;

      if (expanded.length === 10) break;
    }

    if (!addedThisRound) break;
  }

  for (const interest of normalizedInterests) {
    if (expanded.length === 10) break;

    const tag = canonicalizeTag(interest);
    if (!tag || seen.has(tag)) continue;

    seen.add(tag);
    expanded.push(tag);
  }

  return expanded;
}

// Load products (tries to match tags with your selected interests)
export async function fetchProductsByInterests(interests: string[], take = 20): Promise<Product[]> {
  const queryTags = expandInterestTags(interests);
  logDiscoveryDebug("expanded query tags snapshot", JSON.stringify(queryTags));

  const col = collection(db, "products");

  try {
    const q = queryTags.length > 0
      ? query(
          col,
          where("active", "==", true),
          where("swipeEligible", "==", true),
          where("imageApproved", "==", true),
          where("tags", "array-contains-any", queryTags),
          orderBy("updatedAt", "desc"),
          limit(take)
        )
      : query(
          col,
          where("active", "==", true),
          where("swipeEligible", "==", true),
          where("imageApproved", "==", true),
          orderBy("updatedAt", "desc"),
          limit(take)
        );

    const snap = await getDocs(q);
    const items = sliceInterestMatches(normalizeApprovedProductsFromDocs(snap.docs), queryTags, take);
    if (items.length > 0) return items;

    return fetchLooseInterestMatches(queryTags, take);
  } catch (error) {
    if (!isIndexFallbackError(error)) throw error;

    return fetchLooseInterestMatches(queryTags, take);
  }
}

export async function fetchCuratedProductsByInterests(interests: string[], take = 60): Promise<Product[]> {
  const queryTags = expandInterestTags(interests);
  logDiscoveryDebug("expanded query tags snapshot", JSON.stringify(queryTags));
  const col = collection(db, "products");
  try {
    const q = query(
      col,
      where("isCurated", "==", true),
      where("active", "==", true),
      where("swipeEligible", "==", true),
      where("imageApproved", "==", true),
      orderBy("updatedAt", "desc"),
      limit(Math.max(take, 120))
    );
    const snap = await getDocs(q);
    logDiscoveryDebug("curated snap.docs.length", snap.docs.length);
    logDiscoveryDebug(
      "curated raw docs snapshot",
      snap.docs.slice(0, 5).map((d) => ({
        id: d.id,
        isCurated: d.data().isCurated,
        active: d.data().active,
        swipeEligible: d.data().swipeEligible,
        imageApproved: d.data().imageApproved,
        updatedAt: d.data().updatedAt,
        category: d.data().category,
        primaryType: d.data().primaryType,
        tags: d.data().tags,
        roomTags: d.data().roomTags,
        styleTags: d.data().styleTags,
      }))
    );

    const normalized = normalizeApprovedProductsFromDocs(snap.docs);
    logDiscoveryDebug("curated normalized length", normalized.length);

    const matched = sliceInterestMatches(normalized, queryTags, take);
    const items = matched.length >= take
      ? matched
      : [
          ...matched,
          ...normalized
            .filter((product) => !matched.some((candidate) => candidate.id === product.id))
            .slice(0, take - matched.length),
        ];
    logDiscoveryDebug("curated sliced length", items.length);
    logDiscoveryDebug(
      "curated sliced snapshot",
      items.slice(0, 5).map((p) => ({
        id: p.id,
        category: p.category,
        primaryType: p.primaryType,
        tags: p.tags,
        roomTags: p.roomTags,
        styleTags: p.styleTags,
      }))
    );
    if (items.length > 0) return items;

    const loose = await fetchLooseInterestMatches(queryTags, take, { curatedOnly: true });
    logDiscoveryDebug("curated loose fallback length", loose.length);
    return loose;
  } catch (error) {
    if (!isIndexFallbackError(error)) throw error;

    const loose = await fetchLooseInterestMatches(queryTags, take, { curatedOnly: true });
    logDiscoveryDebug("curated loose fallback length after index fallback", loose.length);
    return loose;
  }
}

// Save swipe to Firestore
// Load all products from Firestore (no interest filtering)
export async function fetchProducts(take = 30): Promise<Product[]> {
  const col = collection(db, "products");
  try {
    const q = query(
      col,
      where("active", "==", true),
      where("swipeEligible", "==", true),
      where("imageApproved", "==", true),
      orderBy("updatedAt", "desc"),
      limit(take)
    );
    const snap = await getDocs(q);
    const items = normalizeApprovedProductsFromDocs(snap.docs).slice(0, take);
    if (items.length > 0) return items;

    return fetchLooseInterestMatches([], take);
  } catch (error) {
    if (!isIndexFallbackError(error)) throw error;

    return fetchLooseInterestMatches([], take);
  }
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

  let snap;
  try {
    const q = cursor
      ? query(
          col,
          where("active", "==", true),
          where("swipeEligible", "==", true),
          where("imageApproved", "==", true),
          orderBy("updatedAt", "desc"),
          orderBy("__name__"),
          startAfter(cursor),
          limit(take)
        )
      : query(
          col,
          where("active", "==", true),
          where("swipeEligible", "==", true),
          where("imageApproved", "==", true),
          orderBy("updatedAt", "desc"),
          orderBy("__name__"),
          limit(take)
        );

    snap = await getDocs(q);
  } catch (error) {
    if (!isIndexFallbackError(error)) throw error;

    const fallbackQuery = cursor
      ? query(col, orderBy("__name__"), startAfter(cursor), limit(take))
      : query(col, orderBy("__name__"), limit(take));

    snap = await getDocs(fallbackQuery);
  }

  const items = normalizeApprovedProductsFromDocs(snap.docs);
  if (!cursor && items.length === 0) {
    return {
      items: await fetchLooseInterestMatches([], take),
      cursor: null,
      hasMore: false,
    };
  }
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
  const queryTags = expandInterestTags(interests);
  logDiscoveryDebug("expanded query tags snapshot", JSON.stringify(queryTags));
  const col = collection(db, "products");

  // if no interests, fallback to normal paging
  if (queryTags.length === 0) return fetchProductsPage(take, cursor);

  let snap;
  try {
    const q = cursor
      ? query(
          col,
          where("active", "==", true),
          where("swipeEligible", "==", true),
          where("imageApproved", "==", true),
          where("tags", "array-contains-any", queryTags),
          orderBy("updatedAt", "desc"),
          orderBy("__name__"),
          startAfter(cursor),
          limit(take)
        )
      : query(
          col,
          where("active", "==", true),
          where("swipeEligible", "==", true),
          where("imageApproved", "==", true),
          where("tags", "array-contains-any", queryTags),
          orderBy("updatedAt", "desc"),
          orderBy("__name__"),
          limit(take)
        );

    snap = await getDocs(q);
  } catch (error) {
    if (!isIndexFallbackError(error)) throw error;

    const fallbackQuery = cursor
      ? query(
          col,
          where("tags", "array-contains-any", queryTags),
          orderBy("__name__"),
          startAfter(cursor),
          limit(take)
        )
      : query(
          col,
          where("tags", "array-contains-any", queryTags),
          orderBy("__name__"),
          limit(take)
        );

    snap = await getDocs(fallbackQuery);
  }

  const items = sliceInterestMatches(normalizeApprovedProductsFromDocs(snap.docs), queryTags, take);
  if (!cursor && items.length === 0) {
    return {
      items: await fetchLooseInterestMatches(queryTags, take),
      cursor: null,
      hasMore: false,
    };
  }
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

function toFiniteNumber(v: any, fallback = 0) {
  if (typeof v === "number") {
    return Number.isFinite(v) ? v : fallback;
  }

  const normalized = String(v ?? "")
    .replace(/[^0-9.-]+/g, "")
    .trim();
  const n = Number(normalized);
  return Number.isFinite(n) ? n : fallback;
}

function toSafeInt(v: any, fallback = 0) {
  const n = toFiniteNumber(v, fallback);
  const i = Math.trunc(n);
  return Number.isSafeInteger(i) ? i : fallback;
}

function isPermissionDenied(e: any) {
  return e?.code === "permission-denied" || String(e?.message ?? "").includes("permission-denied");
}

export async function saveLead(payload: {
  email: string;
  subtotal: number;
  bagCount: number;
  wishlistCount: number;
  source?: string;
  view?: string;
  meta?: Record<string, any>;
}) {
  const writeOnce = async () => {
    const user = await ensureUserReady();
    const email = payload.email.trim().toLowerCase();

    const subtotal = toFiniteNumber(payload.subtotal, 0);
    const bagCount = toSafeInt(payload.bagCount, 0);
    const wishlistCount = toSafeInt(payload.wishlistCount, 0);

    const docPayload: Record<string, any> = {
      uid: user.uid,
      email,
      subtotal,
      bagCount,
      wishlistCount,
      source: payload.source ?? "checkout_modal",
      view: payload.view ?? "cart",
      createdAt: serverTimestamp(),
    };

    if (payload.meta && typeof payload.meta === "object" && !Array.isArray(payload.meta)) {
      docPayload.meta = payload.meta;
    }

    return addDoc(collection(db, "leads"), docPayload);
  };

  let leadRef;
  try {
    leadRef = await writeOnce();
  } catch (e) {
    if (isPermissionDenied(e)) {
      await auth.currentUser?.getIdToken(true).catch(() => {});
      await new Promise((r) => setTimeout(r, 0));
      leadRef = await writeOnce();
    } else {
      throw e;
    }
  }

  const leadId = leadRef.id;
  const sid = `server_${leadId}`;

  void logEvent({
    type: "view_change",
    view: payload.view ?? "checkout",
    source: payload.source ?? "lead",
    meta: {
      panel: "lead_doc_created",
      leadId,
      sid,
    },
  }).catch((eventError) => {
    console.warn("lead_doc_created log failed:", eventError);
  });

  return { leadId, sid };
}

type EventType =
  | "buy_click"
  | "share_click"
  | "checkout_item_open"
  | "lead_submit"
  | "wishlist_add"
  | "wishlist_remove"
  | "cart_add"
  | "cart_remove"
  | "session_start"
  | "view_change"
  | "scan_start"
  | "scan_success"
  | "scan_fail"
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
  gclid: string;
  fbclid: string;
}>;

const UTM_KEYS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "gclid",
  "fbclid",
] as const;

export function getOrCreateSessionId() {
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
  for (const k of UTM_KEYS) {
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
  const allowed = new Set<string>(UTM_KEYS);
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
  utm?: UTM;
}) {
  persistUtmIfPresent();

  const user = await ensureUserReady();
  const sessionId = getOrCreateSessionId();
  const persistedUtmRaw = getPersistedUtm();
  const persistedUtm =
    persistedUtmRaw && typeof persistedUtmRaw === "object" && !Array.isArray(persistedUtmRaw) ? persistedUtmRaw : {};
  const payloadUtm =
    payload.utm && typeof payload.utm === "object" && !Array.isArray(payload.utm) ? sanitizeUtm(payload.utm) : {};
  const utm = {...persistedUtm, ...payloadUtm};

  const meta =
    payload.meta && typeof payload.meta === "object" && !Array.isArray(payload.meta)
      ? payload.meta
      : {};

  const needsPurchaseUrl =
    payload.type === "buy_click" || payload.type === "checkout_item_open";
  if (needsPurchaseUrl && !payload.purchaseUrl) {
    console.warn("[logEvent] missing purchaseUrl for", payload.type, payload);
    return;
  }

  const category = typeof meta?.category === "string" ? meta.category : null;
  const parsedPrice = Number(meta?.price);
  const price = Number.isFinite(parsedPrice) ? parsedPrice : null;

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
    meta,
    createdAt: serverTimestamp(),
  };

  if (needsPurchaseUrl) {
    base.purchaseUrl = payload.purchaseUrl;
  }

  try {
    await addDoc(collection(db, "events"), base);
  } catch (e) {
    console.warn("[logEvent] addDoc failed", e, base);
  }
}

