import admin from "firebase-admin";
import fs from "node:fs";
import path from "node:path";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { launchSet } from "../src/data/launchSet.ts";

const keyPath = path.join(process.cwd(), "scripts", "serviceAccountKey.json");
const serviceAccount = JSON.parse(fs.readFileSync(keyPath, "utf8"));

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

const db = getFirestore();

async function run() {
  for (const product of launchSet) {
    if (!product.asin) {
      console.warn("Skipping product with no ASIN:", product.displayName);
      continue;
    }

    // Keep the canonical amazon_ doc id to avoid duplicating the existing launch inventory.
    const docId = `amazon_${product.asin}`;
    const docRef = db.collection("products").doc(docId);
    const existing = await docRef.get();

    const payload: Record<string, unknown> = {
      ...product,
      name: product.displayName,
      title: product.displayName,
      checkoutType: "affiliate",
      isLaunch: true,
      curationVersion: 1,
      updatedAt: FieldValue.serverTimestamp(),
    };

    if (!existing.exists) {
      payload.createdAt = FieldValue.serverTimestamp();
    }

    await docRef.set(payload, { merge: true });

    console.log("Imported:", docId, product.displayName);
  }

  console.log(`Done. Imported ${launchSet.length} launch products.`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});