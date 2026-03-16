import admin from "firebase-admin";
import fs from "node:fs";
import path from "node:path";

type CanonicalCategory =
  | "lighting"
  | "wall-decor"
  | "storage"
  | "mirrors"
  | "plants"
  | "shelf-styling"
  | "desk-setup"
  | "cozy-bedroom";

type PrimaryType =
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

const keyPath = path.join(process.cwd(), "scripts", "serviceAccountKey.json");
const serviceAccount = JSON.parse(fs.readFileSync(keyPath, "utf8"));

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

const db = admin.firestore();

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

const PLACEHOLDER_IMAGE_HOSTS = [
  "picsum.photos",
  "placehold.co",
  "via.placeholder.com",
  "placeholder.com",
  "dummyimage.com",
];

function normalizeTerm(value: unknown) {
  return String(value ?? "")
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

function canonicalizeTagList(values: unknown) {
  if (!Array.isArray(values)) return [];
  return Array.from(new Set(values.map((value) => canonicalizeTag(value)).filter(Boolean)));
}

function hasUsableImageUrl(url: string) {
  const lower = String(url || "").trim().toLowerCase();
  return lower.startsWith("http") && !PLACEHOLDER_IMAGE_HOSTS.some((host) => lower.includes(host));
}

function inferPrimaryType(blob: string): PrimaryType {
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
  if (primaryType === "plant" || blob.includes(" plant ") || blob.includes(" planter ") || blob.includes(" greenery ")) {
    return "plants";
  }
  if (primaryType === "pillow" || blob.includes(" pillow ") || blob.includes(" blanket ") || blob.includes(" throw ") || blob.includes(" bedroom ") || blob.includes(" nightstand ")) {
    return "cozy-bedroom";
  }
  if (blob.includes(" desk ") || blob.includes(" workspace ") || blob.includes(" pegboard ") || blob.includes(" monitor ")) {
    return "desk-setup";
  }

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

function buildStructuredTags(primaryType: PrimaryType, category: CanonicalCategory, price: number, sourceTags: string[]) {
  const tags = [primaryType, category, ...sourceTags];

  if (price <= 30) tags.push("under-30", "budget");
  if (price <= 50) tags.push("under-50");
  if (price <= 80) tags.push("affordable");

  if (["basket", "organizer", "tray", "hook", "bin", "box", "shelf"].includes(primaryType)) {
    tags.push("small-space");
  }

  return Array.from(new Set(tags.map((tag) => canonicalizeTag(tag)).filter(Boolean)));
}

function inferSwipeEligible(price: number, primaryType: PrimaryType, imageUrl: string, active: boolean) {
  if (!active) return false;
  if (!hasUsableImageUrl(imageUrl)) return false;
  if (price <= 0 || price > 80) return false;
  if (primaryType === "shelf" && price > 60) return false;
  return true;
}

function normalizeDescription(value: unknown) {
  const description = String(value ?? "").trim();
  const lower = description.toLowerCase();
  if (!description) return "";
  if (lower.includes("placeholder") || lower.includes("testing") || lower.includes("no description")) return "";
  return description;
}

function normalizeProductDoc(data: Record<string, unknown>) {
  const displayName = String(data.displayName ?? data.title ?? data.name ?? "Untitled").trim() || "Untitled";
  const rawCategory = String(data.category ?? "").trim();
  const description = normalizeDescription(data.description);
  const imageUrl = String(data.imageUrl ?? data.imageURL ?? "").trim();
  const price = toFiniteNumber(data.price, 0);
  const brand = String(data.brand ?? data.merchant ?? "Seligo.AI").trim() || "Seligo.AI";
  const merchant = String(data.merchant ?? "").trim();
  const purchaseUrl = String(data.purchaseUrl ?? "").trim();
  const asin = String(data.asin ?? "").trim();
  const active = data.active !== false;
  const isCurated = Boolean(data.isCurated ?? data.isLaunch ?? false);
  const imageApproved = typeof data.imageApproved === "boolean" ? data.imageApproved : false;

  const rawBaseTags = canonicalizeTagList(data.tags);
  const rawRoomTags = canonicalizeTagList(data.roomTags);
  const rawStyleTags = canonicalizeTagList(data.styleTags);

  const textBlob = `${displayName} ${rawCategory} ${description} ${rawBaseTags.join(" ")} ${rawRoomTags.join(" ")} ${rawStyleTags.join(" ")}`;
  const normalizedBlob = ` ${normalizeTerm(textBlob)} `;
  const hasTerm = (term: string) => normalizedBlob.includes(` ${normalizeTerm(term)} `);
  const extraTags: string[] = [];

  if (price <= 30) extraTags.push("under-30", "budget");
  if (price <= 50) extraTags.push("under-50");
  if (price <= 80) extraTags.push("affordable");

  if (hasTerm("desk")) extraTags.push("desk", "desk-setup");
  if (hasTerm("workspace")) extraTags.push("desk", "desk-setup");
  if (hasTerm("bedroom")) extraTags.push("bedroom", "cozy-bedroom");
  if (hasTerm("nightstand")) extraTags.push("nightstand", "cozy-bedroom");
  if (hasTerm("wall")) extraTags.push("wall", "wall-decor");
  if (hasTerm("entryway")) extraTags.push("entryway");
  if (hasTerm("living room")) extraTags.push("living-room");

  if (hasTerm("lamp") || hasTerm("lighting") || hasTerm("light")) extraTags.push("lighting", "lamp");
  if (hasTerm("mirror")) extraTags.push("mirror", "mirrors");
  if (hasTerm("print") || hasTerm("poster") || hasTerm("wall art") || hasTerm("framed")) extraTags.push("wall-decor", "art", "print");
  if (hasTerm("storage") || hasTerm("organizer") || hasTerm("basket") || hasTerm("bin") || hasTerm("tray")) extraTags.push("storage", "organizer");
  if (hasTerm("shelf") || hasTerm("ledge") || hasTerm("bookend")) extraTags.push("shelf-styling", "shelf");
  if (hasTerm("plant") || hasTerm("planter") || hasTerm("greenery") || hasTerm("vase")) extraTags.push("plants", "plant");
  if (hasTerm("pillow") || hasTerm("blanket") || hasTerm("throw")) extraTags.push("cozy-bedroom", "cozy");

  if (hasTerm("cozy")) extraTags.push("cozy");
  if (hasTerm("minimal")) extraTags.push("minimal");
  if (hasTerm("modern")) extraTags.push("modern");
  if (hasTerm("warm")) extraTags.push("warm");
  if (hasTerm("neutral")) extraTags.push("neutral");
  if (hasTerm("wood")) extraTags.push("wood");
  if (hasTerm("soft")) extraTags.push("soft");

  if (hasTerm("small space")) extraTags.push("small-space-fixes", "small-space");
  if (hasTerm("compact")) extraTags.push("small-space-fixes", "compact");
  if (hasTerm("renter")) extraTags.push("small-space-fixes", "renter-friendly");

  const rawPrimaryType = normalizeTerm(data.primaryType);
  const primaryType = (([
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
  ] as string[]).includes(rawPrimaryType)
    ? rawPrimaryType
    : inferPrimaryType(` ${normalizeTerm(`${displayName} ${rawCategory} ${description} ${rawBaseTags.join(" ")} ${extraTags.join(" ")}`)} `)) as PrimaryType;

  const category = inferCanonicalCategory(normalizedBlob, primaryType, rawCategory);
  const roomTags = Array.from(new Set([...rawRoomTags, ...inferRoomTags(primaryType, [...rawBaseTags, ...extraTags])]));
  const styleTags = Array.from(new Set([...rawStyleTags, ...inferStyleTags(normalizedBlob)]));
  const tags = buildStructuredTags(primaryType, category, price, [...rawBaseTags, ...extraTags, ...roomTags, ...styleTags]);
  const swipeEligible =
    typeof data.swipeEligible === "boolean"
      ? Boolean(data.swipeEligible)
      : inferSwipeEligible(price, primaryType, imageUrl, active);

  return {
    displayName,
    name: displayName,
    title: displayName,
    brand,
    category,
    primaryType,
    roomTags,
    styleTags,
    tags,
    price,
    imageUrl,
    description,
    merchant,
    purchaseUrl,
    asin: asin || admin.firestore.FieldValue.delete(),
    isCurated,
    swipeEligible,
    imageApproved,
    active,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const batchSize = 350;
  let lastDoc: FirebaseFirestore.QueryDocumentSnapshot | null = null;
  let updated = 0;
  let page = 0;

  console.log(`Migrating product schema${dryRun ? " [dry-run]" : ""}...`);

  while (true) {
    page += 1;

    let productsQuery = db
      .collection("products")
      .orderBy(admin.firestore.FieldPath.documentId())
      .limit(batchSize);

    if (lastDoc) {
      productsQuery = productsQuery.startAfter(lastDoc);
    }

    const snap = await productsQuery.get();
    if (snap.empty) break;

    const batch = db.batch();

    for (const docSnap of snap.docs) {
      const update = normalizeProductDoc(docSnap.data() as Record<string, unknown>);
      batch.set(docSnap.ref, update, { merge: true });
      updated += 1;
    }

    if (!dryRun) {
      await batch.commit();
    }

    lastDoc = snap.docs[snap.docs.length - 1];
    console.log(`${dryRun ? "[DRY RUN] " : ""}Page ${page}: normalized ${snap.size} docs (total ${updated})`);
  }

  console.log(`Done. ${dryRun ? "Would normalize" : "Normalized"} ${updated} product docs.`);
}

main().catch((error) => {
  console.error("Product migration failed:", error);
  process.exit(1);
});
