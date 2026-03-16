import admin from "firebase-admin";
import fs from "node:fs";
import path from "node:path";

const keyPath = path.join(process.cwd(), "scripts", "serviceAccountKey.json");
const serviceAccount = JSON.parse(fs.readFileSync(keyPath, "utf8"));

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

const db = admin.firestore();

const CANONICAL_CATEGORIES = new Set([
  "lighting",
  "wall-decor",
  "storage",
  "mirrors",
  "plants",
  "shelf-styling",
  "desk-setup",
  "cozy-bedroom",
]);

const PLACEHOLDER_IMAGE_RE = /picsum|placehold|placeholder|dummyimage/i;
const BAD_COPY_RE = /testing|item for testing|lorem ipsum|placeholder/i;
const BULKY_RE = /dresser|bed frame|office chair|dining table|rug|bench|sofa|sectional|mattress|tv stand|bar stool/i;
const BULKY_CATEGORY_RE = /rugs|seating|furniture|tables/i;

function normalizeText(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
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

function shouldSkipDoc(data: Record<string, unknown>) {
  if (data.isCurated === true) return true;
  if (data.source === "launch-set") return true;
  if (typeof data.legacyStatus === "string" && data.legacyStatus.length > 0) return true;
  return false;
}

function shouldHardHide(data: Record<string, unknown>) {
  const image = String(data.imageUrl ?? data.imageURL ?? "");
  const text = `${data.name ?? ""} ${data.title ?? ""} ${data.displayName ?? ""} ${data.description ?? ""}`.toLowerCase();
  const price = toFiniteNumber(data.price, 0);
  const category = normalizeText(data.category);

  const badImage = !/^https?:\/\//i.test(image) || PLACEHOLDER_IMAGE_RE.test(image);
  const badCopy = BAD_COPY_RE.test(text);
  const bulky = BULKY_RE.test(text) || BULKY_CATEGORY_RE.test(category);
  const overpriced = price > 80 || (price > 60 && !["lighting", "mirrors"].includes(category));
  const nonCanonicalAndBroken = !CANONICAL_CATEGORIES.has(category) && (badImage || price <= 0);

  return badImage || badCopy || bulky || overpriced || nonCanonicalAndBroken;
}

function shouldSoftRetire(data: Record<string, unknown>) {
  if (shouldHardHide(data)) return false;

  const image = String(data.imageUrl ?? data.imageURL ?? "");
  const price = toFiniteNumber(data.price, 0);
  const category = normalizeText(data.category);
  const tags = Array.isArray(data.tags) ? data.tags.map((tag) => normalizeText(tag)).filter(Boolean) : [];
  const text = `${data.name ?? ""} ${data.title ?? ""} ${data.displayName ?? ""} ${data.description ?? ""}`.toLowerCase();

  const realImage = /^https?:\/\//i.test(image) && !PLACEHOLDER_IMAGE_RE.test(image);
  const nonCanonicalCategory = !CANONICAL_CATEGORIES.has(category);
  const weakTags = tags.length < 2;
  const slightlyOffLane = /couch|kitchen|bathroom|outdoor|patio|ceiling fan/i.test(text);
  const tooExpensiveForSwipe = price > 60 && !["lighting", "mirrors"].includes(category);

  return realImage && (nonCanonicalCategory || weakTags || slightlyOffLane || tooExpensiveForSwipe || price <= 0);
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const batchSize = 350;
  let lastDoc: FirebaseFirestore.QueryDocumentSnapshot | null = null;
  let page = 0;
  let hardHidden = 0;
  let softRetired = 0;

  console.log(`Retiring legacy products${dryRun ? " [dry-run]" : ""}...`);

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
    let changesThisPage = 0;

    for (const docSnap of snap.docs) {
      const data = docSnap.data() as Record<string, unknown>;
      if (shouldSkipDoc(data)) continue;

      if (shouldHardHide(data)) {
        batch.set(
          docSnap.ref,
          {
            active: false,
            swipeEligible: false,
            imageApproved: false,
            isCurated: false,
            legacyStatus: "hidden",
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
        hardHidden += 1;
        changesThisPage += 1;
        continue;
      }

      if (shouldSoftRetire(data)) {
        batch.set(
          docSnap.ref,
          {
            swipeEligible: false,
            imageApproved: false,
            isCurated: false,
            legacyStatus: "retired_from_swipe",
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
        softRetired += 1;
        changesThisPage += 1;
      }
    }

    if (!dryRun && changesThisPage > 0) {
      await batch.commit();
    }

    lastDoc = snap.docs[snap.docs.length - 1];
    console.log(
      `${dryRun ? "[DRY RUN] " : ""}Page ${page}: hardHidden=${hardHidden}, softRetired=${softRetired}`
    );
  }

  console.log(
    `Done. ${dryRun ? "Would hide/retire" : "Hide/retired"} ${hardHidden + softRetired} products (${hardHidden} hidden, ${softRetired} retired_from_swipe).`
  );
}

main().catch((error) => {
  console.error("Legacy retirement failed:", error);
  process.exit(1);
});