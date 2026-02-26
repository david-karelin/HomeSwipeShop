import admin from "firebase-admin";
import fs from "node:fs";
import path from "node:path";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

type LaunchItem = {
  asin: string;
  name: string;
  imageUrl: string;
  description: string;
  purchaseUrl: string;
  brand?: string;
  category?: string;
  tags?: string[];
  price?: number;
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

function isAsin(v: string) {
  return /^[A-Z0-9]{10}$/i.test(v.trim());
}

function sanitizeTags(item: LaunchItem) {
  const tags = Array.isArray(item.tags) ? item.tags.filter(Boolean).map((x) => String(x).trim().toLowerCase()) : [];
  const category = (item.category || "home_decor").trim().toLowerCase();
  const out = new Set<string>([category, "launch", ...tags]);
  return Array.from(out);
}

function validate(item: LaunchItem, i: number) {
  const index = i + 1;
  const asin = String(item.asin || "").trim().toUpperCase();
  const name = String(item.name || "").trim();
  const imageUrl = String(item.imageUrl || "").trim();
  const description = String(item.description || "").trim();
  const purchaseUrl = String(item.purchaseUrl || "").trim();

  if (!isAsin(asin)) throw new Error(`Item ${index}: invalid asin`);
  if (!name) throw new Error(`Item ${index}: missing name`);
  if (!imageUrl.startsWith("http")) throw new Error(`Item ${index}: imageUrl must be an http(s) URL`);
  if (!description) throw new Error(`Item ${index}: missing description`);
  if (!purchaseUrl.includes(`/dp/${asin}`)) throw new Error(`Item ${index}: purchaseUrl must contain /dp/${asin}`);

  return {
    asin,
    name,
    imageUrl,
    description,
    purchaseUrl,
  };
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  if (!fs.existsSync(inputPath)) {
    console.error(`Missing ${inputPath}. Create it from scripts/launchSet.example.json first.`);
    process.exit(1);
  }

  const raw = fs.readFileSync(inputPath, "utf8");
  const items = JSON.parse(raw) as LaunchItem[];

  if (!Array.isArray(items) || items.length === 0) {
    console.error("launchSet.json is empty. Add 30-50 curated products and rerun.");
    process.exit(1);
  }

  let updated = 0;
  let batch = db.batch();
  let inBatch = 0;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const checked = validate(item, i);

    const docId = `launch_${checked.asin}`;
    const price = Number(item.price ?? 0);

    batch.set(
      db.collection("products").doc(docId),
      {
        name: checked.name,
        brand: String(item.brand || "Amazon").trim() || "Amazon",
        category: String(item.category || "home_decor").trim() || "home_decor",
        imageUrl: checked.imageUrl,
        description: checked.description,
        tags: sanitizeTags(item),
        price: Number.isFinite(price) ? price : 0,
        matchScore: 92,
        asin: checked.asin,
        checkoutType: "affiliate",
        merchant: "Amazon",
        purchaseUrl: checked.purchaseUrl,
        isLaunch: true,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

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
