import admin from "firebase-admin";
import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import {
  extractAmazonAsin,
  getAmazonAffiliateTagValue,
  getMerchantHostHints,
  getResolvedPurchaseUrlWithTag,
  getUrlHostname,
  isAmazonHostname,
  isPlaceholderAffiliateTag,
  normalizeHttpUrl,
  readOptionalString,
} from "../retailerUrlUtils";
import { resolveNodeAmazonAssocTag } from "../src/lib/affiliateConfig";

type ProductRecord = {
  id: string;
  displayName: string;
  rawDisplayName: string;
  rawName: string;
  rawTitle: string;
  merchant: string;
  brand: string;
  category: string;
  price: number;
  asin: string;
  imageUrl: string;
  active: boolean;
  swipeEligible: boolean;
  imageApproved: boolean;
  isCurated: boolean;
  rawPurchaseUrl: string;
  rawPurchaseUrlNormalized: string;
  fallbackUrl: string;
  fallbackUrlNormalized: string;
  resolvedUrl: string;
};

type AuditStatus = "ok" | "review" | "fail";

type AuditRow = {
  id: string;
  displayName: string;
  brand: string;
  merchant: string;
  category: string;
  price: number;
  asin: string;
  purchaseUrl: string;
  resolvedUrl: string;
  imageUrl: string;
  hasPurchaseUrl: boolean;
  validUrl: boolean;
  hostname: string;
  merchantMatchesDomain: boolean;
  affiliateRuleConfigured: boolean;
  affiliateMarkerPresent: boolean;
  placeholderAffiliateTag: boolean;
  duplicateRawUrl: boolean;
  suspiciousUrl: boolean;
  runtimeAffiliateMarkerPresent: boolean;
  imageUrlPresent: boolean;
  imageUrlHostname: string;
  imageUrlMatchesMerchantDomain: boolean;
  active: boolean;
  swipeEligible: boolean;
  imageApproved: boolean;
  isCurated: boolean;
  duplicateTitleFields: boolean;
  duplicateTitleFieldValuesDiffer: boolean;
  titleFieldsPresent: string[];
  suspiciousBrandValue: boolean;
  status: AuditStatus;
  launchStatus: AuditStatus;
  manualReady: boolean;
  notes: string[];
  launchNotes: string[];
};

type IssueSample = {
  id: string;
  displayName: string;
  merchant: string;
  asin: string;
  rawPurchaseUrl: string;
  resolvedUrl: string;
  detail: string;
};

type IssueBucket = {
  count: number;
  samples: IssueSample[];
};

type HttpProbeResult = {
  ok: boolean;
  status: number;
  finalUrl: string;
  detail: string;
};

type AffiliateRule = {
  label: string;
  markers: string[];
};

const SAMPLE_LIMIT = 12;
const DEFAULT_OUTPUT_DIR = "reports";
const DESKTOP_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36";
const MOBILE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";
const SHORTENER_HOSTS = new Set([
  "amzn.to",
  "bit.ly",
  "bitly.com",
  "goo.gl",
  "lnk.to",
  "ow.ly",
  "t.co",
  "tinyurl.com",
]);

const hasValidAsin = (value: string) => /^[A-Z0-9]{10}$/.test(value);
const SUSPICIOUS_BRAND_PATTERN = /(swipeshop|shoppuri|placeholder|changeme|example|test|unknown|not\s*set|tbd)/i;

function normalizeComparableText(value: string) {
  return readOptionalString(value).toLowerCase();
}

function getPresentTitleFields(product: Pick<ProductRecord, "rawDisplayName" | "rawName" | "rawTitle">) {
  return [
    { label: "displayName", value: readOptionalString(product.rawDisplayName) },
    { label: "name", value: readOptionalString(product.rawName) },
    { label: "title", value: readOptionalString(product.rawTitle) },
  ].filter((field) => field.value.length > 0);
}

function hasConflictingTitleValues(titleFields: Array<{ label: string; value: string }>) {
  const uniqueValues = new Set(
    titleFields.map((field) => normalizeComparableText(field.value)).filter(Boolean)
  );
  return uniqueValues.size > 1;
}

function isSuspiciousBrandValue(brand: string) {
  return SUSPICIOUS_BRAND_PATTERN.test(normalizeComparableText(brand));
}

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

function getAmazonAssocTag() {
  return resolveNodeAmazonAssocTag().value;
}

function getFirestore() {
  const keyPath = path.join(process.cwd(), "scripts", "serviceAccountKey.json");
  const serviceAccount = JSON.parse(fs.readFileSync(keyPath, "utf8"));

  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
  }

  return admin.firestore();
}

function createBucket(): IssueBucket {
  return { count: 0, samples: [] };
}

