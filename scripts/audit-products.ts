import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { resolveNodeAmazonAssocTag } from "../src/lib/affiliateConfig";
import { getResolvedPurchaseUrlWithTag } from "../retailerUrlUtils";

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

type AuditStatus = "ok" | "review" | "fail";

type AuditRow = {
  id: string;
  displayTitle: string;
  merchant: string;
  brand: string;
  category: string;
  asin: string;
  price: number | null;
  purchaseUrl: string;
  imageUrl: string;

  hasPurchaseUrl: boolean;
  validPurchaseUrl: boolean;
  purchaseHostname: string;
  merchantMatchesPurchaseDomain: boolean;

  hasAsin: boolean;
  asinPresentInPurchaseUrl: boolean;

  affiliateTagPresent: boolean;
  affiliateTagValue: string;
  affiliateTagLooksPlaceholder: boolean;

  hasImageUrl: boolean;
  validImageUrl: boolean;
  imageHostname: string;
  imageDomainMatchesMerchant: boolean;

  imageApproved: boolean;
  isCurated: boolean;
  active: boolean;
  swipeEligible: boolean;

  titleFieldsConsistent: boolean;
  suspiciousBrandValue: boolean;

  status: AuditStatus;
  notes: string[];
};

const DEFAULT_INPUT_PATH = path.resolve(process.cwd(), "reports", "live_products_export.json");
const DEFAULT_OUT_DIR = path.resolve(process.cwd(), "reports", "audit_output");
const DEFAULT_REAL_AMAZON_TAG = "YOURREALTAG-20".toLowerCase();

function getArgValue(flag: string) {
  const exact = process.argv.find((arg) => arg.startsWith(`${flag}=`));
  if (exact) return exact.slice(flag.length + 1);

  const index = process.argv.findIndex((arg) => arg === flag);
  if (index >= 0) return process.argv[index + 1];

  return undefined;
}

function loadDotenvFiles() {
  for (const fileName of [".env.local", ".env"]) {
    const filePath = path.join(process.cwd(), fileName);
    if (!fs.existsSync(filePath)) continue;
    dotenv.config({ path: filePath, override: false });
  }
}

function resolveAmazonTag() {
  const argValue = getArgValue("--real-amazon-tag");
  if (argValue) {
    return {
      value: argValue.toLowerCase(),
      configured: true,
      source: "--real-amazon-tag",
    };
  }

  const envValue = resolveNodeAmazonAssocTag();
  if (envValue.configured) {
    return {
      value: envValue.value.toLowerCase(),
      configured: true,
      source: envValue.source,
    };
  }

  return {
    value: DEFAULT_REAL_AMAZON_TAG,
    configured: false,
    source: "default-placeholder",
  };
}

function safeParseUrl(value?: string): URL | null {
  if (!value?.trim()) return null;
  try {
    return new URL(value.trim());
  } catch {
    return null;
  }
}

function norm(value?: string): string {
  return (value ?? "").trim().toLowerCase();
}

function pickTitle(product: LaunchProduct): string {
  return product.displayName?.trim() || product.name?.trim() || product.title?.trim() || "";
}

function pickMerchant(product: LaunchProduct): string {
  return product.merchant?.trim() || product.retailer?.trim() || "";
}

function allPresentTitles(product: LaunchProduct): string[] {
  return [product.displayName, product.name, product.title]
    .map((value) => (value ?? "").trim())
    .filter(Boolean);
}

function areTitlesConsistent(product: LaunchProduct): boolean {
  const values = [...new Set(allPresentTitles(product))];
  return values.length <= 1;
}

function merchantMatchesHostname(merchant?: string, hostname?: string): boolean {
  const m = norm(merchant);
  const h = norm(hostname);

  if (!m || !h) return false;

  if (m.includes("amazon")) return h === "www.amazon.ca" || h.endsWith(".amazon.ca") || h.includes("amazon.");
  if (m.includes("wayfair")) return h.includes("wayfair.");
  if (m.includes("ikea")) return h.includes("ikea.");
  if (m.includes("walmart")) return h.includes("walmart.");
  if (m.includes("etsy")) return h.includes("etsy.");
  if (m.includes("indigo")) return h.includes("indigo.");
  if (m.includes("homesense")) return h.includes("homesense.");
  return true;
}

function getAmazonTag(url: URL | null): string {
  if (!url) return "";
  return (url.searchParams.get("tag") ?? "").trim();
}

function imageDomainMatchesMerchant(merchant?: string, imageHostname?: string): boolean {
  const m = norm(merchant);
  const h = norm(imageHostname);

  if (!m || !h) return false;

  if (m.includes("amazon")) return h.includes("amazon.");
  if (m.includes("wayfair")) return h.includes("wayfair.");
  if (m.includes("ikea")) return h.includes("ikea.");
  if (m.includes("walmart")) return h.includes("walmart.");
  if (m.includes("etsy")) return h.includes("etsy.");
  if (m.includes("indigo")) return h.includes("indigo.");
  if (m.includes("homesense")) return h.includes("homesense.");

  return true;
}

