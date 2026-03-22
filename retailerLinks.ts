import type { Product } from "./types";
import type {
  RetailerClickSource,
  RetailerClickView,
  RetailerPlacement,
} from "./src/lib/retailerClicks";
import { getBrowserAmazonAssocTag } from "./src/lib/affiliateConfig";
import {
  getProductPurchaseUrlWithTag,
  getResolvedPurchaseUrlWithTag,
  readOptionalString,
} from "./retailerUrlUtils";

const AMAZON_TAG = getBrowserAmazonAssocTag();

export type RetailerLinkOptions = {
  source?: RetailerClickSource;
  view?: RetailerClickView;
  placement?: RetailerPlacement;
  purchaseUrl?: string;
  includeCheckoutOpen?: boolean;
};

export const getProductPurchaseUrl = (product: Product) => {
  return getProductPurchaseUrlWithTag(product, AMAZON_TAG);
};

export const getResolvedPurchaseUrl = (product: Product, preferredUrl?: string | null) => {
  return getResolvedPurchaseUrlWithTag(product, preferredUrl, AMAZON_TAG);
};

export const getProductRetailerName = (product: Product) => {
  const retailer = readOptionalString((product as Product & { retailer?: string }).retailer);
  return retailer || readOptionalString(product.merchant) || readOptionalString(product.brand);
};