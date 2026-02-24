import admin from "firebase-admin";
import { randomUUID } from "crypto";

// PRODUCTS array placeholder
const PRODUCTS = [
  // Example product objects
  {
    id: "example-product-1",
    name: "Sample Product",
    price: 19.99,
    description: "A sample product for seeding."
  },
  // Add more products as needed
];



admin.initializeApp({
  credential: admin.credential.cert("scripts/serviceAccountKey.json"),
});

const db = admin.firestore();

async function main() {
  // Use the PRODUCTS array defined above

  const batch = db.batch();
  for (const p of PRODUCTS) {
    const id = p.id ?? randomUUID();
    const ref = db.collection("products").doc(id);
    batch.set(ref, p, { merge: true });
  }

  await batch.commit();
  console.log(`✅ Seeded ${PRODUCTS.length} products`);
}

main().catch((e) => {
  console.error("❌ Seeding failed:", e);
  process.exit(1);
});
