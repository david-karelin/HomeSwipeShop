const interestLabels: Record<string, string> = {
  "desk-setup": "Desk setup",
  lighting: "Lighting",
  "wall-decor": "Wall decor",
  "cozy-bedroom": "Cozy bedroom",
  storage: "Storage",
  mirrors: "Mirrors",
  plants: "Plants",
  "shelf-styling": "Shelf styling",
  "small-space-fixes": "Small-space fixes",
  "under-50": "Under $50",
};

const interestDescriptions: Record<string, string> = {
  "desk-setup": "Clean, aesthetic desk upgrades",
  lighting: "Lamps, glow, and cozy light",
  "wall-decor": "Art, prints, and blank-wall fixes",
  "cozy-bedroom": "Soft, warm bedroom upgrades",
  storage: "Small-space organization wins",
  mirrors: "Light, depth, and style",
  plants: "Greenery and fresh accents",
  "shelf-styling": "Shelves, ledges, and display pieces",
  "small-space-fixes": "Affordable upgrades for tighter rooms",
  "under-50": "Cheap, swipeable finds",
};

export const onboardingCopy = {
  heroTitle: "Swipe affordable room upgrades",
  heroSubtitle:
    "Discover renter-friendly decor, lighting, mirrors, and small-space finds that match your vibe and budget.",
  heroCta: "Start swiping",
  modalCloseLabel: "Close",
  interestsEyebrow: "Affordable room upgrades",
  interestsTitle: "What are you upgrading?",
  interestsSubtitle:
    "Pick a few styles so Seligo can build your first feed.",
  interestsCta: "Build my feed",
  interestsLoadingCta: "Building your feed...",
  interestsHowItWorksCta: "How it works",
  interestsRoomScanCta: "Scan my room instead",
  interestLabels,
  interestDescriptions,
  browsingHint: "Swipe right to save room upgrades you like.",
  featureCards: [
    {
      title: "RoomScan",
      emoji: "📸",
      description:
        "Scan your room and get affordable picks that actually fit your space.",
    },
    {
      title: "Inspo Match",
      emoji: "🎯",
      description:
        "Upload a room pic or screenshot and match that vibe with real products.",
    },
    {
      title: "Style DNA",
      emoji: "🧠",
      description: "Your swipes teach Seligo what your room style actually is.",
    },
    {
      title: "Complete the Corner",
      emoji: "🪄",
      description:
        "Get matching picks that upgrade one part of your room at a time.",
    },
  ],
  howItWorksTitle: "How it works",
  howItWorksSteps: [
    "Pick the kinds of room upgrades you want most.",
    "Swipe cheap, aesthetic products you can instantly say yes or no to.",
    "Use RoomScan or Inspo Match to get more personalized picks.",
    "Save your favorites and build your vibe over time.",
  ],
} as const;