function addIssue(bucket: IssueBucket, issue: IssueSample) {
  bucket.count += 1;
  if (bucket.samples.length < SAMPLE_LIMIT) {
    bucket.samples.push(issue);
  }
}

function formatIssue(issue: IssueSample) {
  const details = [
    issue.id,
    issue.displayName || "(unnamed)",
    issue.merchant ? `merchant=${issue.merchant}` : "",
    issue.asin ? `asin=${issue.asin}` : "",
    issue.detail,
    issue.rawPurchaseUrl ? `raw=${issue.rawPurchaseUrl}` : "",
    issue.resolvedUrl ? `resolved=${issue.resolvedUrl}` : "",
  ].filter(Boolean);

  return `- ${details.join(" | ")}`;
}

function printBucket(title: string, bucket: IssueBucket) {
  console.log(`\n${title}: ${bucket.count}`);

  if (bucket.samples.length === 0) {
    console.log("  none");
    return;
  }

  for (const issue of bucket.samples) {
    console.log(formatIssue(issue));
  }
}

function getAffiliateRule(merchant: string): AffiliateRule | null {
  const normalizedMerchant = merchant.trim().toLowerCase();

  if (normalizedMerchant.includes("amazon")) {
    return {
      label: "Amazon Associates",
      markers: ["tag="],
    };
  }

  return null;
}

function hasAffiliateMarker(url: string, rule: AffiliateRule | null) {
  if (!url || !rule) return false;

  const lowerUrl = url.toLowerCase();
  return rule.markers.some((marker) => lowerUrl.includes(marker.toLowerCase()));
}

function isSuspiciousUrl(url: string) {
  if (!url) return false;

  const hostname = getUrlHostname(url);
  if (SHORTENER_HOSTS.has(hostname)) return true;

  try {
    const parsed = new URL(url);
    return parsed.searchParams.size > 12 || url.length > 500;
  } catch {
    return true;
  }
}

function getDataStatus(args: {
  hasDisplayName: boolean;
  hasMerchant: boolean;
  hasPurchaseUrl: boolean;
  validUrl: boolean;
  imageUrlPresent: boolean;
  imageUrlMatchesMerchantDomain: boolean;
  active: boolean;
  swipeEligible: boolean;
  imageApproved: boolean;
  isCurated: boolean;
  affiliateRuleConfigured: boolean;
  affiliateMarkerPresent: boolean;
  placeholderAffiliateTag: boolean;
  merchantMatchesDomain: boolean;
  duplicateRawUrl: boolean;
  suspiciousUrl: boolean;
  duplicateTitleFields: boolean;
  duplicateTitleFieldValuesDiffer: boolean;
  suspiciousBrandValue: boolean;
}) {
  if (!args.hasPurchaseUrl || !args.validUrl) {
    return "fail" as const;
  }

  if (
    !args.hasDisplayName ||
    !args.hasMerchant ||
    !args.imageUrlPresent ||
    !args.imageUrlMatchesMerchantDomain ||
    !args.active ||
    !args.swipeEligible ||
    !args.imageApproved ||
    !args.isCurated ||
    args.placeholderAffiliateTag ||
    !args.merchantMatchesDomain ||
    args.duplicateRawUrl ||
    args.suspiciousUrl ||
    args.duplicateTitleFields ||
    args.duplicateTitleFieldValuesDiffer ||
    args.suspiciousBrandValue
  ) {
    return "review" as const;
  }

  if (!args.affiliateRuleConfigured) return "review" as const;
  if (!args.affiliateMarkerPresent) return "review" as const;

  return "ok" as const;
}

function getLaunchStatus(
  status: AuditStatus,
  runtimeAffiliateMarkerPresent: boolean,
  affiliateRuleConfigured: boolean
) {
  if (status === "fail") return "fail" as const;
  if (affiliateRuleConfigured && !runtimeAffiliateMarkerPresent) return "fail" as const;
  if (status === "review") return "review" as const;
  return "ok" as const;
}

function csvEscape(value: unknown) {
  const stringValue =
    value == null
      ? ""
      : Array.isArray(value)
        ? value.join("; ")
        : typeof value === "boolean"
          ? value
            ? "yes"
            : "no"
          : String(value);

  return `"${stringValue.replace(/"/g, '""')}"`;
}

function writeCsv(filePath: string, headers: string[], rows: Array<Record<string, unknown>>) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  const lines = [headers.map(csvEscape).join(",")];
  for (const row of rows) {
    lines.push(headers.map((header) => csvEscape(row[header])).join(","));
  }

  fs.writeFileSync(filePath, `${lines.join("\n")}\n`, "utf8");
}

