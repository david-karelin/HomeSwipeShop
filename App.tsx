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
import VerticalFeed from './components/VerticalFeed';
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
import { getSeoPresetFromUrl, type SeoPreset } from './src/lib/seoPresets';
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

const CAT_TAG_MAP: Record<string, string[]> = {
  "desk-setup": ["desk", "desk-setup", "workspace", "monitor", "organizer"],
  "cozy-bedroom": ["bedroom", "cozy-bedroom", "bed", "pillow", "nightstand"],
  "wall-decor": ["wall", "wall-decor", "wall-art", "poster", "print", "canvas"],
  "lighting": ["lighting", "lamp", "light", "led", "bulb", "fairy-lights"],
  "storage": ["storage", "organizer", "basket", "tray", "bin", "box", "shelf"],
  "mirrors": ["mirror", "mirrors"],
  "plants": ["plant", "plants", "succulent", "planter", "pot"],
};

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

const toStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value.map((item) => (typeof item === "string" ? item : String(item)));
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
      style={{ minWidth: 64 }}
      aria-current={active ? "page" : undefined}
    >
      <div
        className={`flex h-11 w-11 items-center justify-center rounded-[14px] transition-all duration-200 ${
          active
            ? "bg-[var(--seligo-primary)] text-white shadow-[0_4px_14px_rgba(14,165,233,0.38)]"
            : "text-slate-500 hover:text-slate-700"
        }`}
      >
        {icon}
      </div>
      <span
        className={`text-[9px] font-extrabold uppercase tracking-[0.16em] transition-colors ${
          active ? "text-[var(--seligo-primary)]" : "text-slate-500"
        }`}
      >
        {label}
      </span>
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

