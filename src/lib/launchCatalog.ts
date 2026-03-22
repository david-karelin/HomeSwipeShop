export type LaunchCatalogProductLike = {
  title?: string | null;
  name?: string | null;
  displayName?: string | null;
  brand?: string | null;
  merchant?: string | null;
  retailer?: string | null;
  purchaseUrl?: string | null;
  imageUrl?: string | null;
  asin?: string | null;
  active?: boolean | null;
  swipeEligible?: boolean | null;
  imageApproved?: boolean | null;
  isCurated?: boolean | null;
  isLaunch?: boolean | null;
};

const PLACEHOLDER_BRANDS = new Set([
  "swipeshop studio",
  "seligo",
  "seligo.ai",
  "unknown",
]);

function norm(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

export function pickLaunchTitle(product: LaunchCatalogProductLike) {
  return String(product.displayName ?? product.name ?? product.title ?? "").trim();
}

export function pickLaunchMerchant(product: LaunchCatalogProductLike) {
  return String(product.merchant ?? product.retailer ?? "").trim();
}

export function isPlaceholderLaunchBrand(brand?: string | null) {
  return PLACEHOLDER_BRANDS.has(norm(brand));
}

export function isLaunchCatalogProduct(product: LaunchCatalogProductLike) {
  const merchant = norm(pickLaunchMerchant(product));
  const purchaseUrl = norm(product.purchaseUrl);
  const imageUrl = norm(product.imageUrl);
  const asin = String(product.asin ?? "").trim();
  const isAmazon = merchant.includes("amazon");

  return (
    product.isLaunch === true &&
    product.isCurated === true &&
    product.active === true &&
    product.swipeEligible === true &&
    product.imageApproved === true &&
    Boolean(merchant) &&
    Boolean(purchaseUrl) &&
    !purchaseUrl.includes("/s?") &&
    !imageUrl.includes("picsum.photos") &&
    !isPlaceholderLaunchBrand(product.brand) &&
    (!isAmazon || Boolean(asin))
  );
}

export function filterLaunchCatalogProducts<T extends LaunchCatalogProductLike>(products: T[]) {
  return products.filter((product) => isLaunchCatalogProduct(product));
}