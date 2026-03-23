import * as Firestore from "./firestoreService";
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Product, UserPreferences, AppState, UserPersona } from './types';
import * as Backend from './backendService';
import {
  getProductRetailerName,
  getResolvedPurchaseUrl,
  type RetailerLinkOptions,
} from './retailerLinks';
import {
  getRetailerClickSource,
  normalizeRetailerPlacement,
  shouldIncludeCheckoutOpen,
  type ProductOverlayContext,
  type ProductOverlaySource,
  type RetailerClickSource,
} from './src/lib/retailerClicks';
import SwipeCard from './components/SwipeCard';
import CheckoutLinksModal from './components/CheckoutLinksModal';
import AdminScreen from './src/components/AdminScreen';
import HowItWorksModal from './src/components/HowItWorksModal';
import { onboardingCopy } from './src/content/copy';
import InterestsPage from './src/pages/InterestsPage';
import { AFFILIATE_DISCLOSURE_TEXT } from './src/lib/affiliateConfig';
import { VIBE_CATEGORIES, normalizeInterestIds } from './src/constants';
import { logDiscoveryDebug, logDiscoveryStage, logRoomScanDebug, warnDiscoveryStage } from './src/lib/debug';
import { prepareSwipeFeed, prioritizeMainFeedInventory } from './src/lib/feed';
import { filterLaunchCatalogProducts } from './src/lib/launchCatalog';
import RoomScanPage from './src/pages/RoomScanPage';
import type { UTM } from './src/lib/utm';
import type { RoomScanAnalysis } from './src/services/localRoomScan';
import seligoLogo from './src/assets/seligo-logo-primary-0EA5E9.png';
import { 
  Search, 
  ShoppingBag, 
  Heart, 
  Compass, 
  User, 
  ArrowRight, 
  Loader2, 
  Plus, 
  ArrowLeft, 
  X, 
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

type RetailerClickDefaults = Required<Pick<RetailerLinkOptions, 'source' | 'view' | 'placement'>>;

type ActionToast =
  | {
      type: "save" | "bag" | "undo";
      label: string;
      actionLabel?: string;
      onAction?: () => void;
    }
  | null;

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

const INTEREST_IDS = new Set<string>(VIBE_CATEGORIES.map((category) => category.id));

const normalizeFeedInterestIds = (interestIds: string[]) =>
  normalizeInterestIds(interestIds).filter((interestId): interestId is string => INTEREST_IDS.has(interestId));

const mapVibeCategoriesToInterests = (selectedIds: string[]) =>
  normalizeFeedInterestIds(selectedIds).slice(0, 10);

const deriveSelectedVibeCategories = (interestIds: string[]) =>
  normalizeFeedInterestIds(interestIds);

const isVibeTag = (t: string) => VIBE_TAGS.has(t);
const isRoomTag = (t: string) => ROOM_TAGS.has(t);

function readEmailAttribution(): { utm?: UTM; sid?: string } {
  const params = new URLSearchParams(window.location.search);

  const utm: UTM = {};
  const keys: Array<keyof UTM> = [
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_content",
    "utm_term",
    "gclid",
    "fbclid",
  ];

  for (const k of keys) {
    const v = params.get(k);
    if (v) (utm as any)[k] = v;
  }

  const sid = params.get("sid") ?? undefined;
  const hasUtm = Object.keys(utm).length > 0;

  return { utm: hasUtm ? utm : undefined, sid };
}

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
        <div className="text-2xl font-extrabold text-slate-900">Privacy Policy</div>
        <div className="text-sm text-slate-500 mt-1">How Seligo collects and uses information</div>
      </div>
      <button onClick={onBack} className="h-10 w-10 rounded-2xl bg-slate-100 flex items-center justify-center">
        <X className="h-5 w-5 text-slate-600" />
      </button>
    </div>

    <div className="space-y-5 pb-32">
      <section className="rounded-[1.5rem] border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-base font-black text-slate-900">Information we collect</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          Seligo may collect basic usage information such as page views, product interactions,
          swipes, saves, shortlist activity, outbound retailer clicks, device and browser
          information, and any contact information you choose to submit.
        </p>
      </section>

      <section className="rounded-[1.5rem] border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-base font-black text-slate-900">How we use information</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          We use this information to improve the Seligo experience, understand product usage,
          maintain app performance, and support features such as saved items and optional
          communications.
        </p>
      </section>

      <section className="rounded-[1.5rem] border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-base font-black text-slate-900">Third-party services</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          Seligo may use services such as Firebase, Vercel Analytics, and external retailer
          websites. Purchases are completed on third-party retailer sites, not within Seligo.
        </p>
      </section>

      <section className="rounded-[1.5rem] border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-base font-black text-slate-900">Data sharing</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          We do not sell personal data. If you submit your email for updates, it is stored for
          that purpose only.
        </p>
      </section>
    </div>
  </div>
);

const TermsScreen = ({ onBack }: { onBack: () => void }) => (
  <div className="p-6 bg-white min-h-full">
    <div className="flex items-start justify-between mb-6">
      <div>
        <div className="text-2xl font-extrabold text-slate-900">Terms of Use</div>
        <div className="text-sm text-slate-500 mt-1">Using Seligo</div>
      </div>
      <button onClick={onBack} className="h-10 w-10 rounded-2xl bg-slate-100 flex items-center justify-center">
        <X className="h-5 w-5 text-slate-600" />
      </button>
    </div>

    <div className="space-y-5 pb-32">
      <section className="rounded-[1.5rem] border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-base font-black text-slate-900">Service description</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          Seligo provides product discovery and links to third-party retailers. Seligo does not
          directly sell products.
        </p>
      </section>

      <section className="rounded-[1.5rem] border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-base font-black text-slate-900">Third-party purchases</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          Product availability, pricing, and policies are controlled by the retailer. Purchases
          are completed on third-party retailer sites.
        </p>
      </section>

      <section className="rounded-[1.5rem] border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-base font-black text-slate-900">Disclaimer</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          Use at your own discretion. Seligo is provided "as is" without warranties of any kind.
        </p>
      </section>
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

    <div className="space-y-5 pb-32">
      <section className="rounded-[1.5rem] border border-slate-200 bg-white p-4 shadow-sm">
        <p className="text-sm leading-6 text-slate-600">
          Seligo may earn a commission from qualifying purchases made through some retailer links,
          at no extra cost to you.
        </p>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          As an Amazon Associate, Seligo earns from qualifying purchases.
        </p>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          These links do not change the price you pay.
        </p>
      </section>
    </div>
  </div>
);

const AboutScreen = ({ onBack }: { onBack: () => void }) => (
  <div className="p-6 bg-white min-h-full">
    <div className="flex items-start justify-between mb-6">
      <div>
        <div className="text-2xl font-extrabold text-slate-900">About Seligo</div>
        <div className="text-sm text-slate-500 mt-1">How Seligo works</div>
      </div>
      <button onClick={onBack} className="h-10 w-10 rounded-2xl bg-slate-100 flex items-center justify-center">
        <X className="h-5 w-5 text-slate-600" />
      </button>
    </div>

    <div className="space-y-5 pb-32">
      <section className="rounded-[1.5rem] border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-base font-black text-slate-900">Discover faster</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          Seligo helps you discover home décor with swipe-style browsing, saved shortlists,
          and room-inspired shopping.
        </p>
      </section>

      <section className="rounded-[1.5rem] border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-base font-black text-slate-900">Save what you like</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          Save products you like, review them later in your shortlist, and compare options more easily.
        </p>
      </section>

      <section className="rounded-[1.5rem] border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-base font-black text-slate-900">Shop through retailers</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          Seligo does not directly sell products. When you are ready, you can open retailer links
          and complete your purchase on third-party sites.
        </p>
      </section>
    </div>
  </div>
);

const ContactScreen = ({ onBack }: { onBack: () => void }) => (
  <div className="p-6 bg-white min-h-full">
    <div className="flex items-start justify-between mb-6">
      <div>
        <div className="text-2xl font-extrabold text-slate-900">Contact</div>
        <div className="text-sm text-slate-500 mt-1">Questions, feedback, or broken links</div>
      </div>
      <button onClick={onBack} className="h-10 w-10 rounded-2xl bg-slate-100 flex items-center justify-center">
        <X className="h-5 w-5 text-slate-600" />
      </button>
    </div>

    <div className="space-y-5 pb-32">
      <section className="rounded-[1.5rem] border border-slate-200 bg-white p-4 shadow-sm">
        <p className="text-sm leading-6 text-slate-600">
          Reach us at: <a href="mailto:davidkarelin3@gmail.com" className="font-semibold text-[var(--seligo-primary)] underline">davidkarelin3@gmail.com</a>
        </p>
      </section>
    </div>
  </div>
);