const AboutScreen = ({ onBack, onNavigate }: { onBack: () => void; onNavigate: (view: AppState, source?: string) => void }) => (
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

      <div className="mt-10 rounded-3xl border border-slate-200 bg-slate-50 p-5">
        <div className="text-xs font-black uppercase tracking-[0.2em] text-slate-500">
          Decor Guides
        </div>

        <h3 className="mt-2 text-xl font-bold text-slate-900">
          Explore ideas by space and budget
        </h3>

        <p className="mt-2 text-sm leading-6 text-slate-600">
          Browse quick guides for bedrooms, dorms, and small apartments.
        </p>

        <div className="mt-4 flex flex-col gap-3">
          <a
            href="/bedroom-decor-under-50"
            onClick={(e) => {
              e.preventDefault();
              onNavigate("bedroomDecorUnder50", "decor_guides");
            }}
            className="rounded-2xl border border-slate-200 bg-white px-4 py-3 font-semibold text-slate-800 transition hover:bg-slate-100"
          >
            Bedroom Decor Under $50
          </a>

          <a
            href="/dorm-room-decor-ideas"
            onClick={(e) => {
              e.preventDefault();
              onNavigate("dormRoomDecorIdeas", "decor_guides");
            }}
            className="rounded-2xl border border-slate-200 bg-white px-4 py-3 font-semibold text-slate-800 transition hover:bg-slate-100"
          >
            Dorm Room Decor Ideas
          </a>

          <a
            href="/small-apartment-decor"
            onClick={(e) => {
              e.preventDefault();
              onNavigate("smallApartmentDecor", "decor_guides");
            }}
            className="rounded-2xl border border-slate-200 bg-white px-4 py-3 font-semibold text-slate-800 transition hover:bg-slate-100"
          >
            Small Apartment Decor
          </a>
        </div>
      </div>
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

/* ─────────────────────────────────────────────────────────────────────────────
   SEO Landing Pages
───────────────────────────────────────────────────────────────────────────── */

const BedroomDecorUnder50Screen = ({
  onBack,
  onNavigate,
}: {
  onBack: () => void;
  onNavigate: (view: AppState, source?: string) => void;
}) => {
  useEffect(() => {
    document.title = "Bedroom Decor Under $50 | Affordable Room Upgrades | Seligo";

    const setMeta = (name: string, content: string) => {
      let tag = document.querySelector(`meta[name="${name}"]`) as HTMLMetaElement | null;
      if (!tag) {
        tag = document.createElement("meta");
        tag.setAttribute("name", name);
        document.head.appendChild(tag);
      }
      tag.setAttribute("content", content);
    };

    const setCanonical = (href: string) => {
      let link = document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
      if (!link) {
        link = document.createElement("link");
        link.setAttribute("rel", "canonical");
        document.head.appendChild(link);
      }
      link.setAttribute("href", href);
    };

    const setJsonLd = (id: string, data: Record<string, unknown>) => {
      let script = document.getElementById(id) as HTMLScriptElement | null;
      if (!script) {
        script = document.createElement("script");
        script.type = "application/ld+json";
        script.id = id;
        document.head.appendChild(script);
      }
      script.textContent = JSON.stringify(data);
    };

    setMeta(
      "description",
      "Browse affordable bedroom decor under $50, including lamps, mirrors, wall art, storage, and renter-friendly room upgrades for small spaces."
    );
    setCanonical("https://www.seligo.app/bedroom-decor-under-50");

    setJsonLd("seo-bedroom-under-50", {
      "@context": "https://schema.org",
      "@type": "WebPage",
      name: "Bedroom Decor Under $50",
      url: "https://www.seligo.app/bedroom-decor-under-50",
      description:
        "Affordable bedroom decor ideas under $50, including lighting, mirrors, wall art, storage, and renter-friendly upgrades.",
    });

    return () => {
      document.title = "Seligo | Swipe Home Decor for Bedrooms, Dorms, and Small Spaces";
      setMeta(
        "description",
        "Discover affordable room upgrades faster. Seligo lets you swipe through decor for bedrooms, dorms, apartments, and small spaces."
      );
      setCanonical("https://www.seligo.app/");
      const script = document.getElementById("seo-bedroom-under-50");
      if (script) script.remove();
    };
  }, []);

  return (
    <main className="min-h-screen bg-white text-slate-900">
      <div className="mx-auto max-w-3xl px-6 py-12">
        <button
          onClick={onBack}
          className="mb-8 text-sm font-medium text-sky-600 hover:underline"
        >
          ← Back to Seligo
        </button>

        <h1 className="text-4xl font-bold tracking-tight">Bedroom Decor Under $50</h1>

        <p className="mt-6 text-lg leading-8 text-slate-700">
          Decorating a bedroom does not need a huge budget. The best low-cost upgrades
          are usually the ones that add warmth, storage, or visual interest without
          taking up much space. For renters, students, and anyone decorating a smaller
          room, affordable pieces can make a space feel more intentional without turning
          into a full redesign project.
        </p>

        <section className="mt-10">
          <h2 className="text-2xl font-semibold">Best low-cost bedroom upgrades</h2>
          <p className="mt-4 leading-8 text-slate-600">
            Start with the items that change the feel of a room quickly. Lighting helps a
            bedroom feel warmer. Mirrors reflect light and make small spaces feel more
            open. Wall decor adds personality without using floor space, while storage and
            small bedside accents make the room feel cleaner and more finished.
          </p>

          <ul className="mt-4 ml-6 list-disc space-y-2 text-slate-600">
            <li><strong>LED string lights or fairy lights</strong> — instant cozy glow for under $15</li>
            <li><strong>Small accent mirror</strong> — makes a room feel larger and brighter</li>
            <li><strong>Floating shelf</strong> — vertical storage without taking up floor space</li>
            <li><strong>Throw pillow covers</strong> — quick color or texture refresh for $10–20</li>
            <li><strong>Desktop organizer or tray</strong> — keeps a nightstand or desk clutter-free</li>
          </ul>
        </section>

        <section className="mt-10">
          <h2 className="text-2xl font-semibold">How to decorate a bedroom on a budget</h2>
          <p className="mt-4 leading-8 text-slate-600">
            The easiest way to decorate on a budget is to improve one area at a time.
            Instead of buying everything at once, start with the upgrade that changes the
            room most noticeably. That might be softer lighting, a mirror above a dresser,
            better visible storage, or one statement object that gives the room character.
            Budget decorating works best when the items are compact, practical, and easy
            to mix with what you already own.
          </p>

          <p className="mt-4 leading-8 text-slate-600">
            Renter-friendly upgrades are especially useful in bedrooms. Adhesive hooks,
            removable wall decor, peel-and-stick details, and compact storage solutions let
            you personalize the room without making permanent changes.
          </p>
        </section>

        <section className="mt-10">
          <h2 className="text-2xl font-semibold">What to prioritize first</h2>
          <p className="mt-4 leading-8 text-slate-600">
            If you only have room in the budget for one or two upgrades, start with
            lighting and visible clutter. Those two changes usually make the biggest
            difference. A bedroom feels more expensive when it looks calm, organized, and
            softly lit, even if most of the items are inexpensive.
          </p>
        </section>

        <section className="mt-10">
          <h2 className="text-2xl font-semibold">Why use Seligo</h2>
          <p className="mt-4 leading-8 text-slate-600">
            Seligo makes decor browsing faster by letting you swipe through affordable room
            upgrades instead of opening lots of product tabs. It is built for bedrooms,
            dorms, and small apartments, with a focus on pieces that feel realistic for
            everyday budgets. That makes it easier to discover ideas quickly, save the
            ones that match your vibe, and move on from the ones that do not.
          </p>
        </section>

        <div className="mt-10 flex flex-wrap gap-4">
          <a
            href="/?preset=bedroom_under_50"
            className="inline-flex rounded-2xl bg-sky-500 px-5 py-3 font-semibold text-white transition hover:bg-sky-600"
          >
            Browse Bedroom Picks Under $50
          </a>

          <a
            href="/dorm-room-decor-ideas"
            onClick={(e) => {
              e.preventDefault();
              onNavigate("dormRoomDecorIdeas", "seo_internal_link");
            }}
            className="inline-flex rounded-2xl border border-slate-300 px-5 py-3 font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            Dorm Room Ideas
          </a>

          <a
            href="/small-apartment-decor"
            onClick={(e) => {
              e.preventDefault();
              onNavigate("smallApartmentDecor", "seo_internal_link");
            }}
            className="inline-flex rounded-2xl border border-slate-300 px-5 py-3 font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            Small Apartment Decor
          </a>
        </div>
      </div>
    </main>
  );
};

const DormRoomDecorIdeasScreen = ({
  onBack,
  onNavigate,
}: {
  onBack: () => void;
  onNavigate: (view: AppState, source?: string) => void;
}) => {
  useEffect(() => {
    document.title = "Dorm Room Decor Ideas | Budget-Friendly College Room Upgrades | Seligo";

    const setMeta = (name: string, content: string) => {
      let tag = document.querySelector(`meta[name="${name}"]`) as HTMLMetaElement | null;
      if (!tag) {
        tag = document.createElement("meta");
        tag.setAttribute("name", name);
        document.head.appendChild(tag);
      }
      tag.setAttribute("content", content);
    };

    const setCanonical = (href: string) => {
      let link = document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
      if (!link) {
        link = document.createElement("link");
        link.setAttribute("rel", "canonical");
        document.head.appendChild(link);
      }
      link.setAttribute("href", href);
    };

    const setJsonLd = (id: string, data: Record<string, unknown>) => {
      let script = document.getElementById(id) as HTMLScriptElement | null;
      if (!script) {
        script = document.createElement("script");
        script.type = "application/ld+json";
        script.id = id;
        document.head.appendChild(script);
      }
      script.textContent = JSON.stringify(data);
    };

    setMeta(
      "description",
      "Explore dorm room decor ideas including LED lights, storage solutions, desk accessories, and renter-friendly wall art for college students."
    );
    setCanonical("https://www.seligo.app/dorm-room-decor-ideas");

    setJsonLd("seo-dorm-decor", {
      "@context": "https://schema.org",
      "@type": "WebPage",
      name: "Dorm Room Decor Ideas",
      url: "https://www.seligo.app/dorm-room-decor-ideas",
      description:
        "Budget-friendly dorm room decor ideas including lights, storage, desk accessories, and damage-free wall art for college students.",
    });

    setJsonLd("seo-dorm-breadcrumb", {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        {
          "@type": "ListItem",
          position: 1,
          name: "Home",
          item: "https://www.seligo.app/",
        },
        {
          "@type": "ListItem",
          position: 2,
          name: "Decor Guides",
          item: "https://www.seligo.app/about",
        },
        {
          "@type": "ListItem",
          position: 3,
          name: "Dorm Room Decor Ideas",
          item: "https://www.seligo.app/dorm-room-decor-ideas",
        },
      ],
    });

    return () => {
      document.title = "Seligo | Swipe Home Decor for Bedrooms, Dorms, and Small Spaces";
      setMeta(
        "description",
        "Discover affordable room upgrades faster. Seligo lets you swipe through decor for bedrooms, dorms, apartments, and small spaces."
      );
      setCanonical("https://www.seligo.app/");
      const script = document.getElementById("seo-dorm-decor");
      if (script) script.remove();
      const breadcrumbScript = document.getElementById("seo-dorm-breadcrumb");
      if (breadcrumbScript) breadcrumbScript.remove();
    };
  }, []);

  return (
    <main className="min-h-screen bg-white text-slate-900">
      <div className="mx-auto max-w-3xl px-6 py-12">
        <button
          onClick={onBack}
          className="mb-8 text-sm font-medium text-sky-600 hover:underline"
        >
          ← Back to Seligo
        </button>

        <nav aria-label="Breadcrumb" className="mb-4 text-sm text-slate-500">
          <ol className="flex flex-wrap items-center gap-2">
            <li>
              <a
                href="/"
                onClick={(e) => {
                  e.preventDefault();
                  onNavigate("browsing", "breadcrumb_home");
                }}
                className="hover:text-slate-700"
              >
                Home
              </a>
            </li>
            <li>/</li>
            <li>
              <a
                href="/about"
                onClick={(e) => {
                  e.preventDefault();
                  onNavigate("about", "breadcrumb_guides");
                }}
                className="hover:text-slate-700"
              >
                Decor Guides
              </a>
            </li>
            <li>/</li>
            <li className="font-medium text-slate-700">Dorm Room Decor Ideas</li>
          </ol>
        </nav>

        <h1 className="text-4xl font-bold tracking-tight">Dorm Room Decor Ideas</h1>

        <p className="mt-6 text-lg leading-8 text-slate-700">
          A dorm room is usually small, shared, and temporary, but that does not mean it
          has to feel boring. With a few affordable upgrades, you can make your space
          feel more personal, more organized, and more comfortable without breaking dorm
          rules or overspending. The best dorm decor ideas are usually compact, useful,
          and easy to remove at the end of the school year.
        </p>

        <section className="mt-10">
          <h2 className="text-2xl font-semibold">Best dorm room upgrades</h2>
          <p className="mt-4 leading-8 text-slate-600">
            When space is limited, the best upgrades are the ones that improve both style
            and function. Good lighting makes a dorm feel warmer. Vertical storage helps
            you use walls, doors, and under-bed space more efficiently. Desk accessories,
            soft textiles, and a few small personal touches can make the room feel more
            finished without creating clutter.
          </p>

          <ul className="mt-4 ml-6 list-disc space-y-2 text-slate-600">
            <li><strong>LED strip lights or fairy lights</strong> — add ambiance without relying on harsh overhead lighting</li>
            <li><strong>Over-door hooks and organizers</strong> — maximize vertical space in a small room</li>
            <li><strong>Desk lamp with USB port</strong> — practical for studying and charging devices</li>
            <li><strong>Command-strip photo display</strong> — personalize walls without nails</li>
            <li><strong>Under-bed storage bins</strong> — make use of hidden storage for clothes and supplies</li>
          </ul>
        </section>

        <section className="mt-10">
          <h2 className="text-2xl font-semibold">Dorm decor that is renter-friendly</h2>
          <p className="mt-4 leading-8 text-slate-600">
            Most dorms have restrictions on nails, paint, and permanent wall changes, so
            renter-friendly decor matters. Damage-free wall hooks, removable adhesive
            strips, lightweight wall art, and peel-and-stick details are good options
            because they let you customize the room without causing problems at move-out.
          </p>

          <p className="mt-4 leading-8 text-slate-600">
            Soft items can also do a lot of visual work in a dorm. Throw blankets, pillow
            covers, bed risers, and a compact rug can make the room feel more comfortable
            without requiring permanent installation.
          </p>
        </section>

        <section className="mt-10">
          <h2 className="text-2xl font-semibold">Where to start</h2>
          <p className="mt-4 leading-8 text-slate-600">
            If you are decorating a dorm room from scratch, start with three priorities:
            better lighting, cleaner storage, and one or two personal accents. Those
            changes usually make the biggest difference first. A dorm feels better when it
            looks organized and intentional, even if the actual decor budget is small.
          </p>

          <p className="mt-4 leading-8 text-slate-600">
            Try to avoid buying too many small decorative items at once. In a dorm, too
            much visual clutter makes the room feel tighter. A few useful upgrades usually
            work better than a long list of random accessories.
          </p>
        </section>

        <section className="mt-10">
          <h2 className="text-2xl font-semibold">Why use Seligo for dorm decor</h2>
          <p className="mt-4 leading-8 text-slate-600">
            Seligo makes it easier to discover affordable room upgrades without opening a
            bunch of shopping tabs. Instead of searching store by store, you can swipe
            through decor ideas built for bedrooms, dorms, apartments, and other small
            spaces. That helps you quickly find dorm-friendly pieces that match your vibe,
            budget, and available space.
          </p>
        </section>

        <div className="mt-10 flex flex-wrap gap-4">
          <a
            href="/?preset=dorm_ideas"
            className="inline-flex rounded-2xl bg-sky-500 px-5 py-3 font-semibold text-white transition hover:bg-sky-600"
          >
            Browse Dorm-Friendly Decor
          </a>

          <a
            href="/bedroom-decor-under-50"
            onClick={(e) => {
              e.preventDefault();
              onNavigate("bedroomDecorUnder50", "seo_internal_link");
            }}
            className="inline-flex rounded-2xl border border-slate-300 px-5 py-3 font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            Bedroom Decor Under $50
          </a>

          <a
            href="/small-apartment-decor"
            onClick={(e) => {
              e.preventDefault();
              onNavigate("smallApartmentDecor", "seo_internal_link");
            }}
            className="inline-flex rounded-2xl border border-slate-300 px-5 py-3 font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            Small Apartment Decor
          </a>
        </div>
      </div>
    </main>
  );
};

