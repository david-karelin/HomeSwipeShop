export type SeoPresetKey =
  | "bedroom_under_50"
  | "dorm_ideas"
  | "small_apartment";

export type SeoPreset = {
  key: SeoPresetKey;
  source: string;
  label: string;
  maxPrice?: number;
  categories: string[];
  tags: string[];
};

export const SEO_PRESETS: Record<SeoPresetKey, SeoPreset> = {
  bedroom_under_50: {
    key: "bedroom_under_50",
    source: "seo_bedroom",
    label: "Bedroom picks under $50",
    maxPrice: 50,
    categories: ["lighting", "wall-decor", "mirrors", "storage", "cozy-bedroom"],
    tags: ["bedroom", "cozy", "affordable", "small-space"],
  },
  dorm_ideas: {
    key: "dorm_ideas",
    source: "seo_dorm",
    label: "Dorm-friendly decor",
    maxPrice: 50,
    categories: ["lighting", "wall-decor", "storage", "desk-setup", "mirrors"],
    tags: ["dorm", "student", "renter-friendly", "small-space"],
  },
  small_apartment: {
    key: "small_apartment",
    source: "seo_apartment",
    label: "Small apartment decor",
    maxPrice: 80,
    categories: ["storage", "mirrors", "lighting", "wall-decor", "plants"],
    tags: ["apartment", "small-space", "renter-friendly", "compact"],
  },
};

export function getSeoPresetFromUrl(): SeoPreset | null {
  const params = new URLSearchParams(window.location.search);
  const preset = params.get("preset") as SeoPresetKey | null;
  if (!preset) return null;
  return SEO_PRESETS[preset] ?? null;
}