function isSuspiciousBrand(brand?: string, merchant?: string): boolean {
  const b = norm(brand);
  const m = norm(merchant);

  if (!b) return false;

  const suspiciousBrands = [
    "swipeshop studio",
    "seligo",
    "seligo.ai",
    "launch set",
    "launch-set",
    "unknown",
    "generic",
  ];

  if (suspiciousBrands.includes(b)) return true;
  if (b && m && b === m) return true;

  return false;
}

function auditProduct(
  product: LaunchProduct,
  realAmazonTag: string,
  amazonTagConfigured: boolean
): AuditRow {
  const resolvedPurchaseUrl = getResolvedPurchaseUrlWithTag(product, product.purchaseUrl, realAmazonTag || undefined);
  const purchase = safeParseUrl(resolvedPurchaseUrl);
  const image = safeParseUrl(product.imageUrl);

  const displayTitle = pickTitle(product);
  const merchant = pickMerchant(product);
  const purchaseHostname = purchase?.hostname ?? "";
  const imageHostname = image?.hostname ?? "";
  const amazonTag = getAmazonTag(purchase);

  const hasPurchaseUrl = Boolean(resolvedPurchaseUrl.trim());
  const validPurchaseUrl = Boolean(purchase);
  const hasImageUrl = Boolean(product.imageUrl?.trim());
  const validImageUrl = Boolean(image);

  const hasAsin = Boolean(product.asin?.trim());
  const asinPresentInPurchaseUrl =
    Boolean(product.asin?.trim()) &&
    resolvedPurchaseUrl.includes(product.asin.trim());

  const affiliateTagPresent = Boolean(amazonTag);
  const affiliateTagLooksPlaceholder =
    norm(merchant).includes("amazon") &&
    (!amazonTag ||
      amazonTag.toUpperCase().includes("YOURREALTAG") ||
      amazonTag.toUpperCase().includes("PLACEHOLDER") ||
      amazonTag.toUpperCase().includes("REPLACE") ||
      (amazonTagConfigured && amazonTag.toLowerCase() !== realAmazonTag));

  const merchantMatchesPurchaseDomain = merchantMatchesHostname(merchant, purchaseHostname);

  const imageMatchesMerchant = imageDomainMatchesMerchant(merchant, imageHostname);

  const titleFieldsConsistent = areTitlesConsistent(product);
  const suspiciousBrandValue = isSuspiciousBrand(product.brand, merchant);

  const notes: string[] = [];

  if (!product.id?.trim()) notes.push("Missing id");
  if (!displayTitle) notes.push("Missing title/displayName/name");
  if (!merchant) notes.push("Missing merchant/retailer");
  if (!hasPurchaseUrl) notes.push("Missing purchaseUrl");
  if (hasPurchaseUrl && !validPurchaseUrl) notes.push("Invalid purchaseUrl");
  if (validPurchaseUrl && !merchantMatchesPurchaseDomain) {
    notes.push("Merchant does not match purchaseUrl hostname");
  }

  if (!hasAsin && norm(merchant).includes("amazon")) {
    notes.push("Missing ASIN for Amazon product");
  }
  if (hasAsin && !asinPresentInPurchaseUrl) {
    notes.push("ASIN not found in purchaseUrl");
  }

  if (norm(merchant).includes("amazon")) {
    if (!amazonTagConfigured) {
      notes.push("Amazon assoc tag is not configured in env");
    }
    if (!affiliateTagPresent) notes.push("Missing Amazon affiliate tag");
    if (affiliateTagLooksPlaceholder) {
      notes.push("Amazon affiliate tag missing, placeholder, or not equal to configured production tag");
    }
  }

  if (!hasImageUrl) notes.push("Missing imageUrl");
  if (hasImageUrl && !validImageUrl) notes.push("Invalid imageUrl");
  if (validImageUrl && !imageMatchesMerchant) {
    notes.push("imageUrl domain does not match merchant domain");
  }

  if (product.imageApproved === false) notes.push("imageApproved is false");
  if (product.isCurated === false) notes.push("isCurated is false");
  if (product.active === false) notes.push("active is false");
  if (product.swipeEligible === false) notes.push("swipeEligible is false");

  if (!titleFieldsConsistent) notes.push("title/displayName/name are inconsistent");
  if (suspiciousBrandValue) notes.push("Brand looks placeholder/internal and should be verified");

  let status: AuditStatus = "ok";

  if (!hasPurchaseUrl || !validPurchaseUrl || !product.id?.trim() || !displayTitle || !merchant) {
    status = "fail";
  } else if (notes.length > 0) {
    status = "review";
  }

  return {
    id: product.id ?? "",
    displayTitle,
    merchant,
    brand: product.brand ?? "",
    category: product.category ?? "",
    asin: product.asin ?? "",
    price: typeof product.price === "number" ? product.price : null,
    purchaseUrl: resolvedPurchaseUrl,
    imageUrl: product.imageUrl ?? "",

    hasPurchaseUrl,
    validPurchaseUrl,
    purchaseHostname,
    merchantMatchesPurchaseDomain,

    hasAsin,
    asinPresentInPurchaseUrl,

    affiliateTagPresent,
    affiliateTagValue: amazonTag,
    affiliateTagLooksPlaceholder,

    hasImageUrl,
    validImageUrl,
    imageHostname,
    imageDomainMatchesMerchant: imageMatchesMerchant,

    imageApproved: Boolean(product.imageApproved),
    isCurated: Boolean(product.isCurated),
    active: Boolean(product.active),
    swipeEligible: Boolean(product.swipeEligible),

    titleFieldsConsistent,
    suspiciousBrandValue,

    status,
    notes,
  };
}

