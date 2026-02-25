
export interface Product {
  id: string;
  name: string;
  brand: string;
  price: number;
  description: string;
  category: string;
  imageUrl: string;
  tags: string[];
  matchScore?: number; // Calculated by the ML algorithm

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

export type AppState = 'auth' | 'interests' | 'discovering' | 'browsing' | 'search' | 'cart' | 'profile';
