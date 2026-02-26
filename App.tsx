import * as Firestore from "./firestoreService";
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Product, UserPreferences, AppState, UserPersona } from './types';
import * as Backend from './backendService';
import SwipeCard from './components/SwipeCard';
import CheckoutLinksModal from './components/CheckoutLinksModal';
import HowItWorksModal from './src/components/HowItWorksModal';
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
  ChevronLeft, 
  Bookmark, 
  ShoppingCart,
  RotateCcw,
  Zap,
  Activity
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
  const [undoCount, setUndoCount] = useState(0);
  const swipedRef = useRef<Set<string>>(new Set());
  const undoRef = useRef<UndoEntry[]>([]);
  const refineLockRef = useRef(false);
  const blockedSet = useMemo(() => new Set(blockedTags), [blockedTags]);

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

  const startDiscovery = async () => {
    const interests = [...userPrefs.interests];
    if (interests.length === 0) return;

    setIsLoading(true);
    try {
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
      setView("browsing");
    } catch (e) {
      console.error("Firestore load failed:", e);
      setView("interests");
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

      Firestore.saveSwipe({ productId: currentProduct.id, direction: "left", action: null })
        .catch(console.error);

      bumpTags(currentProduct, -1);
      swipedRef.current.add(currentProduct.id);
      pushUndo({ product: currentProduct, direction: "left", action: null });
      logLocalActivity("pass");
      setCurrentIndex(i => i + 1);
      return;
    }

    setSelectedProduct(currentProduct);
  };

  const handleAction = async (action: 'wishlist' | 'cart') => {
    const currentProduct = products[currentIndex];
    if (!currentProduct) return;

    void Firestore.saveSwipe({ productId: currentProduct.id, direction: "right", action });
    void Firestore.logEvent({
      type: action === "wishlist" ? "wishlist_add" : "cart_add",
      productId: currentProduct.id,
      source: "style_match_modal",
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

  const subtotal = userPrefs.cart.reduce((s, i) => s + (i.price || 0), 0);

  const submitLead = async () => {
    setLeadError("");

    const email = leadEmail.trim();
    const ok = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    if (!ok) {
      setLeadError("Enter a valid email.");
      return;
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
    } catch (e) {
      console.error(e);
      setLeadStatus("error");
      setLeadError("Couldn’t save right now. Try again.");
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
      const page = await Firestore.fetchProductsByInterestsPage(
        userPrefs.interests,
        20,
        cursor
      );
      const ranked = [...page.items];
      ranked.sort((a, b) => Number(!!b.asin) - Number(!!a.asin) || scoreProduct(b) - scoreProduct(a));

      setProducts(prev => {
        const seen = new Set(prev.map(p => p.id));
        const unique = ranked
          .filter(p => !seen.has(p.id))
          .filter(p => !swipedRef.current.has(p.id));
          
        const filtered = unique.filter(p => !isBlockedProduct(p));
        return [...prev, ...filtered];
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

  // Views
  if (view === 'auth') {
    return (
      <div className="min-h-screen bg-[var(--seligo-primary)] flex flex-col items-center justify-center p-6 text-white">
        <div className="mb-12 text-center animate-in fade-in zoom-in duration-500">
          <div className="w-24 h-24 bg-white/20 backdrop-blur-xl rounded-[2.5rem] flex items-center justify-center mx-auto mb-6 shadow-2xl border border-white/20 overflow-hidden p-3">
            <img src="/seligoLogo.png" alt="Seligo.AI logo" className="w-full h-full object-contain" />
          </div>
          <h1 className="text-5xl font-black mb-2 tracking-tighter">Seligo.AI</h1>
          <p className="text-sky-100 font-medium opacity-80 text-lg italic">AI-powered home discovery</p>
        </div>
        <div className="w-full max-sm:px-4 space-y-4">
          <button onClick={handleLogin} className="w-full py-5 bg-white text-[var(--seligo-primary)] rounded-3xl font-black text-xl hover:scale-[1.02] active:scale-95 transition-all shadow-xl">Get Started</button>
        </div>
      </div>
    );
  }

  if (view === 'interests') {
    return (
      <div className="min-h-screen bg-slate-50 p-6 flex flex-col">
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
                  ? 'border-[var(--seligo-primary)] bg-white text-[var(--seligo-primary)] shadow-lg shadow-sky-100'
                  : 'border-slate-100 bg-white text-slate-400 hover:border-slate-200'
              }`}
            >
              <span className="text-4xl">{interest.icon}</span>
              <span className="font-bold text-sm uppercase tracking-tight">{interest.label}</span>
            </button>
          ))}
        </div>
        <button
          onClick={startDiscovery}
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

  if (view === 'discovering') {
    const discoveryMessages = [
      "Analyzing Interest Nodes...",
      "Mapping Style Cartography...",
      "Connecting to Product Catalog...",
      "Finalizing Personalized Feed..."
    ];
    
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-8 text-center overflow-hidden">
        {/* Animated Background Pulse */}
        <div className="absolute inset-0 bg-indigo-500/5 animate-pulse" />
        
        {/* AI Brain Graphic */}
        <div className="relative mb-12">
          <div className="absolute inset-0 bg-indigo-500 rounded-full blur-3xl opacity-20 animate-pulse" />
          <div className="relative w-32 h-32 bg-slate-800 rounded-full flex items-center justify-center border border-slate-700 shadow-2xl">
            <div className="absolute inset-0 border-t-2 border-indigo-500 rounded-full animate-spin duration-700" />
            <BrainCircuit className="w-16 h-16 text-indigo-400 animate-pulse" />
          </div>
          
          {/* Scanning Line Effect */}
          <div className="absolute -left-12 -right-12 top-1/2 h-[1px] bg-gradient-to-r from-transparent via-indigo-500 to-transparent animate-[bounce_2s_infinite] opacity-50" />
        </div>

        <div className="relative z-10 space-y-6">
          <h2 className="text-3xl font-black text-white tracking-tighter">AI Discovery Engine</h2>
          <div className="flex flex-col items-center space-y-2">
             <p className="text-indigo-400 font-mono text-sm uppercase tracking-[0.3em] h-6">
               {discoveryMessages[discoveryStep]}
             </p>
             <div className="w-48 h-1 bg-slate-800 rounded-full overflow-hidden mt-4">
                <div 
                  className="h-full bg-indigo-500 transition-all duration-1000 ease-out" 
                  style={{ width: `${(discoveryStep + 1) * 25}%` }} 
                />
             </div>
          </div>
          
          <div className="pt-12 grid grid-cols-2 gap-3 max-w-xs mx-auto">
             {userPrefs.interests.map((interestId, idx) => {
               const interest = MOCK_INTERESTS.find(i => i.id === interestId);
               return (
                 <div key={interestId} className={`px-4 py-2 bg-slate-800/50 border border-slate-700 rounded-xl text-slate-400 text-[10px] font-bold uppercase tracking-widest flex items-center gap-2 animate-in fade-in slide-in-from-bottom duration-500`} style={{ animationDelay: `${idx * 200}ms` }}>
                    <Activity className="w-3 h-3 text-[var(--seligo-accent)]" /> {interest?.label}
                 </div>
               )
             })}
          </div>
        </div>

        <div className="absolute bottom-12 left-0 right-0 text-slate-500 text-[10px] font-bold uppercase tracking-[0.4em]">
           Personalizing your style experience...
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-slate-100 flex items-center justify-center p-0 sm:p-6">
      <div className="w-full max-w-md h-[100dvh] sm:h-[min(100dvh,900px)] rounded-none sm:rounded-[2.5rem] overflow-hidden shadow-2xl border border-slate-200 bg-slate-50">
      <div className="h-full flex flex-col">
      {/* Header */}
      <header className="shrink-0 px-6 py-5 bg-white/90 backdrop-blur-xl z-[250] flex justify-between items-center border-b border-slate-100">
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="w-10 h-10 bg-[var(--seligo-primary)] rounded-xl flex items-center justify-center shadow-lg shadow-sky-200 overflow-hidden p-1.5">
              <img src="/seligoLogo.png" alt="Seligo.AI logo" className="w-full h-full object-contain" />
            </div>
            {isAlgorithmRunning && (
              <div className="absolute -top-1 -right-1 w-4 h-4 bg-[var(--seligo-accent)] rounded-full flex items-center justify-center animate-pulse border-2 border-white">
                <BrainCircuit className="w-2 h-2 text-white" />
              </div>
            )}
          </div>
          <div>
            <span className="block font-black text-lg leading-tight text-slate-900">Seligo.AI</span>
            <span className="block text-[10px] font-bold uppercase tracking-widest text-[var(--seligo-accent)]">
              {isAlgorithmRunning ? 'Algorithm Refining...' : 'ML Active'}
            </span>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={undoLast}
            disabled={undoCount === 0}
            className="w-11 h-11 bg-slate-50 rounded-xl flex items-center justify-center text-slate-400 hover:text-slate-700 disabled:opacity-40 transition-colors"
            aria-label="Undo"
            title="Undo"
          >
            <RotateCcw className="w-5 h-5" />
          </button>
          <button onClick={() => setView('cart')} className="w-11 h-11 bg-slate-50 rounded-xl flex items-center justify-center text-slate-400 relative hover:text-[var(--seligo-primary)] transition-colors">
            <ShoppingBag className="w-5 h-5" />
            {(userPrefs.cart.length + userPrefs.wishlist.length) > 0 && (
              <span className="absolute -top-1 -right-1 w-5 h-5 bg-[var(--seligo-primary)] text-white text-[10px] flex items-center justify-center rounded-full font-bold border-2 border-white">
                {userPrefs.cart.length + userPrefs.wishlist.length}
              </span>
            )}
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 relative overflow-hidden">
        {view === 'browsing' && (
          <div className="absolute inset-0 p-6 flex items-center justify-center">
            {currentIndex < products.length ? (
              <div className="w-full flex flex-col items-center">
                 <SwipeCard 
                  key={products[currentIndex].id}
                  product={products[currentIndex]} 
                  onSwipe={handleSwipe}
                  onSelectAction={handleAction}
                  onTap={() => setSelectedProduct(products[currentIndex])}
                />
                <div className="mt-6 flex items-center gap-2 text-slate-400 text-xs font-bold uppercase tracking-widest bg-white px-4 py-2 rounded-full shadow-sm">
                  <Sparkles className="w-3 h-3 text-[var(--seligo-accent)]" />
                  Match: {matchPercent(products[currentIndex])}%
                </div>
              </div>
            ) : (
              <div className="text-center p-10 bg-white rounded-[3rem] shadow-xl border border-slate-100 max-w-[280px] animate-in fade-in zoom-in">
                <div className="w-20 h-20 bg-sky-50 rounded-full flex items-center justify-center mx-auto mb-6">
                  <History className="w-10 h-10 text-sky-300" />
                </div>
                <h3 className="text-xl font-black text-slate-900 mb-2">No more items</h3>

                <p className="text-slate-500 text-sm mb-6">
                  You’ve reached the end of available items for these interests.
                </p>

                <div className="space-y-3">
                  <button
                    onClick={() => setView("interests")}
                    className="w-full py-4 bg-[var(--seligo-cta)] hover:bg-[#fb8b3a] text-white rounded-2xl font-bold shadow-lg transition-colors"
                  >
                    Change interests
                  </button>
                  <button
                    onClick={handleResetData}
                    className="w-full py-4 bg-slate-100 text-slate-900 rounded-2xl font-bold hover:bg-slate-200 transition-colors"
                  >
                    Reset passes
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Product Details Modal Overlay */}
        {selectedProduct && (
          <div className="absolute inset-0 bg-white z-[100] flex flex-col animate-in fade-in slide-in-from-bottom-10 duration-300 overflow-y-auto no-scrollbar">
            <div className="relative aspect-[4/5] w-full shrink-0">
              <img src={selectedProduct.imageUrl} className="w-full h-full object-cover" alt={selectedProduct.name} />
              <button 
                type="button"
                onClick={() => setSelectedProduct(null)} 
                className="absolute top-6 left-6 z-[260] pointer-events-auto p-3 rounded-2xl bg-[var(--seligo-cta)] text-white shadow-xl ring-1 ring-white/30 hover:bg-[#fb8b3a] active:scale-95 transition"
              >
                <ChevronLeft className="w-6 h-6" />
              </button>
              <div className="absolute inset-0 bg-gradient-to-t from-white via-transparent to-transparent pointer-events-none" />
            </div>

            <div className="px-8 pb-32 -mt-16 relative z-10">
              <div className="bg-white rounded-[2.5rem] p-8 shadow-2xl shadow-slate-200/50 border border-slate-50">
                <div className="flex justify-between items-start mb-6">
                  <div>
                    <span className="text-[10px] font-black uppercase tracking-[0.2em] text-[var(--seligo-primary)] mb-1 block">{selectedProduct.brand}</span>
                    <h2 className="text-3xl font-black text-slate-900 leading-tight">{selectedProduct.name}</h2>
                  </div>
                  <div className="text-3xl font-black text-[var(--seligo-accent)]">${selectedProduct.price}</div>
                </div>

                <div className="flex flex-wrap gap-2 mb-8">
                  {selectedProduct.tags.map(tag => (
                    <span key={tag} className="px-4 py-2 bg-slate-50 text-slate-400 rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center gap-2 border border-slate-100">
                      <Tag className="w-3 h-3" /> {tag}
                    </span>
                  ))}
                </div>

                <div className="mb-8">
                  <h3 className="text-sm font-black uppercase tracking-widest text-slate-400 mb-3">Description</h3>
                  <p className="text-slate-600 leading-relaxed font-medium">{selectedProduct.description}</p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <button 
                    onClick={() => handleAction('wishlist')}
                    className="flex flex-col items-center justify-center p-6 bg-slate-50 rounded-3xl border border-slate-100 hover:bg-sky-50 transition-all group"
                  >
                    <Bookmark className="w-8 h-8 text-slate-400 group-hover:text-[var(--seligo-primary)] mb-2" />
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Save Item</span>
                  </button>
                  <button 
                    onClick={() => handleAction('cart')}
                    className="flex flex-col items-center justify-center p-6 bg-[var(--seligo-cta)] rounded-3xl border border-orange-400 shadow-xl hover:bg-[#fb8b3a] transition-all group"
                  >
                    <ShoppingCart className="w-8 h-8 text-white mb-2" />
                    <span className="text-[10px] font-black uppercase tracking-widest text-white">Add to Bag</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {view === 'profile' && (
          <div className="absolute inset-0 bg-white z-[60] flex flex-col p-6 overflow-y-auto no-scrollbar animate-in slide-in-from-right duration-300">
            {/* Top bar */}
            <div className="flex justify-between items-center mb-8">
              <div>
                <h2 className="text-3xl font-black text-slate-900">Insights</h2>
                <div className="text-slate-500 text-sm mt-1">Your Seligo.AI style profile</div>
              </div>

              <button
                onClick={() => setView('browsing')}
                className="p-2 bg-slate-100 rounded-xl hover:bg-slate-200 transition-colors"
                aria-label="Close"
              >
                <X className="w-6 h-6 text-slate-600" />
              </button>
            </div>

            {/* Vibe card */}
            <div className="bg-[var(--seligo-primary)] rounded-[2.5rem] p-8 text-white shadow-2xl shadow-sky-200 mb-6">
              <div className="flex items-center gap-4 mb-4">
                <div className="p-3 bg-white/20 rounded-2xl backdrop-blur-md">
                  <BrainCircuit className="w-8 h-8" />
                </div>
                <div>
                  <h3 className="text-sm font-bold uppercase tracking-widest text-white/80">Detected vibe</h3>
                  <p className="text-2xl font-black">{userPrefs.persona.detectedVibe}</p>
                </div>
              </div>

              <div className="space-y-4">
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

                <div className="pt-4 border-t border-white/10 flex justify-between items-center text-sm font-bold">
                  <span className="text-white/80 uppercase tracking-widest">Price sensitivity</span>
                  <span className="uppercase">{userPrefs.persona.priceSensitivity}</span>
                </div>
              </div>
            </div>

            <div className="mb-6 bg-slate-50 border border-slate-100 rounded-3xl p-6">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs font-black uppercase tracking-widest text-slate-400">Daily streak</div>
                  <div className="text-3xl font-black text-slate-900 mt-1">
                    {streak} <span className="text-base font-bold text-slate-500">days</span>
                  </div>
                </div>

                <div className="text-right">
                  <div className="text-xs font-black uppercase tracking-widest text-slate-400">Today</div>
                  <div className="text-sm font-bold text-slate-700 mt-1">
                    {matchesToday} matches • {passesToday} passes • {savesToday} saved
                  </div>
                </div>
              </div>
            </div>

            {/* Dating-app style “compatibility” row */}
            <div className="grid grid-cols-3 gap-3 mb-8">
              <div className="bg-slate-50 rounded-3xl p-5">
                <Heart className="w-5 h-5 text-[var(--seligo-accent)] mb-2" />
                <span className="block text-2xl font-black text-slate-900">{userPrefs.likedProducts.length}</span>
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Matches</span>
              </div>

              <div className="bg-slate-50 rounded-3xl p-5">
                <History className="w-5 h-5 text-slate-400 mb-2" />
                <span className="block text-2xl font-black text-slate-900">{userPrefs.dislikedProducts.length}</span>
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Passes</span>
              </div>

              <div className="bg-slate-50 rounded-3xl p-5">
                <ShoppingBag className="w-5 h-5 text-[var(--seligo-cta)] mb-2" />
                <span className="block text-2xl font-black text-slate-900">
                  {userPrefs.wishlist.length + userPrefs.cart.length}
                </span>
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Saved</span>
              </div>
            </div>

            {/* Next picks (dating app vibe) */}
            <div className="mb-8 bg-slate-50 border border-slate-100 rounded-3xl p-6">
              <div className="text-xs font-black uppercase tracking-widest text-slate-400 mb-2">Next picks</div>
              <div className="text-slate-800 font-bold">
                We’ll show you more of{" "}
                <span className="text-[var(--seligo-primary)]">
                  {liked[0] ? liked[0] : "your top styles"}
                </span>
                {liked[1] ? (
                  <>
                    {" "}and{" "}
                    <span className="text-[var(--seligo-primary)]">{liked[1]}</span>
                  </>
                ) : null}
                .
              </div>
              <div className="text-slate-500 text-sm mt-2">
                Keep matching to refine your feed.
              </div>
            </div>

            {/* Your Type */}
            <div className="mb-8">
              <h3 className="font-black text-lg mb-3 text-slate-900">Your Type</h3>
              <div className="flex flex-wrap gap-2">
                {liked.length ? liked.map((t) => (
                  <span
                    key={t}
                    className="px-4 py-2 bg-emerald-50 text-emerald-700 rounded-xl text-xs font-bold"
                  >
                    {t}
                  </span>
                )) : (
                  <span className="text-slate-400 italic text-sm">
                    Match a few items to build your type.
                  </span>
                )}
              </div>
            </div>

            {/* Your Spaces */}
            <div className="mb-8">
              <h3 className="font-black text-lg mb-3 text-slate-900">Your Spaces</h3>
              <div className="flex flex-wrap gap-2">
                {topRooms.length ? topRooms.map((t) => (
                  <span
                    key={t}
                    className="px-4 py-2 bg-sky-50 text-[var(--seligo-primary)] rounded-xl text-xs font-bold"
                  >
                    {t}
                  </span>
                )) : (
                  <span className="text-slate-400 italic text-sm">No room preferences detected yet.</span>
                )}
              </div>
            </div>

            {/* Your Categories */}
            <div className="mb-10">
              <h3 className="font-black text-lg mb-3 text-slate-900">Your Categories</h3>
              <div className="flex flex-wrap gap-2">
                {topCategories.length ? topCategories.map((t) => (
                  <span
                    key={t}
                    className="px-4 py-2 bg-sky-50 text-[var(--seligo-primary)] rounded-xl text-xs font-bold"
                  >
                    {t}
                  </span>
                )) : (
                  <span className="text-slate-400 italic text-sm">No category preferences detected yet.</span>
                )}
              </div>
            </div>

            <div className="mb-12">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-black text-lg text-slate-900">Dealbreakers</h3>

                {blockedTags.length > 0 && (
                  <button
                    onClick={clearBlockedTags}
                    className="text-xs font-black uppercase tracking-widest text-slate-500 hover:text-slate-700"
                  >
                    Clear hidden
                  </button>
                )}
              </div>

              <div className="text-slate-500 text-sm mb-3">
                Tap a tag to hide it from your feed.
              </div>

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

            {/* Actions */}
            <div className="mt-auto pt-2">
              <button
                onClick={shareLink}
                className="w-full py-4 rounded-2xl bg-[var(--seligo-cta)] hover:bg-[#fb8b3a] text-white font-black mb-4"
              >
                Share Seligo.AI
              </button>

              <button
                onClick={() => setHowOpen(true)}
                className="w-full py-4 rounded-2xl bg-slate-100 text-slate-900 font-black mb-4"
              >
                How it works
              </button>

              <button
                onClick={handleResetData}
                className="w-full py-5 bg-rose-50 text-rose-500 border border-rose-100 rounded-[2rem] font-black uppercase tracking-widest text-xs flex items-center justify-center gap-2 hover:bg-rose-100 transition-colors"
              >
                <RotateCcw className="w-4 h-4" /> Reset My Data
              </button>
            </div>
          </div>
        )}

        {view === 'cart' && (
          <div className="absolute inset-0 bg-white z-[60] flex flex-col animate-in slide-in-from-bottom duration-300">
            <div className="p-6 flex justify-between items-center border-b border-slate-100">
              <h2 className="text-2xl font-black">Shopping Bag</h2>
              <button onClick={() => setView('browsing')} className="p-2 -mr-2 text-slate-400 hover:text-slate-600 transition-colors"><X className="w-6 h-6" /></button>
            </div>
            
            <div className="flex-grow overflow-y-auto no-scrollbar p-6">
              {(userPrefs.cart.length + userPrefs.wishlist.length) > 0 ? (
                <div className="space-y-8">
                  {userPrefs.cart.length > 0 && (
                    <div>
                      <h3 className="text-xs font-black uppercase tracking-widest text-slate-400 mb-4">In Bag</h3>
                      <div className="space-y-6">
                        {userPrefs.cart.map((item, idx) => (
                          <div key={`${item.id}-${idx}`} className="flex gap-4 group">
                            <img src={item.imageUrl} className="w-20 h-20 rounded-2xl object-cover shadow-md" />
                            <div className="flex-grow py-1">
                              <h4 className="font-black text-slate-900 leading-tight">{item.name}</h4>
                              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{item.brand}</p>
                              <div className="flex justify-between items-center mt-2">
                                <span className="font-black text-[var(--seligo-primary)]">${item.price}</span>
                                <button onClick={() => setUserPrefs(prev => ({...prev, cart: prev.cart.filter((_, i) => i !== idx)}))} className="text-slate-300 hover:text-rose-500 transition-colors p-1">
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
                      <h3 className="text-xs font-black uppercase tracking-widest text-slate-400 mb-4">Saved for Later</h3>
                      <div className="space-y-6 opacity-80">
                        {userPrefs.wishlist.map((item, idx) => (
                          <div key={`${item.id}-${idx}-wish`} className="flex gap-4">
                            <img src={item.imageUrl} className="w-16 h-16 rounded-xl object-cover grayscale-[20%]" />
                            <div className="flex-grow py-1">
                              <h4 className="font-bold text-slate-800 text-sm">{item.name}</h4>
                              <div className="flex justify-between items-center mt-1">
                                <span className="font-bold text-slate-500 text-xs">${item.price}</span>
                                <div className="flex gap-3">
                                  <button
                                    onClick={() => {
                                      const itemToMove = userPrefs.wishlist[idx];
                                      if (!itemToMove) return;

                                      // update local state
                                      setUserPrefs((prev) => ({
                                        ...prev,
                                        wishlist: prev.wishlist.filter((_, i) => i !== idx),
                                        cart: [...prev.cart, itemToMove],
                                      }));

                                      // persist + analytics (fire-and-forget)
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
                                    className="text-[var(--seligo-primary)] font-black text-[10px] uppercase tracking-widest hover:underline"
                                  >
                                    Move to Bag
                                  </button>
                                  <button onClick={() => setUserPrefs(prev => ({...prev, wishlist: prev.wishlist.filter((_, i) => i !== idx)}))} className="text-slate-300 hover:text-rose-500 transition-colors"><X className="w-3 h-3" /></button>
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
                <div className="text-center py-24 text-slate-400">
                  <ShoppingBag className="w-16 h-16 mx-auto mb-4 opacity-10" />
                  <p className="font-bold">Your bag is empty.</p>
                </div>
              )}
            </div>

            <div className="p-8 border-t border-slate-100 bg-white">
               <div className="flex justify-between items-center mb-6">
                  <span className="font-bold text-slate-400 uppercase tracking-widest text-xs">Subtotal</span>
                  <span className="text-3xl font-black text-slate-900">${userPrefs.cart.reduce((s, i) => s + i.price, 0).toFixed(2)}</span>
               </div>
               <button
                 onClick={() => {
                   setLeadEmail("");
                   setLeadError("");
                   setLeadStatus("idle");
                   setShowCheckout(true);
                 }}
                 className="w-full py-5 bg-[var(--seligo-cta)] hover:bg-[#fb8b3a] text-white rounded-[2rem] font-black text-xl shadow-2xl transition-all active:scale-95 disabled:opacity-50"
                 disabled={userPrefs.cart.length === 0}
               >
                 Checkout
               </button>
            </div>
          </div>
        )}
      </main>

      <CheckoutLinksModal
        open={showCheckout}
        onClose={() => setShowCheckout(false)}
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

      {/* Modern Navigation Bar */}
      <nav className="shrink-0 sticky bottom-0 relative bg-white/80 backdrop-blur-xl border-t border-slate-100 px-8 py-4 flex justify-between items-center z-[250]">
        <button onClick={() => setView('browsing')} className={`flex flex-col items-center gap-1 transition-all ${view === 'browsing' ? 'text-[var(--seligo-primary)] scale-110' : 'text-slate-300'}`}>
          <Compass className="w-6 h-6" />
          <span className="text-[9px] font-black uppercase tracking-[0.2em]">Explore</span>
        </button>
        <button onClick={() => setView('profile')} className={`flex flex-col items-center gap-1 transition-all ${view === 'profile' ? 'text-[var(--seligo-primary)] scale-110' : 'text-slate-300'}`}>
          <BrainCircuit className="w-6 h-6" />
          <span className="text-[9px] font-black uppercase tracking-[0.2em]">Insights</span>
        </button>
        <button onClick={() => setView('cart')} className={`flex flex-col items-center gap-1 transition-all ${view === 'cart' ? 'text-[var(--seligo-primary)] scale-110' : 'text-slate-300'}`}>
          <div className="relative">
            <ShoppingBag className="w-6 h-6" />
            {(userPrefs.cart.length + userPrefs.wishlist.length) > 0 && (
              <span className="absolute -top-1 -right-1 w-3 h-3 bg-[var(--seligo-primary)] rounded-full border-2 border-white" />
            )}
          </div>
          <span className="text-[9px] font-black uppercase tracking-[0.2em]">Bag</span>
        </button>
      </nav>
      </div>
      </div>
    </div>
  );
};

export default App;
