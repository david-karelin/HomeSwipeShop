export type RetailerClickSource =
  | "checkout_modal"
  | "cart_confirm"
  | "roomscan"
  | "product_overlay"
  | "saved_sheet"
  | "bag_sheet"
  | "shortlist_page"
  | "unknown";

export type RetailerClickView = "browsing" | "roomscan" | "checkout" | "cart";

export type RetailerPlacement =
  | "continue_to_retailer"
  | "product_overlay_cta"
  | "checkout_cart_item"
  | "checkout_saved_item"
  | "roomscan_pick"
  | "unknown";

export type ProductOverlayView = "browsing" | "roomscan" | "checkout" | "cart";

export type ProductOverlaySource =
  | "unknown"
  | "feed"
  | "roomscan_pick"
  | "saved_sheet"
  | "bag_sheet"
  | "checkout"
  | "shortlist_bag"
  | "shortlist_saved";

export type ProductOverlayContext = {
  view: ProductOverlayView;
  source: ProductOverlaySource;
};

export const getRetailerClickSource = (
  source?: ProductOverlaySource | RetailerClickSource | null
): RetailerClickSource => {
  switch (source) {
    case "checkout_modal":
    case "cart_confirm":
    case "roomscan":
    case "product_overlay":
    case "saved_sheet":
    case "bag_sheet":
    case "shortlist_page":
    case "unknown":
      return source;
    case "roomscan_pick":
      return "roomscan";
    case "shortlist_bag":
    case "shortlist_saved":
      return "shortlist_page";
    case "checkout":
      return "checkout_modal";
    case "feed":
    default:
      return "product_overlay";
  }
};

export const normalizeRetailerPlacement = (
  placement?: RetailerPlacement | null,
  fallback: RetailerPlacement = "unknown"
): RetailerPlacement => {
  switch (placement) {
    case "continue_to_retailer":
    case "product_overlay_cta":
    case "checkout_cart_item":
    case "checkout_saved_item":
    case "roomscan_pick":
    case "unknown":
      return placement;
    default:
      return fallback;
  }
};

export const shouldIncludeCheckoutOpen = (
  source?: RetailerClickSource | null,
  view?: RetailerClickView | null
) => {
  return source === "checkout_modal" || source === "cart_confirm" || view === "checkout";
};