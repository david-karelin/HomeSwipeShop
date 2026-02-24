import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { initializeApp } from "firebase/app";
import { getFirestore, collection, addDoc } from "firebase/firestore";

// Use the SAME firebase config you already have in src/firebase.ts
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

export const products = [
  // --- RUGS (3) ---
  {
    name: "Neutral Area Rug",
    title: "Neutral Area Rug",
    brand: "SwipeShop Studio",
    category: "Rugs",
    imageUrl: "https://picsum.photos/seed/rugs_01/600/600",
    price: 79.99,
    description: "Soft neutral rug for living rooms and bedrooms.",
    tags: ["rugs", "neutral", "cozy", "living room"],
  },
  {
    name: "Vintage Pattern Rug",
    title: "Vintage Pattern Rug",
    brand: "SwipeShop Studio",
    category: "Rugs",
    imageUrl: "https://picsum.photos/seed/rugs_02/600/600",
    price: 109.99,
    description: "Warm vintage-inspired pattern with a classic feel.",
    tags: ["rugs", "vintage", "pattern", "warm"],
  },
  {
    name: "Minimal Runner Rug",
    title: "Minimal Runner Rug",
    brand: "SwipeShop Studio",
    category: "Rugs",
    imageUrl: "https://picsum.photos/seed/rugs_03/600/600",
    price: 59.99,
    description: "Clean runner rug for hallways and entryways.",
    tags: ["rugs", "minimal", "runner", "entryway"],
  },

  // --- LIGHTING (3) ---
  {
    name: "Modern Table Lamp",
    title: "Modern Table Lamp",
    brand: "SwipeShop Studio",
    category: "Lighting",
    imageUrl: "https://picsum.photos/seed/lighting_01/600/600",
    price: 49.99,
    description: "Modern lamp with a warm glow.",
    tags: ["lighting", "lamp", "modern", "bedroom"],
  },
  {
    name: "Arc Floor Lamp",
    title: "Arc Floor Lamp",
    brand: "SwipeShop Studio",
    category: "Lighting",
    imageUrl: "https://picsum.photos/seed/lighting_02/600/600",
    price: 129.99,
    description: "Floor lamp that looks great behind sofas.",
    tags: ["lighting", "floor_lamp", "statement", "living room"],
  },
  {
    name: "Minimal Pendant Light",
    title: "Minimal Pendant Light",
    brand: "SwipeShop Studio",
    category: "Lighting",
    imageUrl: "https://picsum.photos/seed/lighting_03/600/600",
    price: 89.99,
    description: "Simple pendant light for kitchens or dining rooms.",
    tags: ["lighting", "pendant", "minimal", "kitchen_decor"],
  },

  // --- WALL ART (3) ---
  {
    name: "Abstract Canvas Print",
    title: "Abstract Canvas Print",
    brand: "SwipeShop Studio",
    category: "Wall Art",
    imageUrl: "https://picsum.photos/seed/wall_art_01/600/600",
    price: 39.99,
    description: "Abstract print to elevate modern spaces.",
    tags: ["wall_art", "abstract", "modern", "statement"],
  },
  {
    name: "Minimal Line Art Set (2-pack)",
    title: "Minimal Line Art Set (2-pack)",
    brand: "SwipeShop Studio",
    category: "Wall Art",
    imageUrl: "https://picsum.photos/seed/wall_art_02/600/600",
    price: 29.99,
    description: "Two simple line art prints for a clean look.",
    tags: ["wall_art", "minimal", "neutral", "set"],
  },
  {
    name: "Landscape Poster",
    title: "Landscape Poster",
    brand: "SwipeShop Studio",
    category: "Wall Art",
    imageUrl: "https://picsum.photos/seed/wall_art_03/600/600",
    price: 24.99,
    description: "Soft landscape tones for calm rooms.",
    tags: ["wall_art", "calm", "bedroom", "neutral"],
  },

  // --- SEATING (3) ---
  {
    name: "Bouclé Accent Chair",
    title: "Bouclé Accent Chair",
    brand: "SwipeShop Studio",
    category: "Seating",
    imageUrl: "https://picsum.photos/seed/seating_01/600/600",
    price: 229.99,
    description: "Cozy accent chair with soft texture.",
    tags: ["seating", "accent_chair", "cozy", "living room"],
  },
  {
    name: "Modern Dining Chair",
    title: "Modern Dining Chair",
    brand: "SwipeShop Studio",
    category: "Seating",
    imageUrl: "https://picsum.photos/seed/seating_02/600/600",
    price: 79.99,
    description: "Clean dining chair for everyday use.",
    tags: ["seating", "dining", "modern", "durable"],
  },
  {
    name: "Minimal Bar Stool",
    title: "Minimal Bar Stool",
    brand: "SwipeShop Studio",
    category: "Seating",
    imageUrl: "https://picsum.photos/seed/seating_03/600/600",
    price: 89.99,
    description: "Simple stool for kitchen islands.",
    tags: ["seating", "stool", "minimal", "kitchen_decor"],
  },

  // --- TABLES (3) ---
  {
    name: "Round Coffee Table",
    title: "Round Coffee Table",
    brand: "SwipeShop Studio",
    category: "Tables",
    imageUrl: "https://picsum.photos/seed/tables_01/600/600",
    price: 149.99,
    description: "Round coffee table for modern living rooms.",
    tags: ["tables", "coffee_table", "modern", "living room"],
  },
  {
    name: "Wood Side Table",
    title: "Wood Side Table",
    brand: "SwipeShop Studio",
    category: "Tables",
    imageUrl: "https://picsum.photos/seed/tables_02/600/600",
    price: 69.99,
    description: "Small side table for couch or bedside.",
    tags: ["tables", "side_table", "wood", "bedroom"],
  },
  {
    name: "Minimal Console Table",
    title: "Minimal Console Table",
    brand: "SwipeShop Studio",
    category: "Tables",
    imageUrl: "https://picsum.photos/seed/tables_03/600/600",
    price: 129.99,
    description: "Slim console table for entryways.",
    tags: ["tables", "console", "minimal", "entryway"],
  },

  // --- BEDDING (3) ---
  {
    name: "Linen Duvet Set",
    title: "Linen Duvet Set",
    brand: "SwipeShop Studio",
    category: "Bedding",
    imageUrl: "https://picsum.photos/seed/bedding_01/600/600",
    price: 119.99,
    description: "Breathable linen duvet for a relaxed look.",
    tags: ["bedding", "linen", "neutral", "bedroom"],
  },
  {
    name: "Cozy Throw Blanket",
    title: "Cozy Throw Blanket",
    brand: "SwipeShop Studio",
    category: "Bedding",
    imageUrl: "https://picsum.photos/seed/bedding_02/600/600",
    price: 39.99,
    description: "Soft throw blanket for couch or bed.",
    tags: ["bedding", "throw", "cozy", "living room"],
  },
  {
    name: "Minimal Pillow Set (2-pack)",
    title: "Minimal Pillow Set (2-pack)",
    brand: "SwipeShop Studio",
    category: "Bedding",
    imageUrl: "https://picsum.photos/seed/bedding_03/600/600",
    price: 29.99,
    description: "Two simple pillows for clean styling.",
    tags: ["bedding", "pillows", "minimal", "neutral"],
  },

  // --- STORAGE (3) ---
  {
    name: "Woven Storage Basket",
    title: "Woven Storage Basket",
    brand: "SwipeShop Studio",
    category: "Storage",
    imageUrl: "https://picsum.photos/seed/storage_01/600/600",
    price: 24.99,
    description: "Basket storage for blankets, toys, and more.",
    tags: ["storage", "basket", "natural", "living room"],
  },
  {
    name: "Minimal Shelf Unit",
    title: "Minimal Shelf Unit",
    brand: "SwipeShop Studio",
    category: "Storage",
    imageUrl: "https://picsum.photos/seed/storage_02/600/600",
    price: 139.99,
    description: "Open shelving for books and decor.",
    tags: ["storage", "shelf", "minimal", "office"],
  },
  {
    name: "Entryway Shoe Cabinet",
    title: "Entryway Shoe Cabinet",
    brand: "SwipeShop Studio",
    category: "Storage",
    imageUrl: "https://picsum.photos/seed/storage_03/600/600",
    price: 159.99,
    description: "Clean cabinet to keep entryways tidy.",
    tags: ["storage", "cabinet", "entryway", "organized"],
  },

  // --- MIRRORS (3) ---
  {
    name: "Round Wall Mirror",
    title: "Round Wall Mirror",
    brand: "SwipeShop Studio",
    category: "Mirrors",
    imageUrl: "https://picsum.photos/seed/mirrors_01/600/600",
    price: 59.99,
    description: "Round mirror for bathrooms or entryways.",
    tags: ["mirrors", "round", "minimal", "entryway"],
  },
  {
    name: "Full Length Mirror",
    title: "Full Length Mirror",
    brand: "SwipeShop Studio",
    category: "Mirrors",
    imageUrl: "https://picsum.photos/seed/mirrors_02/600/600",
    price: 89.99,
    description: "Leaning mirror for bedrooms and closets.",
    tags: ["mirrors", "full_length", "bedroom", "modern"],
  },
  {
    name: "Arched Mirror",
    title: "Arched Mirror",
    brand: "SwipeShop Studio",
    category: "Mirrors",
    imageUrl: "https://picsum.photos/seed/mirrors_03/600/600",
    price: 109.99,
    description: "Arched mirror for a designer look.",
    tags: ["mirrors", "arched", "statement", "living room"],
  },

  // --- PLANTS (3) ---
  {
    name: "Faux Olive Tree",
    title: "Faux Olive Tree",
    brand: "SwipeShop Studio",
    category: "Plants",
    imageUrl: "https://picsum.photos/seed/plants_01/600/600",
    price: 79.99,
    description: "Low-maintenance greenery for any room.",
    tags: ["plants", "faux", "greenery", "living room"],
  },
  {
    name: "Ceramic Planter Set (2-pack)",
    title: "Ceramic Planter Set (2-pack)",
    brand: "SwipeShop Studio",
    category: "Plants",
    imageUrl: "https://picsum.photos/seed/plants_02/600/600",
    price: 29.99,
    description: "Planters for shelves and windowsills.",
    tags: ["plants", "planter", "minimal", "neutral"],
  },
  {
    name: "Hanging Plant Pot",
    title: "Hanging Plant Pot",
    brand: "SwipeShop Studio",
    category: "Plants",
    imageUrl: "https://picsum.photos/seed/plants_03/600/600",
    price: 19.99,
    description: "Hanging pot to add height and texture.",
    tags: ["plants", "hanging", "boho", "cozy"],
  },

  // --- KITCHEN DECOR (3) ---
  {
    name: "Minimal Canister Set",
    title: "Minimal Canister Set",
    brand: "SwipeShop Studio",
    category: "Kitchen Decor",
    imageUrl: "https://picsum.photos/seed/kitchen_01/600/600",
    price: 34.99,
    description: "Matching canisters to organize counters.",
    tags: ["kitchen_decor", "minimal", "organized", "neutral"],
  },
  {
    name: "Wood Cutting Board Set",
    title: "Wood Cutting Board Set",
    brand: "SwipeShop Studio",
    category: "Kitchen Decor",
    imageUrl: "https://picsum.photos/seed/kitchen_02/600/600",
    price: 29.99,
    description: "Boards that look good on display.",
    tags: ["kitchen_decor", "wood", "warm", "countertop"],
  },
  {
    name: "Ceramic Vase (Kitchen Shelf)",
    title: "Ceramic Vase (Kitchen Shelf)",
    brand: "SwipeShop Studio",
    category: "Kitchen Decor",
    imageUrl: "https://picsum.photos/seed/kitchen_03/600/600",
    price: 24.99,
    description: "Simple vase for open shelving styling.",
    tags: ["kitchen_decor", "ceramic", "minimal", "shelf"],
  },
];

async function seed() {
  const colRef = collection(db, "products");
  for (const p of products) {
    await addDoc(colRef, p);
    console.log("Added:", p.title);
  }
  console.log("✅ Done seeding");
}

seed().catch(console.error);
