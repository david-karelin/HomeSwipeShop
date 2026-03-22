type ViteImportMeta = ImportMeta & {
  env?: Record<string, string | boolean | undefined>;
};

const readOptionalString = (value: unknown) =>
  typeof value === "string" ? value.trim() : "";

export const AFFILIATE_DISCLOSURE_TEXT =
  "Affiliate Disclosure: Some links on Seligo are affiliate links. As an Amazon Associate I earn from qualifying purchases.";

export function getBrowserAmazonAssocTag() {
  return readOptionalString((import.meta as ViteImportMeta).env?.VITE_AMAZON_ASSOC_TAG);
}

export function resolveNodeAmazonAssocTag() {
  if (typeof process === "undefined" || !process.env) {
    return {
      value: "",
      configured: false,
      source: "",
    } as const;
  }

  const amazonAssocTag = readOptionalString(process.env.AMAZON_ASSOC_TAG);
  if (amazonAssocTag) {
    return {
      value: amazonAssocTag,
      configured: true,
      source: "AMAZON_ASSOC_TAG",
    } as const;
  }

  const viteAmazonAssocTag = readOptionalString(process.env.VITE_AMAZON_ASSOC_TAG);
  if (viteAmazonAssocTag) {
    return {
      value: viteAmazonAssocTag,
      configured: true,
      source: "VITE_AMAZON_ASSOC_TAG",
    } as const;
  }

  return {
    value: "",
    configured: false,
    source: "",
  } as const;
}