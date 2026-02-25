import admin from "firebase-admin";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
  });
}

const db = getFirestore();

function amazonSearchUrl(query: string) {
  const q = encodeURIComponent(query.trim().replace(/\s+/g, " "));
  return `https://www.amazon.ca/s?k=${q}`;
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

    const query = [name, brand, category].filter(Boolean).join(" ");
    const purchaseUrl = amazonSearchUrl(query || "home decor");

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
