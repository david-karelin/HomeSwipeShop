import * as Firestore from "./firestoreService";
import React, { useState, useEffect, useRef } from 'react';
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
  const swipedRef = useRef<Set<string>>(new Set());
  const refineLockRef = useRef(false);

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

  const handleResetData = () => {
    if (confirm("Are you sure? This will clear your style persona and all saved items.")) {
      localStorage.clear();
      setUserPrefs(DEFAULT_PREFS);
      setProducts([]);
      setCurrentIndex(0);
      setView('auth');
    }
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
    if (userPrefs.interests.length === 0) return;

    setIsLoading(true);
    try {
      // reset paging + feed
      setCursor(null);
      setHasMore(true);
      setCurrentIndex(0);

      const page = await Firestore.fetchProductsByInterestsPage(userPrefs.interests, 30, null);
      const swipes = await Firestore.fetchMySwipes();
      swipedRef.current = new Set(swipes.map((s: any) => s.id));

      setProducts(page.items.filter(p => !swipedRef.current.has(p.id)));
      setCursor(page.cursor);
      setHasMore(page.hasMore);
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
      const ranked = [...page.items].sort((a, b) => scoreProduct(b) - scoreProduct(a));

      setProducts(prev => {
        const seen = new Set(prev.map(p => p.id));
        const unique = ranked
          .filter(p => !seen.has(p.id))
          .filter(p => !swipedRef.current.has(p.id));
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

    const remaining = products.length - currentIndex;

    // when user has 5 cards left, fetch more
    if (remaining <= 5) {
      refineRecommendations();
    }
  }, [view, currentIndex, products.length]);

  const liked = topTags(tagScores, 1, 5);
  const avoided = topTags(tagScores, -1, 5);
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
      <div className="min-h-screen bg-indigo-600 flex flex-col items-center justify-center p-6 text-white">
        <div className="mb-12 text-center animate-in fade-in zoom-in duration-500">
          <div className="w-24 h-24 bg-white/20 backdrop-blur-xl rounded-[2.5rem] flex items-center justify-center mx-auto mb-6 shadow-2xl border border-white/20">
            <ShoppingBag className="w-12 h-12" />
          </div>
          <h1 className="text-5xl font-black mb-2 tracking-tighter">SwipeShop</h1>
          <p className="text-indigo-100 font-medium opacity-80 text-lg italic">The AI knows your style.</p>
        </div>
        <div className="w-full max-sm:px-4 space-y-4">
          <button onClick={handleLogin} className="w-full py-5 bg-white text-indigo-600 rounded-3xl font-black text-xl hover:scale-[1.02] active:scale-95 transition-all shadow-xl">Get Started</button>
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
                  ? 'border-indigo-600 bg-white text-indigo-600 shadow-lg shadow-indigo-100'
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
            userPrefs.interests.length >= 1 ? 'bg-indigo-600 text-white shadow-2xl' : 'bg-slate-200 text-slate-400'
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
                    <Activity className="w-3 h-3 text-emerald-500" /> {interest?.label}
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
      <header className="shrink-0 px-6 py-5 bg-white/90 backdrop-blur-xl z-50 flex justify-between items-center border-b border-slate-100">
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-200">
              <ShoppingBag className="w-5 h-5 text-white" />
            </div>
            {isAlgorithmRunning && (
              <div className="absolute -top-1 -right-1 w-4 h-4 bg-emerald-500 rounded-full flex items-center justify-center animate-pulse border-2 border-white">
                <BrainCircuit className="w-2 h-2 text-white" />
              </div>
            )}
          </div>
          <div>
            <span className="block font-black text-lg leading-tight text-slate-900">SwipeShop</span>
            <span className="block text-[10px] font-bold uppercase tracking-widest text-emerald-500">
              {isAlgorithmRunning ? 'Algorithm Refining...' : 'ML Active'}
            </span>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setView('cart')} className="w-11 h-11 bg-slate-50 rounded-xl flex items-center justify-center text-slate-400 relative hover:text-indigo-600 transition-colors">
            <ShoppingBag className="w-5 h-5" />
            {(userPrefs.cart.length + userPrefs.wishlist.length) > 0 && (
              <span className="absolute -top-1 -right-1 w-5 h-5 bg-indigo-600 text-white text-[10px] flex items-center justify-center rounded-full font-bold border-2 border-white">
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
                  <Sparkles className="w-3 h-3 text-emerald-500" />
                  Match: {matchPercent(products[currentIndex])}%
                </div>
              </div>
            ) : (
              <div className="text-center p-10 bg-white rounded-[3rem] shadow-xl border border-slate-100 max-w-[280px] animate-in fade-in zoom-in">
                <div className="w-20 h-20 bg-indigo-50 rounded-full flex items-center justify-center mx-auto mb-6">
                  {hasMore && isAlgorithmRunning ? (
                    <Loader2 className="w-10 h-10 text-indigo-300 animate-spin" />
                  ) : (
                    <History className="w-10 h-10 text-indigo-300" />
                  )}
                </div>
                <h3 className="text-xl font-black text-slate-900 mb-2">
                  {hasMore ? (isAlgorithmRunning ? "Loading more..." : "Finding more...") : "No more products"}
                </h3>

                <p className="text-slate-500 text-sm mb-8">
                  {hasMore
                    ? "Generating new products based on your latest matches..."
                    : "You’ve reached the end of the catalog for these interests. Try selecting more interests or reseed more products."}
                </p>

                {!hasMore && (
                  <button
                    onClick={() => setView("interests")}
                    className="w-full py-4 bg-indigo-600 text-white rounded-2xl font-bold shadow-lg shadow-indigo-100 hover:bg-indigo-700 transition-colors"
                  >
                    Choose More Interests
                  </button>
                )}
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
                className="absolute top-6 left-6 z-50 pointer-events-auto p-3 bg-white/20 backdrop-blur-xl rounded-2xl border border-white/20 text-white hover:bg-white/40 transition-all"
              >
                <ChevronLeft className="w-6 h-6" />
              </button>
              <div className="absolute inset-0 bg-gradient-to-t from-white via-transparent to-transparent pointer-events-none" />
            </div>

            <div className="px-8 pb-32 -mt-16 relative z-10">
              <div className="bg-white rounded-[2.5rem] p-8 shadow-2xl shadow-slate-200/50 border border-slate-50">
                <div className="flex justify-between items-start mb-6">
                  <div>
                    <span className="text-[10px] font-black uppercase tracking-[0.2em] text-indigo-600 mb-1 block">{selectedProduct.brand}</span>
                    <h2 className="text-3xl font-black text-slate-900 leading-tight">{selectedProduct.name}</h2>
                  </div>
                  <div className="text-3xl font-black text-emerald-500">${selectedProduct.price}</div>
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
                    className="flex flex-col items-center justify-center p-6 bg-slate-50 rounded-3xl border border-slate-100 hover:bg-indigo-50 transition-all group"
                  >
                    <Bookmark className="w-8 h-8 text-slate-400 group-hover:text-indigo-600 mb-2" />
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Save Item</span>
                  </button>
                  <button 
                    onClick={() => handleAction('cart')}
                    className="flex flex-col items-center justify-center p-6 bg-indigo-600 rounded-3xl border border-indigo-400 shadow-xl shadow-indigo-100 hover:bg-indigo-700 transition-all group"
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
            <div className="flex justify-between items-center mb-8">
              <h2 className="text-3xl font-black text-slate-900">Your Insights</h2>
              <button onClick={() => setView('browsing')} className="p-2 bg-slate-100 rounded-xl hover:bg-slate-200 transition-colors"><X className="w-6 h-6 text-slate-600" /></button>
            </div>

            <div className="bg-indigo-600 rounded-[2.5rem] p-8 text-white shadow-2xl shadow-indigo-200 mb-8">
              <div className="flex items-center gap-4 mb-4">
                <div className="p-3 bg-white/20 rounded-2xl backdrop-blur-md">
                  <BrainCircuit className="w-8 h-8" />
                </div>
                <div>
                  <h3 className="text-sm font-bold uppercase tracking-widest text-indigo-200">Detected Vibe</h3>
                  <p className="text-2xl font-black">{userPrefs.persona.detectedVibe}</p>
                </div>
              </div>
              <div className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  {userPrefs.persona.styleKeywords.map(k => (
                    <span key={k} className="px-3 py-1 bg-white/10 rounded-full text-xs font-bold border border-white/20">{k}</span>
                  ))}
                </div>
                <div className="pt-4 border-t border-white/10 flex justify-between items-center text-sm font-bold">
                   <span className="text-indigo-200 uppercase tracking-widest">Price Sensitivity</span>
                   <span className="uppercase">{userPrefs.persona.priceSensitivity}</span>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 mb-8">
               <div className="bg-slate-50 rounded-3xl p-6">
                  <Heart className="w-6 h-6 text-pink-500 mb-2" />
                  <span className="block text-2xl font-black text-slate-900">{userPrefs.likedProducts.length}</span>
                  <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Matches</span>
               </div>
               <div className="bg-slate-50 rounded-3xl p-6">
                  <History className="w-6 h-6 text-slate-400 mb-2" />
                  <span className="block text-2xl font-black text-slate-900">{userPrefs.dislikedProducts.length}</span>
                  <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Passes</span>
               </div>
            </div>

            <div className="mb-8">
              <h3 className="font-black text-lg mb-4 text-slate-900">Style Keywords</h3>
              <div className="flex flex-wrap gap-2">
                {liked.length ? liked.map(t => (
                  <span key={t} className="px-4 py-2 bg-emerald-50 text-emerald-600 rounded-xl text-xs font-bold">
                    {t}
                  </span>
                )) : (
                  <span className="text-slate-400 italic text-sm">Like a few items to build your style profile.</span>
                )}
              </div>
            </div>

            <div className="mb-8">
              <h3 className="font-black text-lg mb-4 text-slate-900">Top Rooms</h3>
              <div className="flex flex-wrap gap-2">
                {topRooms.length ? topRooms.map(t => (
                  <span key={t} className="px-4 py-2 bg-indigo-50 text-indigo-600 rounded-xl text-xs font-bold">
                    {t}
                  </span>
                )) : (
                  <span className="text-slate-400 italic text-sm">No room preferences detected yet.</span>
                )}
              </div>
            </div>

            <div className="mb-8">
              <h3 className="font-black text-lg mb-4 text-slate-900">Top Categories</h3>
              <div className="flex flex-wrap gap-2">
                {topCategories.length ? topCategories.map(t => (
                  <span key={t} className="px-4 py-2 bg-sky-50 text-sky-600 rounded-xl text-xs font-bold">
                    {t}
                  </span>
                )) : (
                  <span className="text-slate-400 italic text-sm">No category preferences detected yet.</span>
                )}
              </div>
            </div>

            <div className="mb-12">
              <h3 className="font-black text-lg mb-4 text-slate-900">Avoidance Logic</h3>
              <div className="flex flex-wrap gap-2">
                {avoided.length ? avoided.map(t => (
                  <span key={t} className="px-4 py-2 bg-rose-50 text-rose-600 rounded-xl text-xs font-bold flex items-center gap-2">
                    <X className="w-3 h-3" /> {t}
                  </span>
                )) : (
                  <span className="text-slate-400 italic text-sm">Keep swiping to teach the AI what you dislike.</span>
                )}
              </div>
            </div>

            <div className="mt-auto pt-8">
              <button
                onClick={() => setHowOpen(true)}
                className="w-full py-3 rounded-2xl bg-slate-100 text-slate-900 font-black mb-4"
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
                                <span className="font-black text-indigo-600">${item.price}</span>
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
                                    className="text-indigo-600 font-black text-[10px] uppercase tracking-widest hover:underline"
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
                 className="w-full py-5 bg-indigo-600 text-white rounded-[2rem] font-black text-xl shadow-2xl shadow-indigo-100 hover:bg-indigo-700 transition-all active:scale-95 disabled:opacity-50"
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
      <nav className="shrink-0 sticky bottom-0 relative bg-white/80 backdrop-blur-xl border-t border-slate-100 px-8 py-4 flex justify-between items-center z-[55]">
        <button onClick={() => setView('browsing')} className={`flex flex-col items-center gap-1 transition-all ${view === 'browsing' ? 'text-indigo-600 scale-110' : 'text-slate-300'}`}>
          <Compass className="w-6 h-6" />
          <span className="text-[9px] font-black uppercase tracking-[0.2em]">Explore</span>
        </button>
        <button onClick={() => setView('profile')} className={`flex flex-col items-center gap-1 transition-all ${view === 'profile' ? 'text-indigo-600 scale-110' : 'text-slate-300'}`}>
          <BrainCircuit className="w-6 h-6" />
          <span className="text-[9px] font-black uppercase tracking-[0.2em]">Insights</span>
        </button>
        <button onClick={() => setView('cart')} className={`flex flex-col items-center gap-1 transition-all ${view === 'cart' ? 'text-indigo-600 scale-110' : 'text-slate-300'}`}>
          <div className="relative">
            <ShoppingBag className="w-6 h-6" />
            {(userPrefs.cart.length + userPrefs.wishlist.length) > 0 && (
              <span className="absolute -top-1 -right-1 w-3 h-3 bg-indigo-600 rounded-full border-2 border-white" />
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
