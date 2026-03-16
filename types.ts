
export type CanonicalCategory =
  | "lighting"
  | "wall-decor"
  | "storage"
  | "mirrors"
  | "plants"
  | "shelf-styling"
  | "desk-setup"
  | "cozy-bedroom";

export type PrimaryType =
  | "lamp"
  | "sconce"
  | "poster"
  | "basket"
  | "organizer"
  | "shelf"
  | "mirror"
  | "pillow"
  | "tray"
  | "hook"
  | "bin"
  | "box"
  | "plant"
  | "decor";

export type ProductDoc = {
  displayName: string;
  brand: string;
  category: CanonicalCategory;
  primaryType: PrimaryType;
  tags: string[];
  roomTags: string[];
  styleTags: string[];
  price: number;
  imageUrl: string;
  description: string;
  merchant: string;
  purchaseUrl: string;
  asin?: string;
  isCurated: boolean;
  swipeEligible: boolean;
  imageApproved: boolean;
  active: boolean;
};

export interface Product {
  id: string;
  name: string;
  displayName?: string;
  brand: string;
  price: number;
  description: string;
  category: string;
  imageUrl: string;
  tags: string[];
  roomTags?: string[];
  styleTags?: string[];
  matchScore?: number; // Calculated by the ML algorithm
  primaryType?: string;
  isCurated?: boolean;
  swipeEligible?: boolean;
  imageApproved?: boolean;
  isLaunch?: boolean;
  active?: boolean;

  // Affiliate checkout fields (optional)
  checkoutType?: "affiliate" | "stripe";
  merchant?: string;
  purchaseUrl?: string;

  // Amazon product ID (10 chars)
  asin?: string;
}

export interface UserPersona {
  styleKeywords: string[];
  priceSensitivity: 'budget' | 'mid-range' | 'luxury';
  dominantCategories: string[];
  dislikedFeatures: string[];
  detectedVibe: string;
}

export interface UserPreferences {
  interests: string[];
  likedProducts: Product[];
  dislikedProducts: Product[];
  wishlist: Product[];
  cart: Product[];
  lastAction: 'wishlist' | 'cart' | null;
  persona: UserPersona;
  currentFeed: Product[];
  feedIndex: number;
}

export type EmailKind = "cart" | "roomscan" | "generic" | "unknown";

export type EmailKindStat = {
  sent: number;
  failed: number;
  returned: number;
  cleanReturned: number;
  uniqueSent: number;
  uniqueReturned: number;
};

export type TopEmailErrorRow = {
  message: string;
  count: number;
};

export type AppState =
  | 'auth'
  | 'interests'
  | 'discovering'
  | 'browsing'
  | 'profile'
  | 'roomscan'
  | 'cart'
  | 'privacy'
  | 'terms'
  | 'disclosure'
  | 'admin';
