
import React, { useEffect, useRef } from "react";
import type { Product } from "../types";
import { Heart, Info, Share2, ShoppingBag } from "lucide-react";
import { beautifyProductName, getDisplayVibeTag } from "../src/lib/feed";

interface VerticalFeedProps {
  products: Product[];
  savedIds: Set<string>;
  onSave: (product: Product) => void;
  onPass: (product: Product) => void;
  onTap: (product: Product) => void;
  onShop: (product: Product) => void;
  onShare?: (product: Product) => void;
  onActiveIndexChange?: (idx: number) => void;
  endCard?: React.ReactNode;
}

const VerticalFeed: React.FC<VerticalFeedProps> = ({
  products,
  savedIds,
  onSave,
  onPass,
  onTap,
  onShop,
  onShare,
  onActiveIndexChange,
  endCard,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const passedRef = useRef(new Set<string>());
  const prevActiveRef = useRef(0);

  useEffect(() => {
    const el = containerRef.current;
    if (el) {
      el.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
    }
    passedRef.current.clear();
    prevActiveRef.current = 0;
    onActiveIndexChange?.(0);
  }, [products]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !products.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && entry.intersectionRatio >= 0.55) {
            const raw = entry.target.getAttribute("data-idx");
            if (raw === null) continue;
            const idx = Number(raw);
            if (isNaN(idx)) continue;

            if (idx > prevActiveRef.current) {
              for (let i = prevActiveRef.current; i < idx; i++) {
                const p = products[i];
                if (p && !passedRef.current.has(p.id) && !savedIds.has(p.id)) {
                  passedRef.current.add(p.id);
                  onPass(p);
                }
              }
            }
            prevActiveRef.current = idx;
            onActiveIndexChange?.(idx);
          }
        }
      },
      { threshold: [0.55], root: container }
    );

    const cards = container.querySelectorAll("[data-idx]");
    cards.forEach((card) => observer.observe(card));
    return () => observer.disconnect();
  }, [products, savedIds, onPass, onActiveIndexChange]);

  return (
    <div
      ref={containerRef}
      className="h-full overflow-y-scroll snap-y snap-mandatory no-scrollbar"
      style={{ overscrollBehavior: "contain" }}
    >
      {products.map((product, idx) => {
        const isSaved = savedIds.has(product.id);
        const price = Number(product.price || 0);
        const vibeTag = getDisplayVibeTag(product);
        const isTrending =
          Array.isArray(product.tags) &&
          product.tags.some((t) =>
            ["trending", "bestseller", "popular"].includes(
              String(t).toLowerCase()
            )
          );
        const name = beautifyProductName({
          name: product.displayName || product.name || "",
          category: product.category,
          tags: product.tags,
        });

        return (
          <div
            key={product.id}
            data-idx={idx}
            className="snap-start h-full flex-shrink-0 flex flex-col bg-white"
          >
            {/* Image area — top ~62% */}
            <div
              className="relative flex-shrink-0 cursor-pointer overflow-hidden bg-[#F5F5F4]"
              style={{ height: "62%" }}
              onClick={() => onTap(product)}
            >
              <img
                src={product.imageUrl}
                alt={name}
                className="absolute inset-0 h-full w-full object-contain p-2"
                loading={idx < 4 ? "eager" : "lazy"}
              />

              {/* Badges — top left */}
              <div className="absolute left-3 top-3 z-10 flex flex-col gap-1.5">
                {vibeTag && (
                  <span className="rounded-full bg-black/45 px-3 py-1 text-[10px] font-black leading-none text-white backdrop-blur-sm">
                    {vibeTag}
                  </span>
                )}
                {isTrending && (
                  <span className="rounded-full bg-orange-500 px-3 py-1 text-[10px] font-black leading-none text-white">
                    🔥 Trending
                  </span>
                )}
              </div>

              {/* Share button — top right */}
              {onShare && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onShare(product);
                  }}
                  className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-black/30 text-white backdrop-blur-sm transition-opacity active:opacity-70"
                  aria-label="Share"
                >
                  <Share2 className="h-3.5 w-3.5" strokeWidth={2.5} />
                </button>
              )}

              {/* Position counter — bottom right */}
              <div className="absolute bottom-3 right-3 z-10">
                <span className="rounded-full bg-black/25 px-2.5 py-1 text-[10px] font-black text-white/80 backdrop-blur-sm">
                  {idx + 1} / {products.length}
                </span>
              </div>

              {/* Scroll hint on first card only */}
              {idx === 0 && (
                <div className="pointer-events-none absolute inset-x-0 bottom-2 z-10 flex justify-center">
                  <span className="animate-bounce text-xl text-slate-400/70">↓</span>
                </div>
              )}
            </div>

            {/* Info area — bottom ~38% */}
            <div className="flex flex-1 flex-col justify-end px-4 pb-3 pt-3 min-h-0">
              <div
                className="cursor-pointer"
                onClick={() => onTap(product)}
              >
                <div className="line-clamp-2 text-[16px] font-black leading-snug text-slate-900">
                  {name}
                </div>
                {price > 0 && (
                  <div
                    className="mt-0.5 text-[15px] font-black"
                    style={{ color: "var(--seligo-cta)" }}
                  >
                    ${price.toFixed(2)}
                  </div>
                )}
                {product.description && (
                  <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-slate-500">
                    {product.description}
                  </p>
                )}
              </div>

              {/* Action row: Save | Shop | Info */}
              <div className="mt-3 flex items-center gap-2">
                {/* Save */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSave(product);
                  }}
                  className={`flex h-12 flex-1 items-center justify-center gap-1.5 rounded-2xl text-[13px] font-black transition-all active:scale-[0.97] ${
                    isSaved ? "bg-emerald-500 text-white" : "border-2 border-slate-200 text-slate-700"
                  }`}
                >
                  <Heart
                    className={`h-4 w-4 ${isSaved ? "fill-white text-white" : "text-slate-500"}`}
                    strokeWidth={2.5}
                  />
                  {isSaved ? "Saved ✓" : "Save"}
                </button>

                {/* Shop Now — primary CTA */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onShop(product);
                  }}
                  className="flex h-12 flex-[1.4] items-center justify-center gap-1.5 rounded-2xl text-[13px] font-black text-white transition-all active:scale-[0.97]"
                  style={{
                    background: "linear-gradient(135deg, #f97316, var(--seligo-cta))",
                    boxShadow: "0 4px 14px rgba(249,115,22,0.32)",
                  }}
                >
                  <ShoppingBag className="h-4 w-4" strokeWidth={2.5} />
                  Shop Now
                </button>

                {/* Info */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onTap(product);
                  }}
                  className="flex h-12 w-11 flex-shrink-0 items-center justify-center rounded-2xl border-2 border-slate-200 text-slate-400 transition-colors hover:border-slate-300"
                  aria-label="View details"
                >
                  <Info className="h-4 w-4" strokeWidth={2} />
                </button>
              </div>
            </div>
          </div>
        );
      })}

      {endCard && (
        <div className="snap-start h-full flex-shrink-0">{endCard}</div>
      )}
    </div>
  );
};

export default VerticalFeed;
