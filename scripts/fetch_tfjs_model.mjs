import fs from "fs";
import path from "path";

const [,, modelJsonUrl, outDir] = process.argv;

if (!modelJsonUrl || !outDir) {
  console.error('Usage: node scripts/fetch_tfjs_model.mjs "<MODEL_JSON_URL>" "<OUT_DIR>"');
  process.exit(1);
}

fs.mkdirSync(outDir, { recursive: true });

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed ${res.status} for ${url}`);
  return await res.text();
}

async function fetchBin(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed ${res.status} for ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

const joinUrl = (base, rel) => new URL(rel, base).toString();

(async () => {
  const jsonText = await fetchText(modelJsonUrl);
  const model = JSON.parse(jsonText);

  fs.writeFileSync(path.join(outDir, "model.json"), jsonText);

  const shardPaths = [];
  for (const group of model.weightsManifest || []) {
    for (const p of group.paths || []) shardPaths.push(p);
  }

  for (const rel of shardPaths) {
    const url = joinUrl(modelJsonUrl, rel);
    const dest = path.join(outDir, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    console.log("Downloading", url);
    fs.writeFileSync(dest, await fetchBin(url));
  }

  console.log("✅ Saved:", path.join(outDir, "model.json"));
})().catch((e) => {
  console.error("❌", e);
  process.exit(1);
});
