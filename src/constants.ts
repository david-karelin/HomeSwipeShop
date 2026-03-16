export const VIBE_CATEGORIES = [
  {
    id: "desk-setup",
    label: "Desk Setup",
    emoji: "🖥️",
    description: "Clean, aesthetic desk upgrades",
  },
  {
    id: "lighting",
    label: "Lighting",
    emoji: "💡",
    description: "Lamps, glow, and cozy light",
  },
  {
    id: "wall-decor",
    label: "Wall Decor",
    emoji: "🖼️",
    description: "Art, prints, and blank-wall fixes",
  },
  {
    id: "cozy-bedroom",
    label: "Cozy Bedroom",
    emoji: "🛏️",
    description: "Soft, warm bedroom upgrades",
  },
  {
    id: "storage",
    label: "Storage",
    emoji: "🧺",
    description: "Small-space organization wins",
  },
  {
    id: "mirrors",
    label: "Mirrors",
    emoji: "🪞",
    description: "Light, depth, and style",
  },
  {
    id: "plants",
    label: "Plants",
    emoji: "🪴",
    description: "Greenery and fresh accents",
  },
  {
    id: "shelf-styling",
    label: "Shelf Styling",
    emoji: "🪄",
    description: "Shelves, ledges, and display pieces",
  },
  {
    id: "small-space-fixes",
    label: "Small Space Fixes",
    emoji: "✨",
    description: "Affordable upgrades for tighter rooms",
  },
  {
    id: "under-50",
    label: "Under $50",
    emoji: "💸",
    description: "Cheap, swipeable finds",
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

export const FEATURE_CARDS = [
  {
    title: "RoomScan",
    emoji: "📸",
    description: "Scan your room and get affordable picks that actually fit your space.",
  },
  {
    title: "Inspo Match",
    emoji: "🎯",
    description: "Upload a room pic or screenshot and match that vibe with real products.",
  },
  {
    title: "Style DNA",
    emoji: "🧠",
    description: "Your swipes teach Seligo what your room style actually is.",
  },
  {
    title: "Complete the Corner",
    emoji: "🪄",
    description: "Get matching picks that upgrade one part of your room at a time.",
  },
] as const;

export const HOW_IT_WORKS_STEPS = [
  "Pick the kinds of room upgrades you want most.",
  "Swipe cheap, aesthetic products you can instantly say yes or no to.",
  "Use RoomScan or Inspo Match to get more personalized picks.",
  "Save your favorites and build your vibe over time.",
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