const SmallApartmentDecorScreen = ({
  onBack,
  onNavigate,
}: {
  onBack: () => void;
  onNavigate: (view: AppState, source?: string) => void;
}) => {
  useEffect(() => {
    document.title = "Small Apartment Decor | Space-Saving Ideas for Renters | Seligo";

    const setMeta = (name: string, content: string) => {
      let tag = document.querySelector(`meta[name="${name}"]`) as HTMLMetaElement | null;
      if (!tag) {
        tag = document.createElement("meta");
        tag.setAttribute("name", name);
        document.head.appendChild(tag);
      }
      tag.setAttribute("content", content);
    };

    const setCanonical = (href: string) => {
      let link = document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
      if (!link) {
        link = document.createElement("link");
        link.setAttribute("rel", "canonical");
        document.head.appendChild(link);
      }
      link.setAttribute("href", href);
    };

    const setJsonLd = (id: string, data: Record<string, unknown>) => {
      let script = document.getElementById(id) as HTMLScriptElement | null;
      if (!script) {
        script = document.createElement("script");
        script.type = "application/ld+json";
        script.id = id;
        document.head.appendChild(script);
      }
      script.textContent = JSON.stringify(data);
    };

    setMeta(
      "description",
      "Discover small apartment decor ideas that maximize space. Renter-friendly picks for studios, one-bedrooms, and compact living spaces."
    );
    setCanonical("https://www.seligo.app/small-apartment-decor");

    setJsonLd("seo-small-apartment", {
      "@context": "https://schema.org",
      "@type": "WebPage",
      name: "Small Apartment Decor",
      url: "https://www.seligo.app/small-apartment-decor",
      description:
        "Space-saving decor ideas for small apartments, studios, and rentals. Renter-friendly furniture, storage, and accent pieces.",
    });

    setJsonLd("seo-apartment-breadcrumb", {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        {
          "@type": "ListItem",
          position: 1,
          name: "Home",
          item: "https://www.seligo.app/",
        },
        {
          "@type": "ListItem",
          position: 2,
          name: "Decor Guides",
          item: "https://www.seligo.app/about",
        },
        {
          "@type": "ListItem",
          position: 3,
          name: "Small Apartment Decor",
          item: "https://www.seligo.app/small-apartment-decor",
        },
      ],
    });

    return () => {
      document.title = "Seligo | Swipe Home Decor for Bedrooms, Dorms, and Small Spaces";
      setMeta(
        "description",
        "Discover affordable room upgrades faster. Seligo lets you swipe through decor for bedrooms, dorms, apartments, and small spaces."
      );
      setCanonical("https://www.seligo.app/");
      const script = document.getElementById("seo-small-apartment");
      if (script) script.remove();
      const breadcrumbScript = document.getElementById("seo-apartment-breadcrumb");
      if (breadcrumbScript) breadcrumbScript.remove();
    };
  }, []);

  return (
    <main className="min-h-screen bg-white text-slate-900">
      <div className="mx-auto max-w-3xl px-6 py-12">
        <button
          onClick={onBack}
          className="mb-8 text-sm font-medium text-sky-600 hover:underline"
        >
          ← Back to Seligo
        </button>

        <nav aria-label="Breadcrumb" className="mb-4 text-sm text-slate-500">
          <ol className="flex flex-wrap items-center gap-2">
            <li>
              <a
                href="/"
                onClick={(e) => {
                  e.preventDefault();
                  onNavigate("browsing", "breadcrumb_home");
                }}
                className="hover:text-slate-700"
              >
                Home
              </a>
            </li>
            <li>/</li>
            <li>
              <a
                href="/about"
                onClick={(e) => {
                  e.preventDefault();
                  onNavigate("about", "breadcrumb_guides");
                }}
                className="hover:text-slate-700"
              >
                Decor Guides
              </a>
            </li>
            <li>/</li>
            <li className="font-medium text-slate-700">Small Apartment Decor</li>
          </ol>
        </nav>

        <h1 className="text-4xl font-bold tracking-tight">Small Apartment Decor</h1>

        <p className="mt-6 text-lg leading-8 text-slate-700">
          Living in a small apartment means every square foot counts. The right decor
          choices can make a compact space feel bigger, brighter, and more functional
          without cluttering it up. For renters, the challenge is finding pieces that
          work without permanent modifications and still feel worth bringing with you
          when you move.
        </p>

        <section className="mt-10">
          <h2 className="text-2xl font-semibold">Best decor for small apartments</h2>
          <p className="mt-4 leading-8 text-slate-600">
            Prioritize pieces that serve double duty: storage that looks good, mirrors
            that open up space, and furniture that folds, stacks, or nests away. In a
            small apartment, every item should earn its place. Look for pieces that are
            compact, easy to move, and visually light. Bulky furniture and heavy-looking
            decor can make a small room feel even tighter.
          </p>

          <ul className="mt-4 ml-6 list-disc space-y-2 text-slate-600">
            <li><strong>Wall-mounted shelves</strong> — get storage off the floor</li>
            <li><strong>Large mirror</strong> — reflects light and makes rooms feel bigger</li>
            <li><strong>Nesting tables</strong> — extra surface area when you need it</li>
            <li><strong>Over-toilet storage</strong> — turns dead bathroom space into shelving</li>
            <li><strong>Slim console table</strong> — entryway organization without blocking walkways</li>
          </ul>
        </section>

        <section className="mt-10">
          <h2 className="text-2xl font-semibold">Apartment decor tips for renters</h2>
          <p className="mt-4 leading-8 text-slate-600">
            Stick to removable solutions where possible: peel-and-stick backsplash,
            tension rods, freestanding furniture, removable wall hooks, and picture
            hanging strips. These give you flexibility without creating problems when
            it is time to move out.
          </p>

          <p className="mt-4 leading-8 text-slate-600">
            Think vertically too. In a small apartment, floor space disappears quickly,
            but wall space is often underused. Floating shelves, tall bookcases, and
            wall-mounted organizers help you store more without making the room feel
            crowded.
          </p>
        </section>

        <section className="mt-10">
          <h2 className="text-2xl font-semibold">How to make a small apartment feel bigger</h2>
          <p className="mt-4 leading-8 text-slate-600">
            Small spaces usually feel better when they are brighter, less crowded, and
            visually consistent. Mirrors help reflect light. Better lamps make corners
            feel less cramped. A tighter color palette can make a room feel calmer and
            more open. Even a few small changes, like replacing cluttered surfaces with
            trays or baskets, can make the apartment feel more intentional.
          </p>
        </section>

        <section className="mt-10">
          <h2 className="text-2xl font-semibold">Where to start</h2>
          <p className="mt-4 leading-8 text-slate-600">
            If your apartment feels cramped or cluttered, start with storage and lighting.
            Getting items off surfaces and into visible storage makes a room look cleaner
            almost immediately. Then add one or two accent pieces that give the room
            personality without taking up extra floor space.
          </p>
        </section>

        <section className="mt-10">
          <h2 className="text-2xl font-semibold">Why use Seligo for apartment decor</h2>
          <p className="mt-4 leading-8 text-slate-600">
            Seligo makes it easier to discover items that actually work in small spaces.
            Instead of scrolling through oversized furniture and random product pages,
            you can swipe through compact decor, space-saving storage, and affordable
            accents curated for apartments, studios, and rentals.
          </p>
        </section>

        <div className="mt-10 flex flex-wrap gap-4">
          <a
            href="/?preset=small_apartment"
            className="inline-flex rounded-2xl bg-sky-500 px-5 py-3 font-semibold text-white transition hover:bg-sky-600"
          >
            Browse Small-Space Picks
          </a>

          <a
            href="/bedroom-decor-under-50"
            onClick={(e) => {
              e.preventDefault();
              onNavigate("bedroomDecorUnder50", "seo_internal_link");
            }}
            className="inline-flex rounded-2xl border border-slate-300 px-5 py-3 font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            Bedroom Decor Under $50
          </a>

          <a
            href="/dorm-room-decor-ideas"
            onClick={(e) => {
              e.preventDefault();
              onNavigate("dormRoomDecorIdeas", "seo_internal_link");
            }}
            className="inline-flex rounded-2xl border border-slate-300 px-5 py-3 font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            Dorm Room Ideas
          </a>
        </div>
      </div>
    </main>
  );
};

/* ─────────────────────────────────────────────────────────────────────────────
   SEO URL ↔ View mapping helpers
───────────────────────────────────────────────────────────────────────────── */

const normalizePath = (pathname: string): string => {
  const clean = pathname.replace(/\/+$/, "");
  return clean === "" ? "/" : clean;
};

const pathToView = (pathname: string): AppState => {
  const path = normalizePath(pathname);
  switch (path) {
    case "/bedroom-decor-under-50":
      return "bedroomDecorUnder50";
    case "/dorm-room-decor-ideas":
      return "dormRoomDecorIdeas";
    case "/small-apartment-decor":
      return "smallApartmentDecor";
    case "/privacy":
      return "privacy";
    case "/terms":
      return "terms";
    case "/disclosure":
      return "disclosure";
    case "/about":
      return "about";
    case "/contact":
      return "contact";
    default:
      return "auth";
  }
};

const viewToPath = (view: AppState): string => {
  switch (view) {
    case "bedroomDecorUnder50":
      return "/bedroom-decor-under-50";
    case "dormRoomDecorIdeas":
      return "/dorm-room-decor-ideas";
    case "smallApartmentDecor":
      return "/small-apartment-decor";
    case "privacy":
      return "/privacy";
    case "terms":
      return "/terms";
    case "disclosure":
      return "/disclosure";
    case "about":
      return "/about";
    case "contact":
      return "/contact";
    default:
      return "/";
  }
};

