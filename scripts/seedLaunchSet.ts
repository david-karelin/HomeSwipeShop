import admin from "firebase-admin";
import fs from "node:fs";
import path from "node:path";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

type CanonicalCategory =
  | "lighting"
  | "wall-decor"
  | "storage"
  | "mirrors"
  | "plants"
  | "shelf-styling"
  | "desk-setup"
  | "cozy-bedroom";

type LaunchPrimaryType =
  | "lamp"
  | "sconce"
  | "poster"
  | "basket"
  | "organizer"
  | "shelf"
  | "mirror"
  | "pillow"
  | "tray"
  | "hook"
  | "bin"
  | "box"
  | "plant"
  | "decor";

type LaunchSetInput = {
  asin: string;
  displayName?: string;
  name?: string;
  brand?: string;
  category?: CanonicalCategory;
  primaryType?: LaunchPrimaryType;
  price?: number | string;
  imageUrl?: string;
  purchaseUrl?: string;
  description?: string;
  roomTags?: string[];
  styleTags?: string[];
  tags?: string[];
  launchBatch?: string;
  source?: "launch-set";
  curationScore?: number | string;
  allowedAbove60?: boolean;
  notes?: string;
  reviewedAt?: string;
  imageApproved?: boolean;
  isCurated?: boolean;
  swipeEligible?: boolean;
  active?: boolean;
};

const ALLOWED_CATEGORIES = new Set<CanonicalCategory>([
  "lighting",
  "wall-decor",
  "storage",
  "mirrors",
  "plants",
  "shelf-styling",
  "desk-setup",
  "cozy-bedroom",
]);

const ALLOWED_PRIMARY_TYPES = new Set<LaunchPrimaryType>([
  "lamp",
  "sconce",
  "poster",
  "basket",
  "organizer",
  "shelf",
  "mirror",
  "pillow",
  "tray",
  "hook",
  "bin",
  "box",
  "plant",
  "decor",
]);

const CATEGORY_PRIMARY_TYPES: Record<CanonicalCategory, LaunchPrimaryType[]> = {
  lighting: ["lamp", "sconce"],
  "wall-decor": ["poster", "decor", "shelf"],
  storage: ["basket", "organizer", "bin", "box", "hook"],
  mirrors: ["mirror"],
  plants: ["plant"],
  "shelf-styling": ["tray", "decor", "plant", "shelf"],
  "desk-setup": ["organizer", "lamp", "decor"],
  "cozy-bedroom": ["pillow", "decor"],
};

const keyPath = path.join(process.cwd(), "scripts", "serviceAccountKey.json");
const serviceAccount = JSON.parse(fs.readFileSync(keyPath, "utf8"));

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

const db = getFirestore();
const inputPath = path.join(process.cwd(), "scripts", "launchSet.json");

