import admin from "firebase-admin";
import fs from "node:fs";
import path from "node:path";
import { filterLaunchCatalogProducts } from "../src/lib/launchCatalog";

const DEFAULT_OUTPUT_PATH = path.join(process.cwd(), "reports", "live_products_export.json");
const DEFAULT_LAUNCH_OUTPUT_PATH = path.join(process.cwd(), "reports", "launch_products_34.json");

function getArgValue(flag: string) {
  const exact = process.argv.find((arg) => arg.startsWith(`${flag}=`));
  if (exact) return exact.slice(flag.length + 1);

  const index = process.argv.findIndex((arg) => arg === flag);
  if (index >= 0) return process.argv[index + 1];

  return undefined;
}

function hasFlag(flag: string) {
  return process.argv.includes(flag);
}

function serializeFirestoreValue(value: unknown): unknown {
  if (value == null) return value;

  if (Array.isArray(value)) {
    return value.map((entry) => serializeFirestoreValue(entry));
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown> & { toDate?: () => Date; path?: string };

    if (typeof record.toDate === "function") {
      const converted = record.toDate();
      if (converted instanceof Date) return converted.toISOString();
    }

    if (typeof record.path === "string" && "firestore" in record) {
      return record.path;
    }

    return Object.fromEntries(
      Object.entries(record).map(([key, nestedValue]) => [key, serializeFirestoreValue(nestedValue)])
    );
  }

  return value;
}

function getFirestore() {
  const keyPath = path.join(process.cwd(), "scripts", "serviceAccountKey.json");
  const serviceAccount = JSON.parse(fs.readFileSync(keyPath, "utf8"));

  if (admin.apps.length === 0) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
  }

  return admin.firestore();
}

function sortProducts(products: Array<Record<string, unknown>>) {
  return products.sort((left, right) => {
    const leftKey = String(left.displayName ?? left.name ?? left.title ?? left.id ?? "");
    const rightKey = String(right.displayName ?? right.name ?? right.title ?? right.id ?? "");
    return leftKey.localeCompare(rightKey) || String(left.id ?? "").localeCompare(String(right.id ?? ""));
  });
}

async function exportProducts() {
  const launchOnly = hasFlag("--launch-only");
  console.log(launchOnly ? "Exporting launch products..." : "Exporting full products...");

  const db = getFirestore();
  const snap = await db.collection("products").get();
  const allProducts = sortProducts(
    snap.docs.map((doc) => ({
      id: doc.id,
      ...(serializeFirestoreValue(doc.data() as Record<string, unknown>) as Record<string, unknown>),
    }))
  );
  const products = launchOnly ? sortProducts(filterLaunchCatalogProducts(allProducts)) : allProducts;

  const outPath = path.resolve(
    process.cwd(),
    getArgValue("--output") ?? (launchOnly ? DEFAULT_LAUNCH_OUTPUT_PATH : DEFAULT_OUTPUT_PATH)
  );
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(products, null, 2)}\n`, "utf8");

  console.log(`✅ Done. Wrote ${products.length} products to ${outPath}`);
}

exportProducts().catch((error) => {
  console.error("❌ Export failed:", error);
  process.exit(1);
});