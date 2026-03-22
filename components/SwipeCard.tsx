
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

  // Ref-based drag for smooth performance (avoids React re-renders during drag)
  const cardRef = useRef<HTMLDivElement | null>(null);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const offsetRef = useRef({ x: 0, y: 0 });
  const hasMovedRef = useRef(false);
  const feedbackTimeoutRef = useRef<number | null>(null);
  const swipeTimeoutRef = useRef<number | null>(null);

  const SWIPE_THRESHOLD = 72;

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

  const fitLabel =
    price <= 30
      ? "Quick budget win"
      : price <= 50
      ? "Renter-friendly find"
      : "Standout upgrade";

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
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    offsetRef.current = { x: 0, y: 0 };

    setIsDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);

    const el = cardRef.current;
    if (el) el.style.transition = "none";
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging) return;

    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;

    if (Math.abs(dx) > 6 || Math.abs(dy) > 6) {
      hasMovedRef.current = true;
    }

    const limitedY = Math.max(-16, Math.min(16, dy * 0.18));
    offsetRef.current = { x: dx, y: limitedY };

    applyCardTransform(dx, limitedY, true);
  };

  const handlePointerUp = (e?: React.PointerEvent<HTMLDivElement>) => {
    if (e?.currentTarget?.hasPointerCapture?.(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }

    const { x } = offsetRef.current;
    setIsDragging(false);

    if (!hasMovedRef.current) {
      onTap();
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
      const el = cardRef.current;
      if (el) {
        el.style.transition = "none";
        el.style.transform = "translate3d(0px, 0px, 0px) rotate(0deg) scale(1)";
      }

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
  const cardShadow = "0 22px 60px rgba(249,115,22,0.10), 0 18px 45px rgba(0,0,0,0.18)";

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
        <div className="relative h-[32svh] min-h-[210px] max-h-[300px] sm:h-[40svh] sm:min-h-[260px] sm:max-h-[400px] bg-[#F3F4F6]">
          <img
            src={product.imageUrl}
            alt={displayProductName}
            className="pointer-events-none absolute inset-0 h-full w-full object-contain bg-[#F3F4F6]"
          />

          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/16 via-transparent to-white/5" />

          <div
            className="pointer-events-none absolute left-4 top-4 z-20 rotate-[-10deg] rounded-2xl border border-sky-300 bg-sky-50 px-3.5 py-2 shadow-sm"
            style={{ opacity: Math.min(1, Math.max(0, offsetRef.current.x / 70)) }}
          >
            <span className="text-[11px] font-black uppercase tracking-[0.22em] text-sky-700">
              Save
            </span>
          </div>

          <div
            className="pointer-events-none absolute right-4 top-4 z-20 rotate-[10deg] rounded-2xl border border-slate-300 bg-slate-50 px-3.5 py-2 shadow-sm"
            style={{ opacity: Math.min(1, Math.max(0, -offsetRef.current.x / 70)) }}
          >
            <span className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-600">
              Pass
            </span>
          </div>

          <div className="pointer-events-none absolute left-4 right-4 top-4 flex items-start justify-between gap-2">
            <div className="rounded-full border border-white/15 bg-black/55 px-3 py-1.5 text-[9px] font-black uppercase tracking-[0.2em] text-white">
              {priceBadge}
            </div>

            <div className="rounded-full border border-white/15 bg-black/55 px-3 py-1.5 text-[9px] font-black uppercase tracking-[0.2em] text-white">
              {displayVibeTag}
            </div>
          </div>

          <div className="pointer-events-none absolute left-4 right-4 bottom-4 flex items-end justify-between gap-3">
            <div className="rounded-full border border-white/15 bg-black/55 px-3 py-1.5 text-[10px] font-bold text-white/90">
              {fitLabel}
            </div>

            <div className="rounded-full border border-white/20 bg-white/92 px-3 py-1.5 text-[10px] font-black text-slate-900 shadow-sm">
              Tap for details
            </div>
          </div>
        </div>

        <div className="border-t border-slate-100 bg-white px-4 pt-3 pb-4">
          <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.22em] text-sky-500/85">
            <Sparkles className="h-3.5 w-3.5" strokeWidth={2.4} />
            <span>Swipeable room upgrade</span>
          </div>

          <div className="mt-2 flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <h2 className="overflow-hidden text-[17px] font-black leading-[1.06] tracking-[-0.03em] text-slate-950 [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2]">
                {shortTitle}
              </h2>

              <p className="mt-1.5 max-w-[94%] overflow-hidden text-[12px] leading-5 text-slate-600 [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2]">
                {shortDescription}
              </p>
            </div>

            {displayPrice ? (
              <div className="shrink-0 rounded-2xl bg-slate-50 px-3 py-2 text-[15px] font-black text-slate-950 shadow-sm">
                {displayPrice}
              </div>
            ) : null}
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <div className="rounded-full border border-orange-100 bg-orange-50 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.18em] text-orange-600">
              Seligo pick
            </div>
            <div className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
              {priceBadge}
            </div>
          </div>

          <div className="pointer-events-auto mt-5 flex items-center gap-3">
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                triggerSwipe("left");
              }}
              className="group flex flex-1 items-center justify-center gap-2 rounded-[18px] border border-slate-200 bg-slate-50 py-3 text-slate-700 transition hover:bg-slate-100 active:scale-[0.96]"
              aria-label="Pass"
            >
              <X
                className="h-5 w-5 transition-transform duration-200 group-hover:scale-105"
                strokeWidth={2.4}
              />
              <span className="text-[13px] font-black tracking-[-0.01em]">
                Pass
              </span>
            </button>

            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                triggerSwipe("right");
              }}
              className="group relative flex flex-1 items-center justify-center gap-2 overflow-hidden rounded-[18px] bg-gradient-to-r from-[var(--seligo-cta)] to-orange-500 py-3 text-white shadow-[0_16px_34px_rgba(251,146,60,0.34)] transition hover:brightness-[1.03] active:scale-[0.96]"
              aria-label="Save"
            >
              <span className="absolute inset-0 bg-white/10 opacity-0 transition-opacity duration-200 group-hover:opacity-100" />
              <Heart
                className="relative z-10 h-5 w-5 fill-current transition-transform duration-200 group-hover:scale-105"
                strokeWidth={2.2}
              />
              <span className="relative z-10 text-[13px] font-black tracking-[-0.01em]">
                Save
              </span>
            </button>
          </div>

          <div className="mt-3 flex items-center gap-2 text-[10px] font-semibold text-slate-400">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--seligo-cta)]" />
            <span>Swipe or tap to explore faster</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SwipeCard;
