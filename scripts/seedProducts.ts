import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { initializeApp } from "firebase/app";
import { getFirestore, doc, setDoc } from "firebase/firestore";

// ✅ Uses .env.local (Node script uses process.env, NOT import.meta.env)
const firebaseConfig = {
  apiKey: process.env.VITE_FIREBASE_API_KEY!,
  authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN!,
  projectId: process.env.VITE_FIREBASE_PROJECT_ID!,
  storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET!,
  messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID!,
  appId: process.env.VITE_FIREBASE_APP_ID!,
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// --- Home Decor interest IDs (MUST match your UI interests) ---
const HOME_INTERESTS = [
  { id: "rugs", nouns: ["Area Rug", "Runner Rug", "Shag Rug", "Jute Rug", "Wool Rug"] },
  { id: "lighting", nouns: ["Table Lamp", "Floor Lamp", "Pendant Light", "Wall Sconce", "Desk Lamp"] },
  { id: "wall_art", nouns: ["Framed Print", "Canvas Art", "Wall Mirror Set", "Abstract Poster", "Gallery Set"] },
  { id: "seating", nouns: ["Accent Chair", "Bar Stool", "Ottoman", "Bench", "Dining Chair"] },
  { id: "tables", nouns: ["Coffee Table", "Side Table", "Console Table", "Dining Table", "Nightstand"] },
  { id: "bedding", nouns: ["Duvet Cover", "Sheet Set", "Quilt Set", "Pillow Set", "Throw Blanket"] },
  { id: "storage", nouns: ["Storage Basket", "Floating Shelf", "Drawer Unit", "Bookcase", "Entry Organizer"] },
  { id: "mirrors", nouns: ["Round Mirror", "Arched Mirror", "Full-Length Mirror", "Vanity Mirror", "Wall Mirror"] },
  { id: "plants", nouns: ["Planter Pot", "Hanging Planter", "Plant Stand", "Vase Planter", "Indoor Plant"] },
  { id: "kitchen_decor", nouns: ["Counter Canister", "Cutting Board Set", "Spice Rack", "Kitchen Runner", "Fruit Bowl"] },
];

const STYLES = ["Modern", "Minimal", "Japandi", "Scandi", "Boho", "Mid-Century", "Industrial", "Coastal", "Rustic", "Vintage"];
const ROOMS = ["living room", "bedroom", "entryway", "dining room", "office", "nursery", "kitchen", "hallway"];
const FEATURES = ["neutral", "cozy", "warm", "sleek", "textured", "matte", "natural", "soft", "bold", "clean"];
const MATERIALS = ["wood", "linen", "cotton", "glass", "metal", "ceramic", "wool", "jute", "rattan", "stone"];

function pick<T>(arr: T[], n: number) {
  return arr[n % arr.length];
}

function priceFor(tag: string, i: number) {
  // simple category-based ranges
  const base =
    tag === "tables" ? 180 :
    tag === "seating" ? 220 :
    tag === "lighting" ? 70 :
    tag === "rugs" ? 120 :
    tag === "mirrors" ? 110 :
    tag === "bedding" ? 90 :
    tag === "storage" ? 60 :
    tag === "plants" ? 35 :
    tag === "kitchen_decor" ? 25 :
    50;

  const jitter = (i % 9) * 7 + (i % 4) * 3; // deterministic “random”
  return Number((base + jitter + 9.99).toFixed(2));
}

function makeProduct(i: number) {
  const group = pick(HOME_INTERESTS, i);
  const style = pick(STYLES, i * 7);
  const noun = pick(group.nouns, i * 11);
  const room = pick(ROOMS, i * 5);
  const feature = pick(FEATURES, i * 9);
  const material = pick(MATERIALS, i * 13);

  const name = `${style} ${noun}`;
  const id = `${group.id}_${String(i).padStart(3, "0")}`;

  return {
    id,
    name,
    displayName: name,
    title: name,
    brand: "SwipeShop Studio",
    category: group.id, // optional; your app also reads `category`
    imageUrl: `https://picsum.photos/seed/${id}/600/600`,
    price: priceFor(group.id, i),
    description: `${feature} ${style.toLowerCase()} piece for your ${room}. ${material} accents.`,
    // ✅ tags MUST include at least one interest id so your query matches
    tags: [group.id, style.toLowerCase(), room, feature, material],
    roomTags: [],
    styleTags: [],
    primaryType: "decor",
    matchScore: 85,
    isCurated: false,
    swipeEligible: false,
    imageApproved: false,
    active: true,
    createdAt: Date.now(),
  };
}

async function main(count = 200) {
  console.log(`Seeding ${count} products...`);

  for (let i = 0; i < count; i++) {
    const p = makeProduct(i);

    // ✅ setDoc with a fixed ID = rerunning overwrites instead of duplicating
    await setDoc(doc(db, "products", p.id), p, { merge: true });

    if (i % 25 === 0) console.log(`...seeded ${i}/${count}`);
  }

  console.log("✅ Done seeding!");
}

main(200).catch((e) => {
  console.error("❌ Seeding failed:", e);
  process.exit(1);
});
