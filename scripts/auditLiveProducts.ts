import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { resolveNodeAmazonAssocTag } from "../src/lib/affiliateConfig";

type LaunchProduct = {
  id?: string;
  title?: string;
  name?: string;
  displayName?: string;
  brand?: string;
  merchant?: string;
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

const DEFAULT_INPUT_PATH = path.join(process.cwd(), "reports", "live_products_export.csv");
const DEFAULT_FLAGGED_SAMPLE_LIMIT = 10;
const DEFAULT_EXPECTED_AMAZON_TAG = "YOURREALTAG-20";

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

function parseCsvLine(line: string) {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];

    if (character === '"') {
      if (inQuotes && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (character === "," && !inQuotes) {
      values.push(current);
      current = "";
      continue;
    }

    current += character;
  }

  values.push(current);
  return values;
}

function parseBooleanLike(value: string) {
  const normalized = value.trim().toLowerCase();
  if (["yes", "true", "1"].includes(normalized)) return true;
  if (["no", "false", "0"].includes(normalized)) return false;
  return undefined;
}

function parseListField(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean);
}

function readLaunchProducts(filePath: string): LaunchProduct[] {
  const csv = fs.readFileSync(filePath, "utf8");
  const lines = csv
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) return [];

  const headers = parseCsvLine(lines[0]);

  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    const row = Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
    const price = Number.parseFloat(String(row.price ?? "0"));

    return {
      id: String(row.id ?? "") || undefined,
      title: String(row.title ?? "") || undefined,
      name: String(row.name ?? "") || undefined,
      displayName: String(row.displayName ?? "") || undefined,
      brand: String(row.brand ?? "") || undefined,
      merchant: String(row.merchant ?? row.retailer ?? "") || undefined,
      checkoutType: String(row.checkoutType ?? "") || undefined,
      asin: String(row.asin ?? "") || undefined,
      purchaseUrl: String(row.purchaseUrl ?? "") || undefined,
      description: String(row.description ?? "") || undefined,
      imageUrl: String(row.imageUrl ?? "") || undefined,
      price: Number.isFinite(price) ? price : undefined,
      styleTags: parseListField(String(row.styleTags ?? "")),
      roomTags: parseListField(String(row.roomTags ?? "")),
      tags: parseListField(String(row.tags ?? "")),
      category: String(row.category ?? "") || undefined,
      primaryType: String(row.primaryType ?? "") || undefined,
      active: parseBooleanLike(String(row.active ?? "")),
      swipeEligible: parseBooleanLike(String(row.swipeEligible ?? "")),
      imageApproved: parseBooleanLike(String(row.imageApproved ?? "")),
      isCurated: parseBooleanLike(String(row.isCurated ?? "")),
      createdAt: String(row.createdAt ?? "") || undefined,
      updatedAt: String(row.updatedAt ?? "") || undefined,
      matchScore: Number.isFinite(Number(row.matchScore)) ? Number(row.matchScore) : undefined,
    };
  });
}

function safeParseUrl(value?: string): URL | null {
  if (!value?.trim()) return null;
  try {
    return new URL(value.trim());
  } catch {
    return null;
  }
}

function normalize(value?: string): string {
  return (value ?? "").trim().toLowerCase();
}

function pickTitle(product: LaunchProduct): string {
  return product.displayName?.trim() || product.name?.trim() || product.title?.trim() || "";
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
  const r = normalize(merchant);
  const h = normalize(hostname);

  if (!r || !h) return false;

  if (r.includes("amazon")) return h === "www.amazon.ca" || h.endsWith(".amazon.ca") || h.includes("amazon.");
  if (r.includes("wayfair")) return h.includes("wayfair.");
  if (r.includes("ikea")) return h.includes("ikea.");
  if (r.includes("walmart")) return h.includes("walmart.");
  if (r.includes("etsy")) return h.includes("etsy.");
  if (r.includes("indigo")) return h.includes("indigo.");
  if (r.includes("homesense")) return h.includes("homesense.");
  return true;
}

function getAmazonTag(url: URL | null): string {
  if (!url) return "";
  return (url.searchParams.get("tag") ?? "").trim();
}