function writeManualChecklist(
  filePath: string,
  summary: {
    totalProducts: number;
    firstPassOkCount: number;
    launchReadyCount: number;
    fixQueueCount: number;
  }
) {
  const content = `# Product Link Manual Pass\n\nGenerated on ${new Date().toISOString()}\n\n## Before You Start\n\n- Use reports/product_link_audit.csv as the main sheet.\n- Use status for first-pass data triage and launchStatus for runtime launch readiness.\n- Filter launchStatus to ok before clicking rows that are ready for pass 2.\n- Fix any fail or review rows in Firestore first if you want a clean manual pass.\n\n## Current Snapshot\n\n- Total products: ${summary.totalProducts}\n- First-pass ok rows: ${summary.firstPassOkCount}\n- Launch-ready rows: ${summary.launchReadyCount}\n- Rows needing fixes or review: ${summary.fixQueueCount}\n\n## Manual Product Checks\n\nFill in the blank manual columns in reports/product_link_audit.csv as you click on mobile:\n\n- manualOpened\n- manualPageLoads\n- manualRightProduct\n- manualRightRetailer\n- manualNo404\n- manualNoWeirdRedirect\n- manualMobileIssue\n- manualFixNeeded\n- manualNotes\n\n## UI Flow Checks\n\nRun these flows on mobile or mobile emulation:\n\n- feed -> modal -> retailer\n- RoomScan pick -> retailer\n- saved sheet -> modal -> retailer\n- bag sheet -> modal -> retailer\n- shortlist page -> modal -> retailer\n- checkout item -> retailer\n- confirm gate -> continue to retailer\n- missing URL fallback\n- overlay close/restore behavior\n`;

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

function pickManualQueueRows(rows: AuditRow[]) {
  const selected = new Map<string, AuditRow>();

  for (const row of rows) {
    if (row.status !== "ok" || row.launchStatus !== "ok") {
      selected.set(row.id, row);
    }
  }

  const okRows = rows.filter((row) => row.launchStatus === "ok");
  for (const row of okRows.slice(0, 10)) {
    selected.set(row.id, row);
  }

  const merchantSeen = new Set<string>();
  const categorySeen = new Set<string>();

  for (const row of okRows) {
    const merchantKey = row.merchant.toLowerCase();
    if (merchantKey && !merchantSeen.has(merchantKey)) {
      merchantSeen.add(merchantKey);
      selected.set(row.id, row);
    }
  }

  for (const row of okRows) {
    const categoryKey = row.category.toLowerCase();
    if (categoryKey && !categorySeen.has(categoryKey)) {
      categorySeen.add(categoryKey);
      selected.set(row.id, row);
    }
  }

  return Array.from(selected.values());
}

async function fetchWithTimeout(url: string, userAgent: string, timeoutMs = 15000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": userAgent,
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-CA,en;q=0.9,en-US;q=0.8",
        "cache-control": "no-cache",
        pragma: "no-cache",
      },
    });

    const contentType = response.headers.get("content-type") || "";
    let bodySnippet = "";

    if (contentType.includes("text/html")) {
      const text = await response.text();
      bodySnippet = text.slice(0, 6000);
    }

    return {
      status: response.status,
      finalUrl: response.url,
      bodySnippet,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

function detectHttpIssue(status: number, finalUrl: string, bodySnippet: string) {
  const lowerUrl = finalUrl.toLowerCase();
  const lowerBody = bodySnippet.toLowerCase();
  const finalHost = getUrlHostname(finalUrl);

  if (status >= 400) return `status ${status}`;
  if (!isAmazonHostname(finalHost)) return `redirected to unexpected host ${finalHost || "unknown"}`;
  if (lowerUrl.includes("validatecaptcha") || /robot check|captcha/.test(lowerBody)) {
    return "captcha or anti-bot challenge";
  }
  if (/dogs of amazon|page not found|we couldn't find that page|sorry! something went wrong/.test(lowerBody)) {
    return "possible broken Amazon product page";
  }

  return "";
}

async function probeUrl(url: string, userAgent: string): Promise<HttpProbeResult> {
  try {
    const response = await fetchWithTimeout(url, userAgent);
    const detail = detectHttpIssue(response.status, response.finalUrl, response.bodySnippet);

    return {
      ok: detail.length === 0,
      status: response.status,
      finalUrl: response.finalUrl,
      detail: detail || `status ${response.status}`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      status: 0,
      finalUrl: url,
      detail: `request failed: ${message}`,
    };
  }
}

async function runHttpQaChecks(rows: AuditRow[], limit: number) {
  const desktopIssues = createBucket();
  const mobileIssues = createBucket();
  const checkedRows = rows.slice(0, Math.max(0, limit));

  for (const row of checkedRows) {
    const desktop = await probeUrl(row.resolvedUrl, DESKTOP_UA);
    if (!desktop.ok) {
      addIssue(desktopIssues, {
        id: row.id,
        displayName: row.displayName,
        merchant: row.merchant,
        asin: row.asin,
        rawPurchaseUrl: row.purchaseUrl,
        resolvedUrl: desktop.finalUrl || row.resolvedUrl,
        detail: `desktop ${desktop.detail}`,
      });
    }

    const mobile = await probeUrl(row.resolvedUrl, MOBILE_UA);
    if (!mobile.ok) {
      addIssue(mobileIssues, {
        id: row.id,
        displayName: row.displayName,
        merchant: row.merchant,
        asin: row.asin,
        rawPurchaseUrl: row.purchaseUrl,
        resolvedUrl: mobile.finalUrl || row.resolvedUrl,
        detail: `mobile ${mobile.detail}`,
      });
    }
  }

  console.log(`\nHTTP/mobile QA sample size: ${checkedRows.length}`);
  printBucket("Desktop HTTP issues", desktopIssues);
  printBucket("Mobile HTTP issues", mobileIssues);

  return {
    checkedCount: checkedRows.length,
    desktopIssues,
    mobileIssues,
  };
}

async function main() {
  loadDotenvFiles();

  const amazonAssocTag = getAmazonAssocTag();
  const strict = process.argv.includes("--strict");
  const httpCheck = process.argv.includes("--http-check");
  const httpLimit = Number(getArgValue("--limit") ?? 20);
  const outputDir = path.resolve(process.cwd(), getArgValue("--output-dir") ?? DEFAULT_OUTPUT_DIR);
  const db = getFirestore();
  const snap = await db.collection("products").get();

  const products: ProductRecord[] = snap.docs.map((doc) => {
    const data = doc.data() as Record<string, unknown>;
    const rawDisplayName = readOptionalString(data.displayName);
    const rawName = readOptionalString(data.name);
    const rawTitle = readOptionalString(data.title);
    const displayName =
      rawDisplayName ||
      rawName ||
      rawTitle ||
      "(unnamed)";
    const merchant =
      readOptionalString(data.merchant) || readOptionalString(data.retailer);
    const brand = readOptionalString(data.brand);
    const rawPurchaseUrl = readOptionalString(data.purchaseUrl);
    const fallbackUrl = readOptionalString(data.url);
    const asin = readOptionalString(data.asin).toUpperCase();
    const category = readOptionalString(data.category);
    const imageUrl = readOptionalString(data.imageUrl) || readOptionalString(data.imageURL);
    const price = Number(data.price ?? 0);
    const active = Boolean(data.active);
    const swipeEligible = Boolean(data.swipeEligible);
    const imageApproved = Boolean(data.imageApproved);
    const isCurated = Boolean(data.isCurated);

    return {
      id: doc.id,
      displayName,
      rawDisplayName,
      rawName,
      rawTitle,
      merchant,
      brand,
      category,
      price: Number.isFinite(price) ? price : 0,
      asin,
      imageUrl,
      active,
      swipeEligible,
      imageApproved,
      isCurated,
      rawPurchaseUrl,
      rawPurchaseUrlNormalized: normalizeHttpUrl(rawPurchaseUrl),
      fallbackUrl,
      fallbackUrlNormalized: normalizeHttpUrl(fallbackUrl),
      resolvedUrl: getResolvedPurchaseUrlWithTag(
        {
          name: displayName,
          displayName,
          category,
          asin,
          purchaseUrl: rawPurchaseUrl,
          url: fallbackUrl,
        },
        undefined,
        amazonAssocTag
      ),
    };
  });

  const rawUrlCounts = new Map<string, number>();
  for (const product of products) {
    if (!product.rawPurchaseUrlNormalized) continue;
    rawUrlCounts.set(
      product.rawPurchaseUrlNormalized,
      (rawUrlCounts.get(product.rawPurchaseUrlNormalized) ?? 0) + 1
    );
  }

  const requiredFieldIssues = createBucket();
  const missingUrl = createBucket();
  const invalidUrl = createBucket();
  const domainMismatch = createBucket();
  const missingRawAffiliateMarker = createBucket();
  const placeholderAffiliateTag = createBucket();
  const duplicateRawUrl = createBucket();
  const suspiciousRawUrl = createBucket();
  const imageDomainMismatch = createBucket();
  const nonCuratedProducts = createBucket();
  const duplicateTitleFieldIssues = createBucket();
  const suspiciousBrandIssues = createBucket();
  const runtimeAffiliateMissing = createBucket();
  const asinMismatch = createBucket();

  const auditRows: AuditRow[] = [];

  for (const product of products) {
    const affiliateRule = getAffiliateRule(product.merchant);
    const affiliateRuleConfigured = Boolean(affiliateRule);
    const hasPurchaseUrl = product.rawPurchaseUrl.trim().length > 0;
    const validUrl = product.rawPurchaseUrlNormalized.length > 0;
    const hostname = validUrl ? getUrlHostname(product.rawPurchaseUrlNormalized) : "";
    const hostHints = getMerchantHostHints(product.merchant);
    const merchantMatchesDomain =
      product.merchant.length > 0
        ? hostHints.length === 0 || hostHints.some((hint) => hostname.includes(hint))
        : false;
    const affiliateMarkerPresent =
      validUrl && affiliateRuleConfigured
        ? hasAffiliateMarker(product.rawPurchaseUrlNormalized, affiliateRule)
        : false;
    const placeholderTag = isPlaceholderAffiliateTag(
      getAmazonAffiliateTagValue(product.rawPurchaseUrlNormalized)
    );
    const duplicateUrl =
      validUrl && (rawUrlCounts.get(product.rawPurchaseUrlNormalized) ?? 0) > 1;
    const suspiciousUrl = validUrl && isSuspiciousUrl(product.rawPurchaseUrlNormalized);
    const runtimeAffiliateMarkerPresent =
      product.resolvedUrl.length > 0 && affiliateRuleConfigured
        ? hasAffiliateMarker(product.resolvedUrl, affiliateRule)
        : false;
    const resolvedAsin = extractAmazonAsin(product.resolvedUrl);
    const imageUrlPresent = product.imageUrl.length > 0;
    const imageUrlHostname = imageUrlPresent ? getUrlHostname(product.imageUrl) : "";
    const imageUrlMatchesMerchantDomain =
      imageUrlPresent && product.merchant.length > 0
        ? hostHints.length === 0 || hostHints.some((hint) => imageUrlHostname.includes(hint))
        : false;
    const titleFieldsPresent = getPresentTitleFields(product);
    const hasDuplicateTitleFields = titleFieldsPresent.length > 1;
    const duplicateTitleFieldValuesDiffer = hasConflictingTitleValues(titleFieldsPresent);
    const suspiciousBrandValue = isSuspiciousBrandValue(product.brand);

    const issueBase = {
      id: product.id,
      displayName: product.displayName,
      merchant: product.merchant,
      asin: product.asin,
      rawPurchaseUrl: product.rawPurchaseUrl,
      resolvedUrl: product.resolvedUrl,
      detail: "",
    };

    const notes: string[] = [];
    const launchNotes: string[] = [];
    const requiredNotes: string[] = [];

    if (!product.displayName || product.displayName === "(unnamed)") {
      notes.push("Missing displayName");
      requiredNotes.push("missing displayName");
    }

    if (!product.merchant) {
      notes.push("Missing merchant");
      requiredNotes.push("missing merchant");
    }

    if (!hasPurchaseUrl) {
      notes.push("Missing purchaseUrl");
      addIssue(missingUrl, {
        ...issueBase,
        detail: "missing purchaseUrl",
      });
    }

    if (hasPurchaseUrl && !validUrl) {
      notes.push("Invalid purchaseUrl");
      addIssue(invalidUrl, {
        ...issueBase,
        detail: "purchaseUrl is not a valid http(s) URL",
      });
    }

    if (validUrl && product.merchant && hostHints.length > 0 && !merchantMatchesDomain) {
      notes.push(`Merchant does not match URL hostname: ${hostname}`);
      addIssue(domainMismatch, {
        ...issueBase,
        detail: `merchant/domain mismatch: ${hostname}`,
      });
    }

    if (validUrl && affiliateRuleConfigured && !affiliateMarkerPresent) {
      notes.push(`No visible affiliate marker in purchaseUrl (${affiliateRule?.markers.join(" or ")})`);
      addIssue(missingRawAffiliateMarker, {
        ...issueBase,
        detail: `no visible affiliate marker in purchaseUrl (${affiliateRule?.markers.join(" or ")})`,
      });
    }

    if (placeholderTag) {
      notes.push(
        `Affiliate tag looks like placeholder: ${getAmazonAffiliateTagValue(product.rawPurchaseUrlNormalized)}`
      );
      addIssue(placeholderAffiliateTag, {
        ...issueBase,
        detail: `placeholder affiliate tag: ${getAmazonAffiliateTagValue(product.rawPurchaseUrlNormalized)}`,
      });
    }

    if (duplicateUrl) {
      notes.push("duplicate raw purchaseUrl used by multiple products");
      addIssue(duplicateRawUrl, {
        ...issueBase,
        detail: "duplicate raw purchaseUrl used by multiple products",
      });
    }

    if (suspiciousUrl) {
      notes.push("Suspicious or shortened purchaseUrl");
      addIssue(suspiciousRawUrl, {
        ...issueBase,
        detail: "suspicious or shortened purchaseUrl",
      });
    }

    if (!imageUrlPresent) {
      notes.push("Missing imageUrl");
      requiredNotes.push("missing imageUrl");
    }

    if (imageUrlPresent && product.merchant && hostHints.length > 0 && !imageUrlMatchesMerchantDomain) {
      notes.push(`imageUrl domain differs from merchant domain: ${imageUrlHostname}`);
      addIssue(imageDomainMismatch, {
        ...issueBase,
        detail: `imageUrl domain differs from merchant domain: ${imageUrlHostname}`,
      });
    }

    if (!product.active) {
      notes.push("Inactive product");
      requiredNotes.push("inactive product");
    }

    if (!product.swipeEligible) {
      notes.push("Not swipe eligible");
      requiredNotes.push("not swipe eligible");
    }

    if (!product.imageApproved) {
      notes.push("imageApproved is false");
      requiredNotes.push("imageApproved is false");
    }

    if (!product.isCurated) {
      notes.push("isCurated is false");
      addIssue(nonCuratedProducts, {
        ...issueBase,
        detail: "isCurated is false",
      });
    }

    if (hasDuplicateTitleFields) {
      const presentFieldNames = titleFieldsPresent.map((field) => field.label).join(", ");
      notes.push(`duplicate title/displayName/name fields: ${presentFieldNames}`);
      addIssue(duplicateTitleFieldIssues, {
        ...issueBase,
        detail: duplicateTitleFieldValuesDiffer
          ? `duplicate title fields with conflicting values (${presentFieldNames})`
          : `duplicate title fields present (${presentFieldNames})`,
      });
    }

    if (suspiciousBrandValue) {
      notes.push(`brand may need verification: ${product.brand}`);
      addIssue(suspiciousBrandIssues, {
        ...issueBase,
        detail: `brand may need verification: ${product.brand}`,
      });
    }

    if (requiredNotes.length > 0) {
      addIssue(requiredFieldIssues, {
        ...issueBase,
        detail: requiredNotes.join("; "),
      });
    }

    if (!affiliateRuleConfigured && product.merchant) {
      notes.push("No affiliate rule configured for this merchant");
    }

    if (affiliateRuleConfigured && !runtimeAffiliateMarkerPresent) {
      launchNotes.push(
        amazonAssocTag
          ? "runtime resolved URL is missing affiliate marker"
          : "runtime resolved URL is missing affiliate marker because AMAZON_ASSOC_TAG/VITE_AMAZON_ASSOC_TAG is not set"
      );
      addIssue(runtimeAffiliateMissing, {
        ...issueBase,
        detail: launchNotes[launchNotes.length - 1],
      });
    }

    if (hasValidAsin(product.asin) && resolvedAsin && resolvedAsin !== product.asin) {
      launchNotes.push(`resolved ASIN ${resolvedAsin} does not match product ASIN ${product.asin}`);
      addIssue(asinMismatch, {
        ...issueBase,
        detail: `resolved ASIN ${resolvedAsin} does not match product ASIN ${product.asin}`,
      });
    }

    const status = getDataStatus({
      hasDisplayName: Boolean(product.displayName && product.displayName !== "(unnamed)"),
      hasMerchant: Boolean(product.merchant),
      hasPurchaseUrl,
      validUrl,
      imageUrlPresent,
      imageUrlMatchesMerchantDomain,
      active: product.active,
      swipeEligible: product.swipeEligible,
      imageApproved: product.imageApproved,
      isCurated: product.isCurated,
      affiliateRuleConfigured,
      affiliateMarkerPresent,
      placeholderAffiliateTag: placeholderTag,
      merchantMatchesDomain,
      duplicateRawUrl: duplicateUrl,
      suspiciousUrl,
      duplicateTitleFields: hasDuplicateTitleFields,
      duplicateTitleFieldValuesDiffer,
      suspiciousBrandValue,
    });
    const launchStatus = getLaunchStatus(
      status,
      runtimeAffiliateMarkerPresent,
      affiliateRuleConfigured
    );

    auditRows.push({
      id: product.id,
      displayName: product.displayName,
      merchant: product.merchant,
      category: product.category,
      price: product.price,
      asin: product.asin,
      purchaseUrl: product.rawPurchaseUrl,
      resolvedUrl: product.resolvedUrl,
      imageUrl: product.imageUrl,
      hasPurchaseUrl,
      validUrl,
      hostname,
      merchantMatchesDomain,
      affiliateRuleConfigured,
      affiliateMarkerPresent,
      placeholderAffiliateTag: placeholderTag,
      duplicateRawUrl: duplicateUrl,
      suspiciousUrl,
      runtimeAffiliateMarkerPresent,
      imageUrlPresent,
      imageUrlHostname,
      imageUrlMatchesMerchantDomain,
      active: product.active,
      swipeEligible: product.swipeEligible,
      imageApproved: product.imageApproved,
      isCurated: product.isCurated,
      duplicateTitleFields: hasDuplicateTitleFields,
      duplicateTitleFieldValuesDiffer,
      titleFieldsPresent: titleFieldsPresent.map((field) => field.label),
      suspiciousBrandValue,
      brand: product.brand,
      status,
      launchStatus,
      manualReady: launchStatus === "ok",
      notes,
      launchNotes,
    });
  }

  const totalProducts = auditRows.length;
  const firstPassOkCount = auditRows.filter((row) => row.status === "ok").length;
  const launchReadyCount = auditRows.filter((row) => row.launchStatus === "ok").length;
  const fixQueueCount = auditRows.filter((row) => row.launchStatus !== "ok").length;

  console.log("Retailer URL audit");
  console.log(`Total products: ${totalProducts}`);
  console.log(`First-pass ok products: ${firstPassOkCount}`);
  console.log(`Launch-ready products: ${launchReadyCount}`);
  console.log(`Amazon associate tag configured: ${amazonAssocTag ? "yes" : "no"}`);

  printBucket("Required field / launch flag issues", requiredFieldIssues);
  printBucket("Missing purchaseUrl", missingUrl);
  printBucket("Invalid purchaseUrl", invalidUrl);
  printBucket("Merchant/domain mismatches", domainMismatch);
  printBucket("Missing visible affiliate marker", missingRawAffiliateMarker);
  printBucket("Placeholder affiliate tags in raw URLs", placeholderAffiliateTag);
  printBucket("Duplicate raw purchaseUrls", duplicateRawUrl);
  printBucket("Suspicious raw purchaseUrls", suspiciousRawUrl);
  printBucket("Image host mismatches", imageDomainMismatch);
  printBucket("Non-curated products", nonCuratedProducts);
  printBucket("Duplicate title fields", duplicateTitleFieldIssues);
  printBucket("Suspicious brand values", suspiciousBrandIssues);
  printBucket("Missing runtime affiliate marker", runtimeAffiliateMissing);
  printBucket("Amazon ASIN mismatches", asinMismatch);

  const liveExportPath = path.join(outputDir, "live_products_export.csv");
  const auditCsvPath = path.join(outputDir, "product_link_audit.csv");
  const manualQueuePath = path.join(outputDir, "product_link_manual_queue.csv");
  const manualChecklistPath = path.join(outputDir, "manual_link_test_checklist.md");

  writeCsv(
    liveExportPath,
    [
      "id",
      "displayName",
      "name",
      "title",
      "brand",
      "merchant",
      "retailer",
      "category",
      "price",
      "purchaseUrl",
      "asin",
      "imageUrl",
      "imageApproved",
      "isCurated",
      "active",
      "swipeEligible",
    ],
    products.map((product) => ({
      id: product.id,
      displayName: product.displayName,
      name: product.rawName,
      title: product.rawTitle,
      brand: product.brand,
      merchant: product.merchant,
      retailer: product.merchant,
      category: product.category,
      price: product.price,
      purchaseUrl: product.rawPurchaseUrl,
      asin: product.asin,
      imageUrl: product.imageUrl,
      imageApproved: product.imageApproved,
      isCurated: product.isCurated,
      active: product.active,
      swipeEligible: product.swipeEligible,
    }))
  );

  writeCsv(
    auditCsvPath,
    [
      "id",
      "displayName",
      "brand",
      "merchant",
      "category",
      "price",
      "asin",
      "imageUrl",
      "imageUrlHostname",
      "imageUrlMatchesMerchantDomain",
      "purchaseUrl",
      "resolvedUrl",
      "hasPurchaseUrl",
      "validUrl",
      "hostname",
      "merchantMatchesDomain",
      "affiliateRuleConfigured",
      "affiliateMarkerPresent",
      "placeholderAffiliateTag",
      "duplicateRawUrl",
      "suspiciousUrl",
      "runtimeAffiliateMarkerPresent",
      "imageUrlPresent",
      "active",
      "swipeEligible",
      "imageApproved",
      "isCurated",
      "duplicateTitleFields",
      "duplicateTitleFieldValuesDiffer",
      "titleFieldsPresent",
      "suspiciousBrandValue",
      "status",
      "launchStatus",
      "manualReady",
      "notes",
      "launchNotes",
      "manualOpened",
      "manualPageLoads",
      "manualRightProduct",
      "manualRightRetailer",
      "manualNo404",
      "manualNoWeirdRedirect",
      "manualMobileIssue",
      "manualFixNeeded",
      "manualNotes",
    ],
    auditRows.map((row) => ({
      id: row.id,
      displayName: row.displayName,
      brand: row.brand,
      merchant: row.merchant,
      category: row.category,
      price: row.price,
      asin: row.asin,
      imageUrl: row.imageUrl,
      imageUrlHostname: row.imageUrlHostname,
      imageUrlMatchesMerchantDomain: row.imageUrlMatchesMerchantDomain,
      purchaseUrl: row.purchaseUrl,
      resolvedUrl: row.resolvedUrl,
      hasPurchaseUrl: row.hasPurchaseUrl,
      validUrl: row.validUrl,
      hostname: row.hostname,
      merchantMatchesDomain: row.merchantMatchesDomain,
      affiliateRuleConfigured: row.affiliateRuleConfigured,
      affiliateMarkerPresent: row.affiliateMarkerPresent,
      placeholderAffiliateTag: row.placeholderAffiliateTag,
      duplicateRawUrl: row.duplicateRawUrl,
      suspiciousUrl: row.suspiciousUrl,
      runtimeAffiliateMarkerPresent: row.runtimeAffiliateMarkerPresent,
      imageUrlPresent: row.imageUrlPresent,
      active: row.active,
      swipeEligible: row.swipeEligible,
      imageApproved: row.imageApproved,
      isCurated: row.isCurated,
      duplicateTitleFields: row.duplicateTitleFields,
      duplicateTitleFieldValuesDiffer: row.duplicateTitleFieldValuesDiffer,
      titleFieldsPresent: row.titleFieldsPresent,
      suspiciousBrandValue: row.suspiciousBrandValue,
      status: row.status,
      launchStatus: row.launchStatus,
      manualReady: row.manualReady,
      notes: row.notes,
      launchNotes: row.launchNotes,
      manualOpened: "",
      manualPageLoads: "",
      manualRightProduct: "",
      manualRightRetailer: "",
      manualNo404: "",
      manualNoWeirdRedirect: "",
      manualMobileIssue: "",
      manualFixNeeded: "",
      manualNotes: "",
    }))
  );

  const manualQueueRows = pickManualQueueRows(auditRows);
  writeCsv(
    manualQueuePath,
    [
      "id",
      "displayName",
      "brand",
      "merchant",
      "category",
      "price",
      "imageUrlHostname",
      "imageUrlMatchesMerchantDomain",
      "purchaseUrl",
      "isCurated",
      "duplicateTitleFields",
      "titleFieldsPresent",
      "suspiciousBrandValue",
      "status",
      "launchStatus",
      "manualReady",
      "notes",
      "launchNotes",
      "manualOpened",
      "manualPageLoads",
      "manualRightProduct",
      "manualRightRetailer",
      "manualNo404",
      "manualNoWeirdRedirect",
      "manualMobileIssue",
      "manualFixNeeded",
      "manualNotes",
    ],
    manualQueueRows.map((row) => ({
      id: row.id,
      displayName: row.displayName,
      brand: row.brand,
      merchant: row.merchant,
      category: row.category,
      price: row.price,
      imageUrlHostname: row.imageUrlHostname,
      imageUrlMatchesMerchantDomain: row.imageUrlMatchesMerchantDomain,
      purchaseUrl: row.purchaseUrl,
      isCurated: row.isCurated,
      duplicateTitleFields: row.duplicateTitleFields,
      titleFieldsPresent: row.titleFieldsPresent,
      suspiciousBrandValue: row.suspiciousBrandValue,
      status: row.status,
      launchStatus: row.launchStatus,
      manualReady: row.manualReady,
      notes: row.notes,
      launchNotes: row.launchNotes,
      manualOpened: "",
      manualPageLoads: "",
      manualRightProduct: "",
      manualRightRetailer: "",
      manualNo404: "",
      manualNoWeirdRedirect: "",
      manualMobileIssue: "",
      manualFixNeeded: "",
      manualNotes: "",
    }))
  );

  writeManualChecklist(manualChecklistPath, {
    totalProducts,
    firstPassOkCount,
    launchReadyCount,
    fixQueueCount,
  });

  console.log(`\nWrote product export: ${liveExportPath}`);
  console.log(`Wrote audit CSV: ${auditCsvPath}`);
  console.log(`Wrote manual queue: ${manualQueuePath}`);
  console.log(`Wrote manual checklist: ${manualChecklistPath}`);

  let httpResults: Awaited<ReturnType<typeof runHttpQaChecks>> | null = null;
  if (httpCheck) {
    const httpCandidates = auditRows.filter((row) => row.resolvedUrl.length > 0);
    httpResults = await runHttpQaChecks(httpCandidates, httpLimit);
  }

  const criticalIssueCount =
    auditRows.filter((row) => row.launchStatus !== "ok").length +
    (httpResults?.desktopIssues.count ?? 0) +
    (httpResults?.mobileIssues.count ?? 0);

  if (strict && criticalIssueCount > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});