const App: React.FC = () => {
  type LeadSource = "cart_confirm" | "post_buy_panel" | "roomscan";
  const adminEnabled =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("admin") === "1";
  const openRoomscanEnabled =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("open") === "roomscan";
  const [view, setView] = useState<AppState>(() => {
    if (typeof window === "undefined") return "auth";
    return pathToView(window.location.pathname);
  });
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
  const [showTuneModal, setShowTuneModal] = useState(false);
  const [showSwipeTutorial, setShowSwipeTutorial] = useState(() => {
    try { return !localStorage.getItem("seligo_swipe_tutorial_seen"); } catch { return true; }
  });
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [maxPrice, setMaxPrice] = useState<number | null>(null);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [undoCount, setUndoCount] = useState(0);
  const [noInteractionCount, setNoInteractionCount] = useState(0);
  const [showScrollNudge, setShowScrollNudge] = useState(false);
  const [getLinksNudgeDismissed, setGetLinksNudgeDismissed] = useState(false);
  const [postBuyLeadOpen, setPostBuyLeadOpen] = useState(false);
  const [roomscanLeadRequestNonce, setRoomscanLeadRequestNonce] = useState(0);
  const [leadSource, setLeadSource] = useState<LeadSource>("post_buy_panel");
  const [activeSeoPreset, setActiveSeoPreset] = useState<SeoPreset | null>(null);
  const leadSourceRef = useRef<LeadSource>("post_buy_panel");
  const swipedRef = useRef<Set<string>>(new Set());
  const impressedRef = useRef<Set<string>>(new Set());
  const undoRef = useRef<UndoEntry[]>([]);
  const roomScanImpressedRef = useRef<Set<string>>(new Set());
  const refineLockRef = useRef(false);
  const actionToastTimeoutRef = useRef<number | null>(null);
  const prevViewRef = useRef(view);
  const productOverlayScrollRef = useRef<HTMLDivElement | null>(null);
  const normalizedBlockedTags = useMemo(() => toStringArray(blockedTags), [blockedTags]);
  const blockedSet = useMemo(() => new Set(normalizedBlockedTags), [normalizedBlockedTags]);

  // Read SEO preset from URL on load
  useEffect(() => {
    const preset = getSeoPresetFromUrl();
    if (preset) {
      setActiveSeoPreset(preset);
      void Firestore.logEvent({
        type: "view_change",
        source: preset.source,
        view: "browsing",
        meta: { panel: "seo_entry", preset: preset.key },
      }).catch(console.warn);
    }
  }, []);

  // Score products by preset relevance
  const scoreProductByPreset = (product: Product, preset: SeoPreset | null): number => {
    if (!preset) return 0;
    let score = 0;
    const price = Number(product.price ?? 0);
    const categoryText = String(product.category ?? "").toLowerCase();
    const tagText = Array.isArray(product.tags) ? product.tags.join(" ").toLowerCase() : "";

    if (preset.maxPrice != null && price > 0 && price <= preset.maxPrice) {
      score += 3;
    }
    for (const c of preset.categories) {
      if (categoryText.includes(c.toLowerCase())) score += 4;
    }
    for (const t of preset.tags) {
      if (tagText.includes(t.toLowerCase())) score += 2;
    }
    return score;
  };

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
    const nextPath = viewToPath(next);
    if (window.location.pathname !== nextPath) {
      window.history.pushState({}, "", nextPath);
    }
    setShowSavedSheet(false);
    setShowBagSheet(false);
    setView(next);
    void Firestore.logEvent({ type: "view_change", source, view: next }).catch(console.warn);
  };

  // Direct-to-feed navigation — skips interests gate
  const goHome = (source = "nav") => {
    window.history.pushState({}, "", "/");
    void Firestore.logEvent({ type: "view_change", source, view: "browsing" }).catch(console.warn);
    const allIds = VIBE_CATEGORIES.map((c) => c.id);
    void startDiscovery(mapVibeCategoriesToInterests(allIds));
  };

  // Handle browser back/forward buttons
  useEffect(() => {
    const onPopState = () => {
      setView(pathToView(window.location.pathname));
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

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
      if (activeCategory) {
        const relatedTags = CAT_TAG_MAP[activeCategory] ?? [activeCategory];
        const matchesCategory = product.category === activeCategory;
        const productTags = Array.isArray(product.tags)
          ? product.tags.map((t) => String(t).toLowerCase())
          : [];
        const matchesTags = productTags.some((t) => relatedTags.includes(t));
        if (!matchesCategory && !matchesTags) return false;
      }
      if (maxPrice !== null && Number(product.price ?? 0) > maxPrice) return false;
      return true;
    });

    let ranked = rankAndDiversifyFeed(visible, interests);

    // Apply SEO preset scoring if active
    if (activeSeoPreset) {
      ranked = [...ranked].sort((a, b) => {
        const scoreA = scoreProductByPreset(a, activeSeoPreset);
        const scoreB = scoreProductByPreset(b, activeSeoPreset);
        return scoreB - scoreA;
      });
    }

    return ranked;
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

      setAllProducts(savedFeed);

      const curatedFeed = curateFeedProducts(savedFeed, normalizedSavedInterests);
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
    if (!allProducts.length) {
      setProducts([]);
      setCurrentIndex(0);
      return;
    }

    const curated = curateFeedProducts(allProducts);
    setProducts(curated);

    setCurrentIndex((prev) => {
      if (!curated.length) return 0;
      return Math.min(prev, curated.length - 1);
    });
  }, [allProducts, blockedTags, userPrefs.interests, activeSeoPreset, activeCategory, maxPrice]);

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
    void startDiscovery(mapVibeCategoriesToInterests(VIBE_CATEGORIES.map((c) => c.id)));
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

      const curatedFeed = curateFeedProducts(out, interests);
      setProducts(curatedFeed);
      setCursor(nextCursor);
      setHasMore(false);
      setCurrentIndex(0);

      if (opts.navigate !== false) setView("browsing");
      return curatedFeed;
    } catch (e) {
      console.error("Firestore load failed:", e);
      if (opts.navigate !== false) setView("browsing");
      return [];
    } finally {
      setIsLoading(false);
    }
  };

  // Auto-start: skip interests gate, go straight to feed on first load
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (adminEnabled || openRoomscanEnabled) return;
    const sp = new URLSearchParams(window.location.search);
    if (sp.get("view") || sp.get("open")) return;
    if (view !== "auth") return;
    const allIds = VIBE_CATEGORIES.map((c) => c.id);
    void startDiscovery(mapVibeCategoriesToInterests(allIds));
  }, []);

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
      try { navigator.vibrate?.(18); } catch {}
      showActionToast("undo", "Passed", { actionLabel: "Undo", onAction: undoLast });
      setCurrentIndex(i => i + 1);
      return;
    }
    openProductOverlay(currentProduct, { view: "browsing", source: activeSeoPreset?.source ?? "feed" });
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

    const newCount = userPrefs.wishlist.filter((p) => p.id !== product.id).length + 1;
    try { navigator.vibrate?.(40); } catch {}
    if (newCount === 5) {
      showActionToast("save", "5 picks saved — ready to shop? →", {
        actionLabel: "Get links",
        onAction: () => openCheckout("save_nudge_5"),
      });
    } else if (newCount === 3) {
      showActionToast("save", "3 picks saved! Get your checkout links →", {
        actionLabel: "Send me links",
        onAction: () => openCheckout("save_nudge_3"),
      });
    } else {
      showActionToast("save", "Saved to wishlist");
    }
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
    const gemini = analysis.geminiAnalysis as any | undefined;

    const pTagsRaw = Array.isArray(p.tags) ? p.tags.map(norm) : [];
    const pTags = pTagsRaw.map(aliasTag);
    const pCat = norm(p.category);

    const reasons: string[] = [];

    // ── Gemini-powered deep rationale ──────────────────────────────────────
    if (gemini) {
      const roomType: string = gemini.roomType ?? "";
      const colors: string[] = gemini.dominantColors ?? [];
      const style: string[] = gemini.styleKeywords ?? [];
      const missing: string[] = gemini.missingItems ?? [];
      const lighting: string = gemini.lightingCondition ?? "";
      const vibe: string = gemini.overallVibe ?? "";

      // Find the Gemini category match whose category best aligns with this product
      const categoryMatches: Array<{ category: string; reason: string; keywords: string[] }> =
        gemini.productCategoryMatches ?? [];
      const matched = categoryMatches.find((m) => {
        const mc = norm(m.category);
        return (
          pCat.includes(mc) ||
          mc.includes(pCat) ||
          m.keywords.some((k: string) => pTags.includes(norm(k)))
        );
      });

      if (matched?.reason) {
        reasons.push(matched.reason);
      } else if (vibe) {
        const colorStr = colors.slice(0, 2).join(" and ");
        const styleStr = style.slice(0, 2).join(", ");
        reasons.push(
          `Your ${styleStr || roomType} space has ${colorStr || "a distinctive"} palette — this fits the overall vibe: ${vibe}.`
        );
      }

      // Lighting-specific insight
      const isLightingProduct =
        pCat.includes("light") ||
        pTags.some((t) => t.includes("lamp") || t.includes("light") || t.includes("sconce"));
      if (isLightingProduct) {
        if (lighting.includes("dim")) {
          reasons.push("Dim lighting detected — this adds the warm glow your space is missing.");
        } else if (lighting.includes("cool")) {
          reasons.push("Cool-toned light detected — a warm lamp brings balance and makes the room feel lived-in.");
        }
      }

      // Missing item match
      const missingHit = missing.find((item) => {
        const m = norm(item).replace(/\s+/g, "-");
        return pTags.includes(m) || pCat.includes(m) || m.includes(pCat);
      });
      if (missingHit) {
        reasons.push(`Your scan flagged "${missingHit}" as missing — this fills exactly that gap.`);
      }

      // Color harmony insight
      if (colors.length > 0 && pTags.length > 0) {
        const colorKeywords = colors.map((c) => c.toLowerCase());
        const warmRoom = colorKeywords.some((c) =>
          ["beige", "cream", "warm", "tan", "sand", "wood", "oak", "walnut", "honey"].some((w) => c.includes(w))
        );
        const darkRoom = colorKeywords.some((c) =>
          ["black", "charcoal", "dark", "navy", "deep", "espresso"].some((w) => c.includes(w))
        );
        if (warmRoom && pTags.some((t) => t.includes("warm") || t.includes("natural") || t.includes("wood"))) {
          reasons.push(`Warm tones (${colors[0]}) detected — this natural material ties right into your palette.`);
        } else if (darkRoom && pTags.some((t) => t.includes("light") || t.includes("bright") || t.includes("white"))) {
          reasons.push(`Dark palette detected — this lighter piece creates contrast and prevents the space from feeling heavy.`);
        }
      }
    } else {
      // ── Fallback: local TF.js-based rationale ──────────────────────────────
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

      if (analysis.roomType) reasons.push(`Made for a ${prettyLabel(analysis.roomType)} refresh.`);
      else if (hasBed) reasons.push("Bedroom detected — optimizing for cozy + functional upgrades.");

      if (missingRug && (pCat.includes("rug") || pTags.some(t => t.includes("rug"))))
        reasons.push("No rug detected — adding one anchors the room and makes it feel warmer.");
      if (missingPlant && (pCat.includes("plant") || pTags.some(t => t.includes("plant"))))
        reasons.push("No plants detected — greenery adds life and contrast without clutter.");
      if (missingLamp && (pCat.includes("light") || pTags.some((t) => t.includes("lamp") || t.includes("light"))))
        reasons.push("Lighting looks limited — a lamp boosts warmth and ambiance.");
      if (hasBed && (pCat.includes("bed") || pTags.some(t => t.includes("pillow") || t.includes("throw"))))
        reasons.push("Bed is the focal point — upgraded bedding/pillows give the biggest visual payoff.");
      if (hasBed && (pCat.includes("wall") || pTags.some(t => t.includes("art") || t.includes("wall"))))
        reasons.push("Great above-bed upgrade — adds a focal point and makes the space feel finished.");

      const tagHits = intersects(pTags, [...vibe, ...recTags]).slice(0, 3);
      if (tagHits.length) reasons.push(`Matches your scan vibe: ${tagHits.map(prettyLabel).join(", ")}.`);

      const paletteTealish = palette.some((h) => {
        const hex = h.replace("#", "");
        if (hex.length !== 6) return false;
        const r = parseInt(hex.slice(0, 2), 16);
        const g = parseInt(hex.slice(2, 4), 16);
        const b = parseInt(hex.slice(4, 6), 16);
        return g > r && b > r && g > 80 && b > 80;
      });
      if ((vibe.includes("teal") || paletteTealish) && (pCat.includes("light") || pTags.includes("warm")))
        reasons.push("Your room reads cool/teal — warm lighting balances it and feels more inviting.");

      const catHit = recCats.find((c) => pCat.includes(c) || c.includes(pCat));
      if (catHit) reasons.push(`Matches your scan category: ${prettyLabel(catHit)}.`);

      const avoidHit = avoid.find((t) => pTags.includes(t));
      if (avoidHit) reasons.push(`Avoids a dealbreaker style: ${prettyLabel(avoidHit)}.`);
    }

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

    const interestsToUse =
      mergedInterests.length > 0
        ? mergedInterests
        : normalizeFeedInterestIds(userPrefs.interests).length > 0
          ? normalizeFeedInterestIds(userPrefs.interests)
          : mapVibeCategoriesToInterests(VIBE_CATEGORIES.map((c) => c.id)); // fallback: all categories

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

  // Set of saved product IDs for VerticalFeed
  const savedProductIds = useMemo(
    () => new Set(userPrefs.wishlist.map((p) => p.id)),
    [userPrefs.wishlist]
  );

  // Scroll-pass handler: logs and marks swiped but does NOT remove from allProducts
  const handleScrollPass = React.useCallback((product: Product) => {
    setUserPrefs((prev) => ({
      ...prev,
      dislikedProducts: [...prev.dislikedProducts, product],
    }));
    void Firestore.logEvent({
      type: "swipe_pass",
      productId: product.id,
      source: "feed_scroll",
      view: "browsing",
      meta: {
        category: product.category ?? "",
        tags: Array.isArray(product.tags) ? product.tags : [],
        price: Number(product.price ?? 0),
      },
    }).catch(console.warn);
    bumpTags(product, -1);
    swipedRef.current.add(product.id);
    logLocalActivity("pass");
    // Track consecutive no-interaction scrolls for nudge
    setNoInteractionCount((n) => {
      const next = n + 1;
      if (next === 10) setShowScrollNudge(true);
      return next;
    });
  }, []);

  const handleShare = React.useCallback(async (product: Product) => {
    const name = product.displayName || product.name || "this pick";
    const url = window.location.origin;
    try {
      if (navigator.share) {
        await navigator.share({
          title: name,
          text: `Check out this room upgrade I found on Seligo: ${name}`,
          url,
        });
        void Firestore.logEvent({ type: "share_click", productId: product.id, view: "browsing", source: "feed_scroll" }).catch(() => {});
      } else {
        await navigator.clipboard.writeText(`${name} — ${url}`);
        showActionToast("save", "Link copied to clipboard");
      }
    } catch {
      // user cancelled share — no-op
    }
  }, []);

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
    u.searchParams.set("utm_medium", "picks");
    u.searchParams.set("utm_campaign", "viral");
    return u.toString();
  }

  const shareMyPicks = async () => {
    const picks = [...userPrefs.wishlist, ...userPrefs.cart];
    const count = picks.length;
    const previewNames = picks
      .slice(0, 2)
      .map((p) => p.displayName || p.name)
      .filter(Boolean)
      .join(" & ");
    const text = count > 0
      ? `I found ${count} room upgrade${count === 1 ? "" : "s"} on Seligo${previewNames ? ` — including ${previewNames}` : ""}. Check it out:`
      : "Discover affordable home decor on Seligo:";
    const url = buildShareUrl();
    let shared = false;
    try {
      if (navigator.share) {
        await navigator.share({ title: "My Seligo picks", text, url });
        shared = true;
      }
    } catch { /* user cancelled */ }
    if (!shared) {
      try {
        await navigator.clipboard.writeText(`${text} ${url}`);
        showActionToast("save", "Link copied!");
      } catch {
        showActionToast("save", "Couldn’t copy link");
      }
    }
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

  // Category chip counts (unswiped, unblocked products per category)
  const catCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const [catId, relatedTags] of Object.entries(CAT_TAG_MAP)) {
      counts[catId] = allProducts.filter((p) => {
        if (swipedRef.current.has(p.id)) return false;
        if (isBlockedProduct(p)) return false;
        const pTags = Array.isArray(p.tags) ? p.tags.map((t) => String(t).toLowerCase()) : [];
        return p.category === catId || pTags.some((t) => relatedTags.includes(t));
      }).length;
    }
    return counts;
  }, [allProducts]);

  // Profile page derived values
  const vibe = userPrefs.persona.detectedVibe || "Still learning";
  const savedCount = userPrefs.wishlist.length + userPrefs.cart.length;
  const primaryKeywords = (userPrefs.persona.styleKeywords ?? []).slice(0, 5);
  const showMore = liked.slice(0, 4);
  const avoidedSource = toStringArray(
    userPrefs.persona.dislikedFeatures.length
      ? userPrefs.persona.dislikedFeatures
      : avoided
  );
  const showLess = Array.from(
    new Set([...normalizedBlockedTags, ...avoidedSource])
  ).slice(0, 4);
  const summaryLine =
    topRooms[0] && topCategories[0]
      ? `${vibe} picks with a focus on ${topRooms[0].toLowerCase()} upgrades and ${topCategories[0].toLowerCase()} that fit your budget.`
      : topCategories[0]
        ? `${vibe} picks with a preference for affordable ${topCategories[0].toLowerCase()} and cozy, renter-friendly upgrades.`
        : "Affordable, renter-friendly upgrades shaped by what you save, pass, and match.";

  const discoveryMessages = [
    "Finding your picks…",
    "Building your feed…",
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

  // Related products for "You may also like" in overlay
  const relatedOverlayProducts = useMemo(() => {
    if (!selectedProduct) return [];
    const selTags = Array.isArray(selectedProduct.tags)
      ? selectedProduct.tags.map((t) => String(t).toLowerCase())
      : [];
    const selCat = String(selectedProduct.category ?? "").toLowerCase();
    return allProducts
      .filter((p) => {
        if (p.id === selectedProduct.id) return false;
        const pTags = Array.isArray(p.tags) ? p.tags.map((t) => String(t).toLowerCase()) : [];
        const pCat = String(p.category ?? "").toLowerCase();
        if (pCat === selCat) return true;
        return pTags.some((t) => selTags.includes(t));
      })
      .slice(0, 6);
  }, [selectedProduct?.id, allProducts]);

  // Views
  if (view === 'auth' || view === 'interests') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#fffaf6] gap-4">
        <img src={seligoLogo} alt="Seligo" className="w-11 h-11" />
        <div className="relative w-10 h-10">
          <div className="absolute inset-0 rounded-full border-2 border-slate-100" />
          <div className="absolute inset-0 rounded-full border-2 border-t-[var(--seligo-cta)] animate-spin" />
        </div>
        <p className="text-sm font-semibold text-slate-500">Finding your picks…</p>
      </div>
    );
  }

  if (view === "privacy") return <PrivacyScreen onBack={() => goView("profile", "privacy_close")} />;
  if (view === "terms") return <TermsScreen onBack={() => goView("profile", "terms_close")} />;
  if (view === "disclosure") return <DisclosureScreen onBack={() => goView("profile", "disclosure_close")} />;
  if (view === "about") return <AboutScreen onBack={() => goView("profile", "about_close")} onNavigate={goView} />;
  if (view === "contact") return <ContactScreen onBack={() => goView("profile", "contact_close")} />;

  // SEO landing pages
  if (view === "bedroomDecorUnder50") {
    return (
      <BedroomDecorUnder50Screen
        onBack={() => goHome("seo_page_close")}
        onNavigate={goView}
      />
    );
  }
  if (view === "dormRoomDecorIdeas") {
    return (
      <DormRoomDecorIdeasScreen
        onBack={() => goHome("seo_page_close")}
        onNavigate={goView}
      />
    );
  }
  if (view === "smallApartmentDecor") {
    return (
      <SmallApartmentDecorScreen
        onBack={() => goHome("seo_page_close")}
        onNavigate={goView}
      />
    );
  }

  if (view === "admin") {
    if (!adminEnabled) return <div className="p-6">Not authorized.</div>;
    return <AdminScreen onBack={() => goView("profile", "admin_back")} />;
  }

  return (
    <div className="min-h-[100dvh] bg-gradient-to-br from-slate-200 via-slate-100 to-orange-50/40 flex items-center justify-center p-0 sm:p-6">
      <div className="w-full max-w-md h-[100dvh] sm:h-[min(100dvh,900px)] rounded-none sm:rounded-[2.5rem] overflow-hidden shadow-2xl border border-slate-200/60 bg-[#fafaf9]">
      <div className="h-full flex flex-col">
      {/* Header */}
      <header
        className="sticky top-0 z-[250] bg-white/98 backdrop-blur-xl border-b border-slate-100 shadow-[0_2px_16px_rgba(15,23,42,0.07)]"
        style={{ paddingTop: "env(safe-area-inset-top)" }}
      >
        {/* Brand accent strip */}
        <div className="h-[3px] w-full" style={{ background: "var(--seligo-cta)" }} />
        <div className="h-[4.5rem] px-5 flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <div className="relative shrink-0">
              <div className="w-10 h-10 rounded-[13px] overflow-hidden shadow-[0_2px_8px_rgba(14,165,233,0.25)] ring-2 ring-[var(--seligo-primary)]/20">
                <img
                  src={seligoLogo}
                  alt="Seligo"
                  className="w-full h-full object-cover"
                />
              </div>
              {isAlgorithmRunning && (
                <div className="absolute -top-1 -right-1 w-4 h-4 bg-[var(--seligo-accent)] rounded-full flex items-center justify-center animate-pulse border-2 border-white">
                  <BrainCircuit className="w-2 h-2 text-white" />
                </div>
              )}
            </div>

            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <div className="font-black text-[19px] leading-tight tracking-[-0.03em] text-slate-900 truncate">
                  Seligo
                </div>
                {streak > 1 && (
                  <div className="inline-flex items-center gap-1 rounded-full bg-orange-500 px-2 py-0.5 text-[10px] font-black text-white shadow-sm">
                    🔥 {streak}d
                  </div>
                )}
              </div>
              <div className="text-[10px] font-bold text-slate-400 truncate">
                {isAlgorithmRunning ? "Refining your picks…" : "Swipe to discover room upgrades"}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={undoLast}
              disabled={undoCount === 0}
              className="w-9 h-9 rounded-xl flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 disabled:opacity-30 transition-all"
              aria-label="Undo"
              title="Undo"
            >
              <RotateCcw className="w-4.5 h-4.5" />
            </button>

            <button
              onClick={openSavedSheet}
              className="relative w-9 h-9 rounded-xl flex items-center justify-center text-slate-400 hover:text-rose-500 hover:bg-rose-50 transition-all"
              aria-label="Saved"
              title="Saved"
            >
              <Heart className="w-[18px] h-[18px]" />
              {userPrefs.wishlist.length > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 bg-rose-500 text-white text-[9px] flex items-center justify-center rounded-full font-extrabold border border-white">
                  {userPrefs.wishlist.length}
                </span>
              )}
            </button>

            <button
              onClick={openBagSheet}
              className="relative w-9 h-9 rounded-xl flex items-center justify-center text-slate-400 hover:text-[var(--seligo-primary)] hover:bg-sky-50 transition-all"
              aria-label="Bag"
              title="Bag"
            >
              <ShoppingBag className="w-[18px] h-[18px]" />
              {userPrefs.cart.length > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 bg-[var(--seligo-primary)] text-white text-[9px] flex items-center justify-center rounded-full font-extrabold border border-white">
                  {userPrefs.cart.length}
                </span>
              )}
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main
        className="flex-1 overflow-y-auto no-scrollbar bg-[#fafaf9]"
        style={{
          paddingBottom:
            view === "browsing"
              ? "0"
              : view === "roomscan"
              ? "calc(4.0rem + env(safe-area-inset-bottom))"
              : "calc(4.75rem + env(safe-area-inset-bottom))",
        }}
      >
        {view === "discovering" && (
          <div className="flex min-h-[calc(100dvh-8rem)] flex-col items-center justify-center bg-[#fffaf6] p-8">
            <img src={seligoLogo} alt="Seligo" className="mb-8 w-11 h-11" />
            <div className="relative mb-6 w-12 h-12">
              <div className="absolute inset-0 rounded-full border-2 border-slate-100" />
              <div className="absolute inset-0 rounded-full border-2 border-t-[var(--seligo-cta)] animate-spin" />
            </div>
            <p className="text-[15px] font-semibold text-slate-700">
              {discoveryMessages[Math.min(discoveryStep, discoveryMessages.length - 1)]}
            </p>
            {userPrefs.interests.length > 0 && (
              <div className="mt-5 flex flex-wrap justify-center gap-2 max-w-xs">
                {userPrefs.interests.slice(0, 6).map((interestId) => {
                  const cat = VIBE_CATEGORIES.find((c) => c.id === interestId);
                  return cat ? (
                    <div key={interestId} className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-600">
                      {cat.emoji} {cat.label}
                    </div>
                  ) : null;
                })}
              </div>
            )}
          </div>
        )}

        {view === "browsing" && (
          <Screen
            animate={false}
            className={[
              overlayOpen ? "pointer-events-none" : "",
              "px-0 pt-0 pb-0 bg-transparent h-full flex flex-col",
            ].join(" ")}
          >
            {/* Sticky header: filter bar */}
            <div className="shrink-0 bg-white/95 backdrop-blur-sm border-b border-slate-100 z-20">
              <div className="px-4 pt-2.5 pb-1">
                <div className="mx-auto max-w-[520px] flex items-center gap-2">
                  <div className="flex-1 min-w-0 flex items-center gap-2 overflow-x-auto no-scrollbar">
                    {([
                      { id: null, label: "All", emoji: "✦", on: "bg-slate-900 text-white", off: "border border-slate-200 bg-white text-slate-600" },
                      { id: "lighting", label: "Lighting", emoji: "💡", on: "bg-amber-500 text-white", off: "border border-amber-200 bg-amber-50 text-amber-700" },
                      { id: "wall-decor", label: "Wall Art", emoji: "🖼️", on: "bg-violet-600 text-white", off: "border border-violet-200 bg-violet-50 text-violet-700" },
                      { id: "storage", label: "Storage", emoji: "🧺", on: "bg-sky-600 text-white", off: "border border-sky-200 bg-sky-50 text-sky-700" },
                      { id: "mirrors", label: "Mirrors", emoji: "🪞", on: "bg-slate-700 text-white", off: "border border-slate-200 bg-slate-50 text-slate-700" },
                      { id: "cozy-bedroom", label: "Bedroom", emoji: "🛏️", on: "bg-rose-500 text-white", off: "border border-rose-200 bg-rose-50 text-rose-700" },
                      { id: "desk-setup", label: "Desk", emoji: "🖥️", on: "bg-teal-600 text-white", off: "border border-teal-200 bg-teal-50 text-teal-700" },
                      { id: "plants", label: "Plants", emoji: "🪴", on: "bg-green-600 text-white", off: "border border-green-200 bg-green-50 text-green-700" },
                    ] as { id: string | null; label: string; emoji: string; on: string; off: string }[]).map((chip) => (
                      <button
                        key={chip.id ?? "all"}
                        type="button"
                        onClick={() => { setActiveCategory(chip.id); setCurrentIndex(0); }}
                        className={`shrink-0 flex items-center gap-1 rounded-full px-3 py-1.5 text-[10px] font-black transition-all ${
                          activeCategory === chip.id ? chip.on : chip.off
                        }`}
                      >
                        <span>{chip.emoji}</span>
                        <span>{chip.label}</span>
                        {chip.id !== null && (catCounts[chip.id] ?? 0) > 0 && (
                          <span className="text-[9px] font-black opacity-70">{catCounts[chip.id]}</span>
                        )}
                      </button>
                    ))}
                    <div className="shrink-0 w-px h-4 bg-slate-200 mx-0.5" />
                    {([
                      { label: "Any $", value: null },
                      { label: "$25", value: 25 },
                      { label: "$50", value: 50 },
                      { label: "$100", value: 100 },
                    ] as { label: string; value: number | null }[]).map((opt) => (
                      <button
                        key={opt.label}
                        type="button"
                        onClick={() => { setMaxPrice(opt.value); setCurrentIndex(0); }}
                        className={`shrink-0 rounded-full px-2.5 py-1.5 text-[10px] font-black transition-all ${
                          maxPrice === opt.value ? "bg-emerald-600 text-white" : "border border-emerald-200 bg-emerald-50 text-emerald-700"
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowTuneModal(true)}
                    className="shrink-0 flex items-center gap-1 rounded-full bg-[var(--seligo-primary)]/10 px-2.5 py-1.5 text-[10px] font-black text-[var(--seligo-primary)]"
                  >
                    ✨
                  </button>
                </div>
              </div>

              {/* Progress bar */}
              <div className="h-[3px] bg-slate-100">
                <div
                  className="h-full transition-all duration-500"
                  style={{
                    width: `${browseProgressPercent}%`,
                    background: "var(--seligo-cta)",
                  }}
                />
              </div>
            </div>

            {/* Feed or empty state */}
            <div className="relative flex-1 min-h-0">
              {/* Floating "Get my links" CTA — appears after 3+ saves */}
              {savedUpgradeCount >= 3 && !getLinksNudgeDismissed && (
                <div className="pointer-events-none absolute inset-x-0 bottom-4 z-30 flex justify-center">
                  <div className="pointer-events-auto flex items-center rounded-full shadow-[0_8px_28px_rgba(249,115,22,0.45)]" style={{ background: "var(--seligo-cta)" }}>
                    <button
                      type="button"
                      onClick={() => openCheckout("floating_cta")}
                      className="flex items-center gap-2 pl-5 pr-3 py-3 text-[13px] font-black text-white transition-all active:scale-[0.97]"
                    >
                      🛍️ {savedUpgradeCount} saved — get my links
                    </button>
                    <button
                      type="button"
                      onClick={() => setGetLinksNudgeDismissed(true)}
                      className="pr-4 pl-1 py-3 text-white/70 text-base leading-none hover:text-white"
                      aria-label="Dismiss"
                    >×</button>
                  </div>
                </div>
              )}

              {/* Scroll nudge — appears after 10 consecutive no-interaction scrolls */}
              {showScrollNudge && (
                <div className="pointer-events-none absolute inset-x-0 top-3 z-30 flex justify-center px-4">
                  <div className="pointer-events-auto flex items-center gap-3 rounded-2xl border border-sky-100 bg-sky-50/95 px-4 py-2.5 shadow-md backdrop-blur-sm">
                    <span className="text-[12px] font-bold text-sky-700">Tap ♡ on anything you like to get better picks</span>
                    <button
                      type="button"
                      onClick={() => setShowScrollNudge(false)}
                      className="text-sky-400 text-base leading-none"
                    >×</button>
                  </div>
                </div>
              )}

              {products.length > 0 ? (
                <VerticalFeed
                  products={products}
                  savedIds={savedProductIds}
                  onSave={(product) => {
                    saveProductFromOverlay(product);
                    setNoInteractionCount(0);
                    setShowScrollNudge(false);
                    try { navigator.vibrate?.(40); } catch {}
                  }}
                  onPass={handleScrollPass}
                  onShop={(product) => openRetailerLink(product, { source: "product_overlay", view: "browsing", placement: "product_overlay_cta" })}
                  onShare={handleShare}
                  onTap={(product) => openProductOverlay(product, { view: "browsing", source: "discover_tap" })}
                  onActiveIndexChange={(idx) => setCurrentIndex(idx)}
                  endCard={
                    <div className="flex h-full flex-col items-center justify-center px-8 text-center bg-white">
                      {userPrefs.wishlist.length > 0 && (
                        <div className="mb-5 flex justify-center gap-2">
                          {userPrefs.wishlist.slice(0, 4).map((p, i) => (
                            <div
                              key={p.id}
                              className="h-16 w-16 overflow-hidden rounded-xl border-2 border-white shadow-lg"
                              style={{ transform: `rotate(${[-4, 2, -2, 3][i] ?? 0}deg)` }}
                            >
                              <img src={p.imageUrl} alt={p.name} className="h-full w-full object-cover" />
                            </div>
                          ))}
                        </div>
                      )}
                      <h3 className="text-xl font-black text-slate-900">
                        {userPrefs.wishlist.length + userPrefs.cart.length > 0 ? "Your room is coming together 🎉" : "You’ve seen it all"}
                      </h3>
                      <p className="mt-2 mb-6 text-[13px] text-slate-500 max-w-[240px]">
                        {userPrefs.wishlist.length + userPrefs.cart.length > 0
                          ? `${userPrefs.wishlist.length + userPrefs.cart.length} picks saved — get your direct shopping links.`
                          : "New arrivals drop regularly. Tune your feed or start over."}
                      </p>
                      <div className="w-full max-w-[260px] space-y-2.5">
                        {userPrefs.wishlist.length + userPrefs.cart.length > 0 && (
                          <button
                            onClick={() => openCheckout("end_of_feed_nudge")}
                            className="w-full rounded-2xl py-3.5 font-extrabold text-white shadow-[0_6px_20px_rgba(249,115,22,0.35)]"
                            style={{ background: "linear-gradient(135deg, #f97316, var(--seligo-cta))" }}
                          >
                            Shop my picks →
                          </button>
                        )}
                        <button
                          onClick={() => setShowTuneModal(true)}
                          className="w-full rounded-2xl py-3.5 font-extrabold text-white"
                          style={{ background: "var(--seligo-primary)" }}
                        >
                          ✨ Tune my feed
                        </button>
                        <button
                          onClick={handleResetData}
                          className="w-full rounded-2xl bg-slate-100 py-3 text-[13px] font-extrabold text-slate-600"
                        >
                          Start over
                        </button>
                      </div>
                    </div>
                  }
                />
              ) : (
                <div className="flex h-full items-center justify-center px-6">
                  <div className="max-w-[280px] w-full rounded-[2.5rem] border border-slate-100 bg-white p-8 text-center shadow-xl">
                    <div className="mx-auto mb-4 text-4xl">🔍</div>
                    <h3 className="mb-2 text-lg font-black text-slate-900">No matches</h3>
                    <p className="mb-5 text-sm text-slate-500">
                      No picks match{activeCategory ? ` "${activeCategory.replace("-", " ")}"` : ""}{maxPrice !== null ? ` under $${maxPrice}` : ""}. Try widening your filters.
                    </p>
                    <div className="space-y-2.5">
                      <button
                        onClick={() => { setActiveCategory(null); setMaxPrice(null); setCurrentIndex(0); }}
                        className="w-full rounded-2xl py-3.5 font-extrabold text-white"
                        style={{ background: "var(--seligo-cta)" }}
                      >
                        Clear filters
                      </button>
                      <button
                        onClick={() => setShowTuneModal(true)}
                        className="w-full rounded-2xl bg-slate-100 py-3.5 font-extrabold text-slate-900"
                      >
                        ✨ Tune my feed
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </Screen>
        )}

        {/* Tune Feed Modal */}
        {showTuneModal && (
          <div className="fixed inset-0 z-[800]" onClick={() => setShowTuneModal(false)}>
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
            <div
              className="absolute inset-x-0 bottom-0 flex flex-col max-h-[92svh] rounded-t-[2rem] shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Drag handle — fixed, doesn't scroll */}
              <div className="shrink-0 flex justify-center pt-3 pb-1 bg-[#EEF2F7] rounded-t-[2rem]">
                <div className="h-1.5 w-10 rounded-full bg-slate-300" />
              </div>
              {/* Scrollable body — sticky bottom inside here works correctly */}
              <div className="overflow-y-auto flex-1">
                <InterestsPage
                  initialSelectedIds={deriveSelectedVibeCategories(userPrefs.interests)}
                  isLoading={isLoading}
                  onHowItWorks={() => { setShowTuneModal(false); setShowHowItWorks(true); }}
                  onRoomScan={() => { setShowTuneModal(false); goView("roomscan", "tune_roomscan_cta"); }}
                  onContinue={async (selectedIds) => {
                    setShowTuneModal(false);
                    const nextInterests = mapVibeCategoriesToInterests(selectedIds);
                    setUserPrefs((prev) => ({ ...prev, interests: nextInterests }));
                    await startDiscovery(nextInterests);
                  }}
                />
              </div>
            </div>
          </div>
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
                    className="absolute left-3 top-3 z-40 flex h-10 items-center gap-1.5 px-3 justify-center rounded-2xl border border-white/80 bg-white shadow-lg text-[12px] font-black text-slate-900"
                  >
                    <ArrowLeft className="h-4 w-4 text-slate-900" />
                    Back to feed
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

                  {/* You may also like */}
                  {relatedOverlayProducts.length > 0 && (
                    <div className="mt-6">
                      <div className="mb-3 text-[11px] font-black uppercase tracking-[0.2em] text-slate-400">
                        You may also like
                      </div>
                      <div className="flex gap-3 overflow-x-auto no-scrollbar pb-1">
                        {relatedOverlayProducts.map((p) => (
                          <div
                            key={p.id}
                            className="shrink-0 w-[130px] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
                          >
                            <div className="h-[90px] bg-slate-100">
                              <img
                                src={p.imageUrl}
                                alt={p.name}
                                className="h-full w-full object-contain"
                              />
                            </div>
                            <div className="p-2.5">
                              <div className="line-clamp-2 text-[11px] font-bold leading-tight text-slate-900">
                                {p.displayName || p.name}
                              </div>
                              <div className="mt-1 text-[12px] font-black text-slate-900">
                                ${Number(p.price || 0).toFixed(2)}
                              </div>
                              <button
                                type="button"
                                onClick={() =>
                                  openRetailerLink(p, {
                                    source: "product_overlay",
                                    view: "browsing",
                                    placement: "product_overlay_cta",
                                  })
                                }
                                className="mt-2 flex w-full items-center justify-center gap-1 rounded-xl py-1.5 text-[10px] font-black text-white"
                                style={{ background: "var(--seligo-cta)" }}
                              >
                                Shop <ArrowRight className="w-3 h-3" strokeWidth={2.8} />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <div
                  className="sticky bottom-0 border-t border-slate-200 bg-white/95 px-6 pt-4 backdrop-blur-xl"
                  style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
                >
                  {/* Primary: Shop Now */}
                  <button
                    onClick={() => {
                      if (!selectedProduct) return;
                      openRetailerLink(selectedProduct, {
                        source: "product_overlay",
                        view: selectedProductContext?.view ?? "browsing",
                        placement: "product_overlay_cta",
                      });
                    }}
                    className="w-full h-14 rounded-2xl font-black text-white text-[15px] flex items-center justify-center gap-2 shadow-[0_8px_24px_rgba(249,115,22,0.38)] transition-all active:scale-[0.97]"
                    style={{ background: "linear-gradient(135deg, #f97316, var(--seligo-cta))" }}
                  >
                    <span>Shop on {getProductRetailerName(selectedProduct)}</span>
                    <ArrowRight className="w-5 h-5" strokeWidth={2.6} />
                  </button>

                  {/* Secondary: Save / Add to Bag */}
                  <div className="mt-2.5 grid grid-cols-2 gap-2.5">
                    <button
                      onClick={() => {
                        if (!selectedProduct) return;
                        saveProductFromOverlay(selectedProduct);
                        closeProductOverlay();
                      }}
                      disabled={overlayIsSaved}
                      className="h-11 rounded-xl bg-slate-100 text-[13px] font-extrabold text-slate-900 disabled:opacity-50 disabled:cursor-default transition-colors hover:bg-slate-200"
                    >
                      {overlayIsSaved ? "✓ Saved" : "♡ Save"}
                    </button>

                    <button
                      onClick={() => {
                        if (!selectedProduct) return;
                        addProductToBagFromOverlay(selectedProduct);
                        closeProductOverlay();
                      }}
                      disabled={overlayIsInBag}
                      className="h-11 rounded-xl border border-slate-200 bg-white text-[13px] font-extrabold text-slate-900 disabled:opacity-50 disabled:cursor-default transition-colors hover:bg-slate-50"
                    >
                      {overlayIsInBag ? "✓ In Bag" : "🛍 Add to Bag"}
                    </button>
                  </div>

                  <div className="mt-3">
                    <div className="text-[10px] leading-relaxed text-slate-400">
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
                  {Array.from(new Set(avoidedSource)).map((tag) => {
                    const active = blockedSet.has(tag);
                    return (
                      <button
                        key={tag}
                        onClick={() => toggleBlockedTag(tag)}
                        className={
                          active
                            ? "px-4 py-2 rounded-full text-xs font-black bg-rose-600 text-white shadow-sm"
                            : "px-4 py-2 rounded-full text-xs font-black bg-rose-50 text-rose-600 hover:bg-rose-100 transition-colors"
                        }
                        title={active ? "Hidden from feed" : "Tap to hide from feed"}
                      >
                        {active ? `Hidden: ${tag}` : tag}
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
                  onClick={shareMyPicks}
                  className="w-full py-4 rounded-2xl text-white font-black shadow-sm"
                  style={{ background: "var(--seligo-cta)" }}
                >
                  {userPrefs.wishlist.length + userPrefs.cart.length > 0
                    ? `Share my picks (${userPrefs.wishlist.length + userPrefs.cart.length})`
                    : "Share Seligo"}
                </button>

                <button
                  onClick={() => setShowHowItWorks(true)}
                  className="w-full py-4 rounded-2xl bg-slate-100 text-slate-900 font-black mt-3 hover:bg-slate-200 transition-colors"
                >
                  How it works
                </button>

                <button
                  onClick={() => setShowResetConfirm(true)}
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

                {/* Discover section - internal SEO links */}
                <div className="mt-6 rounded-[1.5rem] border border-slate-200 bg-white p-4 shadow-sm">
                  <h3 className="text-xs font-black uppercase tracking-[0.22em] text-slate-400 mb-3">Discover</h3>
                  <div className="space-y-2">
                    <a
                      href="/bedroom-decor-under-50"
                      onClick={(e) => { e.preventDefault(); goView("bedroomDecorUnder50", "profile_seo_link"); }}
                      className="block w-full text-left text-sm font-semibold text-slate-700 py-2 px-3 rounded-xl hover:bg-slate-50 transition-colors"
                    >
                      Bedroom decor under $50
                    </a>
                    <a
                      href="/dorm-room-decor-ideas"
                      onClick={(e) => { e.preventDefault(); goView("dormRoomDecorIdeas", "profile_seo_link"); }}
                      className="block w-full text-left text-sm font-semibold text-slate-700 py-2 px-3 rounded-xl hover:bg-slate-50 transition-colors"
                    >
                      Dorm room decor ideas
                    </a>
                    <a
                      href="/small-apartment-decor"
                      onClick={(e) => { e.preventDefault(); goView("smallApartmentDecor", "profile_seo_link"); }}
                      className="block w-full text-left text-sm font-semibold text-slate-700 py-2 px-3 rounded-xl hover:bg-slate-50 transition-colors"
                    >
                      Small apartment decor
                    </a>
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
          <Screen className="bg-[#fafaf9]">
            <PageHeader
              title={shortlistCount >= 3 ? "Ready to shop? 🛍️" : "Your shortlist"}
              subtitle="Review your picks — then shop each one directly."
              onClose={() => goView("browsing", "shortlist_close")}
            />

            <div className="pt-3 pb-32">
              {shortlistCount > 0 ? (
                <div className="space-y-3.5">
                  {/* Sticky subtotal + CTA at the top */}
                  <div className="rounded-[1.5rem] border border-orange-100 bg-gradient-to-br from-orange-50 to-amber-50/60 p-4 shadow-sm">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="text-[10px] font-black uppercase tracking-[0.18em] text-orange-400">
                          Bag total
                        </div>
                        <div className="mt-0.5 text-[32px] leading-none font-black text-slate-900">
                          ${shortlistSubtotal.toFixed(2)}
                        </div>
                        <div className="mt-1.5 text-xs font-semibold text-slate-500">
                          {userPrefs.cart.length} in bag · {userPrefs.wishlist.length} saved
                        </div>
                      </div>

                      <div className="flex flex-col items-end gap-1">
                        <div className="rounded-xl bg-white border border-orange-100 px-3 py-2 text-right shadow-sm">
                          <div className="text-[9px] font-black uppercase tracking-[0.18em] text-slate-400">
                            Picks
                          </div>
                          <div className="text-lg font-black text-slate-900">
                            {shortlistCount}
                          </div>
                        </div>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => openCheckout("shortlist_summary")}
                      disabled={userPrefs.cart.length === 0}
                      className="mt-4 h-14 w-full rounded-2xl text-white text-[15px] font-black disabled:opacity-50 shadow-[0_8px_24px_rgba(249,115,22,0.40)] flex items-center justify-center gap-2 transition-all active:scale-[0.98]"
                      style={{ background: "linear-gradient(135deg, #f97316, var(--seligo-cta))" }}
                    >
                      Send me my checkout links
                      <ArrowRight className="w-5 h-5" strokeWidth={2.6} />
                    </button>
                    <div className="mt-2 text-center text-[10px] font-semibold text-slate-400">
                      One email · Direct retailer links · No spam
                    </div>
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
                                <div className="flex items-center gap-2">
                                  <div className="text-[15px] font-black text-slate-900">
                                    ${Number(item.price ?? 0).toFixed(2)}
                                  </div>
                                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-black text-slate-500">
                                    {getProductRetailerName(item)}
                                  </span>
                                </div>

                                <div className="flex flex-wrap gap-2">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      openRetailerLink(item, {
                                        source: "bag_sheet",
                                        view: "cart",
                                        placement: "checkout_cart_item",
                                      })
                                    }
                                    className="flex h-9 items-center gap-1 rounded-xl px-3 text-[13px] font-black text-white shadow-sm transition-all active:scale-[0.97]"
                                    style={{ background: "var(--seligo-cta)" }}
                                  >
                                    Shop <ArrowRight className="w-3.5 h-3.5" strokeWidth={2.6} />
                                  </button>

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
                                <div className="flex items-center gap-2">
                                  <div className="text-[15px] font-black text-slate-900">
                                    ${Number(item.price ?? 0).toFixed(2)}
                                  </div>
                                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-black text-slate-500">
                                    {getProductRetailerName(item)}
                                  </span>
                                </div>

                                <div className="flex flex-wrap gap-2">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      openRetailerLink(item, {
                                        source: "saved_sheet",
                                        view: "browsing",
                                        placement: "checkout_saved_item",
                                      })
                                    }
                                    className="flex h-9 items-center gap-1 rounded-xl px-3 text-[13px] font-black text-white shadow-sm transition-all active:scale-[0.97]"
                                    style={{ background: "var(--seligo-cta)" }}
                                  >
                                    Shop <ArrowRight className="w-3.5 h-3.5" strokeWidth={2.6} />
                                  </button>

                                  <button
                                    type="button"
                                    onClick={() => shortlistActions.onMoveSavedItemToBag(item.id)}
                                    className="h-9 rounded-xl border border-slate-200 bg-slate-50 px-3 text-[13px] font-bold text-slate-700 transition-colors hover:bg-slate-100"
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
                <div className="flex flex-col items-center px-4 pt-8 pb-4 text-center">
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-orange-100 bg-orange-50">
                    <ShoppingBag className="h-6 w-6 text-[var(--seligo-cta)]" />
                  </div>
                  <div className="mt-3 text-base font-black text-slate-900">Nothing here yet</div>
                  <div className="mt-1 max-w-[17rem] text-[13px] text-slate-500">
                    Swipe right or tap Save on any pick to build your shortlist.
                  </div>
                  <button
                    type="button"
                    onClick={() => goView("browsing", "shortlist_empty_go_explore")}
                    className="mt-4 h-11 rounded-2xl px-6 font-extrabold text-white shadow-[0_4px_16px_rgba(249,115,22,0.32)]"
                    style={{ background: "linear-gradient(135deg, #f97316, var(--seligo-cta))" }}
                  >
                    Start swiping →
                  </button>
                  {allProducts.length > 0 && (
                    <div className="mt-6 w-full">
                      <div className="mb-2 text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">Popular right now</div>
                      <div className="flex gap-3 overflow-x-auto no-scrollbar pb-1">
                        {allProducts.slice(0, 6).map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => openProductOverlay(p, { view: "cart", source: "bag_sheet" })}
                            className="shrink-0 w-[110px] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm text-left"
                          >
                            <div className="h-[78px] bg-slate-100">
                              <img src={p.imageUrl} alt={p.name} className="h-full w-full object-contain" />
                            </div>
                            <div className="p-2">
                              <div className="line-clamp-2 text-[10px] font-bold leading-tight text-slate-800">{p.displayName || p.name}</div>
                              <div className="mt-0.5 text-[11px] font-black text-slate-900">${Number(p.price || 0).toFixed(0)}</div>
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
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

      {/* Reset confirmation modal */}
      {showResetConfirm && (
        <div className="fixed inset-0 z-[9999] flex items-end justify-center sm:items-center pointer-events-auto">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={() => setShowResetConfirm(false)} />
          <div className="relative w-full max-w-md mx-auto rounded-t-[2rem] sm:rounded-[2rem] bg-white p-6 shadow-2xl"
            style={{ paddingBottom: "calc(1.5rem + env(safe-area-inset-bottom))" }}>
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-rose-100">
              <RotateCcw className="w-5 h-5 text-rose-600" />
            </div>
            <div className="font-black text-lg text-slate-900">Reset all data?</div>
            <p className="mt-1.5 text-sm text-slate-500 leading-relaxed">
              This clears your style persona, saved items, and swipe history. It can't be undone.
            </p>
            <div className="mt-5 flex flex-col gap-2">
              <button
                type="button"
                onClick={() => { setShowResetConfirm(false); void handleResetData(); }}
                className="w-full py-3.5 rounded-2xl bg-rose-600 text-white font-black hover:bg-rose-700 active:scale-[0.98] transition-all"
              >
                Yes, reset everything
              </button>
              <button
                type="button"
                onClick={() => setShowResetConfirm(false)}
                className="w-full py-3.5 rounded-2xl bg-slate-100 text-slate-900 font-black hover:bg-slate-200 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {!overlayOpen && (
        <nav
          className="sticky bottom-0 z-[300] bg-white/95 backdrop-blur-xl border-t border-slate-100/80 shadow-[0_-4px_24px_rgba(15,23,42,0.06)]"
          style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        >
          <div className="h-[4.75rem] px-4 flex items-center justify-around">
            <NavItem
              active={view === "browsing"}
              label="Explore"
              onClick={() => goView("browsing", "bottom_nav_explore")}
              icon={<Compass className="w-5 h-5" />}
            />

            <NavItem
              active={view === "profile"}
              label="Style"
              onClick={() => goView("profile", "bottom_nav_style")}
              icon={<BrainCircuit className="w-5 h-5" />}
            />

            <NavItem
              active={view === "roomscan"}
              label="Scan"
              onClick={() => goView("roomscan", "bottom_nav_roomscan")}
              icon={<Scan className="w-5 h-5" />}
            />

            <NavItem
              active={view === "cart"}
              label="Bag"
              onClick={() => goView("cart", "bottom_nav_bag")}
              icon={
                <div className="relative">
                  <ShoppingBag className="w-5 h-5" />
                  {userPrefs.cart.length > 0 && (
                    <span className="absolute -top-1.5 -right-1.5 w-3.5 h-3.5 bg-[var(--seligo-cta)] rounded-full border-2 border-white" />
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