function csvEscape(value: unknown): string {
  const stringValue = Array.isArray(value) ? value.join(" | ") : String(value ?? "");
  if (stringValue.includes(",") || stringValue.includes('"') || stringValue.includes("\n")) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
}

function toCsv(rows: AuditRow[]): string {
  const headers = [
    "id",
    "displayTitle",
    "merchant",
    "brand",
    "category",
    "asin",
    "price",
    "purchaseUrl",
    "imageUrl",
    "hasPurchaseUrl",
    "validPurchaseUrl",
    "purchaseHostname",
    "merchantMatchesPurchaseDomain",
    "hasAsin",
    "asinPresentInPurchaseUrl",
    "affiliateTagPresent",
    "affiliateTagValue",
    "affiliateTagLooksPlaceholder",
    "hasImageUrl",
    "validImageUrl",
    "imageHostname",
    "imageDomainMatchesMerchant",
    "imageApproved",
    "isCurated",
    "active",
    "swipeEligible",
    "titleFieldsConsistent",
    "suspiciousBrandValue",
    "status",
    "notes",
  ];

  const lines = [
    headers.join(","),
    ...rows.map((row) =>
      headers.map((key) => csvEscape((row as Record<string, unknown>)[key])).join(",")
    ),
  ];

  return lines.join("\n");
}

function main() {
  loadDotenvFiles();

  const inputPath = path.resolve(process.cwd(), getArgValue("--input") ?? DEFAULT_INPUT_PATH);
  const outputDir = path.resolve(process.cwd(), getArgValue("--output-dir") ?? DEFAULT_OUT_DIR);
  const amazonTag = resolveAmazonTag();
  const raw = fs.readFileSync(inputPath, "utf8");
  const products = JSON.parse(raw) as LaunchProduct[];

  if (!Array.isArray(products)) {
    throw new Error(`${inputPath} is not an array`);
  }

  const results = products.map((product) =>
    auditProduct(product, amazonTag.value, amazonTag.configured)
  );
  const flagged = results.filter((row) => row.status !== "ok");
  const review = results.filter((row) => row.status === "review");
  const fail = results.filter((row) => row.status === "fail");

  const noteCounts = new Map<string, number>();
  for (const row of results) {
    for (const note of row.notes) {
      noteCounts.set(note, (noteCounts.get(note) ?? 0) + 1);
    }
  }

  const topNotes = [...noteCounts.entries()]
    .sort((left, right) => right[1] - left[1])
    .map(([note, count]) => ({ note, count }));

  const summary = {
    inputPath,
    amazonTagConfigured: amazonTag.configured,
    amazonTagSource: amazonTag.source,
    total: results.length,
    ok: results.filter((row) => row.status === "ok").length,
    review: review.length,
    fail: fail.length,
    topNotes,
  };

  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, "audit_results.json"), JSON.stringify(results, null, 2));
  fs.writeFileSync(path.join(outputDir, "audit_flagged.json"), JSON.stringify(flagged, null, 2));
  fs.writeFileSync(path.join(outputDir, "audit_summary.json"), JSON.stringify(summary, null, 2));
  fs.writeFileSync(path.join(outputDir, "audit_results.csv"), toCsv(results));
  fs.writeFileSync(path.join(outputDir, "audit_flagged.csv"), toCsv(flagged));

  console.log(JSON.stringify(summary, null, 2));
  console.log("\nTop 20 note counts:");
  for (const row of topNotes.slice(0, 20)) {
    console.log(`- ${row.count}  ${row.note}`);
  }
}

main();