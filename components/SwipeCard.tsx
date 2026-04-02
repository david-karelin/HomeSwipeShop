
import React, { useEffect, useRef, useState } from "react";
import type { Product } from "../types";
import { Heart, Sparkles, X } from "lucide-react";
import { beautifyProductName, getDisplayVibeTag } from "../src/lib/feed";

interface SwipeCardProps {
  product: Product;
  onSwipe: (direction: "left" | "right") => void;
  onSelectAction: (action: "wishlist" | "cart") => void;
  onTap: () => void;
}

function clampCardTitle(name: string) {
  const cleaned = String(name || "").trim();
  if (cleaned.length <= 34) return cleaned;
  return `${cleaned.slice(0, 31).trimEnd()}...`;
}

function clampCardDescription(text: string) {
  const cleaned = String(text || "").trim();
  if (cleaned.length <= 98) return cleaned;
  return `${cleaned.slice(0, 95).trimEnd()}...`;
}

const SwipeCard: React.FC<SwipeCardProps> = ({
  product,
  onSwipe,
  onSelectAction,
  onTap,
}) => {
  const [isSwiping, setIsSwiping] = useState<"left" | "right" | null>(null);
  const [feedback, setFeedback] = useState<null | "save" | "pass">(null);
  const [isDragging, setIsDragging] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgError, setImgError] = useState(false);

  // Ref-based drag for smooth performance (avoids React re-renders during drag)
  const cardRef = useRef<HTMLDivElement | null>(null);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const offsetRef = useRef({ x: 0, y: 0 });
  const hasMovedRef = useRef(false);
  const isDraggingRef = useRef(false);
  const feedbackTimeoutRef = useRef<number | null>(null);
  const swipeTimeoutRef = useRef<number | null>(null);

  const SWIPE_THRESHOLD = 78;

  const price = Number(product.price || 0);
  const displayPrice =
    Number.isFinite(price) && price > 0 ? `$${price.toFixed(2)}` : null;

  const displayVibeTag = getDisplayVibeTag(product);
  const displayProductName = beautifyProductName({
    name: product.displayName || product.name || "",
    category: product.category,
    tags: product.tags,
  });

  const fallbackDescription = (() => {
    if (displayVibeTag === "under $30") return "Cheap upgrade you can say yes to fast.";
    if (displayVibeTag === "blank wall fix") return "Easy way to make an empty wall feel finished.";
    if (displayVibeTag === "cozy desk upgrade") return "A small upgrade that makes your setup feel better instantly.";
    if (displayVibeTag === "nightstand glow-up") return "A simple piece that upgrades your bedside look.";
    if (displayVibeTag === "small-space win") return "Built for tighter rooms, desks, and apartment corners.";
    if (displayVibeTag === "looks expensive") return "Gives your space a more elevated look without a huge spend.";
    return "An easy room upgrade picked to match your vibe.";
  })();

  const hasUsableDescription =
    product.description &&
    String(product.description).trim().length > 0 &&
    !/placeholder|item for testing|no description|testing/i.test(
      String(product.description)
    );

  const cardDescription = hasUsableDescription
    ? String(product.description)
    : fallbackDescription;

  const shortTitle = clampCardTitle(displayProductName);
  const shortDescription = clampCardDescription(cardDescription);

  const priceBadge =
    price <= 30
      ? "Under $30"
      : price <= 50
      ? "Under $50"
      : price <= 80
      ? "Affordable pick"
      : "Statement pick";


  useEffect(() => {
    return () => {
      if (feedbackTimeoutRef.current) window.clearTimeout(feedbackTimeoutRef.current);
      if (swipeTimeoutRef.current) window.clearTimeout(swipeTimeoutRef.current);
    };
  }, []);

  const triggerFeedback = (type: "save" | "pass") => {
    if (feedbackTimeoutRef.current) window.clearTimeout(feedbackTimeoutRef.current);
    setFeedback(type);
    feedbackTimeoutRef.current = window.setTimeout(() => setFeedback(null), 520);
  };

  // Apply transform directly to DOM for smooth 60fps drag
  const applyCardTransform = (x: number, y: number, dragging: boolean) => {
    const el = cardRef.current;
    if (!el) return;
    const rotation = Math.max(-12, Math.min(12, x * 0.035));
    const scale = dragging ? 1.008 : 1;
    el.style.transform = `translate3d(${x}px, ${y}px, 0) rotate(${rotation}deg) scale(${scale})`;
  };

  const resetCardPosition = () => {
    const el = cardRef.current;
    if (!el) return;
    el.style.transition = "transform 220ms cubic-bezier(0.22, 1, 0.36, 1)";
    el.style.transform = "translate3d(0px, 0px, 0px) rotate(0deg) scale(1)";
    offsetRef.current = { x: 0, y: 0 };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isSwiping) return;

    hasMovedRef.current = false;
    isDraggingRef.current = true;
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    offsetRef.current = { x: 0, y: 0 };

    setIsDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);

    const el = cardRef.current;
    if (el) {
      el.style.transition = "none";
      el.style.setProperty("--drag-x", "0");
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current) return;

    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;

    if (Math.abs(dx) > 6 || Math.abs(dy) > 6) {
      hasMovedRef.current = true;
    }

    const limitedY = Math.max(-16, Math.min(16, dy * 0.18));
    offsetRef.current = { x: dx, y: limitedY };

    const el = cardRef.current;
    if (el) {
      el.style.setProperty("--drag-x", String(dx));
    }
    

    applyCardTransform(dx, limitedY, true);
  };

  const handlePointerUp = (e?: React.PointerEvent<HTMLDivElement>) => {
    if (e?.currentTarget?.hasPointerCapture?.(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }

    isDraggingRef.current = false;
    setIsDragging(false);

    const { x } = offsetRef.current;

    if (!hasMovedRef.current) {
      onTap();
      offsetRef.current = { x: 0, y: 0 };
      const el = cardRef.current;
      if (el) el.style.setProperty("--drag-x", "0");
      resetCardPosition();
      return;
    }

    if (x > SWIPE_THRESHOLD) {
      completeSwipe("right");
      return;
    }

    if (x < -SWIPE_THRESHOLD) {
      completeSwipe("left");
      return;
    }

    offsetRef.current = { x: 0, y: 0 };
    const el = cardRef.current;
    if (el) el.style.setProperty("--drag-x", "0");
    resetCardPosition();
  };

  const completeSwipe = (dir: "left" | "right") => {
    if (swipeTimeoutRef.current) window.clearTimeout(swipeTimeoutRef.current);

    const EXIT_X = typeof window !== "undefined" ? window.innerWidth * 0.9 : 360;
    const el = cardRef.current;
    if (el) {
      el.style.transition = "transform 180ms ease-out";
      el.style.transform = `translate3d(${dir === "right" ? EXIT_X : -EXIT_X}px, ${offsetRef.current.y}px, 0) rotate(${dir === "right" ? 12 : -12}deg) scale(0.95)`;
    }

    setIsSwiping(dir);
    triggerFeedback(dir === "right" ? "save" : "pass");

    swipeTimeoutRef.current = window.setTimeout(() => {
      offsetRef.current = { x: 0, y: 0 };
      // Don't reset card position — the parent will unmount this card
      // (new key from products[currentIndex]) so a reset would cause a visible flash
      if (dir === "right") {
        onSelectAction("wishlist");
      } else {
        onSwipe("left");
      }
    }, 170);
  };

  const triggerSwipe = (dir: "left" | "right") => {
    completeSwipe(dir);
  };

  // For visual feedback overlays
  const dragProgress = Math.max(-1, Math.min(1, offsetRef.current.x / SWIPE_THRESHOLD));
  const absDrag = Math.abs(dragProgress);

  // Simplified shadow - no longer depends on drag state for performance
  const cardShadow = "0 24px 64px rgba(15,23,42,0.14), 0 8px 24px rgba(249,115,22,0.08)";

  return (
    <div
      ref={cardRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onLostPointerCapture={handlePointerUp}
      style={{
        willChange: "transform",
        touchAction: "none",
        userSelect: "none",
        WebkitUserSelect: "none",
        cursor: isDragging ? "grabbing" : "grab",
        ["--drag-x" as string]: 0,
      }}
      className={[
        "relative",
        "w-[calc(100vw-1.25rem)]",
        "max-w-[396px] sm:max-w-[404px]",
        "select-none",
        isSwiping ? "pointer-events-none" : "",
      ].join(" ")}
    >
      <div
        className="pointer-events-none absolute inset-x-8 -top-1 -bottom-2 rounded-[2.5rem] blur-xl"
        style={{
          background:
            dragProgress >= 0
              ? `radial-gradient(circle at 50% 20%, rgba(251,146,60,${0.08 + absDrag * 0.10}), transparent 68%)`
              : `radial-gradient(circle at 50% 20%, rgba(15,23,42,${0.06 + absDrag * 0.08}), transparent 68%)`,
        }}
      />

      {feedback === "save" && (
        <div className="pointer-events-none absolute inset-x-0 top-4 z-30 flex justify-center">
          <div className="animate-[seligo-flash-save_520ms_ease-out] rounded-full bg-emerald-500 px-4 py-2 text-xs font-black text-white shadow-lg">
            Saved ✓
          </div>
        </div>
      )}

      {feedback === "pass" && (
        <div className="pointer-events-none absolute inset-x-0 top-4 z-30 flex justify-center">
          <div className="animate-[seligo-flash-save_520ms_ease-out] rounded-full bg-slate-900 px-4 py-2 text-xs font-black text-white shadow-lg">
            Passed
          </div>
        </div>
      )}

      <div
        className="overflow-hidden rounded-[2.25rem] bg-white"
        style={{
          boxShadow: cardShadow,
          animation: "none",
        }}
      >
        {/* Image area — clean, max 2 overlays */}
        <div className="relative h-[34svh] min-h-[220px] max-h-[300px] sm:h-[40svh] sm:max-h-[360px] bg-[#F5F5F4]">
          {!imgLoaded && !imgError && (
            <div className="absolute inset-0 bg-gradient-to-r from-slate-200 via-slate-100 to-slate-200 animate-[shimmer_1.4s_ease-in-out_infinite] bg-[length:200%_100%]" />
          )}
          {imgError && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-slate-100">
              <div className="text-3xl opacity-30">🛋️</div>
              <div className="text-[11px] font-semibold text-slate-400">Image unavailable</div>
            </div>
          )}
          <img
            src={product.imageUrl}
            alt={displayProductName}
            onLoad={() => setImgLoaded(true)}
            onError={() => setImgError(true)}
            className={`pointer-events-none absolute inset-0 h-full w-full object-contain transition-opacity duration-300 ${imgLoaded ? "opacity-100" : "opacity-0"}`}
          />

          {/* Subtle bottom gradient for legibility */}
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/20 via-transparent to-transparent" />

          {/* Swipe direction indicators — appear on drag */}
          <div
            className="pointer-events-none absolute left-4 top-4 z-20 rounded-2xl border-2 border-emerald-400 bg-emerald-500 px-4 py-2 shadow-lg"
            style={{ opacity: "clamp(0, calc(var(--drag-x) / 60), 1)", rotate: "-8deg" }}
          >
            <span className="text-[12px] font-black uppercase tracking-[0.2em] text-white">Save ✓</span>
          </div>
          <div
            className="pointer-events-none absolute right-4 top-4 z-20 rounded-2xl border-2 border-slate-400 bg-white px-4 py-2 shadow-lg"
            style={{ opacity: "clamp(0, calc(var(--drag-x) / -60), 1)", rotate: "8deg" }}
          >
            <span className="text-[12px] font-black uppercase tracking-[0.2em] text-slate-700">Pass ✕</span>
          </div>

          {/* Top-right: vibe tag only */}
          <div className="pointer-events-none absolute right-3 top-3">
            <div className="rounded-full bg-black/60 px-3 py-1.5 text-[9px] font-black uppercase tracking-[0.18em] text-white backdrop-blur-sm">
              {displayVibeTag}
            </div>
          </div>

          {/* Bottom-left: price + trending if curated */}
          <div className="pointer-events-none absolute bottom-3 left-3 flex flex-col items-start gap-1.5">
            <div className="rounded-full bg-black/60 px-3 py-1.5 text-[11px] font-black text-white backdrop-blur-sm">
              {displayPrice ?? priceBadge}
            </div>
            {product.isCurated && (
              <div className="rounded-full bg-orange-500/90 px-3 py-1 text-[9px] font-black uppercase tracking-[0.16em] text-white backdrop-blur-sm">
                🔥 Trending
              </div>
            )}
          </div>
        </div>

        {/* Card content — cleaner hierarchy */}
        <div className="bg-white px-4 pt-3.5 pb-4">
          {/* Brand + price row */}
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.18em] text-[#0EA5E9]">
              <Sparkles className="h-3 w-3" strokeWidth={2.6} />
              <span>Seligo pick</span>
            </div>
            {displayPrice && (
              <div className="text-[18px] font-black tracking-tight text-slate-900">
                {displayPrice}
              </div>
            )}
          </div>

          {/* Product name */}
          <h2 className="text-[16px] font-black leading-[1.15] tracking-[-0.025em] text-slate-950 [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] overflow-hidden">
            {shortTitle}
          </h2>

          {/* Description */}
          <p className="mt-1.5 text-[12px] leading-[1.6] text-slate-500 [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] overflow-hidden">
            {shortDescription}
          </p>

          {/* Action buttons */}
          <div className="pointer-events-auto mt-4 flex items-center gap-2.5">
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); triggerSwipe("left"); }}
              className="flex h-12 w-[38%] items-center justify-center gap-2 rounded-2xl border-2 border-slate-200 bg-white text-slate-600 transition active:scale-[0.96] hover:border-slate-300 hover:bg-slate-50"
              aria-label="Pass"
            >
              <X className="h-4.5 w-4.5" strokeWidth={2.6} />
              <span className="text-[14px] font-black">Pass</span>
            </button>

            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); triggerSwipe("right"); }}
              className="relative flex h-12 flex-1 items-center justify-center gap-2 overflow-hidden rounded-2xl text-white shadow-[0_6px_20px_rgba(249,115,22,0.45)] transition active:scale-[0.96]"
              style={{ background: "linear-gradient(135deg, #f97316, #ea580c)" }}
              aria-label="Save"
            >
              <Heart className="h-4.5 w-4.5 fill-current" strokeWidth={0} />
              <span className="text-[14px] font-black">Save</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SwipeCard;