const App: React.FC = () => {
  type LeadSource = "cart_confirm" | "post_buy_panel" | "roomscan";
  const adminEnabled =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("admin") === "1";
  const openRoomscanEnabled =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("open") === "roomscan";
  const [view, setView] = useState<AppState>("auth");
  const [userPrefs, setUserPrefs] = useState<UserPreferences>(DEFAULT_PREFS);
  const [allProducts, setAllProducts] = useState<Product[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isAlgorithmRunning, setIsAlgorithmRunning] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [selectedProductContext, setSelectedProductContext] = useState<ProductOverlayContext | null>(null);
  const [descOpen, setDescOpen] = useState(false);
  const [returnToCheckout, setReturnToCheckout] = useState(false);
  const [discoveryStep, setDiscoveryStep] = useState(0);
  const [cursor, setCursor] = useState<any>(null);
  const [hasMore, setHasMore] = useState(true);
  const [showCheckout, setShowCheckout] = useState(false);
  const [showSavedSheet, setShowSavedSheet] = useState(false);
  const [showBagSheet, setShowBagSheet] = useState(false);
  const [actionToast, setActionToast] = useState<ActionToast>(null);
  const [leadEmail, setLeadEmail] = useState("");
  const [leadStatus, setLeadStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [leadError, setLeadError] = useState<string>("");
  const [showHowItWorks, setShowHowItWorks] = useState(false);
  const [tagScores, setTagScores] = useState<TagScores>(() => loadTagScores());
  const [activityLog, setActivityLog] = useState<LocalActivity[]>(() => loadActivity());
  const [blockedTags, setBlockedTags] = useState<string[]>(() => loadBlockedTags());
  const [roomScanPicks, setRoomScanPicks] = useState<RoomScanPick[]>([]);
  const [roomScanPickStatus, setRoomScanPickStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [undoCount, setUndoCount] = useState(0);
  const [postBuyLeadOpen, setPostBuyLeadOpen] = useState(false);
  const [roomscanLeadRequestNonce, setRoomscanLeadRequestNonce] = useState(0);
  const [leadSource, setLeadSource] = useState<LeadSource>("post_buy_panel");
  const leadSourceRef = useRef<LeadSource>("post_buy_panel");
  const swipedRef = useRef<Set<string>>(new Set());
  const impressedRef = useRef<Set<string>>(new Set());
  const undoRef = useRef<UndoEntry[]>([]);
  const roomScanImpressedRef = useRef<Set<string>>(new Set());
  const refineLockRef = useRef(false);
  const actionToastTimeoutRef = useRef<number | null>(null);
  const prevViewRef = useRef(view);
  const productOverlayScrollRef = useRef<HTMLDivElement | null>(null);
  const blockedSet = useMemo(() => new Set(blockedTags), [blockedTags]);

  // Reset scroll to top when product overlay opens
  useEffect(() => {
    if (!selectedProduct) return;
    productOverlayScrollRef.current?.scrollTo({ top: 0, behavior: "auto" });
  }, [selectedProduct]);

  const resetImpressions = () => {
    impressedRef.current = new Set();
  };

  const sanitizeUtm = (obj: any) => {
    const allowed = new Set(["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "gclid", "fbclid"]);
    const out: any = {};
    for (const k of Object.keys(obj || {})) {
      if (allowed.has(k)) out[k] = obj[k];
    }
    return out;
  };

  const showActionToast = (
    type: NonNullable<ActionToast>["type"],
    label: string,
    opts?: { actionLabel?: string; onAction?: () => void }
  ) => {
    if (typeof window === "undefined") {
      setActionToast({ type, label, actionLabel: opts?.actionLabel, onAction: opts?.onAction });
      return;
    }

    if (actionToastTimeoutRef.current) {
      window.clearTimeout(actionToastTimeoutRef.current);
    }

    setActionToast({
      type,
      label,
      actionLabel: opts?.actionLabel,
      onAction: opts?.onAction,
    });
    actionToastTimeoutRef.current = window.setTimeout(() => {
      setActionToast((current) =>
        current?.type === type && current?.label === label ? null : current
      );
      actionToastTimeoutRef.current = null;
    }, 2200);
  };

  const showRetailerLinkUnavailableToast = () => {
    showActionToast("undo", "Retailer link unavailable");
  };

  const openSavedSheet = () => {
    setShowBagSheet(false);
    setShowSavedSheet(true);
    void Firestore.logEvent({
      type: "view_change",
      view: "browsing",
      source: "header",
    }).catch(console.warn);
  };

  const openBagSheet = () => {
    setShowSavedSheet(false);
    setShowBagSheet(true);
    void Firestore.logEvent({
      type: "view_change",
      view: "browsing",
      source: "header",
    }).catch(console.warn);
  };

  const openSavedProduct = (product: Product) => {
    setShowSavedSheet(false);
    openProductOverlay(product, { view: "browsing", source: "saved_sheet" });
  };

  const openBagProduct = (product: Product) => {
    setShowBagSheet(false);
    openProductOverlay(product, { view: "browsing", source: "bag_sheet" });
  };

  const openShortlistProduct = (
    product: Product,
    source: Extract<ProductOverlaySource, "shortlist_bag" | "shortlist_saved">
  ) => {
    openProductOverlay(product, { view: "cart", source });
  };

  const continueToCheckout = () => {
    setShowBagSheet(false);
    setShowCheckout(true);

    void Firestore.logEvent({
      type: "view_change",
      view: "checkout",
      source: "bag_sheet",
    }).catch(console.warn);
  };

  const goView = (next: AppState, source = "nav") => {
    setShowSavedSheet(false);
    setShowBagSheet(false);
    setView(next);
    void Firestore.logEvent({ type: "view_change", source, view: next }).catch(console.warn);
  };

  useEffect(() => {
    return () => {
      if (actionToastTimeoutRef.current && typeof window !== "undefined") {
        window.clearTimeout(actionToastTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (adminEnabled) {
      setView("admin");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const nextView = sp.get("view");
    const openWhat = sp.get("open");
    const sid = sp.get("sid") || null;

    const cameFromEmail =
      (sp.get("utm_source") || "").toLowerCase() === "email" &&
      (sp.get("utm_medium") || "").toLowerCase() === "lead";

    if (openWhat === "roomscan") {
      setView("roomscan");
    }

    if (nextView === "cart") {
      setView("cart");

      if (openWhat === "checkout") {
        setLeadEmail("");
        setLeadError("");
        setLeadStatus("idle");
        setShowCheckout(true);

        if (cameFromEmail) {
          const key = `seligo_email_open_checkout_${sid ?? "nosid"}`;
          if (!sessionStorage.getItem(key)) {
            sessionStorage.setItem(key, "1");
            void Firestore.logEvent({
              type: "view_change",
              view: "checkout",
              source: "email",
              meta: {
                panel: "email_return_open_checkout",
                sid,
                sidMissing: sid ? 0 : 1,
              },
            }).catch(console.warn);
          }
        }
      }
    }
  }, []);

  useEffect(() => {
    if (view === "admin" && !adminEnabled) {
      goView("profile", "admin_blocked");
    }
  }, [view, adminEnabled]);

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
    const { utm, sid } = readEmailAttribution();

    if (!utm && !sid) return;

    const utmObj = utm ?? {};
    const key = `seligo_email_return_logged_${sid ?? "nosid"}_${utmObj?.utm_campaign ?? "na"}`;
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, "1");

    const dedupeKey =
      `email_return_${sid ?? "nosid"}_${utmObj?.utm_source ?? "na"}_${utmObj?.utm_medium ?? "na"}_${utmObj?.utm_campaign ?? "na"}_${utmObj?.utm_content ?? "na"}_${utmObj?.utm_term ?? "na"}`;

    try {
      localStorage.setItem("seligo_last_utm", JSON.stringify({ utm: utmObj, sid }));
    } catch {
      // ignore storage failures
    }

    void Firestore.ensureUserReady()
      .then(() => Firestore.logEvent({
        type: "view_change",
        view: "landing",
        source: "email",
        meta: { panel: "email_return", sid: sid ?? null, sidMissing: sid ? 0 : 1, dedupeKey },
        utm: utmObj,
      }))
      .catch(console.warn);
  }, []);

  useEffect(() => {
    void Firestore.logEvent({ type: "session_start", source: "app", view });
  }, []);

  useEffect(() => {
    if (!selectedProduct && !showSavedSheet && !showBagSheet) return;
    const prevOverflow = document.body.style.overflow;
    const prevTouchAction = document.body.style.touchAction;

    document.body.style.overflow = "hidden";
    document.body.style.touchAction = "none";

    return () => {
      document.body.style.overflow = prevOverflow;
      document.body.style.touchAction = prevTouchAction;
    };
  }, [selectedProduct, showSavedSheet, showBagSheet]);

  useEffect(() => {
    setDescOpen(false);
  }, [selectedProduct?.id]);

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
    setAllProducts((prev) =>
      prev.some((product) => product.id === last.product.id)
        ? prev
        : [last.product, ...prev]
    );

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

    closeProductOverlay({ restoreCheckout: false });
    showActionToast("undo", "Last action undone");
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

  const mainFeedPrioritization = {
    leadWindow: 20,
    maxPerSubtype: 2,
    maxPerNameStem: 1,
    maxPerCategorySubtype: 2,
  } as const;

  const smallCuratedPoolThreshold = 18;

  const isApprovedCuratedProduct = (product: Product) =>
    (product.isCurated || product.isLaunch) &&
    product.active !== false &&
    product.swipeEligible !== false &&
    product.imageApproved === true;

  const rankAndDiversifyFeed = (
    source: Product[],
    interests: string[] = userPrefs.interests,
  ) => {
    const launchSource = filterLaunchCatalogProducts(source);
    const ranked = prepareSwipeFeed(
      launchSource,
      normalizeFeedInterestIds(interests),
      blockedTags
    );

    const curatedApprovedCount = ranked.filter(isApprovedCuratedProduct).length;

    if (curatedApprovedCount > 0 && curatedApprovedCount < smallCuratedPoolThreshold) {
      return ranked;
    }

    return prioritizeMainFeedInventory(ranked, mainFeedPrioritization);
  };

  const curateFeedProducts = (
    source: Product[],
    interests: string[] = userPrefs.interests,
  ) => {
    const visible = source.filter((product) => {
      if (isBlockedProduct(product)) return false;
      if (swipedRef.current.has(product.id)) return false;
      return true;
    });

    return rankAndDiversifyFeed(visible, interests);
  };

  // Persistent Hydration
  useEffect(() => {
    const saved = Backend.loadUserData();
    if (saved) {
      const normalizedSavedInterests = normalizeFeedInterestIds(saved.interests || []);
      const savedFeed = filterLaunchCatalogProducts(saved.currentFeed || []);
      setUserPrefs({
        ...saved,
        interests: normalizedSavedInterests,
      });
      const curatedFeed = rankAndDiversifyFeed(savedFeed, normalizedSavedInterests);

      setAllProducts(savedFeed);
      setProducts(curatedFeed);
      setCurrentIndex(Math.min(saved.feedIndex || 0, Math.max(curatedFeed.length - 1, 0)));

      if (adminEnabled || openRoomscanEnabled) return;
      
      if (savedFeed.length > 0) {
        setView('browsing');
      } else if (normalizedSavedInterests.length > 0) {
        setView('interests');
      }
    }
  }, [adminEnabled, openRoomscanEnabled]);

  useEffect(() => {
    if (!allProducts.length) return;

    setProducts(curateFeedProducts(allProducts));
    setCurrentIndex(0);
  }, [blockedTags, userPrefs.interests]);

  useEffect(() => {
    closeProductOverlay({ restoreCheckout: false });
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

    const vibeLabelMap: Record<string, string> = {
      minimal: "Minimalist",
      cozy: "Cozy Homebody",
      modern: "Modern Curator",
      neutral: "Neutral Aesthetic",
      bold: "Bold Curator",
      warm: "Warm & Inviting",
      cool: "Cool & Clean",
    };

    const topVibe = topVibes[0];
    const hasPositiveSignals = Object.values(tagScores).some((v) => Number(v) > 0);

    const vibe =
      topVibe
        ? vibeLabelMap[topVibe] ?? "Style Developing"
        : hasPositiveSignals
          ? "Style Developing"
          : "New Explorer";

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

  const handleResetData = async () => {
    if (!confirm("Are you sure? This will clear your style persona and all saved items.")) return;

    try {
      await Firestore.clearMySwipes();
      const after = await Firestore.fetchMySwipes();
      logDiscoveryDebug("swipes after reset:", after.length);
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
    setAllProducts([]);
    resetImpressions();
    setProducts([]);
    setCurrentIndex(0);
    setCursor(null);
    setHasMore(true);
    setView("interests");
  };

  type StartDiscoveryOpts = { navigate?: boolean };

  const startDiscovery = async (
    overrideInterests?: string[],
    opts: StartDiscoveryOpts = {}
  ): Promise<Product[]> => {
    const interests = normalizeFeedInterestIds([...(overrideInterests ?? userPrefs.interests)]);
    if (interests.length === 0) return [];

    setIsLoading(true);
    if (opts.navigate !== false) setView("discovering");
    try {
      logDiscoveryDebug("selectedIds snapshot", JSON.stringify(interests));
      logDiscoveryStage("selectedIds", interests);
      resetImpressions();
      setAllProducts([]);
      setProducts([]);
      setCursor(null);
      setHasMore(true);
      setCurrentIndex(0);

      const swipes = await Firestore.fetchMySwipes();
      logDiscoveryDebug("raw swipes", swipes.slice(0, 10));
      swipedRef.current = new Set(
        swipes
          .filter((s: any) =>
            s.direction === "left" ||
            s.action === "pass" ||
            s.type === "pass" ||
            s.hidden === true ||
            s.blocked === true
          )
          .map((s: any) => s.productId)
          .filter(Boolean)
      );
      logDiscoveryStage("loaded swipes", {
        fetchedSwipeRecords: swipes.length,
        appliedSwipeExclusions: swipedRef.current.size,
        bypassSwipeExclusion: false,
      });

      let nextCursor: any = null;
      const out: Product[] = [];
      const fetchedRaw: Product[] = [];
      const seen = new Set<string>();
      let filteredBySwiped = 0;
      let filteredByBlocked = 0;

      const curatedPool = await Firestore.fetchCuratedProductsByInterests(interests, 60);
      fetchedRaw.push(...curatedPool);
        logDiscoveryStage("curated raw length", curatedPool.length);
      logDiscoveryStage("fetched curated raw", curatedPool.length, [...curatedPool]);
        logDiscoveryDebug("curated ids snapshot", curatedPool.map((product) => product.id));

      for (const product of curatedPool) {
        if (seen.has(product.id)) continue;
        if (swipedRef.current.has(product.id)) {
          filteredBySwiped += 1;
          continue;
        }
        if (isBlockedProduct(product)) {
          filteredByBlocked += 1;
          continue;
        }

        out.push(product);
        seen.add(product.id);

        if (out.length >= 80) break;
      }

      const normalizedCuratedCount = out.filter(isApprovedCuratedProduct).length;
      logDiscoveryStage("curated normalized length", normalizedCuratedCount);
      logDiscoveryStage("after curated blocked/swiped filter", out.length, [...out]);

      const curatedOnly = rankAndDiversifyFeed(out, interests);
      logDiscoveryStage("curated feed result", curatedOnly.length, [...curatedOnly]);

      logDiscoveryStage("after blocked/swiped filter", out.length, {
        products: [...out],
        filteredBySwiped,
        filteredByBlocked,
        blockedTags,
      });

      const ranked = prepareSwipeFeed(out, interests, blockedTags);
      const rankedCuratedCount = ranked.filter(isApprovedCuratedProduct).length;
      logDiscoveryStage("ranked curated count", rankedCuratedCount);
      logDiscoveryStage("after ranking", ranked.length, [...ranked]);

      const diversified = prioritizeMainFeedInventory(ranked, mainFeedPrioritization);
      logDiscoveryStage("after diversify", diversified.length, [...diversified]);

      const finalFeed = diversified;
      const approvedCurated = finalFeed.filter(isApprovedCuratedProduct);

      logDiscoveryStage("curated final length", finalFeed.length);
      logDiscoveryStage("approved curated total", approvedCurated.length);
      logDiscoveryDebug(
        approvedCurated.map((product) => ({
          asin: product.asin,
          name: product.displayName ?? product.name,
          category: product.category,
        }))
      );

      if (finalFeed.length === 0) {
        warnDiscoveryStage("Feed resolved to zero products", {
          interests,
          fetchedRaw: fetchedRaw.length,
          filteredBySwiped,
          filteredByBlocked,
          blockedTags,
          swipedCount: swipedRef.current.size,
          bypassSwipeExclusion: false,
          bypassFinalPrioritization: false,
        });
      }

      setAllProducts(out);
      setProducts(finalFeed);
      setCursor(nextCursor);
      setHasMore(false);
      setCurrentIndex(0);

      if (opts.navigate !== false) setView("browsing");
      return finalFeed;
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
      setAllProducts(prev => prev.filter((product) => product.id !== currentProduct.id));
      pushUndo({ product: currentProduct, direction: "left", action: null });
      logLocalActivity("pass");
      setCurrentIndex(i => i + 1);
      return;
    }
    openProductOverlay(currentProduct, { view: "browsing", source: "feed" });
  };

  function openProductOverlay(
    product: Product,
    ctx?: Partial<ProductOverlayContext> & { closeCheckout?: boolean }
  ) {
    if (ctx?.closeCheckout) {
      setReturnToCheckout(true);
      setShowCheckout(false);
    }

    void Firestore.logEvent({
      type: "product_open",
      productId: product.id,
      view: ctx?.view ?? "browsing",
      source: ctx?.source ?? "unknown",
      meta: {
        category: product.category ?? "",
        tags: Array.isArray(product.tags) ? product.tags : [],
        price: Number(product.price ?? 0),
      },
    }).catch(console.warn);

    setSelectedProduct(product);
    setSelectedProductContext({
      view: ctx?.view ?? "browsing",
      source: ctx?.source ?? "unknown",
    });
  }

  function openProductOverlayFromCheckout(p: Product) {
    openProductOverlay(p, {
      view: "checkout",
      source: "checkout",
      closeCheckout: showCheckout,
    });
  }

  const closeProductOverlay = (options?: { restoreCheckout?: boolean }) => {
    setSelectedProduct(null);
    setSelectedProductContext(null);
    setDescOpen(false);

    if (options?.restoreCheckout === false) {
      setReturnToCheckout(false);
      return;
    }

    if (returnToCheckout) {
      setReturnToCheckout(false);
      setShowCheckout(true);
    }
  };

  const getRetailerClickDefaults = (
    product: Product,
    context?: ProductOverlayContext | null
  ): RetailerClickDefaults => {
    const isSavedItem = userPrefs.wishlist.some((item) => item.id === product.id);
    const fallbackSource = getRetailerClickSource(context?.source ?? 'unknown');

    switch (context?.source) {
      case 'roomscan_pick':
        return {
          source: 'roomscan',
          view: 'roomscan',
          placement: 'roomscan_pick',
        };
      case 'saved_sheet':
        return {
          source: 'saved_sheet',
          view: 'browsing',
          placement: 'product_overlay_cta',
        };
      case 'bag_sheet':
        return {
          source: 'bag_sheet',
          view: 'browsing',
          placement: 'product_overlay_cta',
        };
      case 'shortlist_saved':
        return {
          source: 'shortlist_page',
          view: 'cart',
          placement: 'product_overlay_cta',
        };
      case 'shortlist_bag':
        return {
          source: 'shortlist_page',
          view: 'cart',
          placement: 'product_overlay_cta',
        };
      case 'checkout':
        return {
          source: 'checkout_modal',
          view: 'checkout',
          placement: isSavedItem ? 'checkout_saved_item' : 'checkout_cart_item',
        };
      default:
        if (context?.view === 'roomscan') {
          return {
            source: fallbackSource === 'unknown' ? 'roomscan' : fallbackSource,
            view: 'roomscan',
            placement: 'roomscan_pick',
          };
        }

        if (context?.view === 'checkout') {
          return {
            source: fallbackSource === 'unknown' ? 'checkout_modal' : fallbackSource,
            view: 'checkout',
            placement: isSavedItem ? 'checkout_saved_item' : 'checkout_cart_item',
          };
        }

        if (context?.view === 'cart') {
          return {
            source: fallbackSource === 'unknown' ? 'shortlist_page' : fallbackSource,
            view: 'cart',
            placement: 'product_overlay_cta',
          };
        }

        return {
          source: fallbackSource,
          view: context?.view ?? 'browsing',
          placement: fallbackSource === 'unknown' ? 'unknown' : 'product_overlay_cta',
        };
    }
  };

  const openRetailerLink = (product: Product, opts?: RetailerLinkOptions) => {
    const defaults = getRetailerClickDefaults(product, selectedProductContext);
    const purchaseUrl = getResolvedPurchaseUrl(product, opts?.purchaseUrl);
    if (!purchaseUrl) {
      showRetailerLinkUnavailableToast();
      return;
    }

    const source = getRetailerClickSource(opts?.source ?? defaults.source);
    const view = opts?.view ?? defaults.view;
    const placement = normalizeRetailerPlacement(opts?.placement, defaults.placement);
    const includeCheckoutOpen = opts?.includeCheckoutOpen ?? shouldIncludeCheckoutOpen(source, view);
    const meta = {
      category: product.category ?? "",
      tags: Array.isArray(product.tags) ? product.tags : [],
      price: Number(product.price ?? 0),
      retailer: getProductRetailerName(product),
      placement,
      purchaseUrl,
    };

    if (includeCheckoutOpen) {
      void Firestore.logEvent({
        type: "checkout_item_open",
        productId: product.id,
        source,
        view,
        purchaseUrl,
        meta,
      }).catch(() => {});
    }

    void Firestore.logEvent({
      type: "buy_click",
      productId: product.id,
      source,
      view,
      purchaseUrl,
      meta,
    }).catch(() => {});

    console.log("[openRetailerLink] Resolved purchase URL:", purchaseUrl);
    window.open(purchaseUrl, "_blank", "noopener,noreferrer");
  };

  const handleAction = async (action: 'wishlist' | 'cart', source: string = "feed") => {
    const currentProduct = selectedProduct ?? products[currentIndex];
    if (!currentProduct) return;

    const targetView = selectedProductContext?.view ?? (view === "cart" ? "cart" : "browsing");
    const targetSource = selectedProductContext?.source ?? source;
    const isCurrentBrowseProduct =
      view === "browsing" &&
      Boolean(products[currentIndex]) &&
      products[currentIndex].id === currentProduct.id;

    void Firestore.saveSwipe({ productId: currentProduct.id, direction: "right", action });
    if (action === "wishlist") {
      void Firestore.logEvent({
        type: "wishlist_add",
        productId: currentProduct.id,
        source: targetSource,
        view: targetView,
        meta: {
          category: currentProduct.category ?? "",
          price: Number(currentProduct.price ?? 0),
        },
      }).catch(console.warn);
    } else {
      void Firestore.logEvent({
        type: "cart_add",
        productId: currentProduct.id,
        source: targetSource,
        view: targetView,
        meta: {
          category: currentProduct.category ?? "",
          price: Number(currentProduct.price ?? 0),
          actionSource: targetSource,
        },
      }).catch(console.warn);
    }
    bumpTags(currentProduct, +2);

    setUserPrefs(prev => ({
      ...prev,
      wishlist: action === "wishlist" ? addUnique(prev.wishlist, currentProduct) : prev.wishlist,
      cart: action === "cart" ? addUnique(prev.cart, currentProduct) : prev.cart,
      likedProducts: addUnique(prev.likedProducts, currentProduct),
      lastAction: action
    }));

    showActionToast(
      action === "wishlist" ? "save" : "bag",
      action === "wishlist" ? "Saved to wishlist" : "Added to bag"
    );

    if (isCurrentBrowseProduct) {
      swipedRef.current.add(currentProduct.id);
      setAllProducts(prev => prev.filter((product) => product.id !== currentProduct.id));

      logLocalActivity("match");
      logLocalActivity(action === "wishlist" ? "save" : "bag");
      pushUndo({ product: currentProduct, direction: "right", action });
      setCurrentIndex(prev => prev + 1);
    }

    closeProductOverlay();
  };

  const addUnique = (arr: Product[], p: Product) =>
    arr.some(x => x.id === p.id) ? arr : [...arr, p];

  type SurfaceSource =
    | "saved_sheet"
    | "bag_sheet"
    | "checkout_modal"
    | "shortlist_page";

  type SurfaceView = "browsing" | "checkout" | "cart";

  type MoveAction = "move_to_saved" | "move_to_bag";
  type RemoveAction = "remove";

  const findWishlistProduct = (productId: string) =>
    userPrefs.wishlist.find((item) => item.id === productId) ?? null;

  const findCartProduct = (productId: string) =>
    userPrefs.cart.find((item) => item.id === productId) ?? null;

  const removeWishlistProduct = (
    productId: string,
    opts: { source: SurfaceSource; view: SurfaceView }
  ) => {
    const action: RemoveAction = "remove";
    const product = findWishlistProduct(productId);
    if (!product) return;

    setUserPrefs((prev) => ({
      ...prev,
      wishlist: prev.wishlist.filter((item) => item.id !== productId),
    }));

    void Firestore.logEvent({
      type: "wishlist_remove",
      productId: product.id,
      source: opts.source,
      view: opts.view,
      meta: {
        category: product.category ?? "",
        price: Number(product.price ?? 0),
        from: opts.source,
        action,
      },
    }).catch(console.warn);

    showActionToast("undo", "Removed from saved", {
      actionLabel: "Undo",
      onAction: () => {
        setUserPrefs((prev) => ({
          ...prev,
          wishlist: addUnique(prev.wishlist, product),
        }));
      },
    });
  };

  const removeCartProduct = (
    productId: string,
    opts: { source: SurfaceSource; view: SurfaceView }
  ) => {
    const action: RemoveAction = "remove";
    const product = findCartProduct(productId);
    if (!product) return;

    setUserPrefs((prev) => ({
      ...prev,
      cart: prev.cart.filter((item) => item.id !== productId),
    }));

    void Firestore.logEvent({
      type: "cart_remove",
      productId: product.id,
      source: opts.source,
      view: opts.view,
      meta: {
        category: product.category ?? "",
        price: Number(product.price ?? 0),
        from: opts.source,
        action,
      },
    }).catch(console.warn);

    showActionToast("undo", "Removed from bag", {
      actionLabel: "Undo",
      onAction: () => {
        setUserPrefs((prev) => ({
          ...prev,
          cart: addUnique(prev.cart, product),
        }));
      },
    });
  };

  const moveWishlistProductToCart = (
    productId: string,
    opts: { source: SurfaceSource; view: SurfaceView }
  ) => {
    const action: MoveAction = "move_to_bag";
    const product = findWishlistProduct(productId);
    if (!product) return;

    setUserPrefs((prev) => ({
      ...prev,
      wishlist: prev.wishlist.filter((item) => item.id !== product.id),
      cart: addUnique(prev.cart, product),
      likedProducts: addUnique(prev.likedProducts, product),
      lastAction: "cart",
    }));

    void Firestore.logEvent({
      type: "cart_add",
      productId: product.id,
      source: opts.source,
      view: opts.view,
      meta: {
        category: product.category ?? "",
        price: Number(product.price ?? 0),
        from: opts.source,
        action,
      },
    }).catch(console.warn);

    showActionToast("undo", "Moved to bag", {
      actionLabel: "Undo",
      onAction: () => {
        setUserPrefs((prev) => ({
          ...prev,
          cart: prev.cart.filter((item) => item.id !== product.id),
          wishlist: addUnique(prev.wishlist, product),
          likedProducts: addUnique(prev.likedProducts, product),
          lastAction: "wishlist",
        }));
      },
    });
  };

  const moveCartProductToWishlist = (
    productId: string,
    opts: { source: SurfaceSource; view: SurfaceView }
  ) => {
    const action: MoveAction = "move_to_saved";
    const product = findCartProduct(productId);
    if (!product) return;

    setUserPrefs((prev) => ({
      ...prev,
      cart: prev.cart.filter((item) => item.id !== product.id),
      wishlist: addUnique(prev.wishlist, product),
      likedProducts: addUnique(prev.likedProducts, product),
      lastAction: "wishlist",
    }));

    void Firestore.logEvent({
      type: "wishlist_add",
      productId: product.id,
      source: opts.source,
      view: opts.view,
      meta: {
        category: product.category ?? "",
        price: Number(product.price ?? 0),
        from: opts.source,
        action,
      },
    }).catch(console.warn);

    showActionToast("undo", "Moved to saved", {
      actionLabel: "Undo",
      onAction: () => {
        setUserPrefs((prev) => ({
          ...prev,
          wishlist: prev.wishlist.filter((item) => item.id !== product.id),
          cart: addUnique(prev.cart, product),
          likedProducts: addUnique(prev.likedProducts, product),
          lastAction: "cart",
        }));
      },
    });
  };

  const removeFromWishlist = (productId: string) =>
    removeWishlistProduct(productId, {
      source: "saved_sheet",
      view: "browsing",
    });

  const removeFromCart = (productId: string) =>
    removeCartProduct(productId, {
      source: "bag_sheet",
      view: "browsing",
    });

  const moveWishlistToCart = (product: Product) =>
    moveWishlistProductToCart(product.id, {
      source: "saved_sheet",
      view: "browsing",
    });

  const moveCartToWishlist = (product: Product) =>
    moveCartProductToWishlist(product.id, {
      source: "bag_sheet",
      view: "browsing",
    });

  const removeCartItemFromCheckout = (productId: string) =>
    removeCartProduct(productId, {
      source: "checkout_modal",
      view: "checkout",
    });

  const moveCartItemToSavedFromCheckout = (product: Product) =>
    moveCartProductToWishlist(product.id, {
      source: "checkout_modal",
      view: "checkout",
    });

  const removeSavedItemFromCheckout = (productId: string) =>
    removeWishlistProduct(productId, {
      source: "checkout_modal",
      view: "checkout",
    });

  const moveSavedItemToBagFromCheckout = (product: Product) =>
    moveWishlistProductToCart(product.id, {
      source: "checkout_modal",
      view: "checkout",
    });

  const saveProductFromOverlay = (product: Product) => {
    setUserPrefs((prev) => ({
      ...prev,
      wishlist: addUnique(prev.wishlist, product),
      likedProducts: addUnique(prev.likedProducts, product),
      lastAction: "wishlist",
    }));

    bumpTags(product, +2);

    void Firestore.logEvent({
      type: "wishlist_add",
      productId: product.id,
      source: "product_sheet",
      view: selectedProductContext?.view ?? "product_overlay",
      meta: {
        category: product.category ?? "",
        tags: Array.isArray(product.tags) ? product.tags : [],
        price: Number(product.price ?? 0),
      },
    }).catch(console.warn);

    showActionToast("save", "Saved to wishlist");
  };

  const addProductToBagFromOverlay = (product: Product) => {
    setUserPrefs((prev) => ({
      ...prev,
      cart: addUnique(prev.cart, product),
      likedProducts: addUnique(prev.likedProducts, product),
      lastAction: "cart",
    }));

    bumpTags(product, +2);

    void Firestore.logEvent({
      type: "cart_add",
      productId: product.id,
      source: "product_sheet",
      view: selectedProductContext?.view ?? "product_overlay",
      meta: {
        category: product.category ?? "",
        tags: Array.isArray(product.tags) ? product.tags : [],
        price: Number(product.price ?? 0),
      },
    }).catch(console.warn);

    showActionToast("bag", "Added to bag");
  };

  const shortlistActions = {
    onRemoveCartItem: (productId: string) =>
      removeCartProduct(productId, {
        source: "shortlist_page",
        view: "cart",
      }),
    onMoveCartItemToSaved: (productId: string) =>
      moveCartProductToWishlist(productId, {
        source: "shortlist_page",
        view: "cart",
      }),
    onRemoveSavedItem: (productId: string) =>
      removeWishlistProduct(productId, {
        source: "shortlist_page",
        view: "cart",
      }),
    onMoveSavedItemToBag: (productId: string) =>
      moveWishlistProductToCart(productId, {
        source: "shortlist_page",
        view: "cart",
      }),
  };

  const dismissRoomScanPick = (productId: string, reason: string = "x") => {
    void Firestore.logEvent({
      type: "pick_dismiss",
      view: "roomscan",
      source: "roomscan_pick",
      productId,
      meta: { reason },
    }).catch(console.warn);

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

    void Firestore.logEvent({
      type: "wishlist_add",
      view: "roomscan",
      source: "roomscan_pick",
      productId: p.id,
      meta: {
        category: p.category ?? "",
        tags: Array.isArray(p.tags) ? p.tags : [],
        price: Number(p.price ?? 0),
        from: "roomscan",
      },
    }).catch(console.warn);
    void Firestore.saveSwipe({ productId: p.id, direction: "right", action: "wishlist" }).catch(console.warn);

    showActionToast("save", "Saved from RoomScan");

    dismissRoomScanPick(p.id, "save");
  };

  const addToCartFromRoomScan = (p: Product) => {
    setUserPrefs(prev => ({
      ...prev,
      cart: addUnique(prev.cart, p),
      likedProducts: addUnique(prev.likedProducts, p),
      lastAction: "cart",
    }));
    bumpTags(p, +2);

    void Firestore.logEvent({
      type: "cart_add",
      view: "roomscan",
      source: "roomscan_pick",
      productId: p.id,
      meta: {
        category: p.category ?? "",
        tags: Array.isArray(p.tags) ? p.tags : [],
        price: Number(p.price ?? 0),
        from: "roomscan",
      },
    }).catch(console.warn);
    void Firestore.saveSwipe({ productId: p.id, direction: "right", action: "cart" }).catch(console.warn);

    showActionToast("bag", "Added to bag");

    dismissRoomScanPick(p.id, "bag");
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

    const filtered = filterLaunchCatalogProducts(page.items || []).filter((p) => {
      if (isBlockedProduct(p)) return false;
      if (!ignoreSwiped && swipedRef.current.has(p.id)) return false;
      return true;
    });

    const curated = rankAndDiversifyFeed(filtered, interests);

    return { page, curated, filtered };
  };

  const applyRoomScan = async (analysis: RoomScanAnalysis) => {
    setView("roomscan");
    setRoomScanPickStatus("loading");
    setRoomScanPicks([]);
    roomScanImpressedRef.current = new Set();

    const alias: Record<string, string> = {
      add_rug: "",
      add_plants: "plants",
      wall_art: "wall-decor",
      livingroom: "",
      living_room: "",
      bedroom: "cozy-bedroom",
      kitchen: "",
      decor: "wall-decor",
      wall: "wall-decor",
      art: "wall-decor",
      lights: "lighting",
      lamp: "lighting",
      lamps: "lighting",
      table: "desk-setup",
      desk: "desk-setup",
      workspace: "desk-setup",
      chair: "",
      sofa: "",
      plant: "plants",
      rug: "",
      mirror: "mirrors",
      organization: "storage",
      shelf: "shelf-styling",
      shelves: "shelf-styling",
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
      mergedInterests = normalizeFeedInterestIds([...(prev.interests || []), ...scanInterests]).slice(0, 10);

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

    const interestsToUse = mergedInterests.length ? mergedInterests : normalizeFeedInterestIds(userPrefs.interests);

    const fetchCandidatesIgnoringSwipes = async (interests: string[], limit = 120) => {
      return filterLaunchCatalogProducts(
        await Firestore.fetchCuratedProductsByInterests(interests, Math.max(limit, 60))
      )
        .filter((product) => !isBlockedProduct(product))
        .slice(0, limit);
    };

    try {
      const ranked = await startDiscovery(interestsToUse, { navigate: false });

      const candidates = ranked.length ? ranked : await fetchCandidatesIgnoringSwipes(interestsToUse);

      const picks = buildRoomScanPicks(candidates, analysis);

      logRoomScanDebug("[RoomScan] interestsToUse:", interestsToUse);
      logRoomScanDebug(
        "[RoomScan] ranked:",
        ranked.length,
        "candidates:",
        candidates.length,
        "picks:",
        picks.length
      );

      void Firestore.logEvent({
        type: "scan_apply",
        view: "roomscan",
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
  const shortlistSubtotal = subtotal;
  const shortlistCount = userPrefs.cart.length + userPrefs.wishlist.length;
  const nextBrowseProduct = currentIndex + 1 < products.length ? products[currentIndex + 1] : null;
  const savedUpgradeCount = userPrefs.wishlist.length;

  const openCheckout = (source: string) => {
    void Firestore.logEvent({
      type: "checkout_open",
      view: "checkout",
      source,
      meta: {
        subtotal,
        items: userPrefs.cart.length,
      },
    }).catch(console.warn);

    setShowSavedSheet(false);
    setShowBagSheet(false);
    setLeadEmail("");
    setLeadError("");
    setLeadStatus("idle");
    setShowCheckout(true);
  };

  const handleLeadEmailChange = (value: string) => {
    setLeadEmail(value);
    if (leadStatus === "error") {
      setLeadStatus("idle");
      setLeadError("");
    }
  };

  const openRoomScanLeadCapture = () => {
    void Firestore.logEvent({
      type: "view_change",
      view: "roomscan",
      source: "roomscan",
      meta: { panel: "roomscan_email_cta_click" },
    }).catch(console.warn);

    setLeadSourceTracked("roomscan");
    setLeadError("");
    if (leadStatus === "error") setLeadStatus("idle");
    setRoomscanLeadRequestNonce((n) => n + 1);
    setShowCheckout(true);
  };

  const setLeadSourceTracked = (value: LeadSource) => {
    leadSourceRef.current = value;
    setLeadSource(value);
  };

  const submitLead = async (): Promise<boolean> => {
    setLeadError("");

    const email = leadEmail.trim().toLowerCase();
    const ok = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    if (!ok) {
      setLeadError("Enter a valid email.");
      return false;
    }

    if (leadStatus === "saving") return false;

    const emailKnown = !!leadEmail?.trim();
    const src = leadSourceRef.current;
    const leadView = src === "roomscan" ? "roomscan" : "checkout";
    const roomscanPickIds = src === "roomscan"
      ? roomScanPicks
          .map((p) => p?.product?.id)
          .filter((id): id is string => typeof id === "string" && id.length > 0)
      : [];

    if (src === "roomscan" && roomscanPickIds.length === 0) {
      setLeadError("No picks yet — run a scan first.");
      return false;
    }

    const roomscanLeadMeta = src === "roomscan"
      ? {
          pickIds: roomscanPickIds,
          pickCount: roomscanPickIds.length,
        }
      : undefined;

    const cartIds = userPrefs.cart
      .map((p) => p?.id)
      .filter((id): id is string => typeof id === "string" && id.length > 0);

    const cartLeadMeta = {
      cartIds,
      cartCount: cartIds.length,
    };

    const mergedMeta =
      src === "roomscan"
        ? { ...(roomscanLeadMeta ?? {}), ...cartLeadMeta }
        : cartLeadMeta;

    setLeadStatus("saving");
    try {
      await Firestore.ensureUserReady();

      await Firestore.saveLead({
        email,
        subtotal,
        bagCount: userPrefs.cart.length,
        wishlistCount: userPrefs.wishlist.length,
        source: src,
        view: leadView,
        meta: mergedMeta,
      });

      void Firestore.logEvent({
        type: "lead_submit",
        view: leadView,
        source: src,
        meta: {
          subtotal,
          bagCount: userPrefs.cart.length,
          wishlistCount: userPrefs.wishlist.length,
          emailKnown,
          ...mergedMeta,
        },
      }).catch(console.warn);
      try {
        localStorage.setItem("seligo_lead_email", email);
        localStorage.setItem("seligo_lead_saved", "1");
      } catch {
        // ignore storage failures (incognito / blocked storage)
      }
      setLeadStatus("saved");
      return true;
    } catch (e: any) {
      console.error("saveLead failed:", e?.code, e);
      setLeadStatus("error");
      setLeadError("Couldn’t save right now. Try again.");
      return false;
    }
  };

  function buildShareUrl() {
    const u = new URL(window.location.href);
    u.searchParams.set("utm_source", "share");
    u.searchParams.set("utm_medium", "roomscan");
    u.searchParams.set("utm_campaign", "viral");
    u.searchParams.set("open", "roomscan");
    return u.toString();
  }

  const shareLink = async () => {
    const url = buildShareUrl();
    let shared = false;

    try {
      if (navigator.share) {
        await navigator.share({
          title: "Seligo — RoomScan picks",
          text: "Check out my curated picks 👇",
          url,
        });
        shared = true;
      }
    } catch {
      // user cancelled share, or share failed — fall back below
    }

    if (!shared) {
      try {
        await navigator.clipboard.writeText(url);
        shared = true;
        alert("Link copied!");
      } catch {
        alert("Couldn’t copy link. Please copy from the address bar.");
        return;
      }
    }

    await Firestore.logEvent({
      type: "share_click",
      view: "roomscan",
      source: "roomscan_cleared",
      meta: { url },
    });
  };

  const refineRecommendations = async () => {
    if (refineLockRef.current) return;
    if (!hasMore) return;

    refineLockRef.current = true;
    setIsAlgorithmRunning(true);
    try {
      const { page, curated, filtered } = await fetchMoreProducts({
        interests: userPrefs.interests,
        limit: 20,
        cursor,
        ignoreSwiped: false,
      });

      setAllProducts(prev => {
        const seen = new Set(prev.map(p => p.id));
        const unique = filtered.filter(p => !seen.has(p.id));
        return [...prev, ...unique];
      });

      setProducts(prev => {
        const seen = new Set(prev.map(p => p.id));
        const unique = curated.filter(p => !seen.has(p.id));
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
    if (view !== "roomscan") return;

    for (const pick of roomScanPicks) {
      const productId = pick?.product?.id;
      if (!productId) continue;
      if (roomScanImpressedRef.current.has(productId)) continue;

      roomScanImpressedRef.current.add(productId);
      void Firestore.logEvent({
        type: "pick_impression",
        view: "roomscan",
        source: "roomscan_pick",
        productId,
        meta: { score: pick.score },
      }).catch(console.warn);
    }
  }, [view, roomScanPicks]);

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

  // Discover counter
  const feedTotal = products.length;
  const feedPosition =
    feedTotal > 0
      ? Math.min(Math.max(currentIndex + 1, 1), feedTotal)
      : 0;
  const browseProgressPercent =
    feedTotal > 0
      ? (feedPosition / feedTotal) * 100
      : 0;
  const feedCountLabel =
    feedTotal > 0
      ? `${feedPosition} of ${feedTotal} in your feed`
      : "Curating your feed";

  // Profile page derived values
  const vibe = userPrefs.persona.detectedVibe || "Still learning";
  const savedCount = userPrefs.wishlist.length + userPrefs.cart.length;
  const primaryKeywords = (userPrefs.persona.styleKeywords ?? []).slice(0, 5);
  const showMore = liked.slice(0, 4);
  const avoidedSource =
    userPrefs.persona.dislikedFeatures.length ? userPrefs.persona.dislikedFeatures : avoided;
  const showLess = Array.from(new Set([...(blockedTags ?? []), ...avoidedSource])).slice(0, 4);
  const summaryLine =
    topRooms[0] && topCategories[0]
      ? `${vibe} picks with a focus on ${topRooms[0].toLowerCase()} upgrades and ${topCategories[0].toLowerCase()} that fit your budget.`
      : topCategories[0]
        ? `${vibe} picks with a preference for affordable ${topCategories[0].toLowerCase()} and cozy, renter-friendly upgrades.`
        : "Affordable, renter-friendly upgrades shaped by what you save, pass, and match.";

  const discoveryMessages = [
    "Analyzing Interest Nodes...",
    "Mapping Style Cartography...",
    "Connecting to Product Catalog...",
    "Finalizing Personalized Feed..."
  ];
  const selectedView = selectedProductContext?.view ?? "browsing";
  const selectedSource = selectedProductContext?.source ?? "unknown";
  const overlayEyebrow = (() => {
    if (selectedSource === "shortlist_saved") return "Saved upgrade";
    if (selectedSource === "shortlist_bag") return "Ready for checkout";

    if (selectedSource === "saved_sheet") return "Saved upgrade";
    if (selectedSource === "bag_sheet") return "Ready for checkout";
    if (selectedSource === "checkout") return "Checkout item";
    if (selectedView === "roomscan" || selectedSource === "roomscan_pick") {
      return "Picked for your room";
    }

    return "Swipeable room upgrade";
  })();
  const overlaySupportText = (() => {
    if (selectedSource === "shortlist_saved") {
      return "A saved item from your shortlist.";
    }

    if (selectedSource === "shortlist_bag") {
      return "A shortlist item already in your bag and ready for checkout.";
    }

    if (selectedSource === "saved_sheet") {
      return "A saved item from your shortlist.";
    }

    if (selectedSource === "bag_sheet") {
      return "You already added this to your bag.";
    }

    if (selectedSource === "checkout" || selectedView === "checkout") {
      return "Review details before heading to the retailer.";
    }

    if (selectedView === "roomscan" || selectedSource === "roomscan_pick") {
      return "Matched to your room scan, vibe, and budget.";
    }

    return "An affordable room upgrade matched to your feed.";
  })();
  const overlayWhyItFits = (() => {
    if (!selectedProduct) return "";

    const price = Number(selectedProduct.price ?? 0);
    const category = String(selectedProduct.category ?? "").toLowerCase();
    const tags = Array.isArray(selectedProduct.tags)
      ? selectedProduct.tags.map((t) => String(t).toLowerCase())
      : [];

    if (tags.some((t) => t.includes("desk")) || category.includes("desk")) {
      return "A compact upgrade that works well for desks, shelves, and smaller setups.";
    }

    if (tags.some((t) => t.includes("bedroom")) || category.includes("bed")) {
      return "A simple bedroom upgrade that adds style without taking over the space.";
    }

    if (tags.some((t) => t.includes("wall")) || category.includes("wall")) {
      return "An easy visual upgrade that helps blank walls feel more finished.";
    }

    if (price > 0 && price <= 30) {
      return "A low-cost room refresh that’s easy to say yes to quickly.";
    }

    if (price > 30 && price <= 50) {
      return "A renter-friendly upgrade with a strong visual payoff for the price.";
    }

    return "A strong fit for small spaces, cozy setups, and affordable room upgrades.";
  })();
  const overlayBrand = selectedProduct?.brand || "Seligo.AI";
  const overlayIsSaved = !!selectedProduct?.id && userPrefs.wishlist.some((item) => item.id === selectedProduct.id);
  const overlayIsInBag = !!selectedProduct?.id && userPrefs.cart.some((item) => item.id === selectedProduct.id);
  const overlaySaveLabel = overlayIsSaved ? "Saved" : "Save";
  const overlayBagLabel = overlayIsInBag ? "In Bag" : "Add to Bag";
  const overlayFooterText =
    selectedView === "checkout"
      ? "Review details before checkout."
      : overlayIsInBag || selectedSource === "bag_sheet" || selectedSource === "shortlist_bag"
        ? "Bag items stay ready for checkout while you keep exploring."
        : "Saved items stay easy to revisit while you build your room shortlist.";
  const overlayOpen = !!selectedProduct || showCheckout || showHowItWorks || showSavedSheet || showBagSheet;

  // Views
  if (view === 'auth' || view === 'interests') {
    return (
      <>
        <InterestsPage
          initialSelectedIds={deriveSelectedVibeCategories(userPrefs.interests)}
          isLoading={isLoading}
          onHowItWorks={() => setShowHowItWorks(true)}
          onRoomScan={() => goView("roomscan", "interests_roomscan_cta")}
          onContinue={async (selectedIds) => {
            const nextInterests = mapVibeCategoriesToInterests(selectedIds);
            setUserPrefs((prev) => ({
              ...prev,
              interests: nextInterests,
            }));
            setShowHowItWorks(false);
            await startDiscovery(nextInterests);
          }}
        />

        <HowItWorksModal open={showHowItWorks} onClose={() => setShowHowItWorks(false)} />
      </>
    );
  }

  if (view === "privacy") return <PrivacyScreen onBack={() => goView("profile", "privacy_close")} />;
  if (view === "terms") return <TermsScreen onBack={() => goView("profile", "terms_close")} />;
  if (view === "disclosure") return <DisclosureScreen onBack={() => goView("profile", "disclosure_close")} />;
  if (view === "about") return <AboutScreen onBack={() => goView("profile", "about_close")} />;
  if (view === "contact") return <ContactScreen onBack={() => goView("profile", "contact_close")} />;
  if (view === "admin") {
    if (!adminEnabled) return <div className="p-6">Not authorized.</div>;
    return <AdminScreen onBack={() => goView("profile", "admin_back")} />;
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
              onClick={openSavedSheet}
              className="relative w-10 h-10 bg-slate-50 rounded-2xl flex items-center justify-center text-slate-400 hover:text-rose-500 transition-colors"
              aria-label="Saved"
              title="Saved"
            >
              <Heart className="w-5 h-5" />
              {userPrefs.wishlist.length > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 bg-rose-500 text-white text-[10px] flex items-center justify-center rounded-full font-extrabold border-2 border-white">
                  {userPrefs.wishlist.length}
                </span>
              )}
            </button>

            <button
              onClick={openBagSheet}
              className="relative w-10 h-10 bg-slate-50 rounded-2xl flex items-center justify-center text-slate-400 hover:text-[var(--seligo-primary)] transition-colors"
              aria-label="Bag"
              title="Bag"
            >
              <ShoppingBag className="w-5 h-5" />
              {userPrefs.cart.length > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 bg-[var(--seligo-primary)] text-white text-[10px] flex items-center justify-center rounded-full font-extrabold border-2 border-white">
                  {userPrefs.cart.length}
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
                    const interestLabel = prettyLabel(interestId);
                    return (
                      <div
                        key={interestId}
                        className="px-4 py-2 bg-slate-800/50 border border-slate-700 rounded-xl text-slate-400 text-[10px] font-bold uppercase tracking-widest flex items-center gap-2 animate-in fade-in slide-in-from-bottom duration-500"
                        style={{ animationDelay: `${idx * 200}ms` }}
                      >
                        <Activity className="w-3 h-3 text-[var(--seligo-accent)]" /> {interestLabel}
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
          <Screen
            animate={false}
            className={[
              overlayOpen ? "pointer-events-none" : "",
              "px-0 pt-0 pb-0 bg-transparent",
            ].join(" ")}
          >
            {currentIndex < products.length ? (
              <div className="min-h-full bg-[#fffaf6]">
                <div className="pointer-events-none fixed inset-0 overflow-hidden">
                  <div className="absolute left-1/2 top-[20%] h-72 w-72 -translate-x-1/2 rounded-full bg-orange-200/30 blur-3xl" />
                  <div className="absolute left-1/2 top-[45%] h-80 w-80 -translate-x-1/2 rounded-full bg-sky-200/20 blur-3xl" />
                </div>

                <div className="relative z-10 px-4 pt-3">
                  <div className="mx-auto max-w-[420px] rounded-[1.35rem] border border-white/70 bg-white/82 px-4 py-3 shadow-[0_10px_30px_rgba(15,23,42,0.08)] backdrop-blur-xl">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">
                        Discover
                      </div>
                      <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500 text-right">
                        {feedCountLabel}
                      </div>
                    </div>

                    <div className="mt-2.5 h-2 overflow-hidden rounded-full bg-slate-300/80">
                      <div
                        className="h-full rounded-full transition-all duration-500 shadow-sm"
                        style={{
                          width: `${browseProgressPercent}%`,
                          background: "linear-gradient(90deg, var(--seligo-cta), #f97316)",
                        }}
                      />
                    </div>

                    <div className="mt-2.5 flex items-center justify-between gap-3">
                      <div className="text-[11px] font-semibold text-slate-500">
                        Saved {savedUpgradeCount} pick{savedUpgradeCount === 1 ? "" : "s"}
                      </div>

                      <div className="text-[11px] text-slate-400">
                        Curated for your style
                      </div>
                    </div>
                  </div>
                </div>

                <div
                  className="relative z-10 flex items-start justify-center px-3 pt-3"
                  style={{
                    minHeight:
                      "calc(100svh - var(--seligo-header-h,76px) - 7rem - env(safe-area-inset-bottom))",
                  }}
                >
                  <div className="relative">
                    {nextBrowseProduct ? (
                      <>
                        <div className="pointer-events-none absolute inset-x-3 top-3 h-full rounded-[2rem] bg-white/70 shadow-lg scale-[0.97]" />
                        <div className="pointer-events-none absolute inset-x-5 top-5 h-[98%] overflow-hidden rounded-[1.9rem] opacity-40 shadow-md scale-[0.94]">
                          <img
                            src={nextBrowseProduct.imageUrl}
                            alt={nextBrowseProduct.name}
                            className="h-full w-full object-cover"
                          />
                          <div className="absolute inset-0 bg-white/45 backdrop-blur-[1px]" />
                        </div>
                      </>
                    ) : null}

                    <div className="relative animate-[seligo-pop-in_280ms_ease-out]">
                      <SwipeCard
                        key={products[currentIndex].id}
                        product={products[currentIndex]}
                        onSwipe={handleSwipe}
                        onSelectAction={handleAction}
                        onTap={() => openProductOverlay(products[currentIndex], { view: "browsing", source: "discover_tap" })}
                      />
                    </div>
                  </div>
                </div>

                <div className="relative z-10 px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-2">
                  <div className="mx-auto max-w-[420px] text-center text-[11px] font-semibold text-slate-400">
                    Swipe right to save upgrades
                  </div>
                </div>
              </div>
            ) : (
              <div className="min-h-full bg-[#fffaf6]">
                <div className="pointer-events-none fixed inset-0 overflow-hidden">
                  <div className="absolute left-1/2 top-[20%] h-72 w-72 -translate-x-1/2 rounded-full bg-orange-200/30 blur-3xl" />
                  <div className="absolute left-1/2 top-[45%] h-80 w-80 -translate-x-1/2 rounded-full bg-sky-200/20 blur-3xl" />
                </div>

                <div
                  className="relative z-10 flex items-center justify-center px-6"
                  style={{
                    minHeight:
                      "calc(100svh - var(--seligo-header-h,76px) - 7rem - env(safe-area-inset-bottom))",
                  }}
                >
                  <div className="max-w-[300px] animate-in fade-in zoom-in rounded-[2.5rem] border border-slate-100 bg-white p-8 text-center shadow-xl">
                    <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-[var(--seligo-primary)]/10">
                      <History className="h-8 w-8 text-[var(--seligo-primary)]" />
                    </div>
                    <h3 className="mb-2 text-lg font-black text-slate-900">No more items</h3>

                    <p className="mb-5 text-sm text-slate-500">
                      You’ve reached the end for these interests.
                    </p>

                    <div className="space-y-3">
                      <button
                        onClick={() => goView("interests", "browse_end_change_interests")}
                        className="w-full rounded-2xl py-4 font-extrabold text-white transition-colors"
                        style={{ background: "var(--seligo-cta)" }}
                      >
                        Change interests
                      </button>
                      <button
                        onClick={handleResetData}
                        className="w-full rounded-2xl bg-slate-100 py-4 font-extrabold text-slate-900 transition-colors hover:bg-slate-200"
                      >
                        Reset passes
                      </button>
                    </div>
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
              className="absolute inset-0 bg-black/45 backdrop-blur-[3px]"
              aria-label="Close"
              onClick={closeProductOverlay}
            />

            <div
              className="absolute inset-x-0 bottom-0 mx-auto w-full max-w-md px-0"
              style={{
                paddingBottom: "env(safe-area-inset-bottom)",
                paddingTop: "max(0.75rem, env(safe-area-inset-top))",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex max-h-[calc(100svh-env(safe-area-inset-top)-0.75rem)] flex-col overflow-hidden rounded-t-[2.25rem] border border-slate-200 bg-white shadow-2xl">
                <div className="flex shrink-0 justify-center pt-3 pb-2">
                  <div className="h-1.5 w-11 rounded-full bg-slate-200" />
                </div>

                <div className="relative h-[22svh] min-h-[150px] max-h-[220px] shrink-0 bg-slate-100">
                  <img
                    src={selectedProduct.imageUrl}
                    alt={selectedProduct.name}
                    className="absolute inset-0 h-full w-full object-contain bg-slate-100"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/20 via-black/0 to-transparent" />

                  <button
                    type="button"
                    onClick={closeProductOverlay}
                    aria-label="Back"
                    className="absolute left-3 top-3 z-40 flex h-10 w-10 items-center justify-center rounded-2xl border border-white/80 bg-white shadow-lg"
                  >
                    <ArrowLeft className="h-5 w-5 text-slate-900" />
                  </button>

                  <div className="absolute bottom-3 right-3 rounded-xl border border-white/70 bg-white/95 px-3 py-1.5 text-sm font-black text-slate-900 shadow-sm">
                    ${Number(selectedProduct.price || 0).toFixed(2)}
                  </div>
                </div>

                <div
                  ref={productOverlayScrollRef}
                  className="min-h-0 flex-1 overflow-y-auto no-scrollbar overscroll-contain px-6 pb-24"
                >
                  <div className="pt-4">
                    <div className="text-[10px] font-extrabold uppercase tracking-[0.22em] text-sky-500/80">
                      {overlayEyebrow}
                    </div>

                    <div className="mt-1 text-[28px] leading-tight font-extrabold text-slate-900">
                      {selectedProduct.name}
                    </div>

                    <div className="mt-2 text-sm leading-relaxed text-slate-600">
                      {overlaySupportText}
                    </div>

                    <div className="mt-3 text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">
                      {overlayBrand}
                    </div>
                  </div>

                  {Array.isArray(selectedProduct.tags) && selectedProduct.tags.length > 0 && (
                    <div className="mt-4 flex flex-wrap gap-2">
                      {selectedProduct.tags.slice(0, 10).map((t: string) => (
                        <span
                          key={t}
                          className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.14em] text-slate-700"
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  )}

                  <div className="mt-4 rounded-2xl border border-orange-100 bg-orange-50/80 p-3.5">
                    <div className="text-[11px] font-black uppercase tracking-[0.18em] text-orange-600">
                      Why it fits
                    </div>
                    <div className="mt-2 text-sm font-semibold text-slate-900">
                      {overlayWhyItFits}
                    </div>
                    <div className="mt-1 text-xs leading-relaxed text-slate-600">
                      Good for small spaces, renter-friendly styling, and building a room shortlist without overspending.
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    <span className="rounded-full bg-slate-100 px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.14em] text-slate-700">
                      Affordable pick
                    </span>
                    <span className="rounded-full bg-slate-100 px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.14em] text-slate-700">
                      Small-space friendly
                    </span>
                    <span className="rounded-full bg-slate-100 px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.14em] text-slate-700">
                      Retailer checkout
                    </span>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-2 text-[11px]">
                    <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-slate-700 font-bold">
                      Ships via retailer
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-slate-700 font-bold">
                      Secure checkout on retailer site
                    </div>
                  </div>

                  {selectedProduct.description && (
                    <div className="mt-4 text-[13px] leading-relaxed text-slate-600">
                      <div
                        className="whitespace-pre-wrap"
                        style={
                          descOpen
                            ? {}
                            : {
                                maxHeight: "4.8em",
                                overflow: "hidden",
                              }
                        }
                      >
                        {selectedProduct.description}
                      </div>

                      {String(selectedProduct.description).length > 140 && (
                        <button
                          onClick={() => setDescOpen((v) => !v)}
                          className="mt-2 text-xs font-extrabold text-slate-900"
                          type="button"
                        >
                          {descOpen ? "Show less" : "Read more"}
                        </button>
                      )}
                    </div>
                  )}
                </div>

                <div
                  className="sticky bottom-0 border-t border-slate-200 bg-white/95 px-6 pt-3.5 backdrop-blur-xl"
                  style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
                >
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      onClick={() => {
                        if (!selectedProduct) return;
                        saveProductFromOverlay(selectedProduct);
                        closeProductOverlay();
                      }}
                      disabled={overlayIsSaved}
                      className="h-12 rounded-2xl bg-slate-100 font-extrabold text-slate-900 disabled:opacity-60 disabled:cursor-default"
                    >
                      {overlaySaveLabel}
                    </button>

                    <button
                      onClick={() => {
                        if (!selectedProduct) return;
                        addProductToBagFromOverlay(selectedProduct);
                        closeProductOverlay();
                      }}
                      disabled={overlayIsInBag}
                      className="flex h-12 items-center justify-center gap-2 rounded-2xl font-extrabold text-white disabled:opacity-60 disabled:cursor-default"
                      style={{ background: "var(--seligo-cta)" }}
                    >
                      <span>{overlayBagLabel}</span>
                      {!overlayIsInBag ? <span className="opacity-90">•</span> : null}
                      {!overlayIsInBag ? <span>${Number(selectedProduct.price || 0).toFixed(2)}</span> : null}
                    </button>
                  </div>

                  <div className="mt-3 space-y-1.5">
                    <div className="text-[11px] text-slate-500">
                      {overlayFooterText}
                    </div>

                    <div className="text-[11px] leading-relaxed text-slate-500">
                      {AFFILIATE_DISCLOSURE_TEXT}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {showSavedSheet && (
          <div className="fixed inset-0 z-[9998]">
            <button
              className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
              onClick={() => setShowSavedSheet(false)}
              aria-label="Close saved"
            />

            <div
              className="absolute inset-x-0 bottom-0 mx-auto w-full max-w-md rounded-t-[2.25rem] border border-slate-100 bg-white shadow-2xl"
              style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
            >
              <div className="p-5">
                <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-slate-200" />

                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-lg font-black text-slate-900">Saved</div>
                    <div className="mt-1 text-sm text-slate-500">
                      {userPrefs.wishlist.length} saved upgrade{userPrefs.wishlist.length === 1 ? "" : "s"}
                    </div>
                  </div>

                  <button
                    onClick={() => setShowSavedSheet(false)}
                    className="h-10 w-10 rounded-2xl bg-slate-100 flex items-center justify-center"
                    aria-label="Close"
                  >
                    <X className="w-5 h-5 text-slate-600" />
                  </button>
                </div>

                {userPrefs.wishlist.length === 0 ? (
                  <div className="mt-5 rounded-[1.75rem] border border-slate-200 bg-gradient-to-b from-slate-50 to-white p-5 text-center">
                    <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-rose-50 border border-rose-100">
                      <Heart className="h-6 w-6 text-rose-500" />
                    </div>

                    <div className="mt-4 text-base font-black text-slate-900">
                      No saved upgrades yet
                    </div>

                    <div className="mt-2 text-sm leading-relaxed text-slate-500">
                      Swipe right on anything you want to revisit later. Your saved picks will show up here.
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        setShowSavedSheet(false);
                        goView("browsing", "saved_empty_cta");
                      }}
                      className="mt-4 h-11 w-full rounded-2xl bg-slate-900 text-white font-extrabold"
                    >
                      Start saving upgrades
                    </button>
                  </div>
                ) : (
                  <div className="mt-4 max-h-[58vh] overflow-y-auto overscroll-contain space-y-3 pr-1">
                    {userPrefs.wishlist.map((p) => (
                      <div
                        key={p.id}
                        className="rounded-[1.5rem] border border-slate-100 bg-white p-3 shadow-[0_10px_30px_rgba(15,23,42,0.05)] transition-transform active:scale-[0.99]"
                      >
                        <div className="flex gap-3">
                          <img
                            src={p.imageUrl}
                            alt={p.name}
                            className="h-20 w-20 rounded-2xl object-cover bg-slate-100"
                          />

                          <div className="min-w-0 flex-1">
                            <div className="text-[10px] font-black uppercase tracking-[0.18em] text-rose-500">
                              Saved upgrade
                            </div>

                            <div className="mt-1 line-clamp-2 font-black leading-tight text-slate-900">
                              {p.name}
                            </div>

                            <div className="mt-2 flex items-center gap-2">
                              <div className="rounded-xl bg-slate-50 px-2.5 py-1.5 text-sm font-black text-slate-900">
                                ${(Number(p.price) || 0).toFixed(2)}
                              </div>

                              <div className="text-[11px] font-semibold text-slate-400">
                                Easy to revisit
                              </div>
                            </div>

                            <div className="mt-3 grid grid-cols-2 gap-2">
                              <button
                                onClick={() => openSavedProduct(p)}
                                className="h-10 rounded-xl border border-slate-200 bg-white text-xs font-black text-slate-700"
                              >
                                View
                              </button>

                              <button
                                onClick={() => moveWishlistToCart(p)}
                                className="h-10 rounded-xl text-xs font-black text-white active:scale-[0.98] transition"
                                style={{ background: "var(--seligo-cta)" }}
                              >
                                Move to Bag
                              </button>
                            </div>

                            <button
                              onClick={() => removeFromWishlist(p.id)}
                              className="mt-2 text-[11px] font-bold text-slate-400 hover:text-slate-600"
                            >
                              Remove
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {showBagSheet && (
          <div className="fixed inset-0 z-[9998]">
            <button
              className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
              onClick={() => setShowBagSheet(false)}
              aria-label="Close bag"
            />

            <div
              className="absolute inset-x-0 bottom-0 mx-auto w-full max-w-md rounded-t-[2.25rem] border border-slate-100 bg-white shadow-2xl"
              style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
            >
              <div className="p-5">
                <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-slate-200" />

                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-lg font-black text-slate-900">Bag</div>
                    <div className="mt-1 text-sm text-slate-500">
                      {userPrefs.cart.length} item{userPrefs.cart.length === 1 ? "" : "s"} ready
                    </div>
                  </div>

                  <button
                    onClick={() => setShowBagSheet(false)}
                    className="h-10 w-10 rounded-2xl bg-slate-100 flex items-center justify-center"
                    aria-label="Close"
                  >
                    <X className="w-5 h-5 text-slate-600" />
                  </button>
                </div>

                {userPrefs.cart.length === 0 ? (
                  <div className="mt-5 rounded-[1.75rem] border border-slate-200 bg-gradient-to-b from-slate-50 to-white p-5 text-center">
                    <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-orange-50 border border-orange-100">
                      <ShoppingBag className="h-6 w-6 text-[var(--seligo-cta)]" />
                    </div>

                    <div className="mt-4 text-base font-black text-slate-900">
                      Your bag is empty
                    </div>

                    <div className="mt-2 text-sm leading-relaxed text-slate-500">
                      Add a few upgrades to compare and check out later.
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        setShowBagSheet(false);
                        goView("browsing", "bag_empty_cta");
                      }}
                      className="mt-4 h-11 w-full rounded-2xl text-white font-extrabold"
                      style={{ background: "var(--seligo-cta)" }}
                    >
                      Find room upgrades
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="mt-4 max-h-[44vh] overflow-y-auto overscroll-contain space-y-3 pr-1">
                      {userPrefs.cart.map((p) => (
                        <div
                          key={p.id}
                          className="rounded-[1.5rem] border border-slate-100 bg-white p-3 shadow-[0_10px_30px_rgba(15,23,42,0.05)] transition-transform active:scale-[0.99]"
                        >
                          <div className="flex gap-3">
                            <img
                              src={p.imageUrl}
                              alt={p.name}
                              className="h-20 w-20 rounded-2xl object-cover bg-slate-100"
                            />

                            <div className="min-w-0 flex-1">
                              <div className="text-[10px] font-black uppercase tracking-[0.18em] text-orange-500">
                                In your bag
                              </div>

                              <div className="mt-1 line-clamp-2 font-black leading-tight text-slate-900">
                                {p.name}
                              </div>

                              <div className="mt-2 flex items-center gap-2">
                                <div className="rounded-xl bg-slate-50 px-2.5 py-1.5 text-sm font-black text-slate-900">
                                  ${(Number(p.price) || 0).toFixed(2)}
                                </div>

                                <div className="text-[11px] font-semibold text-slate-400">
                                  Ready for checkout
                                </div>
                              </div>

                              <div className="mt-3 grid grid-cols-2 gap-2">
                                <button
                                  onClick={() => openBagProduct(p)}
                                  className="h-10 rounded-xl border border-slate-200 bg-white text-xs font-black text-slate-700"
                                >
                                  View
                                </button>

                                <button
                                  onClick={() => moveCartToWishlist(p)}
                                  className="h-10 rounded-xl bg-slate-900 text-xs font-black text-white active:scale-[0.98] transition"
                                >
                                  Move to Saved
                                </button>
                              </div>

                              <button
                                onClick={() => removeFromCart(p.id)}
                                className="mt-2 text-[11px] font-bold text-slate-400 hover:text-slate-600"
                              >
                                Remove
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="mt-4 rounded-[1.5rem] border border-slate-100 bg-slate-50 p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">
                            Subtotal
                          </div>
                          <div className="mt-1 text-lg font-black text-slate-900">
                            ${subtotal.toFixed(2)}
                          </div>
                        </div>

                        <div className="text-right">
                          <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">
                            Items
                          </div>
                          <div className="mt-1 text-lg font-black text-slate-900">
                            {userPrefs.cart.length}
                          </div>
                        </div>
                      </div>

                      <div className="mt-3 text-[11px] leading-relaxed text-slate-500">
                        Retailer pages open after you continue.
                      </div>

                      <button
                        type="button"
                        onClick={continueToCheckout}
                        disabled={userPrefs.cart.length === 0}
                        className="mt-4 h-12 w-full rounded-2xl text-white font-extrabold disabled:opacity-50 shadow-[0_16px_34px_rgba(251,146,60,0.30)]"
                        style={{ background: "linear-gradient(90deg, var(--seligo-cta), #f97316)" }}
                      >
                        Review retailer links
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        )}

                {view === 'profile' && (
          <Screen className="bg-white">
            <PageHeader
              title="Your style"
              subtitle="What Seligo is learning from your picks"
              onClose={() => goView("browsing", "profile_close")}
            />

            <div className="space-y-5 pb-8">
              <div
                className="relative overflow-hidden rounded-[2rem] p-6 text-white shadow-[0_24px_60px_rgba(15,23,42,0.18)]"
                style={{
                  background:
                    "linear-gradient(135deg, #0f172a 0%, #111827 45%, var(--seligo-primary) 100%)",
                }}
              >
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.18),transparent_32%)] pointer-events-none" />

                <div className="relative flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.22em] text-white/80 backdrop-blur-sm border border-white/10">
                      <BrainCircuit className="w-4 h-4" />
                      Taste profile
                    </div>

                    <div className="mt-4 text-3xl font-black tracking-tight leading-tight">
                      {vibe}
                    </div>

                    <p className="mt-2 max-w-[26rem] text-sm leading-6 text-white/80">
                      {summaryLine}
                    </p>
                  </div>

                  <div className="shrink-0 rounded-2xl bg-white/10 px-3 py-2 border border-white/10 backdrop-blur-sm text-right">
                    <div className="text-[10px] font-black uppercase tracking-[0.22em] text-white/70">
                      Budget
                    </div>
                    <div className="mt-1 text-sm font-black">
                      {userPrefs.persona.priceSensitivity || "Flexible"}
                    </div>
                  </div>
                </div>

                <div className="relative mt-5 flex flex-wrap gap-2">
                  {primaryKeywords.length ? (
                    primaryKeywords.map((k) => (
                      <span
                        key={k}
                        className="px-3 py-1.5 rounded-full text-xs font-bold bg-white/10 border border-white/15 backdrop-blur-sm"
                      >
                        {k}
                      </span>
                    ))
                  ) : (
                    <span className="text-sm text-white/70">
                      Keep swiping to sharpen your taste profile.
                    </span>
                  )}
                </div>
              </div>

              <SectionCard className="border border-slate-200/70 bg-white shadow-none">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">
                      Preferences
                    </div>
                    <div className="mt-1 text-lg font-black text-slate-900">
                      Your current Seligo lane
                    </div>
                  </div>
                  <div className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">
                    Updates as you swipe
                  </div>
                </div>

                <div className="mt-4 space-y-4">
                  <div>
                    <div className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400 mb-2">
                      Best spaces
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {topRooms.length ? (
                        topRooms.slice(0, 4).map((t) => (
                          <span
                            key={t}
                            className="px-3 py-1.5 rounded-full bg-[var(--seligo-primary)]/10 text-[var(--seligo-primary)] text-xs font-bold"
                          >
                            {t}
                          </span>
                        ))
                      ) : (
                        <span className="text-sm italic text-slate-400">
                          No room preferences detected yet.
                        </span>
                      )}
                    </div>
                  </div>

                  <div>
                    <div className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400 mb-2">
                      Best categories
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {topCategories.length ? (
                        topCategories.slice(0, 5).map((t) => (
                          <span
                            key={t}
                            className="px-3 py-1.5 rounded-full bg-slate-100 text-slate-700 text-xs font-bold"
                          >
                            {t}
                          </span>
                        ))
                      ) : (
                        <span className="text-sm italic text-slate-400">
                          No category preferences detected yet.
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </SectionCard>

              <div className="grid grid-cols-1 gap-3">
                <SectionCard className="border border-slate-200/70 bg-white shadow-none">
                  <div className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">
                    We'll show more of
                  </div>
                  <div className="mt-2 text-base font-black text-slate-900">
                    Picks that feel closer to your style
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {showMore.length ? (
                      showMore.map((t) => (
                        <span
                          key={t}
                          className="px-3 py-1.5 rounded-full bg-emerald-50 text-emerald-700 text-xs font-bold"
                        >
                          {t}
                        </span>
                      ))
                    ) : (
                      <span className="text-sm italic text-slate-400">
                        Match a few more items to sharpen recommendations.
                      </span>
                    )}
                  </div>
                  <div className="mt-3 text-sm text-slate-500">
                    Your matches are already shaping what lands in Discover next.
                  </div>
                </SectionCard>

                <SectionCard className="border border-slate-200/70 bg-white shadow-none">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">
                        We'll show less of
                      </div>
                      <div className="mt-2 text-base font-black text-slate-900">
                        Hidden tags and weaker-fit styles
                      </div>
                    </div>

                    {blockedTags.length > 0 && (
                      <button
                        onClick={clearBlockedTags}
                        className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500 hover:text-slate-700"
                      >
                        Clear hidden
                      </button>
                    )}
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    {showLess.length ? (
                      showLess.map((t) => {
                        const active = blockedSet.has(t);
                        return (
                          <span
                            key={t}
                            className={
                              active
                                ? "px-3 py-1.5 rounded-full bg-rose-600 text-white text-xs font-bold"
                                : "px-3 py-1.5 rounded-full bg-rose-50 text-rose-600 text-xs font-bold"
                            }
                          >
                            {t}
                          </span>
                        );
                      })
                    ) : (
                      <span className="text-sm italic text-slate-400">
                        No dealbreakers set yet.
                      </span>
                    )}
                  </div>

                  <div className="mt-3 text-sm text-slate-500">
                    Use dealbreakers below to hide styles you want less often.
                  </div>
                </SectionCard>
              </div>

              <SectionCard className="border border-slate-200/70 bg-white shadow-none">
                <div className="flex items-center justify-between mb-2 gap-3">
                  <div>
                    <div className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">
                      Dealbreakers
                    </div>
                    <div className="mt-1 text-lg font-black text-slate-900">
                      Show less of these
                    </div>
                  </div>

                  {blockedTags.length > 0 && (
                    <div className="text-[11px] text-slate-500">
                      Hidden tags: <span className="font-black text-slate-900">{blockedTags.length}</span>
                    </div>
                  )}
                </div>

                <div className="text-sm text-slate-500 mb-4">
                  Tap a tag to hide it from your feed.
                </div>

                <div className="flex flex-wrap gap-2">
                  {Array.from(new Set(avoidedSource)).map((t) => {
                    const active = blockedSet.has(t);
                    return (
                      <button
                        key={t}
                        onClick={() => toggleBlockedTag(t)}
                        className={
                          active
                            ? "px-4 py-2 rounded-full text-xs font-black bg-rose-600 text-white shadow-sm"
                            : "px-4 py-2 rounded-full text-xs font-black bg-rose-50 text-rose-600 hover:bg-rose-100 transition-colors"
                        }
                        title={active ? "Hidden from feed" : "Tap to hide from feed"}
                      >
                        {active ? `Hidden: ${t}` : t}
                      </button>
                    );
                  })}
                </div>
              </SectionCard>

              <SectionCard className="border border-slate-200/70 bg-slate-50/80 shadow-none">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">
                      Activity
                    </div>
                    <div className="mt-1 text-lg font-black text-slate-900">
                      Your recent signals
                    </div>
                  </div>

                  <div className="rounded-full bg-white px-3 py-1.5 border border-slate-200 text-xs font-black text-slate-700">
                    {streak} day streak
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-3 gap-3">
                  <div className="rounded-2xl bg-white border border-slate-200/70 p-4">
                    <Heart className="w-4 h-4 text-[var(--seligo-accent)] mb-2" />
                    <div className="text-xl font-black text-slate-900">{userPrefs.likedProducts.length}</div>
                    <div className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">
                      Matches
                    </div>
                  </div>

                  <div className="rounded-2xl bg-white border border-slate-200/70 p-4">
                    <History className="w-4 h-4 text-slate-400 mb-2" />
                    <div className="text-xl font-black text-slate-900">{userPrefs.dislikedProducts.length}</div>
                    <div className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">
                      Passes
                    </div>
                  </div>

                  <div className="rounded-2xl bg-white border border-slate-200/70 p-4">
                    <ShoppingBag className="w-4 h-4 text-[var(--seligo-cta)] mb-2" />
                    <div className="text-xl font-black text-slate-900">{savedCount}</div>
                    <div className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">
                      Saved
                    </div>
                  </div>
                </div>

                <div className="mt-4 text-sm text-slate-500">
                  Today: <span className="font-bold text-slate-700">{matchesToday}</span> matches •{" "}
                  <span className="font-bold text-slate-700">{passesToday}</span> passes •{" "}
                  <span className="font-bold text-slate-700">{savesToday}</span> saved
                </div>
              </SectionCard>

              <div className="pt-2">
                <button
                  onClick={shareLink}
                  className="w-full py-4 rounded-2xl text-white font-black shadow-sm"
                  style={{ background: "var(--seligo-cta)" }}
                >
                  Share Seligo.AI
                </button>

                <button
                  onClick={() => setShowHowItWorks(true)}
                  className="w-full py-4 rounded-2xl bg-slate-100 text-slate-900 font-black mt-3 hover:bg-slate-200 transition-colors"
                >
                  How it works
                </button>

                <button
                  onClick={handleResetData}
                  className="w-full py-4 bg-rose-50 text-rose-600 border border-rose-100 rounded-2xl font-black uppercase tracking-[0.22em] text-xs flex items-center justify-center gap-2 hover:bg-rose-100 transition-colors mt-3"
                >
                  <RotateCcw className="w-4 h-4" />
                  Reset my data
                </button>

                {/* Legal section */}
                <div className="mt-6 rounded-[1.5rem] border border-slate-200 bg-white p-4 shadow-sm">
                  <h3 className="text-xs font-black uppercase tracking-[0.22em] text-slate-400 mb-3">Legal</h3>
                  <div className="space-y-2">
                    <button
                      type="button"
                      onClick={() => goView("about", "profile_about")}
                      className="w-full text-left text-sm font-semibold text-slate-700 py-2 px-3 rounded-xl hover:bg-slate-50 transition-colors"
                    >
                      About Seligo
                    </button>
                    <button
                      type="button"
                      onClick={() => goView("privacy", "profile_privacy")}
                      className="w-full text-left text-sm font-semibold text-slate-700 py-2 px-3 rounded-xl hover:bg-slate-50 transition-colors"
                    >
                      Privacy Policy
                    </button>
                    <button
                      type="button"
                      onClick={() => goView("terms", "profile_terms")}
                      className="w-full text-left text-sm font-semibold text-slate-700 py-2 px-3 rounded-xl hover:bg-slate-50 transition-colors"
                    >
                      Terms of Use
                    </button>
                    <button
                      type="button"
                      onClick={() => goView("disclosure", "profile_disclosure")}
                      className="w-full text-left text-sm font-semibold text-slate-700 py-2 px-3 rounded-xl hover:bg-slate-50 transition-colors"
                    >
                      Affiliate Disclosure
                    </button>
                    <button
                      type="button"
                      onClick={() => goView("contact", "profile_contact")}
                      className="w-full text-left text-sm font-semibold text-slate-700 py-2 px-3 rounded-xl hover:bg-slate-50 transition-colors"
                    >
                      Contact
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </Screen>
        )}

{view === 'roomscan' && (
          <div className="min-h-full bg-[#fffaf6]">
            <RoomScanPage
              onApply={applyRoomScan}
              picks={roomScanPicks.map(p => ({ product: p.product, rationale: p.rationale }))}
              pickStatus={roomScanPickStatus}
              onSavePick={addToWishlistFromRoomScan}
              onBagPick={addToCartFromRoomScan}
              onEmailPicks={openRoomScanLeadCapture}
              onGoExplore={() => goView("browsing", "roomscan_go_explore")}
              onDismissPick={dismissRoomScanPick}
              onScanAgain={() => {
                setRoomScanPicks([]);
                setRoomScanPickStatus("idle");
              }}
            />
          </div>
        )}

        {view === "cart" && (
          <Screen className="bg-white">
            <PageHeader
              title="Your shortlist"
              subtitle="Review your saved picks and bag before checkout."
              onClose={() => goView("browsing", "shortlist_close")}
            />

            <div className="pt-3 pb-32">
              {shortlistCount > 0 ? (
                <div className="space-y-3.5">
                  <div className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">
                    Checkout
                  </div>

                  <div className="rounded-[1.5rem] border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">
                          Bag subtotal
                        </div>
                        <div className="mt-1 text-[28px] leading-none font-black text-slate-900">
                          ${shortlistSubtotal.toFixed(2)}
                        </div>
                        <div className="mt-2 text-xs text-slate-500">
                          {userPrefs.cart.length} in bag • {userPrefs.wishlist.length} saved
                        </div>
                      </div>

                      <div className="rounded-[1.15rem] border border-slate-200 bg-slate-50 px-3 py-2 text-right">
                        <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">
                          Total picks
                        </div>
                        <div className="mt-1 text-lg font-black text-slate-900">
                          {shortlistCount}
                        </div>
                      </div>
                    </div>

                    <div className="mt-3 text-[11px] leading-relaxed text-slate-500">
                      Retailer pages open after you continue.
                    </div>

                    <button
                      type="button"
                      onClick={() => openCheckout("shortlist_summary")}
                      disabled={userPrefs.cart.length === 0}
                      className="mt-4 h-12 w-full rounded-2xl text-white font-extrabold disabled:opacity-50 shadow-[0_16px_34px_rgba(251,146,60,0.30)]"
                      style={{ background: "linear-gradient(90deg, var(--seligo-cta), #f97316)" }}
                    >
                      Review retailer links
                    </button>
                  </div>

                  {userPrefs.cart.length > 0 && (
                    <section>
                      <div className="mb-3 flex items-center justify-between">
                        <div className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">
                          In Bag
                        </div>
                        <div className="text-[11px] font-semibold text-slate-500">
                          {userPrefs.cart.length} item{userPrefs.cart.length === 1 ? "" : "s"}
                        </div>
                      </div>

                      <div className="space-y-3.5">
                        {userPrefs.cart.map((item) => (
                          <div
                            key={item.id}
                            className="grid grid-cols-[76px_minmax(0,1fr)] gap-3 rounded-[1.5rem] border border-slate-200 bg-white p-3.5 shadow-sm"
                          >
                            <button
                              type="button"
                              className="block h-[76px] w-[76px] shrink-0"
                              onClick={() => openShortlistProduct(item, "shortlist_bag")}
                            >
                              <img
                                src={item.imageUrl}
                                alt={item.name}
                                className="h-[76px] w-[76px] rounded-[1.1rem] bg-slate-100 object-cover"
                              />
                            </button>

                            <div className="min-w-0">
                              <button
                                type="button"
                                onClick={() => openShortlistProduct(item, "shortlist_bag")}
                                className="block w-full text-left"
                              >
                                <div className="line-clamp-2 text-[15px] font-black leading-[1.15] text-slate-900">
                                  {item.name}
                                </div>
                                <div className="mt-1 line-clamp-2 text-[13px] leading-5 text-slate-500">
                                  {item.description || "Affordable room upgrade"}
                                </div>
                              </button>

                              <div className="mt-2.5 space-y-2.5">
                                <div className="text-[15px] font-black text-slate-900">
                                  ${Number(item.price ?? 0).toFixed(2)}
                                </div>

                                <div className="flex flex-wrap gap-2">
                                  <button
                                    type="button"
                                    onClick={() => shortlistActions.onMoveCartItemToSaved(item.id)}
                                    className="h-9 rounded-xl border border-slate-200 bg-slate-50 px-3 text-[13px] font-bold text-slate-700 transition-colors hover:bg-slate-100"
                                  >
                                    Save
                                  </button>

                                  <button
                                    type="button"
                                    onClick={() => shortlistActions.onRemoveCartItem(item.id)}
                                    className="h-9 rounded-xl border border-rose-200 bg-rose-50/60 px-3 text-[13px] font-bold text-rose-600 transition-colors hover:bg-rose-100"
                                  >
                                    Remove
                                  </button>
                                </div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </section>
                  )}

                  {userPrefs.wishlist.length > 0 && (
                    <section>
                      <div className="mb-3 flex items-center justify-between">
                        <div className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">
                          Saved
                        </div>
                        <div className="text-[11px] font-semibold text-slate-500">
                          {userPrefs.wishlist.length} item{userPrefs.wishlist.length === 1 ? "" : "s"}
                        </div>
                      </div>

                      <div className="space-y-3.5">
                        {userPrefs.wishlist.map((item) => (
                          <div
                            key={item.id}
                            className="grid grid-cols-[76px_minmax(0,1fr)] gap-3 rounded-[1.5rem] border border-slate-200 bg-white p-3.5 shadow-sm"
                          >
                            <button
                              type="button"
                              className="block h-[76px] w-[76px] shrink-0"
                              onClick={() => openShortlistProduct(item, "shortlist_saved")}
                            >
                              <img
                                src={item.imageUrl}
                                alt={item.name}
                                className="h-[76px] w-[76px] rounded-[1.1rem] bg-slate-100 object-cover"
                              />
                            </button>

                            <div className="min-w-0">
                              <button
                                type="button"
                                onClick={() => openShortlistProduct(item, "shortlist_saved")}
                                className="block w-full text-left"
                              >
                                <div className="line-clamp-2 text-[15px] font-black leading-[1.15] text-slate-900">
                                  {item.name}
                                </div>
                                <div className="mt-1 line-clamp-2 text-[13px] leading-5 text-slate-500">
                                  {item.description || "Saved for later"}
                                </div>
                              </button>

                              <div className="mt-2.5 space-y-2.5">
                                <div className="text-[15px] font-black text-slate-900">
                                  ${Number(item.price ?? 0).toFixed(2)}
                                </div>

                                <div className="flex flex-wrap gap-2">
                                  <button
                                    type="button"
                                    onClick={() => shortlistActions.onMoveSavedItemToBag(item.id)}
                                    className="h-9 rounded-xl bg-[var(--seligo-cta)] px-3 text-[13px] font-extrabold text-white shadow-sm transition-colors hover:brightness-105"
                                  >
                                    Add to Bag
                                  </button>

                                  <button
                                    type="button"
                                    onClick={() => shortlistActions.onRemoveSavedItem(item.id)}
                                    className="h-9 rounded-xl border border-rose-200 bg-rose-50/60 px-3 text-[13px] font-bold text-rose-600 transition-colors hover:bg-rose-100"
                                  >
                                    Remove
                                  </button>
                                </div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </section>
                  )}
                </div>
              ) : (
                <div className="min-h-[52vh] flex flex-col items-center justify-center text-center">
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-orange-100 bg-orange-50">
                    <ShoppingBag className="h-6 w-6 text-[var(--seligo-cta)]" />
                  </div>

                  <div className="mt-4 text-base font-black text-slate-900">
                    Your shortlist is empty
                  </div>

                  <div className="mt-2 max-w-[18rem] text-sm leading-relaxed text-slate-500">
                    Add room upgrades from Explore, Saved, or RoomScan to compare them here.
                  </div>

                  <button
                    type="button"
                    onClick={() => goView("browsing", "shortlist_empty_go_explore")}
                    className="mt-4 h-11 rounded-2xl bg-slate-900 px-5 font-extrabold text-white"
                  >
                    Go to Explore
                  </button>
                </div>
              )}
            </div>
          </Screen>
        )}
      </main>

      <CheckoutLinksModal
        open={showCheckout}
        onClose={() => setShowCheckout(false)}
        showActionToast={(label) => showActionToast("undo", label)}
        onOpenProduct={openProductOverlayFromCheckout}
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
        setLeadEmail={handleLeadEmailChange}
        hasSavedLeadEmail={!!leadEmail.trim()}
        leadStatus={leadStatus}
        leadError={leadError}
        onSubmitLead={submitLead}
        postBuyLeadOpen={postBuyLeadOpen}
        setPostBuyLeadOpen={setPostBuyLeadOpen}
        roomscanLeadRequestNonce={roomscanLeadRequestNonce}
        leadSource={leadSource}
        setLeadSource={setLeadSourceTracked}
        onOpenRetailerLink={openRetailerLink}
        onRemoveCartItem={removeCartItemFromCheckout}
        onMoveCartItemToSaved={moveCartItemToSavedFromCheckout}
        onRemoveSavedItem={removeSavedItemFromCheckout}
        onMoveSavedItemToBag={moveSavedItemToBagFromCheckout}
      />


  <HowItWorksModal open={showHowItWorks} onClose={() => setShowHowItWorks(false)} />

      {actionToast ? (
        <div className="fixed left-1/2 bottom-[calc(6rem+env(safe-area-inset-bottom))] z-[9999] -translate-x-1/2">
          <div
            className={[
              "flex items-center gap-3 rounded-full px-4 py-2 text-xs font-black text-white shadow-xl backdrop-blur",
              actionToast.type === "save"
                ? "bg-emerald-500"
                : actionToast.type === "bag"
                  ? "bg-[var(--seligo-cta)]"
                  : "bg-slate-900",
            ].join(" ")}
          >
            <span>{actionToast.label}</span>

            {actionToast.actionLabel && actionToast.onAction ? (
              <button
                type="button"
                onClick={() => {
                  actionToast.onAction?.();
                  setActionToast(null);
                  if (actionToastTimeoutRef.current) {
                    window.clearTimeout(actionToastTimeoutRef.current);
                    actionToastTimeoutRef.current = null;
                  }
                }}
                className="pointer-events-auto rounded-full bg-white/15 px-3 py-1 text-[11px] font-black text-white hover:bg-white/25"
              >
                {actionToast.actionLabel}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {!overlayOpen && (
        <nav
          className="sticky bottom-0 z-[300] bg-white/90 backdrop-blur-xl border-t border-slate-100"
          style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        >
          <div className="h-[4.75rem] px-6 flex items-center justify-between">
            <NavItem
              active={view === "browsing"}
              label="Explore"
              onClick={() => goView("browsing", "bottom_nav_explore")}
              icon={<Compass className="w-6 h-6" />}
            />

            <NavItem
              active={view === "profile"}
              label="Style"
              onClick={() => goView("profile", "bottom_nav_style")}
              icon={<BrainCircuit className="w-6 h-6" />}
            />

            <NavItem
              active={view === "roomscan"}
              label="RoomScan"
              onClick={() => goView("roomscan", "bottom_nav_roomscan")}
              icon={<Scan className="w-6 h-6" />}
            />

            <NavItem
              active={view === "cart"}
              label="Bag"
              onClick={() => goView("cart", "bottom_nav_bag")}
              icon={
                <div className="relative">
                  <ShoppingBag className="w-6 h-6" />
                  {userPrefs.cart.length > 0 && (
                    <span className="absolute -top-1 -right-1 w-3 h-3 bg-[var(--seligo-primary)] rounded-full border-2 border-white" />
                  )}
                </div>
              }
            />
          </div>
        </nav>
      )}
      </div>
      </div>
    </div>
  );
};

export default App;
