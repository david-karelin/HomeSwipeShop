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

async function exportLeads() {
  console.log("Exporting leads...");

  const snap = await db.collection("leads").orderBy("createdAt", "desc").get();

  const header = ["email", "createdAt", "subtotal", "bagCount", "wishlistCount", "uid", "source"];
  const rows = [header.join(",")];

  for (const doc of snap.docs) {
    const d = doc.data() as any;

    const createdAt =
      d.createdAt?.toDate?.() instanceof Date ? d.createdAt.toDate().toISOString() : "";

    const row = [
      csvEscape(d.email),
      csvEscape(createdAt),
      csvEscape(d.subtotal),
      csvEscape(d.bagCount),
      csvEscape(d.wishlistCount),
      csvEscape(d.uid),
      csvEscape(d.source ?? ""),
    ];

    rows.push(row.join(","));
  }

  const outPath = path.join(process.cwd(), "leads.csv");
  fs.writeFileSync(outPath, rows.join("\n"), "utf8");

  console.log(`✅ Done. Wrote ${snap.size} leads to ${outPath}`);
}

exportLeads().catch((e) => {
  console.error("❌ Export failed:", e);
  process.exit(1);
});
