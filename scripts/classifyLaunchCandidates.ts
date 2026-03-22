import fs from "node:fs";
import path from "node:path";

type LaunchProduct = {
  id?: string;
  title?: string;
  name?: string;
  displayName?: string;
  brand?: string;
  merchant?: string;
  retailer?: string;
  checkoutType?: string;
  asin?: string;
  purchaseUrl?: string;
  description?: string;
  imageUrl?: string;
  price?: number;
  styleTags?: string[];
  roomTags?: string[];
  tags?: string[];
  category?: string;
  primaryType?: string;
  active?: boolean;
  swipeEligible?: boolean;
  imageApproved?: boolean;
  isCurated?: boolean;
  createdAt?: string;
  updatedAt?: string;
  matchScore?: number;
};

const DEFAULT_INPUT_PATH = path.resolve(process.cwd(), "reports", "live_products_export.json");
const DEFAULT_OUTPUT_DIR = path.resolve(process.cwd(), "reports", "launch_inventory");

function getArgValue(flag: string) {
  const exact = process.argv.find((arg) => arg.startsWith(`${flag}=`));
  if (exact) return exact.slice(flag.length + 1);

  const index = process.argv.findIndex((arg) => arg === flag);
  if (index >= 0) return process.argv[index + 1];

  return undefined;
}

function csvEscape(value: unknown): string {
  const stringValue = Array.isArray(value) ? value.join(" | ") : String(value ?? "");
  if (stringValue.includes(",") || stringValue.includes('"') || stringValue.includes("\n")) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
}

function toCsv(rows: Array<Record<string, unknown>>) {
  if (rows.length === 0) return "";

  const headers = Array.from(
    rows.reduce((keys, row) => {
      for (const key of Object.keys(row)) keys.add(key);
      return keys;
    }, new Set<string>())
  );

  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((header) => csvEscape(row[header])).join(","));
  }

  return lines.join("\n");
}

function pickTitle(product: LaunchProduct) {
  return product.displayName ?? product.name ?? product.title ?? "";
}

function pickMerchant(product: LaunchProduct) {
  return product.merchant ?? product.retailer ?? "";
}

function main() {
  const inputPath = path.resolve(process.cwd(), getArgValue("--input") ?? DEFAULT_INPUT_PATH);
  const outputDir = path.resolve(process.cwd(), getArgValue("--output-dir") ?? DEFAULT_OUTPUT_DIR);
  const raw = fs.readFileSync(inputPath, "utf8");
  const products = JSON.parse(raw) as LaunchProduct[];

  if (!Array.isArray(products)) {
    throw new Error(`${inputPath} is not an array`);
  }

  const launchCandidates = products.filter((product) => {
    const purchaseUrl = (product.purchaseUrl ?? "").trim().toLowerCase();
    const imageUrl = (product.imageUrl ?? "").trim().toLowerCase();
    const merchant = (product.merchant ?? product.retailer ?? "").trim().toLowerCase();
    const brand = (product.brand ?? "").trim().toLowerCase();

    const isAmazon = merchant.includes("amazon");
    const isSearchUrl = purchaseUrl.includes("/s?");
    const isPlaceholderImage = imageUrl.includes("picsum.photos");
    const isPlaceholderBrand =
      brand === "swipeshop studio" ||
      brand === "seligo" ||
      brand === "seligo.ai" ||
      brand === "unknown";

    return (
      product.active === true &&
      product.swipeEligible === true &&
      product.imageApproved === true &&
      product.isCurated === true &&
      !!purchaseUrl &&
      !isSearchUrl &&
      !isPlaceholderImage &&
      !isPlaceholderBrand &&
      !!merchant &&
      (!isAmazon || !!product.asin)
    );
  });

  const placeholderRows = products.filter((product) => {
    const purchaseUrl = (product.purchaseUrl ?? "").trim().toLowerCase();
    const imageUrl = (product.imageUrl ?? "").trim().toLowerCase();
    const brand = (product.brand ?? "").trim().toLowerCase();

    return (
      brand === "swipeshop studio" ||
      imageUrl.includes("picsum.photos") ||
      purchaseUrl.includes("/s?") ||
      product.imageApproved === false ||
      product.isCurated === false
    );
  });

  const summary = {
    inputPath,
    totalProducts: products.length,
    launchCandidates: launchCandidates.length,
    placeholderRows: placeholderRows.length,
    nonPlaceholderRows: products.length - placeholderRows.length,
    sampleLaunchCandidates: launchCandidates.slice(0, 20).map((product) => ({
      id: product.id ?? "",
      title: pickTitle(product),
      merchant: pickMerchant(product),
      asin: product.asin ?? "",
      price: product.price ?? null,
      purchaseUrl: product.purchaseUrl ?? "",
    })),
  };

  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, "launch_candidates.json"), JSON.stringify(launchCandidates, null, 2));
  fs.writeFileSync(path.join(outputDir, "placeholder_rows.json"), JSON.stringify(placeholderRows, null, 2));
  fs.writeFileSync(path.join(outputDir, "launch_candidates_summary.json"), JSON.stringify(summary, null, 2));
  fs.writeFileSync(
    path.join(outputDir, "launch_candidates.csv"),
    `${toCsv(launchCandidates.map((product) => ({
      id: product.id ?? "",
      title: pickTitle(product),
      merchant: pickMerchant(product),
      asin: product.asin ?? "",
      price: product.price ?? null,
      purchaseUrl: product.purchaseUrl ?? "",
      imageUrl: product.imageUrl ?? "",
    })))}\n`,
    "utf8"
  );
  fs.writeFileSync(
    path.join(outputDir, "placeholder_rows.csv"),
    `${toCsv(placeholderRows.map((product) => ({
      id: product.id ?? "",
      title: pickTitle(product),
      merchant: pickMerchant(product),
      brand: product.brand ?? "",
      asin: product.asin ?? "",
      active: product.active ?? null,
      swipeEligible: product.swipeEligible ?? null,
      imageApproved: product.imageApproved ?? null,
      isCurated: product.isCurated ?? null,
      purchaseUrl: product.purchaseUrl ?? "",
      imageUrl: product.imageUrl ?? "",
    })))}\n`,
    "utf8"
  );

  console.log(JSON.stringify(summary, null, 2));
}

main();