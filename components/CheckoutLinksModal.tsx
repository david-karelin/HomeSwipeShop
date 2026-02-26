import React, { useEffect } from "react";
import type { Product } from "../types";
import { logBuyClick } from "../firestoreService";

const AMAZON_TAG = import.meta.env.VITE_AMAZON_ASSOC_TAG || "";

type Props = {
  open: boolean;
  onClose: () => void;
  cart: Product[];
  wishlist?: Product[];
  subtotal: number;

  // lead capture
  leadEmail: string;
  setLeadEmail: (v: string) => void;
  leadStatus: "idle" | "saving" | "saved" | "error";
  leadError: string;
  onSubmitLead: () => void;
};

function buildAmazonSearchUrl(p: Product) {
  const q = encodeURIComponent(`${p.name ?? ""} ${p.category ?? ""} home decor`.trim());
  return `https://www.amazon.ca/s?k=${q}`;
}

function buildAmazonAsinUrl(asin: string) {
  const a = asin.trim().toUpperCase();
  const base = `https://www.amazon.ca/dp/${a}/ref=nosim`;
  return AMAZON_TAG ? `${base}?tag=${encodeURIComponent(AMAZON_TAG)}` : base;
}

function getPurchaseUrl(p: Product): string {
  const asin = (p.asin || "").trim();
  if (asin.length === 10) return buildAmazonAsinUrl(asin);

  const url = typeof p.purchaseUrl === "string" ? p.purchaseUrl.trim() : "";
  return url || buildAmazonSearchUrl(p);
}

function openInNewTab(url: string) {
  window.open(url, "_blank", "noopener,noreferrer");
}

function handleBuy(product: Product) {
  const url = getPurchaseUrl(product);
  if (!url) return;

  openInNewTab(url);

  logBuyClick({ productId: product.id, purchaseUrl: url, source: "checkout_modal" }).catch((e) => {
    console.warn("logBuyClick failed", e);
  });
}

const CheckoutLinksModal: React.FC<Props> = ({
  open,
  onClose,
  cart,
  wishlist = [],
  subtotal,
  leadEmail,
  setLeadEmail,
  leadStatus,
  leadError,
  onSubmitLead,
}) => {
  // lock body scroll + close on Escape
  useEffect(() => {
    if (!open) return;

    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] bg-black/60 flex items-center justify-center p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="max-h-[90vh] w-full max-w-lg overflow-hidden flex flex-col rounded-2xl bg-white shadow-2xl">
        {/* Header (always visible) */}
        <div className="shrink-0 p-4 border-b border-slate-100">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-2xl font-black text-slate-900">Checkout links</div>
              <div className="text-slate-500 text-sm mt-1">
                This demo opens affiliate product pages (real checkout coming later).
              </div>
            </div>

            <button
              onClick={onClose}
              className="w-10 h-10 rounded-xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-600"
              aria-label="Close"
            >
              ✕
            </button>
          </div>

          <div className="mt-5 rounded-2xl border border-slate-100 bg-slate-50 p-4 flex justify-between items-center">
            <div className="text-xs font-black uppercase tracking-widest text-slate-400">Subtotal</div>
            <div className="text-xl font-black text-slate-900">${subtotal.toFixed(2)}</div>
          </div>
        </div>

        {/* Scroll body (everything that can grow) */}
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <div className="space-y-3">
            {cart.length > 0 ? (
              cart.map((p) => (
                <div key={p.id} className="flex gap-3 items-center border border-slate-100 rounded-2xl p-3">
                  <img
                    src={p.imageUrl}
                    alt={p.name}
                    className="w-14 h-14 rounded-xl object-cover bg-slate-100"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="font-black text-slate-900 truncate">{p.name}</div>
                    <div className="text-xs text-slate-500 truncate">
                      {p.brand ?? "Seligo.AI"} • ${Number(p.price ?? 0).toFixed(2)}
                    </div>
                  </div>
                  <button
                    onClick={() => handleBuy(p)}
                    className="shrink-0 px-4 py-2 rounded-xl bg-[var(--seligo-cta)] hover:bg-[#fb8b3a] text-white font-black text-xs uppercase tracking-widest active:scale-95 transition"
                  >
                    Open on Amazon
                  </button>
                </div>
              ))
            ) : (
              <div className="text-slate-500 text-sm">Your bag is empty.</div>
            )}

            {wishlist.length > 0 && (
              <div className="pt-2">
                <div className="text-xs font-black uppercase tracking-widest text-slate-400 mb-2">
                  Saved for later
                </div>

                <div className="space-y-3">
                  {wishlist.map((p) => (
                    <div
                      key={`${p.id}-wish`}
                      className="flex gap-3 items-center border border-slate-100 rounded-2xl p-3 opacity-80"
                    >
                      <img
                        src={p.imageUrl}
                        alt={p.name}
                        className="w-12 h-12 rounded-xl object-cover bg-slate-100"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="font-bold text-slate-900 truncate">{p.name}</div>
                        <div className="text-xs text-slate-500 truncate">${Number(p.price ?? 0).toFixed(2)}</div>
                      </div>
                      <button
                          onClick={() => handleBuy(p)}
                        className="shrink-0 px-3 py-2 rounded-xl bg-slate-100 text-slate-700 font-black text-[10px] uppercase tracking-widest hover:bg-slate-200"
                      >
                        Open
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="mt-5 text-[11px] text-slate-500 leading-snug">
            Disclosure: some links may be affiliate links. We may earn a commission at no extra cost to you.
          </div>

        </div>

        <div className="shrink-0 p-4 border-t border-slate-100">
          <div className="mt-1">
            <div className="text-sm font-black text-slate-900">Want one-click checkout later?</div>
            <div className="text-sm text-slate-500 mt-1">
              Drop your email and we’ll notify you when real checkout is live.
            </div>

            {leadStatus === "saved" ? (
              <div className="mt-4 bg-emerald-50 border border-emerald-100 rounded-2xl p-4">
                <div className="font-black text-emerald-700">You’re on the list ✅</div>
                <div className="text-sm text-emerald-700/80 mt-1">
                  Thanks — we’ll email you when checkout is available.
                </div>
              </div>
            ) : (
              <>
                <input
                  value={leadEmail}
                  onChange={(e) => setLeadEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="mt-4 w-full px-4 py-4 rounded-2xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-[var(--seligo-primary)]"
                />

                {leadError && (
                  <div className="text-rose-600 text-sm font-bold mt-2">{leadError}</div>
                )}

                <button
                  onClick={onSubmitLead}
                  disabled={leadStatus === "saving"}
                  className="mt-4 w-full py-4 bg-[var(--seligo-cta)] hover:bg-[#fb8b3a] text-white rounded-2xl font-black disabled:opacity-60"
                >
                  {leadStatus === "saving" ? "Saving..." : "Notify me"}
                </button>

                <div className="text-[11px] text-slate-400 mt-3 leading-snug">
                  We’ll only use this to contact you about checkout. No spam.
                </div>
              </>
            )}
          </div>

          <button
            onClick={onClose}
            className="mt-5 w-full py-4 rounded-2xl bg-slate-900 text-white font-black hover:bg-slate-800 active:scale-95 transition"
          >
            Back to browsing
          </button>
        </div>
      </div>
    </div>
  );
};

export default CheckoutLinksModal;
