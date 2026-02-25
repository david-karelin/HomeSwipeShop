import admin from "firebase-admin";
import fs from "node:fs";
import path from "node:path";

// Load service account key (DO NOT COMMIT THIS FILE)
const keyPath = path.join(process.cwd(), "scripts", "serviceAccountKey.json");
const serviceAccount = JSON.parse(fs.readFileSync(keyPath, "utf8"));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

function csvEscape(value: any) {
  const s = String(value ?? "");
  // Wrap in quotes if it contains comma/quote/newline
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

async function exportEvents() {
  console.log("Exporting events...");

  const snap = await db.collection("events").orderBy("createdAt", "desc").get();

  const header = ["type", "createdAt", "productId", "uid", "source", "purchaseUrl", "eventId"];
  const rows = [header.join(",")];

  for (const doc of snap.docs) {
    const d = doc.data() as any;

    const createdAt =
      d.createdAt?.toDate?.() instanceof Date ? d.createdAt.toDate().toISOString() : "";

    const row = [
      csvEscape(d.type ?? ""),
      csvEscape(createdAt),
      csvEscape(d.productId ?? ""),
      csvEscape(d.uid ?? ""),
      csvEscape(d.source ?? ""),
      csvEscape(d.purchaseUrl ?? ""),
      csvEscape(doc.id),
    ];

    rows.push(row.join(","));
  }

  const outPath = path.join(process.cwd(), "events.csv");
  fs.writeFileSync(outPath, rows.join("\n"), "utf8");

  console.log(`✅ Done. Wrote ${snap.size} events to ${outPath}`);
}

exportEvents().catch((e) => {
  console.error("❌ Export failed:", e);
  process.exit(1);
});
