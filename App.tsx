import * as Firestore from "./firestoreService";
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Product, UserPreferences, AppState, UserPersona } from './types';
import * as Backend from './backendService';
import SwipeCard from './components/SwipeCard';
import CheckoutLinksModal from './components/CheckoutLinksModal';
import AdminScreen from './src/components/AdminScreen';
import HowItWorksModal from './src/components/HowItWorksModal';
import RoomScanPage from './src/pages/RoomScanPage';
import type { RoomScanAnalysis } from './src/services/localRoomScan';
import seligoLogo from './src/assets/seligo-logo-primary-0EA5E9.png';
import { 
  Search, 
  ShoppingBag, 
  Heart, 
  Compass, 
  User, 
  Trash2, 
  ArrowRight, 
  Loader2, 
  Plus, 
  ArrowLeft, 
  X, 
  Sparkles, 
  BrainCircuit, 
  History, 
  Tag, 
  Bookmark, 
  ShoppingCart,
  RotateCcw,
  Zap,
  Activity,
  Scan
} from 'lucide-react';

const MOCK_INTERESTS = [
 { id: "rugs",          label: "Rugs",          icon: "🧶" },
  { id: "lighting",      label: "Lighting",      icon: "💡" },
  { id: "wall_art",      label: "Wall Art",      icon: "🖼️" },
  { id: "seating",       label: "Seating",       icon: "🪑" },
  { id: "tables",        label: "Tables",        icon: "🛋️" },
  { id: "bedding",       label: "Bedding",       icon: "🛏️" },
  { id: "storage",       label: "Storage",       icon: "🧺" },
  { id: "mirrors",       label: "Mirrors",       icon: "🪞" },
  { id: "plants",        label: "Plants",        icon: "🪴" },
  { id: "kitchen_decor", label: "Kitchen Decor", icon: "🍽️" },
];

const INITIAL_PERSONA: UserPersona = {
  styleKeywords: [],
  priceSensitivity: 'mid-range',
  dominantCategories: [],
  dislikedFeatures: [],
  detectedVibe: 'New Explorer'
};

const DEFAULT_PREFS: UserPreferences = {
  interests: [],
  likedProducts: [],
  dislikedProducts: [],
  wishlist: [],
  cart: [],
  lastAction: null,
  persona: INITIAL_PERSONA,
  currentFeed: [],
  feedIndex: 0
};

type TagScores = Record<string, number>;

type UndoEntry = {
  product: Product;
  direction: "left" | "right";
  action: "wishlist" | "cart" | null;
};

type LocalActivityKind = "match" | "pass" | "save" | "bag";
type LocalActivity = { ts: number; kind: LocalActivityKind };

type RoomScanPick = {
  product: Product;
  rationale: string[];
  score: number;
};

const ACTIVITY_KEY = "seligo_activity_v1";

const dayKey = (ts: number) => {
  const d = new Date(ts);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
};

const loadActivity = (): LocalActivity[] => {
  try {
    const raw = localStorage.getItem(ACTIVITY_KEY);
    const arr = raw ? (JSON.parse(raw) as LocalActivity[]) : [];
    return Array.isArray(arr) ? arr.filter(Boolean) : [];
  } catch {
    return [];
  }
};

const saveActivity = (items: LocalActivity[]) => {
  localStorage.setItem(ACTIVITY_KEY, JSON.stringify(items.slice(-500)));
};

const computeStreak = (items: LocalActivity[]) => {
  const days = new Set(items.map((e) => dayKey(e.ts)));
  const today = dayKey(Date.now());

  let streak = 0;
  for (let i = 0; i < 3650; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const k = dayKey(d.getTime());
    if (days.has(k)) streak++;
    else break;
  }

  const todayItems = items.filter((e) => dayKey(e.ts) === today);
  const matchesToday = todayItems.filter((e) => e.kind === "match").length;
  const passesToday = todayItems.filter((e) => e.kind === "pass").length;
  const savesToday = todayItems.filter((e) => e.kind === "save" || e.kind === "bag").length;

  return { streak, matchesToday, passesToday, savesToday };
};

const BLOCKED_TAGS_KEY = "seligo_blocked_tags_v1";