function imageDomainMatchesMerchant(merchant?: string, imageHostname?: string): boolean {
  const m = normalize(merchant);
  const h = normalize(imageHostname);

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
  const b = normalize(brand);
  const m = normalize(merchant);

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

function resolveExpectedAmazonTag() {
  const envValue = resolveNodeAmazonAssocTag();
  return normalize(
    getArgValue("--expected-amazon-tag") ||
      envValue.value ||
      DEFAULT_EXPECTED_AMAZON_TAG
  );
}

function auditProduct(product: LaunchProduct, expectedAmazonTag: string): AuditRow {
  const purchase = safeParseUrl(product.purchaseUrl);
  const image = safeParseUrl(product.imageUrl);

  const displayTitle = pickTitle(product);
  const purchaseHostname = purchase?.hostname ?? "";
  const imageHostname = image?.hostname ?? "";
  const amazonTag = getAmazonTag(purchase);

  const hasPurchaseUrl = Boolean(product.purchaseUrl?.trim());
  const validPurchaseUrl = Boolean(purchase);
  const hasImageUrl = Boolean(product.imageUrl?.trim());
  const validImageUrl = Boolean(image);

  const hasAsin = Boolean(product.asin?.trim());
  const asinPresentInPurchaseUrl =
    Boolean(product.asin?.trim()) &&
    Boolean(product.purchaseUrl?.includes(product.asin?.trim() ?? ""));

  const affiliateTagPresent = Boolean(amazonTag);
  const affiliateTagLooksPlaceholder =
    !amazonTag ||
    amazonTag.toLowerCase() !== expectedAmazonTag ||
    amazonTag.toUpperCase().includes("YOURREALTAG") ||
    amazonTag.toUpperCase().includes("PLACEHOLDER") ||
    amazonTag.toUpperCase().includes("REPLACE");

  const merchantMatchesPurchaseDomain = merchantMatchesHostname(
    product.merchant,
    purchaseHostname
  );

  const imageMatchesMerchant = imageDomainMatchesMerchant(product.merchant, imageHostname);

  const titleFieldsConsistent = areTitlesConsistent(product);
  const suspiciousBrandValue = isSuspiciousBrand(product.brand, product.merchant);

  const notes: string[] = [];

  if (!product.id?.trim()) notes.push("Missing id");
  if (!displayTitle) notes.push("Missing title/displayName/name");
  if (!product.merchant?.trim()) notes.push("Missing merchant");
  if (!hasPurchaseUrl) notes.push("Missing purchaseUrl");
  if (hasPurchaseUrl && !validPurchaseUrl) notes.push("Invalid purchaseUrl");
  if (validPurchaseUrl && !merchantMatchesPurchaseDomain) {
    notes.push("Merchant does not match purchaseUrl hostname");
  }

  if (!hasAsin && normalize(product.merchant).includes("amazon")) {
    notes.push("Missing ASIN for Amazon product");
  }
  if (hasAsin && !asinPresentInPurchaseUrl) {
    notes.push("ASIN not found in purchaseUrl");
  }

  if (normalize(product.merchant).includes("amazon")) {
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

  if (
    !hasPurchaseUrl ||
    !validPurchaseUrl ||
    !product.id?.trim() ||
    !displayTitle ||
    !product.merchant?.trim()
  ) {
    status = "fail";
  } else if (notes.length > 0) {
    status = "review";
  }

  return {
    id: product.id ?? "",
    displayTitle,
    merchant: product.merchant ?? "",
    brand: product.brand ?? "",
    category: product.category ?? "",
    asin: product.asin ?? "",
    price: typeof product.price === "number" ? product.price : null,
    purchaseUrl: product.purchaseUrl ?? "",
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

function auditProducts(products: LaunchProduct[], expectedAmazonTag: string): AuditRow[] {
  return products.map((product) => auditProduct(product, expectedAmazonTag));
}

function main() {
  loadDotenvFiles();
  const inputPath = path.resolve(process.cwd(), getArgValue("--input") ?? DEFAULT_INPUT_PATH);
  const summaryOnly = process.argv.includes("--summary-only");
  const flaggedSampleLimit = Number.parseInt(
    getArgValue("--flagged-limit") ?? String(DEFAULT_FLAGGED_SAMPLE_LIMIT),
    10
  );
  const expectedAmazonTag = resolveExpectedAmazonTag();
  const products = readLaunchProducts(inputPath);
  const results = auditProducts(products, expectedAmazonTag);

  const summary = {
    ok: results.filter((row) => row.status === "ok").length,
    review: results.filter((row) => row.status === "review").length,
    fail: results.filter((row) => row.status === "fail").length,
  };

  const flagged = results.filter((row) => row.status !== "ok");

  if (summaryOnly) {
    console.log(
      JSON.stringify(
        {
          inputPath,
          expectedAmazonTag,
          total: results.length,
          summary,
          flaggedSample: flagged.slice(0, Math.max(0, flaggedSampleLimit)),
        },
        null,
        2
      )
    );
    return;
  }

  console.log(`Auditing ${results.length} launch products from ${inputPath}`);
  console.log(`Expected Amazon tag: ${expectedAmazonTag}`);
  console.table(
    results.map((row) => ({
      id: row.id,
      title: row.displayTitle,
      status: row.status,
      merchant: row.merchant,
      purchaseHost: row.purchaseHostname,
      imageHost: row.imageHostname,
      affiliateTag: row.affiliateTagValue,
      notes: row.notes.join(" | "),
    }))
  );

  console.log(summary);
  console.table(
    flagged.map((row) => ({
      id: row.id,
      title: row.displayTitle,
      status: row.status,
      notes: row.notes.join(" | "),
    }))
  );
}

main();