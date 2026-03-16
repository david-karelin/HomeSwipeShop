import { SWIPE_FEED_RULES } from "../constants";

const SMALL_CURATED_POOL_THRESHOLD = 18;

type FeedProduct = {
  id?: string;
  name: string;
  displayName?: string | null;
  title?: string | null;
  price?: number | string | null;
  matchScore?: number | string | null;
  imageUrl?: string | null;
  tags?: string[];
  roomTags?: string[];
  styleTags?: string[];
  category?: string | null;
  room?: string | null;
  description?: string | null;
  primaryType?: string | null;
  isCurated?: boolean | null;
  swipeEligible?: boolean | null;
  imageApproved?: boolean | null;
  isLaunch?: boolean | null;
  active?: boolean | null;
};

function normalizeText(...parts: unknown[]) {
  return parts
    .flatMap((part) => (Array.isArray(part) ? part : [part]))
    .filter(Boolean)
    .map((value) => String(value).toLowerCase())
    .join(" ")
    .replace(/[^a-z0-9\s-]+/g, " ")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getPriceNum(price: FeedProduct["price"]) {
  const n = Number(price);
  return Number.isFinite(n) ? n : 999999;
}

function textBlob(product: FeedProduct) {
  return normalizeText(
    product.displayName,
    product.name,
    product.title,
    product.category,
    product.room,
    product.description,
    product.roomTags ?? [],
    product.styleTags ?? [],
    product.tags ?? []
  );
}

export function getPrimaryType(product: FeedProduct) {
  const text = normalizeText(
    product.category,
    product.displayName,
    product.name,
    product.title,
    product.description,
    product.tags ?? [],
    product.roomTags ?? [],
    product.styleTags ?? []
  );

  if (/\bmirror\b/.test(text)) return "mirror";
  if (/\blamp\b|\bsconce\b|\blight\b|\bcandle warmer\b/.test(text)) return "lamp";
  if (/\bpillow\b|\bcushion\b/.test(text)) return "pillow";
  if (/\bplant\b|\bsucculent\b|\bpropagation\b/.test(text)) return "plant";
  if (/\borganizer\b|\bbasket\b|\bbin\b|\bbox\b|\bhook\b|\btray\b/.test(text)) return "organizer";
  if (/\bshelf\b|\bledge\b|\bbookend\b/.test(text)) return "shelf";
  if (/\bposter\b|\bcanvas\b|\bwall art\b|\bprint\b/.test(text)) return "poster";

  return "decor";
}

function isCuratedFeedProduct(product: FeedProduct) {
  return Boolean(product.isCurated || product.isLaunch);
}

function hasApprovedFeedImage(product: FeedProduct) {
  if (product.imageApproved === true) return true;

  const imageUrl = String(product.imageUrl ?? "").trim().toLowerCase();
  if (!imageUrl.startsWith("http")) return false;

  return !SWIPE_FEED_RULES.placeholderImageHosts.some((host) => imageUrl.includes(host));
}

function canUsePremiumPriceBand(product: FeedProduct) {
  const primaryType = getPrimaryType(product);
  return SWIPE_FEED_RULES.premiumOverrideTypes.some((allowedType) => primaryType === normalizeText(allowedType));
}

export function isSwipeableUpgrade(product: FeedProduct) {
  if (product.swipeEligible === false) return false;
  const price = getPriceNum(product.price);
  const blob = textBlob(product);
  const curatedApproved = isCuratedFeedProduct(product) && product.imageApproved === true;

  if (product.active === false) return false;
  if (!hasApprovedFeedImage(product)) return false;

  if (price > SWIPE_FEED_RULES.hardMaxPrice) return false;
  if (price > SWIPE_FEED_RULES.standardMaxPrice && !canUsePremiumPriceBand(product)) return false;

   if (curatedApproved) return true;

  const hasBannedKeyword = SWIPE_FEED_RULES.bannedKeywords.some((keyword) =>
    blob.includes(normalizeText(keyword))
  );

  if (hasBannedKeyword) return false;

  return true;
}

export function getSwipeScore(
  product: FeedProduct,
  selectedInterests: string[] = [],
  blockedTags: string[] = []
) {
  const price = getPriceNum(product.price);
  const blob = textBlob(product);
  const category = normalizeText(product.category);
  const room = normalizeText(product.room);

  let score = 0;

  if (price <= 25) score += 35;
  else if (price <= SWIPE_FEED_RULES.idealMaxPrice) score += 25;
  else if (price <= SWIPE_FEED_RULES.standardMaxPrice) score += 12;
  else if (price <= SWIPE_FEED_RULES.hardMaxPrice && canUsePremiumPriceBand(product)) score += 4;
  else score -= 100;

  if (isCuratedFeedProduct(product)) score += 30;
  if (product.imageApproved) score += 12;

  for (const keyword of SWIPE_FEED_RULES.preferredKeywords) {
    if (blob.includes(normalizeText(keyword))) score += 8;
  }

  for (const preferredCategory of SWIPE_FEED_RULES.preferredCategories) {
    const preferred = normalizeText(preferredCategory);
    if (category.includes(preferred)) score += 18;
    else if (blob.includes(preferred)) score += 8;
  }

  for (const interest of selectedInterests) {
    const normalizedInterest = normalizeText(interest);
    if (!normalizedInterest) continue;
    if (category.includes(normalizedInterest)) score += 18;
    if (room.includes(normalizedInterest)) score += 10;
    if (blob.includes(normalizedInterest)) score += 8;
  }

  for (const tag of blockedTags) {
    if (blob.includes(normalizeText(tag))) score -= 40;
  }

  if (blob.includes("under $50") || blob.includes("under 50")) score += 10;
  if (blob.includes("renter")) score += 8;
  if (blob.includes("small space")) score += 10;
  if (blob.includes("desk")) score += 8;
  if (blob.includes("bedroom")) score += 8;
  if (blob.includes("wall")) score += 8;
  if (blob.includes("cozy")) score += 8;

  return score;
}

export function prepareSwipeFeed<T extends FeedProduct>(
  products: T[],
  selectedInterests: string[] = [],
  blockedTags: string[] = []
) {
  return products
    .filter(isSwipeableUpgrade)
    .map((product) => ({
      product,
      swipeScore: getSwipeScore(product, selectedInterests, blockedTags),
    }))
    .sort((a, b) => b.swipeScore - a.swipeScore)
    .map(({ product }) => product);
}

export function getSubtypeKey(product: FeedProduct) {
  const primaryType = getPrimaryType(product);
  const text = normalizeText(
    product.displayName,
    product.name,
    product.title,
    product.description,
    product.tags ?? [],
    product.roomTags ?? [],
    product.styleTags ?? []
  );

  switch (primaryType) {
    case "organizer":
      if (/\bdesk\b/.test(text)) return "desk-organizer";
      if (/\bdrawer\b/.test(text)) return "drawer-organizer";
      if (/\bbathroom\b|\bvanity\b/.test(text)) return "bathroom-organizer";
      if (/\bbasket\b/.test(text)) return "basket";
      if (/\bbin\b/.test(text)) return "bin";
      if (/\bbox\b/.test(text)) return "box";
      if (/\bhook\b/.test(text)) return "hook";
      if (/\btray\b/.test(text)) return "tray";
      return "organizer";

    case "shelf":
      if (/\bfloating\b/.test(text)) return "floating-shelf";
      if (/\bacrylic\b/.test(text)) return "acrylic-shelf";
      if (/\bledge\b/.test(text)) return "ledge";
      if (/\bbookend\b/.test(text)) return "bookend";
      return "shelf";

    case "plant":
      if (/\bhanging\b/.test(text)) return "hanging-plant";
      if (/\bsucculent\b/.test(text)) return "succulent";
      if (/\bpropagation\b/.test(text)) return "propagation-station";
      return "plant";

    case "pillow":
      if (/\bcorduroy\b/.test(text)) return "corduroy-pillow";
      if (/\bvelvet\b/.test(text)) return "velvet-pillow";
      if (/\bthrow\b/.test(text)) return "throw-pillow";
      return "pillow";

    case "lamp":
      if (/\bcandle warmer\b/.test(text)) return "candle-warmer";
      if (/\btable\b/.test(text)) return "table-lamp";
      if (/\bwall\b|\bsconce\b/.test(text)) return "wall-light";
      return "lamp";

    case "poster":
      if (/\bcanvas\b/.test(text)) return "canvas";
      if (/\bwall art\b/.test(text)) return "wall-art";
      if (/\bprint\b/.test(text)) return "print";
      return "poster";

    default:
      return primaryType;
  }
}

function getCategoryKey(product: FeedProduct) {
  return normalizeText(product.category);
}

function getNameStem(name: string) {
  return normalizeText(name)
    .replace(/\b(minimal|minimalist|modern|classic|cozy|soft|warm|sleek|elegant|simple|small|large)\b/g, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function diversifySwipeFeed<T extends FeedProduct>(
  products: T[],
  opts?: {
    leadWindow?: number;
    maxPerSubtype?: number;
    maxPerNameStem?: number;
    maxPerCategorySubtype?: number;
  }
) {
  const leadWindow = opts?.leadWindow ?? 12;
  const maxPerSubtype = opts?.maxPerSubtype ?? 2;
  const maxPerNameStem = opts?.maxPerNameStem ?? 1;
  const maxPerCategorySubtype = opts?.maxPerCategorySubtype ?? 2;

  const lead: T[] = [];
  const deferred: T[] = [];

  const subtypeCounts = new Map<string, number>();
  const stemCounts = new Map<string, number>();
  const categorySubtypeCounts = new Map<string, number>();

  for (const product of products) {
    if (lead.length >= leadWindow) {
      deferred.push(product);
      continue;
    }

    const subtype = getSubtypeKey(product);
    const stem = getNameStem(product.name || "");
    const categorySubtype = `${getCategoryKey(product)}:${subtype}`;

    const subtypeCount = subtypeCounts.get(subtype) ?? 0;
    const stemCount = stemCounts.get(stem) ?? 0;
    const categorySubtypeCount = categorySubtypeCounts.get(categorySubtype) ?? 0;

    const tooManyOfSubtype = subtypeCount >= maxPerSubtype;
    const duplicateNameStem = stem.length > 0 && stemCount >= maxPerNameStem;
    const tooManyOfCategorySubtype = categorySubtypeCount >= maxPerCategorySubtype;

    if (tooManyOfSubtype || duplicateNameStem || tooManyOfCategorySubtype) {
      deferred.push(product);
      continue;
    }

    lead.push(product);
    subtypeCounts.set(subtype, subtypeCount + 1);
    categorySubtypeCounts.set(categorySubtype, categorySubtypeCount + 1);
    if (stem.length > 0) {
      stemCounts.set(stem, stemCount + 1);
    }
  }

  return [...lead, ...deferred];
}

export function prioritizeMainFeedInventory<T extends FeedProduct>(
  products: T[],
  opts?: {
    leadWindow?: number;
    maxPerSubtype?: number;
    maxPerNameStem?: number;
    maxPerCategorySubtype?: number;
  }
) {
  const curatedApproved = products.filter(
    (product) => isCuratedFeedProduct(product) && product.imageApproved === true
  );

  console.log("curatedApproved.length", curatedApproved.length);

  if (curatedApproved.length === 0) {
    return diversifySwipeFeed(products, opts);
  }

  if (curatedApproved.length < SMALL_CURATED_POOL_THRESHOLD) {
    console.log("small curated pool detected - skipping diversity");
    return products;
  }

  const fallback = products.filter(
    (product) => !(isCuratedFeedProduct(product) && product.imageApproved === true)
  );

  return [
    ...diversifySwipeFeed(curatedApproved, opts),
    ...diversifySwipeFeed(fallback, opts),
  ];
}

export function getDisplayVibeTag(product: FeedProduct) {
  const blob = textBlob(product);
  const price = getPriceNum(product.price);

  if (blob.includes("wall") || blob.includes("art") || blob.includes("poster")) return "blank wall fix";
  if (blob.includes("basket") || blob.includes("storage")) return "small-space win";
  if (blob.includes("desk")) return "cozy desk upgrade";
  if (blob.includes("mirror")) return "looks expensive";
  if (blob.includes("lamp") || blob.includes("light")) return "cozy lighting";
  if (blob.includes("nightstand")) return "nightstand glow-up";
  if (blob.includes("shelf")) return "shelf refresh";
  if (price <= 30) return "under $30";
  if (price <= 50) return "under $50";
  return "easy room upgrade";
}

export function beautifyProductName(product: Pick<FeedProduct, "name" | "category" | "tags">) {
  const raw = String(product.name || "").trim();
  const cleaned = raw
    .replace(/placeholder/gi, "")
    .replace(/item for testing/gi, "")
    .replace(/test item/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  const blob = normalizeText(`${product.category || ""} ${(product.tags || []).join(" ")}`);
  const hasGenericPattern = /^(modern|classic|cozy|minimal|soft|bold|neutral|simple|decorative)\s+(shelf|mirror|lamp|basket|tray|organizer|plant|print|poster|vase)( unit| stand| decor)?$/i.test(cleaned);

  if (!cleaned || hasGenericPattern) {
    if (blob.includes("basket")) return "Woven Storage Basket";
    if (blob.includes("shelf")) return "Oak Wall Shelf";
    if (blob.includes("mirror")) return "Rounded Accent Mirror";
    if (blob.includes("lamp") || blob.includes("lighting")) return "Warm Glow Table Lamp";
    if (blob.includes("wall") || blob.includes("art") || blob.includes("print")) return "Minimal Canvas Print";
    if (blob.includes("tray")) return "Matte Catch Tray";
    if (blob.includes("organizer") || blob.includes("storage")) return "Clean Desk Organizer";

    return "Easy Room Upgrade";
  }

  return cleaned;
}

export function displayMatchPercent(product: Pick<FeedProduct, "matchScore">) {
  const raw = Number(product.matchScore ?? 85);
  return Math.max(72, Math.min(96, Math.round(raw)));
}

export function getShortProductName(name: string) {
  const cleaned = String(name || "")
    .replace(/placeholder/gi, "")
    .replace(/item for testing/gi, "")
    .replace(/\b(set of \d+)\b/gi, "")
    .replace(/\b(pack of \d+)\b/gi, "")
    .replace(/\bfor bedroom\b/gi, "")
    .replace(/\bfor living room\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) return "Easy Room Upgrade";
  if (cleaned.length <= 42) return cleaned;
  return `${cleaned.slice(0, 39).trimEnd()}...`;
}