const loadBlockedTags = (): string[] => {
  try {
    const raw = localStorage.getItem(BLOCKED_TAGS_KEY);
    const arr = raw ? (JSON.parse(raw) as string[]) : [];
    return Array.isArray(arr) ? arr.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
};

const saveBlockedTags = (tags: string[]) => {
  localStorage.setItem(BLOCKED_TAGS_KEY, JSON.stringify(tags));
};

const loadTagScores = (): TagScores => {
  try { return JSON.parse(localStorage.getItem("tagScores") || "{}"); }
  catch { return {}; }
};

const saveTagScores = (scores: TagScores) => {
  localStorage.setItem("tagScores", JSON.stringify(scores));
};

const topTags = (scores: TagScores, sign: 1 | -1, n = 5) => {
  return Object.entries(scores)
    .filter(([, v]) => sign === 1 ? Number(v) > 0 : Number(v) < 0)
    .sort((a, b) => sign === 1 ? Number(b[1]) - Number(a[1]) : Number(a[1]) - Number(b[1]))
    .slice(0, n)
    .map(([k]) => k);
};

const VIBE_TAGS = new Set([
  "cozy", "neutral", "modern", "minimal", "bold", "warm", "cool"
]);

const ROOM_TAGS = new Set([
  "entryway", "living_room", "bedroom", "kitchen"
]);

const INTEREST_IDS = new Set([
  "rugs", "lighting", "wall_art", "seating", "tables", "bedding", "storage", "mirrors", "plants", "kitchen_decor"
]);

const isVibeTag = (t: string) => VIBE_TAGS.has(t);
const isRoomTag = (t: string) => ROOM_TAGS.has(t);

function NavItem({
  active,
  label,
  icon,
  onClick,
}: {
  active: boolean;
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center justify-center gap-1 select-none"
      style={{ width: 70 }}
      aria-current={active ? "page" : undefined}
    >
      <div
        className={`transition-colors ${active ? "text-[var(--seligo-primary)]" : "text-slate-300"}`}
      >
        {icon}
      </div>

      <span
        className={`text-[10px] font-extrabold uppercase tracking-[0.18em] transition-colors ${
          active ? "text-[var(--seligo-primary)]" : "text-slate-300"
        }`}
      >
        {label}
      </span>

      <div
        className={`mt-1 h-[3px] w-8 rounded-full transition-all ${
          active ? "bg-[var(--seligo-primary)] opacity-100" : "bg-transparent opacity-0"
        }`}
      />
    </button>
  );
}

function Screen({
  children,
  className = "",
  animate = true,
}: {
  children: React.ReactNode;
  className?: string;
  animate?: boolean;
}) {
  return (
    <div
      className={[
        "min-h-full w-full",
        "px-6 pt-6 pb-6",
        animate ? "animate-in slide-in-from-right duration-300" : "",
        className,
      ].join(" ")}
    >
      {children}
    </div>
  );
}

function PageHeader({
  title,
  subtitle,
  onClose,
}: {
  title: string;
  subtitle?: string;
  onClose?: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 mb-6">
      <div className="min-w-0">
        <div className="text-2xl font-extrabold text-slate-900 leading-tight">{title}</div>
        {subtitle && <div className="text-sm text-slate-500 mt-1">{subtitle}</div>}
      </div>

      {onClose && (
        <button
          onClick={onClose}
          className="h-10 w-10 rounded-2xl bg-slate-100 flex items-center justify-center hover:bg-slate-200 transition-colors shrink-0"
          aria-label="Close"
        >
          <X className="h-5 w-5 text-slate-600" />
        </button>
      )}
    </div>
  );
}

function SectionCard({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-3xl border border-slate-100 bg-slate-50 p-5 ${className}`}>
      {children}
    </div>
  );
}

const PrivacyScreen = ({ onBack }: { onBack: () => void }) => (
  <div className="p-6 bg-white min-h-full">
    <div className="flex items-start justify-between mb-6">
      <div>
        <div className="text-2xl font-extrabold text-slate-900">Privacy</div>
        <div className="text-sm text-slate-500 mt-1">How Seligo handles data</div>
      </div>
      <button onClick={onBack} className="h-10 w-10 rounded-2xl bg-slate-100 flex items-center justify-center">
        <X className="h-5 w-5 text-slate-600" />
      </button>
    </div>

    <div className="text-sm text-slate-600 space-y-4 leading-relaxed">
      <p>Seligo.AI uses anonymous authentication to personalize your feed.</p>
      <p>We store your swipes, saved items, and usage events to improve recommendations.</p>
      <p>If you submit your email for updates, it’s stored for that purpose only.</p>
      <p>We do not sell personal data.</p>
    </div>
  </div>
);

const TermsScreen = ({ onBack }: { onBack: () => void }) => (
  <div className="p-6 bg-white min-h-full">
    <div className="flex items-start justify-between mb-6">
      <div>
        <div className="text-2xl font-extrabold text-slate-900">Terms</div>
        <div className="text-sm text-slate-500 mt-1">Using Seligo</div>
      </div>
      <button onClick={onBack} className="h-10 w-10 rounded-2xl bg-slate-100 flex items-center justify-center">
        <X className="h-5 w-5 text-slate-600" />
      </button>
    </div>

    <div className="text-sm text-slate-600 space-y-4 leading-relaxed">
      <p>Seligo.AI provides product discovery and links to third-party retailers.</p>
      <p>Product availability, pricing, and policies are controlled by the retailer.</p>
      <p>Use at your own discretion. Seligo.AI is provided “as is”.</p>
    </div>
  </div>
);

const DisclosureScreen = ({ onBack }: { onBack: () => void }) => (
  <div className="p-6 bg-white min-h-full">
    <div className="flex items-start justify-between mb-6">
      <div>
        <div className="text-2xl font-extrabold text-slate-900">Affiliate Disclosure</div>
        <div className="text-sm text-slate-500 mt-1">How Seligo may earn revenue</div>
      </div>
      <button onClick={onBack} className="h-10 w-10 rounded-2xl bg-slate-100 flex items-center justify-center">
        <X className="h-5 w-5 text-slate-600" />
      </button>
    </div>

    <div className="text-sm text-slate-600 space-y-4 leading-relaxed">
      <p>Seligo.AI may earn a commission if you purchase through links in the app.</p>
      <p>These links do not change the price you pay.</p>
    </div>
  </div>
);

const App: React.FC = () => {
  const [view, setView] = useState<AppState>('auth');
  const [userPrefs, setUserPrefs] = useState<UserPreferences>(DEFAULT_PREFS);
  const [products, setProducts] = useState<Product[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isAlgorithmRunning, setIsAlgorithmRunning] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [discoveryStep, setDiscoveryStep] = useState(0);
  const [cursor, setCursor] = useState<any>(null);
  const [hasMore, setHasMore] = useState(true);
  const [showCheckout, setShowCheckout] = useState(false);
  const [leadEmail, setLeadEmail] = useState("");
  const [leadStatus, setLeadStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [leadError, setLeadError] = useState<string>("");
  const [howOpen, setHowOpen] = useState(false);
  const [tagScores, setTagScores] = useState<TagScores>(() => loadTagScores());
  const [activityLog, setActivityLog] = useState<LocalActivity[]>(() => loadActivity());
  const [blockedTags, setBlockedTags] = useState<string[]>(() => loadBlockedTags());
  const [roomScanPicks, setRoomScanPicks] = useState<RoomScanPick[]>([]);
  const [roomScanPickStatus, setRoomScanPickStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [undoCount, setUndoCount] = useState(0);
  const swipedRef = useRef<Set<string>>(new Set());
  const impressedRef = useRef<Set<string>>(new Set());
  const undoRef = useRef<UndoEntry[]>([]);
  const refineLockRef = useRef(false);
  const prevViewRef = useRef(view);
  const blockedSet = useMemo(() => new Set(blockedTags), [blockedTags]);

  const resetImpressions = () => {
    impressedRef.current = new Set();
  };

  const sanitizeUtm = (obj: any) => {
    const allowed = new Set(["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"]);
    const out: any = {};
    for (const k of Object.keys(obj || {})) {
      if (allowed.has(k)) out[k] = obj[k];
    }
    return out;
  };

  const goView = (next: AppState, source = "nav") => {
    setView(next);
    void Firestore.logEvent({ type: "view_change", source, view: next }).catch(console.warn);
  };

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("admin") === "1") {
      goView("admin", "query_param");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const prev = prevViewRef.current;

    if (prev === "roomscan" && view !== "roomscan") {
      setRoomScanPicks([]);
      setRoomScanPickStatus("idle");
    }

    prevViewRef.current = view;
  }, [view]);

  useEffect(() => {
    try {
      const raw = JSON.parse(localStorage.getItem("seligo_utm") || "{}");
      localStorage.setItem("seligo_utm", JSON.stringify(sanitizeUtm(raw)));
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    void Firestore.logEvent({ type: "session_start", source: "app", view });
  }, []);

  useEffect(() => {
    if (!selectedProduct) return;
    const prevOverflow = document.body.style.overflow;
    const prevTouchAction = document.body.style.touchAction;

    document.body.style.overflow = "hidden";
    document.body.style.touchAction = "none";

    return () => {
      document.body.style.overflow = prevOverflow;
      document.body.style.touchAction = prevTouchAction;
    };
  }, [selectedProduct]);

  const logLocalActivity = (kind: LocalActivityKind) => {
    setActivityLog((prev) => {
      const next = [...prev, { ts: Date.now(), kind }];
      saveActivity(next);
      return next;
    });
  };

  const toggleBlockedTag = (tag: string) => {
    const t = String(tag || "").trim();
    if (!t) return;

    setBlockedTags((prev) => {
      const set = new Set(prev);
      if (set.has(t)) set.delete(t);
      else set.add(t);
      const next = Array.from(set).filter((x): x is string => typeof x === "string");
      saveBlockedTags(next);
      return next;
    });
  };

  const clearBlockedTags = () => {
    setBlockedTags([]);
    saveBlockedTags([]);
  };

  const isBlockedProduct = (p: Product) => {
    const tags = p.tags || [];
    for (const t of tags) if (blockedSet.has(t)) return true;
    return false;
  };

  const { streak, matchesToday, passesToday, savesToday } = computeStreak(activityLog);

  function pushUndo(entry: UndoEntry) {
    undoRef.current.push(entry);
    setUndoCount(undoRef.current.length);
  }

  function removeLastById(list: Product[], id: string) {
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i].id === id) return [...list.slice(0, i), ...list.slice(i + 1)];
    }
    return list;
  }

  const undoLast = () => {
    const last = undoRef.current.pop();
    setUndoCount(undoRef.current.length);
    if (!last) return;

    setCurrentIndex((i) => Math.max(i - 1, 0));

    swipedRef.current.delete(last.product.id);

    bumpTags(last.product, last.direction === "left" ? +1 : -2);

    setUserPrefs((prev) => {
      const next = { ...prev };

      if (last.direction === "left") {
        next.dislikedProducts = removeLastById(prev.dislikedProducts, last.product.id);
      } else {
        next.likedProducts = removeLastById(prev.likedProducts, last.product.id);
        if (last.action === "wishlist") next.wishlist = removeLastById(prev.wishlist, last.product.id);
        if (last.action === "cart") next.cart = removeLastById(prev.cart, last.product.id);
        next.lastAction = null;
      }

      return next;
    });

    void Firestore.deleteMySwipe(last.product.id).catch(console.error);

    setSelectedProduct(null);
  };

  const bumpTags = (product: Product, delta: number) => {
    setTagScores(prev => {
      const next = { ...prev };
      for (const t of product.tags || []) next[t] = (next[t] || 0) + delta;
      saveTagScores(next);
      return next;
    });
  };

  const scoreProduct = (p: Product) => {
    let s = 0;
    for (const t of p.tags || []) s += (tagScores[t] || 0);
    return s;
  };

  const matchPercent = (p: Product) => {
    const s = scoreProduct(p);

    let pct = 75 + s * 3;

    pct = Math.max(60, Math.min(99, pct));

    return Math.round(pct);
  };

  // Persistent Hydration
  useEffect(() => {
    const saved = Backend.loadUserData();
    if (saved) {
      setUserPrefs(saved);
      setProducts(saved.currentFeed || []);
      setCurrentIndex(saved.feedIndex || 0);
      
      if (saved.currentFeed && saved.currentFeed.length > 0) {
        setView('browsing');
      } else if (saved.interests.length > 0) {
        setView('interests');
      }
    }
  }, []);

  useEffect(() => {
    setSelectedProduct(null);
  }, [view]);

  // Persistence Sync
  useEffect(() => {
    Backend.saveUserData({
      ...userPrefs,
      currentFeed: products,
      feedIndex: currentIndex
    });
  }, [userPrefs, products, currentIndex]);

  useEffect(() => {
    const topVibes = Object.entries(tagScores)
      .filter(([k, v]) => Number(v) > 0 && isVibeTag(k))
      .sort((a, b) => Number(b[1]) - Number(a[1]))
      .slice(0, 3)
      .map(([k]) => k);

    const has = (t: string) => topVibes.includes(t);

    const vibe =
      has("minimal") ? "Minimalist" :
      has("cozy") ? "Cozy Homebody" :
      has("modern") ? "Modern Curator" :
      has("neutral") ? "Neutral Aesthetic" :
      has("bold") ? "Bold Curator" :
      has("warm") ? "Warm & Inviting" :
      has("cool") ? "Cool & Clean" :
      (Object.values(tagScores).some(v => Number(v) > 0) ? "Style Developing" : "New Explorer");

    const styleKeywords = Object.entries(tagScores)
      .filter(([k, v]) => Number(v) > 0 && isVibeTag(k))
      .sort((a, b) => Number(b[1]) - Number(a[1]))
      .slice(0, 6)
      .map(([k]) => k);

    const dislikedFeatures = Object.entries(tagScores)
      .filter(([k, v]) => Number(v) < 0 && isVibeTag(k))
      .sort((a, b) => Number(a[1]) - Number(b[1]))
      .slice(0, 6)
      .map(([k]) => k);

    setUserPrefs(prev => ({
      ...prev,
      persona: {
        ...prev.persona,
        detectedVibe: vibe,
        styleKeywords,
        dislikedFeatures,
      },
    }));
  }, [tagScores]);

  const handleLogin = () => setView('interests');

  const handleResetData = async () => {
    if (!confirm("Are you sure? This will clear your style persona and all saved items.")) return;

    try {
      await Firestore.clearMySwipes();
      const after = await Firestore.fetchMySwipes();
      console.log("swipes after reset:", after.length);
      swipedRef.current = new Set();
    } catch (e) {
      console.error("Failed to clear swipes:", e);
    }

    localStorage.removeItem("swipeshop_userPrefs");
    localStorage.removeItem("swipeshop_tagScores");
    localStorage.removeItem("swipeshop_undo");
    localStorage.removeItem("swipeshop_data");
    localStorage.removeItem("tagScores");
    setUserPrefs(DEFAULT_PREFS);
    resetImpressions();
    setProducts([]);
    setCurrentIndex(0);
    setCursor(null);
    setHasMore(true);
    setView("interests");
  };

  const handleToggleInterest = (id: string) => {
    setUserPrefs(prev => ({
      ...prev,
      interests: prev.interests.includes(id) 
        ? prev.interests.filter(i => i !== id) 
        : [...prev.interests, id]
    }));
  };

  type StartDiscoveryOpts = { navigate?: boolean };

  const startDiscovery = async (
    overrideInterests?: string[],
    opts: StartDiscoveryOpts = {}
  ): Promise<Product[]> => {
    const interests = [...(overrideInterests ?? userPrefs.interests)];
    if (interests.length === 0) return [];

    setIsLoading(true);
    if (opts.navigate !== false) setView("discovering");
    try {
      resetImpressions();
      setProducts([]);
      setCursor(null);
      setHasMore(true);
      setCurrentIndex(0);

      const swipes = await Firestore.fetchMySwipes();
      swipedRef.current = new Set(swipes.map((s: any) => s.productId ?? s.id));

      let nextCursor: any = null;
      let more = true;
      let safety = 0;
      const out: Product[] = [];

      while (more && out.length < 80 && safety < 8) {
        const page = await Firestore.fetchProductsByInterestsPage(interests, 30, nextCursor);

        nextCursor = page.cursor;
        more = page.hasMore;

        for (const p of page.items) {
          if (!swipedRef.current.has(p.id) && !isBlockedProduct(p)) out.push(p);
          if (out.length >= 80) break;
        }

        if (!page.items?.length) break;
        safety++;
      }

      const ranked = [...out].sort((a, b) => {
        const scoreA = (a.asin ? 100000 : 0) + scoreProduct(a);
        const scoreB = (b.asin ? 100000 : 0) + scoreProduct(b);
        return scoreB - scoreA;
      });

      setProducts(ranked);
      setCursor(nextCursor);
      setHasMore(more);

      if (opts.navigate !== false) setView("browsing");
      return ranked;
    } catch (e) {
      console.error("Firestore load failed:", e);
      if (opts.navigate !== false) setView("interests");
      return [];
    } finally {
      setIsLoading(false);
    }
  };

  const handleSwipe = (direction: 'left' | 'right') => {
    const currentProduct = products[currentIndex];
    if (!currentProduct) return;
    
    if (direction === 'left') {
      setUserPrefs(prev => ({
        ...prev,
        dislikedProducts: [...prev.dislikedProducts, currentProduct]
      }));

      void Firestore.saveSwipe({ productId: currentProduct.id, direction: "left", action: null }).catch(console.error);

      void Firestore.logEvent({
        type: "swipe_pass",
        productId: currentProduct.id,
        source: "feed_swipe",
        view: "browsing",
        meta: {
          category: currentProduct.category ?? "",
          tags: Array.isArray(currentProduct.tags) ? currentProduct.tags : [],
          price: Number(currentProduct.price ?? 0),
        },
      }).catch(console.warn);

      bumpTags(currentProduct, -1);
      swipedRef.current.add(currentProduct.id);
      pushUndo({ product: currentProduct, direction: "left", action: null });
      logLocalActivity("pass");
      setCurrentIndex(i => i + 1);
      return;
    }

    void Firestore.logEvent({
      type: "product_open",
      productId: currentProduct.id,
      source: "feed_card",
      view: "browsing",
      meta: {
        category: currentProduct.category ?? "",
        tags: Array.isArray(currentProduct.tags) ? currentProduct.tags : [],
        price: Number(currentProduct.price ?? 0),
      },
    }).catch(console.warn);

    setSelectedProduct(currentProduct);
  };

  const handleAction = async (action: 'wishlist' | 'cart', source: string = "style_match_modal") => {
    const currentProduct = products[currentIndex];
    if (!currentProduct) return;

    void Firestore.saveSwipe({ productId: currentProduct.id, direction: "right", action });
    void Firestore.logEvent({
      type: action === "wishlist" ? "wishlist_add" : "cart_add",
      productId: currentProduct.id,
      source,
      view: "browsing",
      meta: {
        category: currentProduct.category ?? "",
        tags: Array.isArray(currentProduct.tags) ? currentProduct.tags : [],
        price: Number(currentProduct.price ?? 0),
      },
    }).catch(console.warn);
    bumpTags(currentProduct, +2);
    swipedRef.current.add(currentProduct.id);

    const newLiked = [...userPrefs.likedProducts, currentProduct];

    setUserPrefs(prev => ({
      ...prev,
      [action]: [...prev[action], currentProduct],
      likedProducts: newLiked,
      lastAction: action
    }));

    logLocalActivity("match");
    logLocalActivity(action === "wishlist" ? "save" : "bag");
    pushUndo({ product: currentProduct, direction: "right", action });
    setCurrentIndex(prev => prev + 1);
    setSelectedProduct(null);
    // Optionally, auto-load more if needed
  };

  const addUnique = (arr: Product[], p: Product) =>
    arr.some(x => x.id === p.id) ? arr : [...arr, p];

  const dismissRoomScanPick = (productId: string) => {
    setRoomScanPicks(prev => prev.filter(p => p.product.id !== productId));
  };

  const addToWishlistFromRoomScan = (p: Product) => {
    setUserPrefs(prev => ({
      ...prev,
      wishlist: addUnique(prev.wishlist, p),
      likedProducts: addUnique(prev.likedProducts, p),
      lastAction: "wishlist",
    }));
    bumpTags(p, +2);

    void Firestore.logEvent({ type: "pick_save", productId: p.id, source: "roomscan_pick" }).catch(console.warn);
    void Firestore.logEvent({ type: "wishlist_add", productId: p.id, source: "roomscan_pick" }).catch(console.warn);
    void Firestore.saveSwipe({ productId: p.id, direction: "right", action: "wishlist" }).catch(console.warn);

    dismissRoomScanPick(p.id);
  };

  const addToCartFromRoomScan = (p: Product) => {
    setUserPrefs(prev => ({
      ...prev,
      cart: addUnique(prev.cart, p),
      likedProducts: addUnique(prev.likedProducts, p),
      lastAction: "cart",
    }));
    bumpTags(p, +2);

    void Firestore.logEvent({ type: "cart_add", productId: p.id, source: "roomscan_pick" }).catch(console.warn);
    void Firestore.saveSwipe({ productId: p.id, direction: "right", action: "cart" }).catch(console.warn);

    dismissRoomScanPick(p.id);
  };

  const norm = (s: any) => String(s ?? "").trim().toLowerCase();

  const aliasTag = (t: string) => {
    const x = norm(t);
    if (x === "add_rug" || x === "add-rug") return "rug";
    if (x === "warm_lighting" || x === "warm-lighting") return "warm";
    if (x === "throw-pillows" || x === "throw_pillows") return "throw";
    if (x === "wall_art" || x === "wall-art") return "wall";
    return x;
  };

  const getDetectedObjects = (analysis: RoomScanAnalysis): string[] => {
    const objs = analysis?.debug?.objects;
    return Array.isArray(objs) ? objs.map(norm).filter(Boolean) : [];
  };

  const getPalette = (analysis: RoomScanAnalysis): string[] => {
    const pal = analysis?.debug?.palette;
    return Array.isArray(pal) ? pal.map(norm).filter(Boolean) : [];
  };

  const hasAny = (objs: string[], keys: string[]) => keys.some(k => objs.includes(norm(k)));

  const intersects = (a: string[], b: string[]) => {
    const sb = new Set(b.map(norm));
    return a.map(norm).filter(x => sb.has(x));
  };

  const prettyLabel = (s: string) =>
    String(s || "")
      .replace(/[_-]+/g, " ")
      .trim()
      .replace(/\b\w/g, (c) => c.toUpperCase());

  const buildRationaleForPick = (
    p: Product,
    analysis: RoomScanAnalysis,
    ctx: {
      missingRug: boolean;
      missingPlant: boolean;
      missingLamp: boolean;
      hasBed: boolean;
      recCats: string[];
      recTags: string[];
      vibeTags: string[];
    }
  ): string[] => {
    const pCat = norm(p.category);
    const pTags = Array.isArray(p.tags) ? p.tags.map(norm) : [];

    const reasons: string[] = [];

    if (ctx.missingRug && (pCat === "rugs" || pTags.includes("rug"))) {
      reasons.push("No rug detected — adding one anchors the room and makes it feel warmer.");
    }
    if (ctx.missingPlant && (pCat === "plants" || pTags.includes("plant") || pTags.includes("plants"))) {
      reasons.push("No plants detected — greenery adds life and contrast without clutter.");
    }
    if (ctx.missingLamp && (pCat === "lighting" || pTags.includes("lamp") || pTags.includes("light") || pTags.includes("lighting"))) {
      reasons.push("Lighting looks limited — a lamp boosts warmth and ambiance.");
    }
    if (ctx.hasBed && (pCat === "bedding" || pTags.includes("pillow") || pTags.includes("throw-pillows") || pTags.includes("throw_pillows"))) {
      reasons.push("Bed detected — bedding upgrades make the space look instantly more finished.");
    }

    if (ctx.recCats.includes(pCat)) {
      reasons.push(`Matches your scan category: ${prettyLabel(pCat)}.`);
    }

    const tagHits = intersects(pTags, [...ctx.recTags, ...ctx.vibeTags]);
    if (tagHits.length) {
      reasons.push(`Matches your scan vibe: ${tagHits.slice(0, 2).map(prettyLabel).join(", ")}.`);
    }

    if (reasons.length === 0) {
      if (pTags.length) reasons.push(`Style match: ${pTags.slice(0, 2).map(prettyLabel).join(", ")}.`);
      else if (pCat) reasons.push(`Complements your space: ${prettyLabel(pCat)}.`);
      else reasons.push("Picked to complement your room and preferences.");
    }

    return reasons.slice(0, 3);
  };

  const buildRationaleSmart = (p: Product, analysis: RoomScanAnalysis) => {
    const objs = getDetectedObjects(analysis);
    const palette = getPalette(analysis);

    const pTagsRaw = Array.isArray(p.tags) ? p.tags.map(norm) : [];
    const pTags = pTagsRaw.map(aliasTag);
    const pCat = norm(p.category);

    const vibeRaw = (analysis.vibeTags || []).map(norm);
    const vibe = vibeRaw.map(aliasTag);
    const recTagsRaw = (analysis.recommendedTags || []).map(norm);
    const recTags = recTagsRaw.map(aliasTag);
    const recCats = (analysis.recommendedCategories || []).map(norm);
    const avoid = (analysis.avoidTags || []).map(norm).map(aliasTag);

    const missingRug = !hasAny(objs, ["rug"]);
    const missingPlant = !hasAny(objs, ["potted plant"]);
    const missingLamp = !hasAny(objs, ["lamp"]);
    const hasBed = hasAny(objs, ["bed"]);

    const reasons: string[] = [];

    if (analysis.roomType) reasons.push(`Made for a ${prettyLabel(analysis.roomType)} refresh.`);
    else if (hasBed) reasons.push("Bedroom detected — optimizing for cozy + functional upgrades.");

    if (missingRug && (pCat.includes("rug") || pTags.some(t => t.includes("rug")))) {
      reasons.push("No rug detected — adding one anchors the room and makes it feel warmer.");
    }
    if (missingPlant && (pCat.includes("plant") || pTags.some(t => t.includes("plant")))) {
      reasons.push("No plants detected — greenery adds life + contrast without clutter.");
    }
    if (
      missingLamp &&
      (pCat.includes("light") || pTags.some((t) => t.includes("lamp") || t.includes("light") || t.includes("lighting")))
    ) {
      reasons.push("Lighting looks limited — a lamp boosts warmth and ambiance.");
    }
    if (hasBed && (pCat.includes("bed") || pTags.some(t => t.includes("pillow") || t.includes("throw")))) {
      reasons.push("Bed is the focal point — upgraded bedding/pillows give the biggest visual payoff.");
    }
    if (hasBed && (pCat.includes("wall") || pTags.some(t => t.includes("art") || t.includes("wall")))) {
      reasons.push("Great above-bed upgrade — adds a focal point and makes the space feel finished.");
    }

    const tagUniverse = [...vibe, ...recTags];
    const tagHits = intersects(pTags, tagUniverse).slice(0, 3);
    if (tagHits.length) reasons.push(`Matches your scan vibe: ${tagHits.map(prettyLabel).join(", ")}.`);

    const paletteTealish = palette.some((h) => {
      const hex = h.replace("#", "");
      if (hex.length !== 6) return false;
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      return g > r && b > r && g > 80 && b > 80;
    });
    const tealish = vibe.includes("teal") || paletteTealish;

    if (tealish && (pCat.includes("light") || pTags.includes("warm"))) {
      reasons.push("Your room reads cool/teal — warm lighting balances it and feels more inviting.");
    }

    const catHit = recCats.find((c) => pCat.includes(c) || c.includes(pCat));
    if (catHit) reasons.push(`Matches your scan category: ${prettyLabel(catHit)}.`);

    const avoidHit = avoid.find((t) => pTags.includes(t));
    if (avoidHit) reasons.push(`Avoids a dealbreaker style: ${prettyLabel(avoidHit)}.`);

    if (!reasons.length) {
      if (pCat) reasons.push(`Complements your space: ${prettyLabel(pCat)}.`);
      else if (pTags.length) reasons.push(`Style match: ${pTags.slice(0, 2).map(prettyLabel).join(", ")}.`);
      else reasons.push("Picked to complement your room and preferences.");
    }

    return reasons.slice(0, 3);
  };

  const buildRoomScanPicks = (candidates: Product[], analysis: RoomScanAnalysis): RoomScanPick[] => {
    const objs = getDetectedObjects(analysis);
    const missingRug = !hasAny(objs, ["rug"]);
    const missingPlant = !hasAny(objs, ["potted plant"]);
    const missingLamp = !hasAny(objs, ["lamp"]);
    const hasBed = hasAny(objs, ["bed"]);

    const recCats = (analysis.recommendedCategories || []).map(norm);
    const recTags = (analysis.recommendedTags || []).map(norm);
    const vibeTags = (analysis.vibeTags || []).map(norm);

    const alreadySaved = new Set([
      ...userPrefs.cart.map(x => x.id),
      ...userPrefs.wishlist.map(x => x.id),
    ]);

    const scored: RoomScanPick[] = candidates
      .filter(p => !alreadySaved.has(p.id))
      .map((p) => {
        const pCat = norm(p.category);
        const pTags = Array.isArray(p.tags) ? p.tags.map(norm) : [];

        let score = scoreProduct(p) + (p.asin ? 500 : 0);

        if (recCats.includes(pCat)) score += 250;

        const tagHits = intersects(pTags, [...recTags, ...vibeTags]).length;
        score += tagHits * 90;

        if (missingRug && (pCat === "rugs" || pTags.includes("rug"))) score += 300;
        if (missingPlant && (pCat === "plants" || pTags.includes("plant"))) score += 240;
        if (missingLamp && (pCat === "lighting" || pTags.includes("lamp") || pTags.includes("light"))) score += 240;
        if (hasBed && (pCat === "bedding" || pTags.includes("pillow") || pTags.includes("throw-pillows"))) score += 220;

        return {
          product: p,
          score,
          rationale: buildRationaleForPick(p, analysis, {
            missingRug,
            missingPlant,
            missingLamp,
            hasBed,
            recCats,
            recTags,
            vibeTags,
          }),
        };
      })
      .sort((a, b) => b.score - a.score);

    if (scored.length > 0) return scored.slice(0, 8);

    const fallback = candidates
      .slice(0, 6)
      .map((product) => ({
        product,
        score: scoreProduct(product) + (product.asin ? 500 : 0),
        rationale: buildRationaleForPick(product, analysis, {
          missingRug,
          missingPlant,
          missingLamp,
          hasBed,
          recCats,
          recTags,
          vibeTags,
        }),
      }));

    return fallback;
  };

  type FetchOpts = {
    interests: string[];
    limit: number;
    cursor: any;
    ignoreSwiped?: boolean;
  };

  const fetchMoreProducts = async ({ interests, limit, cursor, ignoreSwiped = false }: FetchOpts) => {
    const page = await Firestore.fetchProductsByInterestsPage(interests, limit, cursor);

    const ranked = [...(page.items || [])].sort(
      (a, b) => Number(!!b.asin) - Number(!!a.asin) || scoreProduct(b) - scoreProduct(a)
    );

    const filtered = ranked.filter((p) => {
      if (isBlockedProduct(p)) return false;
      if (!ignoreSwiped && swipedRef.current.has(p.id)) return false;
      return true;
    });

    return { page, filtered };
  };

  const applyRoomScan = async (analysis: RoomScanAnalysis) => {
    setView("roomscan");
    setRoomScanPickStatus("loading");
    setRoomScanPicks([]);

    const alias: Record<string, string> = {
      add_rug: "rugs",
      add_plants: "plants",
      wall_art: "wall_art",
      livingroom: "seating",
      living_room: "seating",
      bedroom: "bedding",
      kitchen: "kitchen_decor",
      decor: "wall_art",
      wall: "wall_art",
      art: "wall_art",
      lights: "lighting",
      lamp: "lighting",
      lamps: "lighting",
      table: "tables",
      chair: "seating",
      sofa: "seating",
      plant: "plants",
      rug: "rugs",
      mirror: "mirrors",
      organization: "storage",
    };

    const toInterestId = (raw: string) => {
      const key = String(raw || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
      if (INTEREST_IDS.has(key)) return key;
      const mapped = alias[key] ?? "";
      return INTEREST_IDS.has(mapped) ? mapped : null;
    };

    const scanInterests = [
      ...(analysis.recommendedCategories || []),
      ...(analysis.recommendedTags || []),
    ]
      .map(toInterestId)
      .filter((x): x is string => Boolean(x));

    setTagScores((prev) => {
      const next = { ...prev };

      for (const tag of [...(analysis.recommendedTags || []), ...(analysis.vibeTags || [])]) {
        const key = String(tag || "").trim().toLowerCase();
        if (!key) continue;
        next[key] = (next[key] || 0) + 2;
      }

      for (const tag of analysis.avoidTags || []) {
        const key = String(tag || "").trim().toLowerCase();
        if (!key) continue;
        next[key] = (next[key] || 0) - 2;
      }

      saveTagScores(next);
      return next;
    });

    if ((analysis.avoidTags || []).length) {
      setBlockedTags((prev) => {
        const next = Array.from(
          new Set([
            ...prev,
            ...(analysis.avoidTags || [])
              .map((t) => String(t || "").trim().toLowerCase())
              .filter(Boolean),
          ])
        );
        saveBlockedTags(next);
        return next;
      });
    }

    let mergedInterests: string[] = [];
    setUserPrefs((prev) => {
      mergedInterests = Array.from(new Set([...(prev.interests || []), ...scanInterests])).slice(0, 10);

      return {
        ...prev,
        interests: mergedInterests.length ? mergedInterests : prev.interests,
        persona: {
          ...prev.persona,
          styleKeywords: Array.from(
            new Set([...(analysis.vibeTags || []), ...(analysis.recommendedTags || []), ...prev.persona.styleKeywords])
          ).slice(0, 10),
        },
      };
    });

    const interestsToUse = mergedInterests.length ? mergedInterests : userPrefs.interests;

    const fetchCandidatesIgnoringSwipes = async (interests: string[], limit = 120) => {
      let nextCursor: any = null;
      let more = true;
      let safety = 0;
      const out: Product[] = [];

      while (more && out.length < limit && safety < 6) {
        const page = await Firestore.fetchProductsByInterestsPage(interests, 30, nextCursor);
        nextCursor = page.cursor;
        more = page.hasMore;

        for (const p of page.items || []) {
          if (!isBlockedProduct(p)) out.push(p);
          if (out.length >= limit) break;
        }

        if (!page.items?.length) break;
        safety++;
      }

      return out;
    };

    try {
      const ranked = await startDiscovery(interestsToUse, { navigate: false });

      const candidates = ranked.length ? ranked : await fetchCandidatesIgnoringSwipes(interestsToUse);

      const picks = buildRoomScanPicks(candidates, analysis);

      console.log("[RoomScan] interestsToUse:", interestsToUse);
      console.log("[RoomScan] ranked:", ranked.length, "candidates:", candidates.length, "picks:", picks.length);

      void Firestore.logEvent({
        type: "scan_apply",
        source: "roomscan",
        meta: {
          picksCount: picks.length,
          interestsCount: interestsToUse.length,
        },
      }).catch(console.warn);

      setRoomScanPicks(picks);
      setRoomScanPickStatus("ready");
      setView("roomscan");
    } catch (e) {
      console.error("applyRoomScan failed:", e);
      setRoomScanPickStatus("error");
      setView("roomscan");
    }
  };

  const subtotal = userPrefs.cart.reduce((s, i) => s + (i.price || 0), 0);

  const submitLead = async (): Promise<boolean> => {
    setLeadError("");

    const email = leadEmail.trim();
    const ok = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    if (!ok) {
      setLeadError("Enter a valid email.");
      return false;
    }

    setLeadStatus("saving");
    try {
      await Firestore.saveLead({
        email,
        subtotal,
        bagCount: userPrefs.cart.length,
        wishlistCount: userPrefs.wishlist.length,
      });
      setLeadStatus("saved");
      return true;
    } catch (e) {
      console.error(e);
      setLeadStatus("error");
      setLeadError("Couldn’t save right now. Try again.");
      return false;
    }
  };

  const shareLink = async () => {
    const url = window.location.href;
    await navigator.clipboard.writeText(url);
    alert("Link copied!");
  };

  const refineRecommendations = async () => {
    if (refineLockRef.current) return;
    if (!hasMore) return;

    refineLockRef.current = true;
    setIsAlgorithmRunning(true);
    try {
      const { page, filtered } = await fetchMoreProducts({
        interests: userPrefs.interests,
        limit: 20,
        cursor,
        ignoreSwiped: false,
      });

      setProducts(prev => {
        const seen = new Set(prev.map(p => p.id));
        const unique = filtered.filter(p => !seen.has(p.id));
        return [...prev, ...unique];
      });

      setCursor(page.cursor);
      setHasMore(page.hasMore);
    } catch (e) {
      console.error("refineRecommendations failed:", e);
    } finally {
      refineLockRef.current = false;
      setIsAlgorithmRunning(false);
    }
  };

  useEffect(() => {
    if (view !== "browsing") return;

    const p = products[currentIndex];
    if (!p?.id) return;

    if (impressedRef.current.has(p.id)) return;
    impressedRef.current.add(p.id);

    void Firestore.logEvent({
      type: "card_impression",
      productId: p.id,
      source: "feed",
      view: "browsing",
      meta: {
        category: p.category ?? "",
        tags: Array.isArray(p.tags) ? p.tags : [],
        price: Number(p.price ?? 0),
        index: currentIndex,
      },
    }).catch(console.warn);
  }, [view, currentIndex, products]);

  useEffect(() => {
    if (view !== "browsing") return;

    const remaining = products.length - currentIndex;

    // when user has 5 cards left, fetch more
    if (remaining <= 5) {
      refineRecommendations();
    }
  }, [view, currentIndex, products.length]);

  const liked = topTags(tagScores, 1, 5);
  const avoided = topTags(tagScores, -1, 5);
  const nextBestPicks = liked.slice(0, 2).join(" ");
  const topRooms = Object.entries(tagScores)
    .filter(([k, v]) => Number(v) > 0 && isRoomTag(k))
    .sort((a, b) => Number(b[1]) - Number(a[1]))
    .slice(0, 4)
    .map(([k]) => k);
  const topCategories = Object.entries(tagScores)
    .filter(([k, v]) => Number(v) > 0 && INTEREST_IDS.has(k))
    .sort((a, b) => Number(b[1]) - Number(a[1]))
    .slice(0, 5)
    .map(([k]) => k);
  const discoveryMessages = [
    "Analyzing Interest Nodes...",
    "Mapping Style Cartography...",
    "Connecting to Product Catalog...",
    "Finalizing Personalized Feed..."
  ];
  const overlayOpen = !!selectedProduct || showCheckout || howOpen;

  // Views
  if (view === 'auth') {
    return (
      <div className="min-h-[100dvh] bg-[var(--seligo-primary)] flex flex-col items-center justify-center p-6 text-white">
        <div className="mb-12 text-center animate-in fade-in zoom-in duration-500">
          <img
            src={seligoLogo}
            alt="Seligo.AI"
            className="w-24 h-24 rounded-[2rem] object-cover shadow-2xl mx-auto mb-6"
          />
          <h1 className="text-5xl font-black mb-2 tracking-tighter">Seligo.AI</h1>
          <p className="text-white font-medium opacity-80 text-lg italic">AI-powered home discovery</p>
        </div>
        <div className="w-full max-sm:px-4 space-y-4">
          <button onClick={handleLogin} className="w-full py-5 bg-white text-[var(--seligo-primary)] rounded-3xl font-black text-xl hover:scale-[1.02] active:scale-95 transition-all shadow-xl">Get Started</button>
        </div>
      </div>
    );
  }

  if (view === 'interests') {
    return (
      <div className="min-h-[100dvh] bg-slate-50 p-6 flex flex-col">
        <header className="mb-8">
          <h1 className="text-3xl font-black text-slate-900 mb-2">Feed the Algorithm</h1>
          <p className="text-slate-500">The ML engine uses your initial choices to build your base persona.</p>
        </header>
        <div className="grid grid-cols-2 gap-4 flex-grow content-start no-scrollbar overflow-y-auto pb-4">
          {MOCK_INTERESTS.map((interest) => (
            <button
              key={interest.id}
              onClick={() => handleToggleInterest(interest.id)}
              className={`p-6 rounded-[2rem] border-2 transition-all flex flex-col items-center text-center space-y-3 ${
                userPrefs.interests.includes(interest.id)
                  ? 'border-[var(--seligo-primary)] bg-white text-[var(--seligo-primary)] shadow-lg'
                  : 'border-slate-100 bg-white text-slate-400 hover:border-slate-200'
              }`}
            >
              <span className="text-4xl">{interest.icon}</span>
              <span className="font-bold text-sm uppercase tracking-tight">{interest.label}</span>
            </button>
          ))}
        </div>
        <button
          onClick={() => startDiscovery()}
          disabled={userPrefs.interests.length < 1 || isLoading}
          className={`mt-4 w-full py-5 rounded-[2rem] font-bold text-lg flex items-center justify-center gap-3 transition-all ${
            userPrefs.interests.length >= 1 ? 'bg-[var(--seligo-cta)] hover:bg-[#fb8b3a] text-white shadow-2xl' : 'bg-slate-200 text-slate-400'
          }`}
        >
          {isLoading ? <Loader2 className="animate-spin" /> : <>Generate My Feed <Zap className="w-5 h-5" /></>}
        </button>
      </div>
    );
  }

  if (view === "privacy") return <PrivacyScreen onBack={() => goView("profile", "legal_back")} />;
  if (view === "terms") return <TermsScreen onBack={() => goView("profile", "legal_back")} />;
  if (view === "disclosure") return <DisclosureScreen onBack={() => goView("profile", "legal_back")} />;
  if (view === "admin") {
    const ok = new URLSearchParams(window.location.search).get("admin") === "1";
    if (!ok) return null;
    return <AdminScreen onBack={() => goView("browsing", "admin_back")} />;
  }

  return (
    <div className="min-h-[100dvh] bg-slate-100 flex items-center justify-center p-0 sm:p-6">
      <div className="w-full max-w-md h-[100dvh] sm:h-[min(100dvh,900px)] rounded-none sm:rounded-[2.5rem] overflow-hidden shadow-2xl border border-slate-200 bg-slate-50">
      <div className="h-full flex flex-col">
      {/* Header */}
      <header
        className="sticky top-0 z-[250] bg-white/90 backdrop-blur-xl border-b border-slate-100"
        style={{ paddingTop: "env(safe-area-inset-top)" }}
      >
        <div className="h-[4.75rem] px-6 flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <div className="relative shrink-0">
              <img
                src={seligoLogo}
                alt="Seligo.AI"
                className="w-10 h-10 rounded-xl object-cover shadow"
              />
              {isAlgorithmRunning && (
                <div className="absolute -top-1 -right-1 w-4 h-4 bg-[var(--seligo-accent)] rounded-full flex items-center justify-center animate-pulse border-2 border-white">
                  <BrainCircuit className="w-2 h-2 text-white" />
                </div>
              )}
            </div>

            <div className="min-w-0">
              <div className="font-black text-[17px] leading-tight text-slate-900 truncate">
                Seligo.AI
              </div>
              <div className="text-[10px] font-extrabold uppercase tracking-[0.22em] text-[var(--seligo-accent)] truncate">
                {isAlgorithmRunning ? "Algorithm refining…" : "ML active"}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={undoLast}
              disabled={undoCount === 0}
              className="w-10 h-10 bg-slate-50 rounded-2xl flex items-center justify-center text-slate-400 hover:text-slate-700 disabled:opacity-40 transition-colors"
              aria-label="Undo"
              title="Undo"
            >
              <RotateCcw className="w-5 h-5" />
            </button>

            <button
              onClick={() => setView("cart")}
              className="w-10 h-10 bg-slate-50 rounded-2xl flex items-center justify-center text-slate-400 relative hover:text-[var(--seligo-primary)] transition-colors"
              aria-label="Bag"
              title="Bag"
            >
              <ShoppingBag className="w-5 h-5" />
              {(userPrefs.cart.length + userPrefs.wishlist.length) > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 bg-[var(--seligo-primary)] text-white text-[10px] flex items-center justify-center rounded-full font-extrabold border-2 border-white">
                  {userPrefs.cart.length + userPrefs.wishlist.length}
                </span>
              )}
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main
        className="flex-1 overflow-y-auto no-scrollbar bg-slate-50"
        style={{
          paddingBottom:
            view === "roomscan"
              ? "calc(4.0rem + env(safe-area-inset-bottom))"
              : "calc(4.75rem + env(safe-area-inset-bottom))",
        }}
      >
        {view === "discovering" && (
          <div
            className="min-h-[calc(100dvh-8rem)] bg-slate-900 relative overflow-hidden"
          >
            {/* Animated Background Pulse */}
            <div className="absolute inset-0 bg-[var(--seligo-primary)]/5 animate-pulse" />

            <div className="absolute inset-0 flex flex-col items-center justify-center p-8 text-center">
              {/* AI Brain Graphic */}
              <div className="relative mb-12">
                <div className="absolute inset-0 bg-[var(--seligo-primary)] rounded-full blur-3xl opacity-20 animate-pulse" />
                <div className="relative w-32 h-32 bg-slate-800 rounded-full flex items-center justify-center border border-slate-700 shadow-2xl">
                  <div className="absolute inset-0 border-t-2 border-[var(--seligo-primary)] rounded-full animate-spin duration-700" />
                  <BrainCircuit className="w-16 h-16 text-[var(--seligo-primary)] animate-pulse" />
                </div>

                {/* Scanning Line Effect */}
                <div className="absolute -left-12 -right-12 top-1/2 h-[1px] bg-gradient-to-r from-transparent via-[var(--seligo-primary)] to-transparent animate-[bounce_2s_infinite] opacity-50" />
              </div>

              <div className="relative z-10 space-y-6">
                <h2 className="text-3xl font-black text-white tracking-tighter">AI Discovery Engine</h2>

                <div className="flex flex-col items-center space-y-2">
                  <p className="text-[var(--seligo-primary)] font-mono text-sm uppercase tracking-[0.3em] h-6">
                    {discoveryMessages[discoveryStep]}
                  </p>
                  <div className="w-48 h-1 bg-slate-800 rounded-full overflow-hidden mt-4">
                    <div
                      className="h-full bg-[var(--seligo-primary)] transition-all duration-1000 ease-out"
                      style={{ width: `${(discoveryStep + 1) * 25}%` }}
                    />
                  </div>
                </div>

                <div className="pt-12 grid grid-cols-2 gap-3 max-w-xs mx-auto">
                  {userPrefs.interests.map((interestId, idx) => {
                    const interest = MOCK_INTERESTS.find(i => i.id === interestId);
                    return (
                      <div
                        key={interestId}
                        className="px-4 py-2 bg-slate-800/50 border border-slate-700 rounded-xl text-slate-400 text-[10px] font-bold uppercase tracking-widest flex items-center gap-2 animate-in fade-in slide-in-from-bottom duration-500"
                        style={{ animationDelay: `${idx * 200}ms` }}
                      >
                        <Activity className="w-3 h-3 text-[var(--seligo-accent)]" /> {interest?.label}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="absolute bottom-10 left-0 right-0 text-slate-500 text-[10px] font-bold uppercase tracking-[0.4em]">
                Personalizing your style experience...
              </div>
            </div>
          </div>
        )}

        {view === 'browsing' && (
          <Screen animate={false} className={overlayOpen ? "pointer-events-none" : ""}>
            {currentIndex < products.length ? (
              <div
                className="flex items-center justify-center"
                style={{
                  minHeight:
                    "calc(100dvh - var(--seligo-header-h,76px) - 4.75rem - env(safe-area-inset-bottom))",
                }}
              >
                <div className="w-full flex flex-col items-center">
                  <SwipeCard
                    key={products[currentIndex].id}
                    product={products[currentIndex]}
                    onSwipe={handleSwipe}
                    onSelectAction={handleAction}
                    onTap={() => handleSwipe("right")}
                  />
                  <div className="mt-4 flex items-center gap-2 text-slate-400 text-[11px] font-extrabold uppercase tracking-[0.22em] bg-white px-4 py-2 rounded-full border border-slate-100 shadow-sm">
                    <Sparkles className="w-3 h-3 text-[var(--seligo-accent)]" />
                    Match: {matchPercent(products[currentIndex])}%
                  </div>
                </div>
              </div>
            ) : (
              <div
                className="flex items-center justify-center"
                style={{
                  minHeight:
                    "calc(100dvh - var(--seligo-header-h,76px) - 4.75rem - env(safe-area-inset-bottom))",
                }}
              >
                <div className="text-center p-8 bg-white rounded-[2.5rem] shadow-xl border border-slate-100 max-w-[300px] animate-in fade-in zoom-in">
                  <div className="w-16 h-16 bg-[var(--seligo-primary)]/10 rounded-full flex items-center justify-center mx-auto mb-5">
                    <History className="w-8 h-8 text-[var(--seligo-primary)]" />
                  </div>
                  <h3 className="text-lg font-black text-slate-900 mb-2">No more items</h3>

                  <p className="text-slate-500 text-sm mb-5">
                    You’ve reached the end for these interests.
                  </p>

                  <div className="space-y-3">
                    <button
                      onClick={() => setView("interests")}
                      className="w-full py-4 text-white rounded-2xl font-extrabold transition-colors"
                      style={{ background: "var(--seligo-cta)" }}
                    >
                      Change interests
                    </button>
                    <button
                      onClick={handleResetData}
                      className="w-full py-4 bg-slate-100 text-slate-900 rounded-2xl font-extrabold hover:bg-slate-200 transition-colors"
                    >
                      Reset passes
                    </button>
                  </div>
                </div>
              </div>
            )}
          </Screen>
        )}

        {/* Product Details Modal Overlay */}
        {selectedProduct && (
          <div className="fixed inset-0 z-[500]">
            <button
              className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
              aria-label="Close"
              onClick={() => setSelectedProduct(null)}
            />

            <div
              className="absolute left-0 right-0 bottom-0 mx-auto w-full max-w-md"
              style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="rounded-t-[2.5rem] bg-white shadow-2xl border border-slate-100 overflow-hidden">
                <div className="pt-3 pb-2 flex justify-center">
                  <div className="h-1.5 w-12 rounded-full bg-slate-200" />
                </div>

                <div className="relative h-60 bg-slate-100">
                  <img
                    src={selectedProduct.imageUrl}
                    alt={selectedProduct.name}
                    className="absolute inset-0 w-full h-full object-contain bg-slate-100"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/35 via-black/0 to-transparent" />

                  <button
                    onClick={() => setSelectedProduct(null)}
                    className="absolute top-4 left-4 h-10 w-10 rounded-2xl bg-white/85 backdrop-blur-xl border border-white/40 flex items-center justify-center"
                    aria-label="Back"
                  >
                    <ArrowLeft className="h-5 w-5 text-slate-900" />
                  </button>

                  <div className="absolute bottom-4 right-4 px-3 py-2 rounded-2xl bg-black/45 backdrop-blur-xl text-white font-black">
                    ${Number(selectedProduct.price || 0).toFixed(2)}
                  </div>
                </div>

                <div className="max-h-[52vh] overflow-y-auto no-scrollbar px-6 pb-28 overscroll-contain">
                  <div className="pt-4">
                    <div className="text-[10px] font-extrabold uppercase tracking-[0.22em] text-slate-400">
                      {selectedProduct.brand || "Seligo.AI"}
                    </div>
                    <div className="mt-1 text-2xl font-extrabold text-slate-900 leading-tight">
                      {selectedProduct.name}
                    </div>
                  </div>

                  {Array.isArray(selectedProduct.tags) && selectedProduct.tags.length > 0 && (
                    <div className="mt-4 flex flex-wrap gap-2">
                      {selectedProduct.tags.slice(0, 10).map((t: string) => (
                        <span
                          key={t}
                          className="px-3 py-1 rounded-full bg-slate-100 text-slate-700 text-xs font-bold"
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  )}

                  {selectedProduct.description && (
                    <div className="mt-4 text-[13px] text-slate-600 leading-relaxed">
                      {selectedProduct.description}
                    </div>
                  )}
                </div>

                <div
                  className="sticky bottom-0 bg-white/95 backdrop-blur-xl border-t border-slate-100 px-6 pt-4"
                  style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
                >
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      onClick={() => {
                        handleAction("wishlist", "product_sheet");
                        setSelectedProduct(null);
                      }}
                      className="h-12 rounded-2xl bg-slate-100 text-slate-900 font-extrabold"
                    >
                      Save Item
                    </button>

                    <button
                      onClick={() => {
                        handleAction("cart", "product_sheet");
                        setSelectedProduct(null);
                      }}
                      className="h-12 rounded-2xl text-white font-extrabold"
                      style={{ background: "var(--seligo-cta)" }}
                    >
                      Add to Bag
                    </button>
                  </div>

                  <div className="mt-3 text-[11px] text-slate-400">
                    Tip: Swiping refines your feed. Saving trains your style profile.
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {view === 'profile' && (
          <Screen className="bg-white">
            <PageHeader
              title="Insights"
              subtitle="Your Seligo.AI style profile"
              onClose={() => setView("browsing")}
            />

            <div className="bg-[var(--seligo-primary)] rounded-[2.5rem] p-7 text-white shadow-xl mb-6">
              <div className="flex items-center gap-4 mb-4">
                <div className="p-3 bg-white/20 rounded-2xl backdrop-blur-md">
                  <BrainCircuit className="w-7 h-7" />
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-extrabold uppercase tracking-[0.22em] text-white/80">
                    Detected vibe
                  </div>
                  <div className="text-2xl font-black truncate">{userPrefs.persona.detectedVibe}</div>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                {userPrefs.persona.styleKeywords.slice(0, 6).map((k) => (
                  <span
                    key={k}
                    className="px-3 py-1 bg-white/10 rounded-full text-xs font-bold border border-white/20"
                  >
                    {k}
                  </span>
                ))}
              </div>

              <div className="mt-5 pt-4 border-t border-white/10 flex justify-between items-center text-sm font-bold">
                <span className="text-white/80 uppercase tracking-[0.22em] text-[11px]">
                  Price sensitivity
                </span>
                <span className="uppercase">{userPrefs.persona.priceSensitivity}</span>
              </div>
            </div>

            <SectionCard className="mb-6 bg-white border-slate-100">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs font-black uppercase tracking-[0.22em] text-slate-400">
                    Daily streak
                  </div>
                  <div className="text-3xl font-black text-slate-900 mt-1">
                    {streak} <span className="text-base font-bold text-slate-500">days</span>
                  </div>
                </div>

                <div className="text-right">
                  <div className="text-xs font-black uppercase tracking-[0.22em] text-slate-400">
                    Today
                  </div>
                  <div className="text-sm font-bold text-slate-700 mt-1">
                    {matchesToday} matches • {passesToday} passes • {savesToday} saved
                  </div>
                </div>
              </div>
            </SectionCard>

            <div className="grid grid-cols-3 gap-3 mb-6">
              <SectionCard className="bg-slate-50">
                <Heart className="w-5 h-5 text-[var(--seligo-accent)] mb-2" />
                <div className="text-2xl font-black text-slate-900">{userPrefs.likedProducts.length}</div>
                <div className="text-[10px] font-black text-slate-400 uppercase tracking-[0.22em]">Matches</div>
              </SectionCard>

              <SectionCard className="bg-slate-50">
                <History className="w-5 h-5 text-slate-400 mb-2" />
                <div className="text-2xl font-black text-slate-900">{userPrefs.dislikedProducts.length}</div>
                <div className="text-[10px] font-black text-slate-400 uppercase tracking-[0.22em]">Passes</div>
              </SectionCard>

              <SectionCard className="bg-slate-50">
                <ShoppingBag className="w-5 h-5 text-[var(--seligo-cta)] mb-2" />
                <div className="text-2xl font-black text-slate-900">
                  {userPrefs.wishlist.length + userPrefs.cart.length}
                </div>
                <div className="text-[10px] font-black text-slate-400 uppercase tracking-[0.22em]">Saved</div>
              </SectionCard>
            </div>

            <SectionCard className="mb-6">
              <div className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400 mb-2">
                Next picks
              </div>
              <div className="text-slate-800 font-bold">
                We’ll show you more of{" "}
                <span className="text-[var(--seligo-primary)]">{liked[0] ? liked[0] : "your top styles"}</span>
                {liked[1] ? (
                  <>
                    {" "}and{" "}
                    <span className="text-[var(--seligo-primary)]">{liked[1]}</span>
                  </>
                ) : null}
                .
              </div>
              <div className="text-slate-500 text-sm mt-2">Keep matching to refine your feed.</div>
            </SectionCard>

            <div className="mb-6">
              <div className="font-black text-lg mb-3 text-slate-900">Your Type</div>
              <div className="flex flex-wrap gap-2">
                {liked.length ? (
                  liked.map((t) => (
                    <span key={t} className="px-4 py-2 bg-emerald-50 text-emerald-700 rounded-xl text-xs font-bold">
                      {t}
                    </span>
                  ))
                ) : (
                  <span className="text-slate-400 italic text-sm">Match a few items to build your type.</span>
                )}
              </div>
            </div>

            <div className="mb-6">
              <div className="font-black text-lg mb-3 text-slate-900">Your Spaces</div>
              <div className="flex flex-wrap gap-2">
                {topRooms.length ? (
                  topRooms.map((t) => (
                    <span key={t} className="px-4 py-2 bg-[var(--seligo-primary)]/10 text-[var(--seligo-primary)] rounded-xl text-xs font-bold">
                      {t}
                    </span>
                  ))
                ) : (
                  <span className="text-slate-400 italic text-sm">No room preferences detected yet.</span>
                )}
              </div>
            </div>

            <div className="mb-8">
              <div className="font-black text-lg mb-3 text-slate-900">Your Categories</div>
              <div className="flex flex-wrap gap-2">
                {topCategories.length ? (
                  topCategories.map((t) => (
                    <span key={t} className="px-4 py-2 bg-[var(--seligo-primary)]/10 text-[var(--seligo-primary)] rounded-xl text-xs font-bold">
                      {t}
                    </span>
                  ))
                ) : (
                  <span className="text-slate-400 italic text-sm">No category preferences detected yet.</span>
                )}
              </div>
            </div>

            <div className="mb-10">
              <div className="flex items-center justify-between mb-2">
                <div className="font-black text-lg text-slate-900">Dealbreakers</div>
                {blockedTags.length > 0 && (
                  <button
                    onClick={clearBlockedTags}
                    className="text-xs font-black uppercase tracking-[0.22em] text-slate-500 hover:text-slate-700"
                  >
                    Clear hidden
                  </button>
                )}
              </div>

              <div className="text-slate-500 text-sm mb-3">Tap a tag to hide it from your feed.</div>

              <div className="flex flex-wrap gap-2">
                {(userPrefs.persona.dislikedFeatures.length ? userPrefs.persona.dislikedFeatures : avoided).map((t) => {
                  const active = blockedSet.has(t);
                  return (
                    <button
                      key={t}
                      onClick={() => toggleBlockedTag(t)}
                      className={
                        active
                          ? "px-4 py-2 rounded-xl text-xs font-black bg-rose-600 text-white"
                          : "px-4 py-2 rounded-xl text-xs font-black bg-rose-50 text-rose-600 hover:bg-rose-100"
                      }
                      title={active ? "Hidden from feed" : "Tap to hide from feed"}
                    >
                      {active ? `Hidden: ${t}` : t}
                    </button>
                  );
                })}
              </div>

              {blockedTags.length > 0 && (
                <div className="mt-4 text-xs text-slate-500">
                  Hidden tags: <span className="font-bold">{blockedTags.length}</span>
                </div>
              )}
            </div>

            <div className="mt-2 pt-4 border-t border-slate-100">
              <button
                onClick={shareLink}
                className="w-full py-4 rounded-2xl text-white font-black"
                style={{ background: "var(--seligo-cta)" }}
              >
                Share Seligo.AI
              </button>

              <button
                onClick={() => setHowOpen(true)}
                className="w-full py-4 rounded-2xl bg-slate-100 text-slate-900 font-black mt-3"
              >
                How it works
              </button>

              <button
                onClick={handleResetData}
                className="w-full py-4 bg-rose-50 text-rose-600 border border-rose-100 rounded-2xl font-black uppercase tracking-[0.22em] text-xs flex items-center justify-center gap-2 hover:bg-rose-100 transition-colors mt-3"
              >
                <RotateCcw className="w-4 h-4" /> Reset My Data
              </button>

              <div className="mt-4 flex justify-center gap-4 text-[11px] font-bold text-slate-400">
                <button onClick={() => goView("privacy", "profile_footer")} className="hover:text-slate-600">Privacy</button>
                <button onClick={() => goView("terms", "profile_footer")} className="hover:text-slate-600">Terms</button>
                <button onClick={() => goView("disclosure", "profile_footer")} className="hover:text-slate-600">Disclosure</button>
              </div>
            </div>
          </Screen>
        )}

        {view === 'roomscan' && (
          <div className="min-h-full bg-slate-50">
            <RoomScanPage
              onApply={applyRoomScan}
              picks={roomScanPicks.map(p => ({ product: p.product, rationale: p.rationale }))}
              pickStatus={roomScanPickStatus}
              onSavePick={addToWishlistFromRoomScan}
              onBagPick={addToCartFromRoomScan}
              onGoExplore={() => setView("browsing")}
              onDismissPick={dismissRoomScanPick}
              onScanAgain={() => {
                setRoomScanPicks([]);
                setRoomScanPickStatus("idle");
              }}
            />
          </div>
        )}

        {view === 'cart' && (
          <Screen className="bg-white">
            <PageHeader
              title="Shopping Bag"
              subtitle="Review and checkout your selected items."
              onClose={() => setView("browsing")}
            />

            <div className="pb-28">
              {(userPrefs.cart.length + userPrefs.wishlist.length) > 0 ? (
                <div className="space-y-8">
                  {userPrefs.cart.length > 0 && (
                    <div>
                      <div className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400 mb-4">In Bag</div>
                      <div className="space-y-5">
                        {userPrefs.cart.map((item, idx) => (
                          <div key={`${item.id}-${idx}`} className="flex gap-4">
                            <img src={item.imageUrl} className="w-20 h-20 rounded-2xl object-cover shadow-sm bg-slate-100" />
                            <div className="flex-1 min-w-0 py-1">
                              <div className="font-black text-slate-900 leading-tight line-clamp-2">{item.name}</div>
                              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.22em] truncate">
                                {item.brand}
                              </div>
                              <div className="flex justify-between items-center mt-2">
                                <span className="font-black text-[var(--seligo-primary)]">${Number(item.price).toFixed(2)}</span>
                                <button
                                  onClick={() => setUserPrefs(prev => ({ ...prev, cart: prev.cart.filter((_, i) => i !== idx) }))}
                                  className="text-slate-300 hover:text-rose-500 transition-colors p-2 -mr-2"
                                  aria-label="Remove"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {userPrefs.wishlist.length > 0 && (
                    <div>
                      <div className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400 mb-4">Saved for Later</div>
                      <div className="space-y-5 opacity-90">
                        {userPrefs.wishlist.map((item, idx) => (
                          <div key={`${item.id}-${idx}-wish`} className="flex gap-4">
                            <img src={item.imageUrl} className="w-16 h-16 rounded-xl object-cover bg-slate-100" />
                            <div className="flex-1 min-w-0 py-1">
                              <div className="font-bold text-slate-800 text-sm line-clamp-2">{item.name}</div>
                              <div className="flex justify-between items-center mt-1">
                                <span className="font-bold text-slate-500 text-xs">${Number(item.price).toFixed(2)}</span>
                                <div className="flex items-center gap-3">
                                  <button
                                    onClick={() => {
                                      const itemToMove = userPrefs.wishlist[idx];
                                      if (!itemToMove) return;

                                      setUserPrefs((prev) => ({
                                        ...prev,
                                        wishlist: prev.wishlist.filter((_, i) => i !== idx),
                                        cart: [...prev.cart, itemToMove],
                                      }));

                                      void Firestore.saveSwipe({
                                        productId: itemToMove.id,
                                        direction: "right",
                                        action: "cart",
                                      }).catch(console.error);

                                      void Firestore.logEvent({
                                        type: "cart_add",
                                        productId: itemToMove.id,
                                        source: "bag_move_to_cart",
                                      }).catch(console.warn);
                                    }}
                                    className="text-[var(--seligo-primary)] font-black text-[10px] uppercase tracking-[0.22em] hover:underline"
                                  >
                                    Move to Bag
                                  </button>
                                  <button
                                    onClick={() => setUserPrefs(prev => ({ ...prev, wishlist: prev.wishlist.filter((_, i) => i !== idx) }))}
                                    className="text-slate-300 hover:text-rose-500 transition-colors"
                                    aria-label="Remove"
                                  >
                                    <X className="w-4 h-4" />
                                  </button>
                                </div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="min-h-[52vh] flex flex-col items-center justify-center text-slate-400">
                  <ShoppingBag className="h-10 w-10 opacity-30" />
                  <div className="mt-3 font-semibold text-slate-500">Your bag is empty.</div>
                  <div className="text-sm text-slate-400 mt-1">Add items from Explore to checkout.</div>
                </div>
              )}
            </div>

            <div
              className="sticky bottom-0 bg-white/95 backdrop-blur-xl border-t border-slate-100 pt-4"
              style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
            >
              <div className="flex justify-between items-end mb-4">
                <div className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">Subtotal</div>
                <div className="text-3xl font-black text-slate-900">
                  ${userPrefs.cart.reduce((s, i) => s + Number(i.price || 0), 0).toFixed(2)}
                </div>
              </div>

              <button
                onClick={() => {
                  setLeadEmail("");
                  setLeadError("");
                  setLeadStatus("idle");
                  setShowCheckout(true);
                  void Firestore.logEvent({ type: "checkout_open", source: "bag" }).catch(console.warn);
                }}
                className="w-full rounded-2xl py-4 font-extrabold text-white transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ background: "var(--seligo-cta)" }}
                disabled={userPrefs.cart.length === 0}
              >
                Checkout
              </button>
            </div>
          </Screen>
        )}
      </main>

      <CheckoutLinksModal
        open={showCheckout}
        onClose={() => setShowCheckout(false)}
        onPrivacy={() => {
          setShowCheckout(false);
          goView("privacy", "checkout_footer");
        }}
        onTerms={() => {
          setShowCheckout(false);
          goView("terms", "checkout_footer");
        }}
        onDisclosure={() => {
          setShowCheckout(false);
          goView("disclosure", "checkout_footer");
        }}
        cart={userPrefs.cart}
        wishlist={userPrefs.wishlist}
        subtotal={userPrefs.cart.reduce((s, i) => s + (i.price || 0), 0)}
        leadEmail={leadEmail}
        setLeadEmail={setLeadEmail}
        leadStatus={leadStatus}
        leadError={leadError}
        onSubmitLead={submitLead}
      />

      <HowItWorksModal open={howOpen} onClose={() => setHowOpen(false)} />

      {/* Bottom Navigation */}
      <nav
        className="sticky bottom-0 z-[300] bg-white/90 backdrop-blur-xl border-t border-slate-100"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="h-[4.75rem] px-6 flex items-center justify-between">
          <NavItem
            active={view === "browsing"}
            label="Explore"
            onClick={() => goView("browsing")}
            icon={<Compass className="w-6 h-6" />}
          />

          <NavItem
            active={view === "profile"}
            label="Insights"
            onClick={() => goView("profile")}
            icon={<BrainCircuit className="w-6 h-6" />}
          />

          <NavItem
            active={view === "roomscan"}
            label="RoomScan"
            onClick={() => goView("roomscan")}
            icon={<Scan className="w-6 h-6" />}
          />

          <NavItem
            active={view === "cart"}
            label="Bag"
            onClick={() => goView("cart")}
            icon={
              <div className="relative">
                <ShoppingBag className="w-6 h-6" />
                {(userPrefs.cart.length + userPrefs.wishlist.length) > 0 && (
                  <span className="absolute -top-1 -right-1 w-3 h-3 bg-[var(--seligo-primary)] rounded-full border-2 border-white" />
                )}
              </div>
            }
          />
        </div>
      </nav>
      </div>
      </div>
    </div>
  );
};

export default App;
