import type { Product } from "./types";

export type ProductLinkLike = Partial<
  Pick<Product, "name" | "displayName" | "category" | "asin" | "purchaseUrl" | "merchant" | "brand">
> & {
  url?: string | null;
  retailer?: string | null;
};

const AMAZON_ASIN_REGEX = /\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:[/?]|$)/i;

const MERCHANT_HOST_HINTS: Record<string, string[]> = {
  amazon: ["amazon."],
  amazonca: ["amazon.ca", "amazon."],
  article: ["article."],
  cb2: ["cb2."],
  crateandbarrel: ["crateandbarrel."],
  eq3: ["eq3."],
  etsy: ["etsy."],
  hm: ["hm.com", "www2.hm.com"],
  homedepot: ["homedepot."],
  ikea: ["ikea."],
  overstock: ["overstock."],
  target: ["target."],
  urbanoutfitters: ["urbanoutfitters."],
  walmart: ["walmart."],
  wayfair: ["wayfair."],
  westelm: ["westelm."],
};

export const readOptionalString = (value: unknown) =>
  typeof value === "string" ? value.trim() : "";

const getProductQueryName = (product: Pick<ProductLinkLike, "name" | "displayName">) =>
  readOptionalString(product.displayName) || readOptionalString(product.name);

const normalizeAmazonTag = (value?: string | null) => readOptionalString(value);

export const normalizeHttpUrl = (value: unknown) => {
  const candidate = readOptionalString(value);
  if (!candidate) return "";

  const normalizedCandidate =
    /^[a-z][a-z0-9+.-]*:\/\//i.test(candidate) || candidate.startsWith("//")
      ? candidate
      : candidate.startsWith("www.")
        ? `https://${candidate}`
        : candidate;

  try {
    const url = new URL(
      normalizedCandidate.startsWith("//")
        ? `https:${normalizedCandidate}`
        : normalizedCandidate
    );
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    return url.toString();
  } catch {
    return "";
  }
};

export const buildAmazonSearchUrl = (
  product: Pick<ProductLinkLike, "name" | "displayName" | "category">,
  amazonTag?: string | null
) => {
  const query = encodeURIComponent(
    `${getProductQueryName(product)} ${readOptionalString(product.category)} home decor`.trim() ||
      "home decor"
  );
  const baseUrl = `https://www.amazon.ca/s?k=${query}`;
  return withAmazonAffiliateTag(baseUrl, amazonTag);
};

export const buildAmazonAsinUrl = (asin: string, amazonTag?: string | null) => {
  const normalizedAsin = readOptionalString(asin).toUpperCase();
  if (!/^[A-Z0-9]{10}$/.test(normalizedAsin)) return "";

  const baseUrl = `https://www.amazon.ca/dp/${normalizedAsin}/ref=nosim`;
  return withAmazonAffiliateTag(baseUrl, amazonTag);
};

const isAmazonHost = (hostname: string) => {
  const host = hostname.toLowerCase();
  return /^(.+\.)?amazon\.[a-z.]+$/.test(host);
};

const isWayfairHost = (hostname: string) => {
  const host = hostname.toLowerCase();
  return host === "www.wayfair.com" || host === "wayfair.com";
};

export const withWayfairAffiliateTag = (rawUrl: string, affiliateId?: string | null) => {
  const normalizedUrl = normalizeHttpUrl(rawUrl);
  const id = readOptionalString(affiliateId);
  if (!normalizedUrl || !id) return normalizedUrl;

  try {
    const url = new URL(normalizedUrl);
    if (!isWayfairHost(url.hostname)) return normalizedUrl;
    url.searchParams.set("refid", id);
    return url.toString();
  } catch {
    return normalizedUrl;
  }
};

export const withAmazonAffiliateTag = (rawUrl: string, amazonTag?: string | null) => {
  const normalizedUrl = normalizeHttpUrl(rawUrl);
  const tag = normalizeAmazonTag(amazonTag);

  if (!normalizedUrl || !tag) return normalizedUrl;

  try {
    const url = new URL(normalizedUrl);
    if (!isAmazonHost(url.hostname)) return normalizedUrl;
    url.searchParams.set("tag", tag);
    return url.toString();
  } catch {
    return normalizedUrl;
  }
};

export const getProductPurchaseUrlWithTag = (
  product: ProductLinkLike,
  amazonTag?: string | null,
  wayfairId?: string | null
) => {
  const asinUrl = buildAmazonAsinUrl(product.asin ?? "", amazonTag);
  if (asinUrl) return asinUrl;

  const rawPurchaseUrl = readOptionalString(product.purchaseUrl);
  const rawFallbackUrl = readOptionalString(product.url);

  const purchaseUrl =
    withWayfairAffiliateTag(withAmazonAffiliateTag(rawPurchaseUrl, amazonTag), wayfairId);
  const fallbackUrl =
    withWayfairAffiliateTag(withAmazonAffiliateTag(rawFallbackUrl, amazonTag), wayfairId);

  return purchaseUrl || fallbackUrl || buildAmazonSearchUrl(product, amazonTag);
};

export const getResolvedPurchaseUrlWithTag = (
  product: ProductLinkLike,
  preferredUrl?: string | null,
  amazonTag?: string | null,
  wayfairId?: string | null
) => {
  const preferred = readOptionalString(preferredUrl);
  const taggedPreferred =
    withWayfairAffiliateTag(withAmazonAffiliateTag(preferred, amazonTag), wayfairId);
  return taggedPreferred || getProductPurchaseUrlWithTag(product, amazonTag, wayfairId);
};

export const getUrlHostname = (value: unknown) => {
  const normalizedUrl = normalizeHttpUrl(value);
  if (!normalizedUrl) return "";

  try {
    return new URL(normalizedUrl).hostname.toLowerCase();
  } catch {
    return "";
  }
};

export const isAmazonHostname = (hostname: string) => {
  const host = readOptionalString(hostname).toLowerCase();
  return /^(.+\.)?amazon\.[a-z.]+$/.test(host);
};

export const hasAmazonAffiliateTag = (value: unknown) => {
  const normalizedUrl = normalizeHttpUrl(value);
  if (!normalizedUrl) return false;

  try {
    const url = new URL(normalizedUrl);
    if (!isAmazonHostname(url.hostname)) return false;
    return readOptionalString(url.searchParams.get("tag")).length > 0;
  } catch {
    return false;
  }
};

export const getAmazonAffiliateTagValue = (value: unknown) => {
  const normalizedUrl = normalizeHttpUrl(value);
  if (!normalizedUrl) return "";

  try {
    const url = new URL(normalizedUrl);
    if (!isAmazonHostname(url.hostname)) return "";
    return readOptionalString(url.searchParams.get("tag"));
  } catch {
    return "";
  }
};

export const isPlaceholderAffiliateTag = (value: unknown) => {
  const normalizedValue = readOptionalString(value).toLowerCase();
  if (!normalizedValue) return false;
  return /(yourtag|yourrealtag|placeholder|changeme|example|test)/.test(normalizedValue);
};

export const extractAmazonAsin = (value: unknown) => {
  const normalizedUrl = normalizeHttpUrl(value);
  if (!normalizedUrl) return "";

  const match = normalizedUrl.match(AMAZON_ASIN_REGEX);
  return match?.[1]?.toUpperCase() ?? "";
};

export const getMerchantHostHints = (merchant: unknown) => {
  const merchantKey = readOptionalString(merchant)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");

  return MERCHANT_HOST_HINTS[merchantKey] ?? [];
};