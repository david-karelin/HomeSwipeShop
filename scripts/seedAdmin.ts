import admin from "firebase-admin";
import fs from "node:fs";
import path from "node:path";

// 1) load service account key JSON (DO NOT COMMIT THIS FILE)
const keyPath = path.join(process.cwd(), "scripts", "serviceAccountKey.json");
const serviceAccount = JSON.parse(fs.readFileSync(keyPath, "utf8"));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

const INTEREST_IDS = [
  "rugs",
  "lighting",
  "wall_art",
  "seating",
  "tables",
  "bedding",
  "storage",
  "mirrors",
  "plants",
  "kitchen_decor",
] as const;

function rand<T>(arr: T[]) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function priceFor(category: string, i: number) {
  const base: Record<string, number> = {
    rugs: 79,
    lighting: 49,
    wall_art: 39,
    seating: 149,
    tables: 129,
    bedding: 69,
    storage: 29,
    mirrors: 59,
    plants: 24,
    kitchen_decor: 19,
  };
  const jitter = (i % 10) * 3; // deterministic-ish variation
  return Number((base[category] + jitter + 0.99).toFixed(2));
}

function makeProduct(i: number) {
  const category = rand([...INTEREST_IDS]);
  const adjectives = ["Modern", "Minimal", "Cozy", "Neutral", "Bold", "Soft", "Classic"];
  const nouns: Record<string, string[]> = {
    rugs: ["Area Rug", "Runner Rug", "Wool Rug"],
    lighting: ["Table Lamp", "Floor Lamp", "Pendant Light"],
    wall_art: ["Framed Print", "Canvas Art", "Wall Poster"],
    seating: ["Accent Chair", "Stool", "Bench"],
    tables: ["Coffee Table", "Side Table", "Console Table"],
    bedding: ["Duvet Set", "Sheet Set", "Pillow Set"],
    storage: ["Storage Basket", "Shelf Unit", "Organizer"],
    mirrors: ["Round Mirror", "Wall Mirror", "Vanity Mirror"],
    plants: ["Potted Plant", "Indoor Plant", "Planter"],
    kitchen_decor: ["Serving Tray", "Ceramic Set", "Kitchen Decor"],
  };

  const name = `${rand(adjectives)} ${rand(nouns[category])}`;
  const imageSeed = `${category}_${i + 1}`;

  // tags MUST include your interest IDs EXACTLY
  const tags = Array.from(
    new Set([
      category,
      rand(["neutral", "warm", "cool", "cozy", "minimal", "modern"]),
      rand(["living_room", "bedroom", "kitchen", "entryway"]),
    ])
  );

  return {
    name,
    title: name, // your normalizer accepts name OR title
    brand: "SwipeShop Studio",
    price: priceFor(category, i),
    description: `Placeholder ${category} item for testing.`,
    category,
    imageUrl: `https://picsum.photos/seed/${imageSeed}/600/600`,
    tags,
    matchScore: 70 + (i % 30),
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  };
}

async function seed(count = 200) {
  console.log(`Seeding ${count} products...`);

  const col = db.collection("products");

  // optional: batch write for speed
  const batchSize = 400; // Firestore batch limit is 500
  let batch = db.batch();
  let ops = 0;

  for (let i = 0; i < count; i++) {
    const docRef = col.doc(); // auto id
    batch.set(docRef, makeProduct(i));
    ops++;

    if (ops >= batchSize) {
      await batch.commit();
      batch = db.batch();
      ops = 0;
      console.log("Committed a batch...");
    }
  }

  if (ops > 0) {
    await batch.commit();
  }

  console.log("✅ Done seeding.");
}

seed(200).catch((e) => {
  console.error(e);
  process.exit(1);
});
