import admin from "firebase-admin";
import fs from "node:fs";
import path from "node:path";

const keyPath = path.join(process.cwd(), "scripts", "serviceAccountKey.json");
const serviceAccount = JSON.parse(fs.readFileSync(keyPath, "utf8"));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

function amazonSearchUrl(name: string, category?: string) {
  const q = `${name} ${category ?? ""} home decor`.trim();
  // Change amazon.ca -> any store/search page you want
  return `https://www.amazon.ca/s?k=${encodeURIComponent(q)}`;
}

async function run() {
  console.log("Backfilling checkoutType + purchaseUrl for products...");

  const batchSize = 400; // keep under 500 writes per batch
  let lastDoc: FirebaseFirestore.QueryDocumentSnapshot | null = null;

  let totalUpdated = 0;
  let page = 0;

  while (true) {
    page++;

    let q = db
      .collection("products")
      .orderBy(admin.firestore.FieldPath.documentId())
      .limit(batchSize);

    if (lastDoc) q = q.startAfter(lastDoc);

    const snap = await q.get();
    if (snap.empty) break;

    const batch = db.batch();

    for (const doc of snap.docs) {
      const data = doc.data() as any;

      const name = data.name ?? data.title ?? "Home decor item";
      const category = data.category ?? "";

      // Only set if missing (so you don’t overwrite future real links)
      const checkoutType = data.checkoutType ?? "affiliate";
      const purchaseUrl = data.purchaseUrl ?? amazonSearchUrl(name, category);
      const merchant = data.merchant ?? "Amazon";

      batch.set(
        doc.ref,
        {
          checkoutType,
          purchaseUrl,
          merchant,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      totalUpdated++;
    }

    await batch.commit();
    lastDoc = snap.docs[snap.docs.length - 1];

    console.log(`✅ Page ${page}: updated ${snap.size} docs (total ${totalUpdated})`);
  }

  console.log(`🎉 Done. Updated ${totalUpdated} product docs.`);
}

run().catch((e) => {
  console.error("Backfill failed:", e);
  process.exit(1);
});
