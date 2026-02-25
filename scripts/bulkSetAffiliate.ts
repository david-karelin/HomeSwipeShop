import admin from "firebase-admin";
import fs from "node:fs";
import path from "node:path";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

// Load service account key (DO NOT COMMIT THIS FILE)
const keyPath = path.join(process.cwd(), "scripts", "serviceAccountKey.json");
const serviceAccount = JSON.parse(fs.readFileSync(keyPath, "utf8"));

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

const db = getFirestore();
const TAG = process.env.AMAZON_ASSOC_TAG || process.env.VITE_AMAZON_ASSOC_TAG || "";

function amazonSearchUrl(query: string) {
  const q = encodeURIComponent(query.trim().replace(/\s+/g, " "));
  const base = `https://www.amazon.ca/s?k=${q}`;
  return TAG ? `${base}&tag=${encodeURIComponent(TAG)}` : base;
}

function isAsin(x: string) {
  return /^[A-Z0-9]{10}$/i.test(x.trim());
}

function amazonAsinUrl(asin: string) {
  const a = asin.trim();
  const base = `https://www.amazon.ca/dp/${a}/ref=nosim`;
  return TAG ? `${base}?tag=${encodeURIComponent(TAG)}` : base;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  const snap = await db.collection("products").get();
  console.log(`Found ${snap.size} products`);

  let batch = db.batch();
  let inBatch = 0;
  let updated = 0;

  for (const doc of snap.docs) {
    const data = doc.data() as any;

    const name = String(data.name ?? data.title ?? "").trim();
    const brand = String(data.brand ?? "").trim();
    const category = String(data.category ?? "").trim();
    const asinRaw = typeof data.asin === "string" ? data.asin : "";
    const asin = asinRaw.trim().toUpperCase();

    const queryStr = [name, brand, category].filter(Boolean).join(" ");
    const existing = typeof data.purchaseUrl === "string" ? data.purchaseUrl.trim() : "";

    const purchaseUrl =
      isAsin(asin)
        ? amazonAsinUrl(asin)
        : (existing.length > 0 ? existing : amazonSearchUrl(queryStr || "home decor"));

    batch.set(
      doc.ref,
      {
        checkoutType: "affiliate",
        merchant: "Amazon",
        purchaseUrl,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    updated++;
    inBatch++;

    // Firestore batch limit is 500 writes
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