function toFiniteNumber(value: unknown, fallback = 0) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : fallback;
  }

  const normalized = String(value ?? "")
    .replace(/[^0-9.-]+/g, "")
    .trim();
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getDisplayName(item: LaunchSetInput) {
  return String(item.displayName ?? item.name ?? "").trim();
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

function isAsin(v: string) {
  return /^[A-Z0-9]{10}$/i.test(v.trim());
}

function sanitizeTags(item: LaunchSetInput) {
  const tags = canonicalizeTagList(item.tags);
  const category = canonicalizeTag(item.category || "storage");
  const price = toFiniteNumber(item.price, 0);
  const primaryType = inferPrimaryType(item);
  const roomTags = canonicalizeTagList(item.roomTags);
  const styleTags = canonicalizeTagList(item.styleTags);
  const out = new Set<string>([category, primaryType, "launch", "curated", ...roomTags, ...styleTags, ...tags]);

  if (price <= 30) out.add("under-30");
  if (price <= 50) out.add("under-50");
  if (price <= 60) out.add("budget");
  if (price <= 80) out.add("affordable");

  return Array.from(out);
}

function normalizeBlob(item: LaunchSetInput) {
  return [getDisplayName(item), item.category, item.description, item.primaryType, ...(item.tags || [])]
    .map((value) => String(value ?? "").toLowerCase())
    .join(" ");
}

function inferPrimaryType(item: LaunchSetInput): LaunchPrimaryType {
  const explicitPrimaryType = String(item.primaryType || "").trim().toLowerCase() as LaunchPrimaryType | "";
  if (explicitPrimaryType) return explicitPrimaryType;

  const blob = normalizeBlob(item);
  if (blob.includes("basket")) return "basket";
  if (blob.includes("organizer")) return "organizer";
  if (blob.includes("tray")) return "tray";
  if (blob.includes("shelf")) return "shelf";
  if (blob.includes("hook")) return "hook";
  if (blob.includes("bin")) return "bin";
  if (blob.includes("box")) return "box";
  if (blob.includes("mirror")) return "mirror";
  if (blob.includes("sconce")) return "sconce";
  if (blob.includes("lamp") || blob.includes("lighting") || blob.includes("light")) return "lamp";
  if (blob.includes("poster") || blob.includes("print") || blob.includes("wall art") || blob.includes("canvas")) return "poster";
  if (blob.includes("plant") || blob.includes("planter") || blob.includes("vase")) return "plant";
  if (blob.includes("pillow") || blob.includes("blanket") || blob.includes("throw")) return "pillow";
  return "decor";
}

function validate(item: LaunchSetInput, i: number) {
  const index = i + 1;
  const asin = String(item.asin || "").trim().toUpperCase();
  const displayName = getDisplayName(item);
  const brand = String(item.brand || "").trim();
  const imageUrl = String(item.imageUrl || "").trim();
  const description = String(item.description || "").trim();
  const purchaseUrl = String(item.purchaseUrl || "").trim();
  const price = toFiniteNumber(item.price, 0);
  const primaryType = inferPrimaryType(item);
  const category = String(item.category || "").trim().toLowerCase() as CanonicalCategory;
  const launchBatch = String(item.launchBatch || "").trim();
  const source = item.source ?? "launch-set";
  const curationScore = toFiniteNumber(item.curationScore, 0);
  const notes = String(item.notes || "").trim();
  const reviewedAt = String(item.reviewedAt || "").trim();

  if (!isAsin(asin)) throw new Error(`Item ${index}: invalid asin`);
  if (!displayName) throw new Error(`Item ${index}: missing displayName`);
  if (!brand) throw new Error(`Item ${index}: missing brand`);
  if (!ALLOWED_PRIMARY_TYPES.has(primaryType)) {
    throw new Error(`Item ${index}: invalid primaryType "${primaryType}"`);
  }
  if (!ALLOWED_CATEGORIES.has(category)) throw new Error(`Item ${index}: category must be one of the canonical swipe categories`);
  if (!CATEGORY_PRIMARY_TYPES[category]?.includes(primaryType)) {
    throw new Error(`Item ${index}: primaryType ${primaryType} not allowed for ${category}`);
  }
  if (!launchBatch) throw new Error(`Item ${index}: missing launchBatch`);
  if (source !== "launch-set") throw new Error(`Item ${index}: source must be launch-set`);
  if (curationScore < 18) throw new Error(`Item ${index}: curationScore must be 18 or higher`);
  if (!imageUrl.startsWith("http")) throw new Error(`Item ${index}: imageUrl must be an http(s) URL`);
  if (/picsum\.photos|placehold\.co|via\.placeholder\.com|placeholder\.com|dummyimage\.com/i.test(imageUrl)) {
    throw new Error(`Item ${index}: imageUrl must be a real product image, not a placeholder host`);
  }
  if (!description) throw new Error(`Item ${index}: missing description`);
  if (!purchaseUrl.includes(`/dp/${asin}`)) throw new Error(`Item ${index}: purchaseUrl must contain /dp/${asin}`);
  if (!Number.isFinite(price) || price <= 0) throw new Error(`Item ${index}: invalid price`);
  if (price > 80) throw new Error(`Item ${index}: price must be $80 or less for the curated main feed`);
  if (reviewedAt && Number.isNaN(Date.parse(reviewedAt))) {
    throw new Error(`Item ${index}: reviewedAt must be a valid date string`);
  }

  const isAllowedPremium =
    price > 60 &&
    (category === "lighting" || category === "mirrors") &&
    item.allowedAbove60 === true;

  if (price > 60 && !isAllowedPremium) {
    throw new Error(`Item ${index}: over-$60 item must be explicitly allowed and in lighting or mirrors`);
  }

  return {
    asin,
    displayName,
    brand,
    imageUrl,
    description,
    purchaseUrl,
    price,
    category,
    primaryType,
    launchBatch,
    source,
    curationScore,
    allowedAbove60: item.allowedAbove60 === true,
    notes,
    reviewedAt,
  };
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  if (!fs.existsSync(inputPath)) {
    console.error(`Missing ${inputPath}. Create it from scripts/launchSet.example.json first.`);
    process.exit(1);
  }

  const raw = fs.readFileSync(inputPath, "utf8");
  const items = JSON.parse(raw) as LaunchSetInput[];

  if (!Array.isArray(items) || items.length === 0) {
    console.error("launchSet.json is empty. Add 30-50 curated products and rerun.");
    process.exit(1);
  }

  const seenAsins = new Set<string>();

  for (const [i, item] of items.entries()) {
    const asin = String(item.asin || "").trim().toUpperCase();
    if (seenAsins.has(asin)) {
      throw new Error(`Duplicate ASIN in launchSet.json at item ${i + 1}: ${asin}`);
    }
    seenAsins.add(asin);
  }

  const prepared = items.map((item, index) => {
    const checked = validate(item, index);
    return {
      item,
      checked,
      docId: `amazon_${checked.asin}`,
      legacyDocId: `launch_${checked.asin}`,
    };
  });

  const existingDocs = await db.getAll(
    ...prepared.flatMap(({ docId, legacyDocId }) => [
      db.collection("products").doc(docId),
      db.collection("products").doc(legacyDocId),
    ])
  );
  const existingById = new Map(existingDocs.map((docSnap) => [docSnap.id, docSnap]));
  const hasCreatedAtById = new Map(
    prepared.map(({ docId }) => [docId, existingById.get(docId)?.get("createdAt") != null])
  );

  let updated = 0;
  let batch = db.batch();
  let inBatch = 0;

  for (const { item, checked, docId, legacyDocId } of prepared) {
    const price = toFiniteNumber(item.price, 0);
    const payload: Record<string, unknown> = {
      name: checked.displayName,
      displayName: checked.displayName,
      title: checked.displayName,
      brand: checked.brand,
      category: checked.category,
      primaryType: checked.primaryType,
      imageUrl: checked.imageUrl,
      description: checked.description,
      roomTags: Array.isArray(item.roomTags) ? item.roomTags.map((x) => String(x).trim().toLowerCase()).filter(Boolean) : [],
      styleTags: Array.isArray(item.styleTags) ? item.styleTags.map((x) => String(x).trim().toLowerCase()).filter(Boolean) : [],
      tags: sanitizeTags(item),
      price: Number.isFinite(price) ? price : 0,
      matchScore: FieldValue.delete(),
      asin: checked.asin,
      checkoutType: "affiliate",
      merchant: "Amazon",
      purchaseUrl: checked.purchaseUrl,
      isCurated: item.isCurated ?? true,
      swipeEligible: item.swipeEligible ?? true,
      imageApproved: item.imageApproved ?? true,
      isLaunch: true,
      active: item.active ?? true,
      source: checked.source,
      launchBatch: checked.launchBatch,
      curationScore: checked.curationScore,
      allowedAbove60: checked.allowedAbove60,
      notes: checked.notes || FieldValue.delete(),
      reviewedAt: checked.reviewedAt || FieldValue.delete(),
      curationVersion: 1,
      updatedAt: FieldValue.serverTimestamp(),
    };

    if (!hasCreatedAtById.get(docId)) {
      payload.createdAt = FieldValue.serverTimestamp();
    }

    batch.set(
      db.collection("products").doc(docId),
      payload,
      { merge: true }
    );

    if (legacyDocId !== docId && existingById.get(legacyDocId)?.exists) {
      batch.set(
        db.collection("products").doc(legacyDocId),
        {
          active: false,
          swipeEligible: false,
          imageApproved: false,
          isCurated: false,
          legacyStatus: "replaced_by_amazon_id",
          replacedBy: docId,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }

    updated++;
    inBatch++;

    if (inBatch >= 450) {
      if (!dryRun) await batch.commit();
      console.log(`${dryRun ? "[DRY RUN] " : ""}Committed batch. Updated so far: ${updated}`);
      batch = db.batch();
      inBatch = 0;
    }
  }

  if (inBatch > 0) {
    if (!dryRun) await batch.commit();
    console.log(`${dryRun ? "[DRY RUN] " : ""}Committed final batch. Total updated: ${updated}`);
  }

  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
