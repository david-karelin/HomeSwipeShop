import { onboardingCopy } from "./content/copy";

export const VIBE_CATEGORIES = [
  {
    id: "desk-setup",
    label: onboardingCopy.interestLabels["desk-setup"],
    emoji: "🖥️",
    description: onboardingCopy.interestDescriptions["desk-setup"],
  },
  {
    id: "lighting",
    label: onboardingCopy.interestLabels.lighting,
    emoji: "💡",
    description: onboardingCopy.interestDescriptions.lighting,
  },
  {
    id: "wall-decor",
    label: onboardingCopy.interestLabels["wall-decor"],
    emoji: "🖼️",
    description: onboardingCopy.interestDescriptions["wall-decor"],
  },
  {
    id: "cozy-bedroom",
    label: onboardingCopy.interestLabels["cozy-bedroom"],
    emoji: "🛏️",
    description: onboardingCopy.interestDescriptions["cozy-bedroom"],
  },
  {
    id: "storage",
    label: onboardingCopy.interestLabels.storage,
    emoji: "🧺",
    description: onboardingCopy.interestDescriptions.storage,
  },
  {
    id: "mirrors",
    label: onboardingCopy.interestLabels.mirrors,
    emoji: "🪞",
    description: onboardingCopy.interestDescriptions.mirrors,
  },
  {
    id: "plants",
    label: onboardingCopy.interestLabels.plants,
    emoji: "🪴",
    description: onboardingCopy.interestDescriptions.plants,
  },
  {
    id: "shelf-styling",
    label: onboardingCopy.interestLabels["shelf-styling"],
    emoji: "🪄",
    description: onboardingCopy.interestDescriptions["shelf-styling"],
  },
  {
    id: "small-space-fixes",
    label: onboardingCopy.interestLabels["small-space-fixes"],
    emoji: "✨",
    description: onboardingCopy.interestDescriptions["small-space-fixes"],
  },
  {
    id: "under-50",
    label: onboardingCopy.interestLabels["under-50"],
    emoji: "💸",
    description: onboardingCopy.interestDescriptions["under-50"],
  },
] as const;

export const CANONICAL_INTEREST_IDS = VIBE_CATEGORIES.map((category) => category.id);

export const INTEREST_ID_ALIASES: Record<string, string | null> = {
  wall_art: "wall-decor",
  "wall-art": "wall-decor",
  bedding: "cozy-bedroom",
  tables: "desk-setup",
  rugs: null,
  seating: null,
  kitchen_decor: null,
  "kitchen-decor": null,
};

export function normalizeInterestIds(interests: string[]) {
  return Array.from(
    new Set(
      interests
        .map((interest) => String(interest ?? "").trim())
        .filter(Boolean)
        .map((interest) =>
          Object.prototype.hasOwnProperty.call(INTEREST_ID_ALIASES, interest)
            ? INTEREST_ID_ALIASES[interest]
            : interest
        )
        .filter((interest): interest is string => Boolean(interest))
    )
  );
}

export const PRODUCT_VIBE_TAGS = [
  "cozy desk upgrade",
  "blank wall fix",
  "small-space win",
  "looks expensive",
  "under $30",
  "under $50",
  "renter-friendly",
  "clean desk energy",
  "nightstand glow-up",
  "easy room upgrade",
] as const;

export const HERO_COPY = {
  title: "Swipe Your Next Room Upgrade",
  subtitle:
    "Find affordable pieces for your bedroom, desk, or apartment that match your vibe.",
} as const;

export const QUICK_ACTIONS = [
  {
    id: "scan",
    label: "Scan My Room",
    emoji: "📸",
    description: "Get picks that fit your actual space",
  },
  {
    id: "match",
    label: "Match Inspo",
    emoji: "🎯",
    description: "Upload a room pic and match the vibe",
  },
  {
    id: "swipe",
    label: "Start Swiping",
    emoji: "💙",
    description: "Browse cheap yes/no room upgrades",
  },
] as const;

export const SWIPE_FEED_RULES = {
  idealMaxPrice: 50,
  standardMaxPrice: 60,
  hardMaxPrice: 80,
  premiumOverrideTypes: ["lamp", "lighting", "sconce", "mirror"],
  placeholderImageHosts: [
    "picsum.photos",
    "placehold.co",
    "via.placeholder.com",
    "placeholder.com",
    "dummyimage.com",
  ],
  preferredCategories: [
    "Desk Setup",
    "Lighting",
    "Wall Decor",
    "Cozy Bedroom",
    "Storage",
    "Mirrors",
    "Plants",
    "Shelf Styling",
    "Small Space Fixes",
    "Under $50",
  ],
  bannedKeywords: [
    "sofa",
    "sectional",
    "dining table",
    "coffee table set",
    "bed frame",
    "mattress",
    "dresser",
    "tv stand",
    "bar stool",
    "office chair",
    "rug 8x10",
    "rug 9x12",
    "bedding set",
  ],
  preferredKeywords: [
    "lamp",
    "sconce",
    "light",
    "mirror",
    "wall art",
    "print",
    "poster",
    "tray",
    "organizer",
    "basket",
    "shelf",
    "ledge",
    "plant",
    "vase",
    "pillow",
    "cushion",
    "hook",
    "pegboard",
    "desk",
    "nightstand",
    "storage",
    "candle",
  ],
} as const;

export const INTEREST_QUERY_TAGS: Record<string, string[]> = {
  "desk-setup": ["desk-setup", "desk"],
  lighting: ["lighting", "lamp"],
  "wall-decor": ["wall-decor", "wall-art", "poster", "print"],
  "cozy-bedroom": ["cozy-bedroom", "pillow", "blanket"],
  storage: ["storage", "organizer", "basket", "bin"],
  mirrors: ["mirrors", "mirror"],
  plants: ["plants", "plant", "succulent"],
  "shelf-styling": ["shelf-styling", "shelf", "vase", "tray"],
  "small-space-fixes": ["small-space-fixes", "compact", "renter-friendly"],
  "under-50": ["under-50", "under-30", "affordable"],
};