import React, { useEffect, useState } from "react";
import { X } from "lucide-react";
import type { Product } from "../types";
import * as Firestore from "../firestoreService";

const AMAZON_TAG = import.meta.env.VITE_AMAZON_ASSOC_TAG || "";


type CheckoutLinksModalProps = {
  open: boolean;
  onClose: () => void;
  onPrivacy: () => void;
  onTerms: () => void;
  onDisclosure: () => void;
  cart: Product[];
  wishlist?: Product[];
  subtotal: number;
  leadEmail: string;
  setLeadEmail: (v: string) => void;
  leadStatus: "idle" | "saving" | "saved" | "error";
  leadError: string;
  onSubmitLead: () => Promise<boolean>;
  postBuyLeadOpen: boolean;
  setPostBuyLeadOpen: (v: boolean) => void;
  onOpenProduct?: (p: Product) => void; // open your Product Details overlay
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

async function openWithTracking(
  url: string,
  payload: {
    type: "buy_click" | "checkout_item_open";
    view: string;
    source: string;
    productId: string;
    category?: string;
    price?: number;
    purchaseUrl: string;
  },
  opts?: {
    afterOpen?: () => void;
  }
) {
  // Open immediately to avoid popup blocking
  window.open(url, "_blank", "noopener,noreferrer");
  opts?.afterOpen?.();

  // Log asynchronously; don't block UI
  void Firestore.logEvent({
    type: payload.type,
    view: payload.view,
    source: payload.source,
    productId: payload.productId,
    purchaseUrl: payload.purchaseUrl,
    meta: {
      category: payload.category ?? "",
      price: Number(payload.price ?? 0),
    },
  }).catch(console.warn);
}


const CheckoutLinksModal: React.FC<CheckoutLinksModalProps> = ({
  open,
  onClose,
  onPrivacy,
  onTerms,
  onDisclosure,
  cart,
  wishlist = [],
  subtotal,
  leadEmail,
  setLeadEmail,
  leadStatus,
  leadError,
  onSubmitLead,
  postBuyLeadOpen,
  setPostBuyLeadOpen,
  onOpenProduct,
}) => {
  const [pendingPostBuy, setPendingPostBuy] = useState(false);
  const [lastBoughtName, setLastBoughtName] = useState<string>("");

  // Prefill email from localStorage
  useEffect(() => {
    if (!open) return;
    const saved = localStorage.getItem("seligo_lead_email");
    if (saved && !leadEmail) setLeadEmail(saved);
  }, [open, leadEmail, setLeadEmail]);

  useEffect(() => {
    if (open) return;
    setPendingPostBuy(false);
    setPostBuyLeadOpen(false);
  }, [open, setPostBuyLeadOpen]);

  useEffect(() => {
    if (!open) return;

    const maybeShow = () => {
      if (!pendingPostBuy) return;
      setPostBuyLeadOpen(true);
      setPendingPostBuy(false);
    };

    const onFocus = () => maybeShow();
    const onVis = () => {
      if (!document.hidden) maybeShow();
    };

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [open, pendingPostBuy, setPostBuyLeadOpen, setPendingPostBuy]);

  // Hide panel after successful lead
  useEffect(() => {
    if (leadStatus === "saved") setPostBuyLeadOpen(false);
  }, [leadStatus, setPostBuyLeadOpen]);


  async function handleBuy(product: Product) {
    const url = getPurchaseUrl(product);
    if (!url) return;

    // Open outbound immediately
    window.open(url, "_blank", "noopener,noreferrer");

    setLastBoughtName(product.name ?? "");

    const already = localStorage.getItem("seligo_lead_saved") === "1";
    if (!already) {
      setPendingPostBuy(true);
      setPostBuyLeadOpen(false);
    }

    // Log buy_click with clear source
    void Firestore.logEvent({
      type: "buy_click",
      view: "checkout",
      source: "cart_buy",
      productId: product.id,
      purchaseUrl: url,
      meta: {
        category: product.category ?? "",
        price: Number(product.price ?? 0),
      },
    }).catch(console.warn);
  }

  const handleLeadClick = async () => {
    await onSubmitLead();
  };

  // lock body scroll + close on Escape
  useEffect(() => {
    if (!open) return;

    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };

    const prevent = (e: TouchEvent) => {
      const target = e.target as HTMLElement | null;
      const scrollEl = target?.closest?.('[data-modal-scroll="true"]');
      if (!scrollEl) e.preventDefault();
    };

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("touchmove", prevent, { passive: false });

    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("touchmove", prevent);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[9999] pointer-events-auto">
      <button
        className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
        aria-label="Close"
        onClick={onClose}
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

          <div className="px-6 pb-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-xl font-extrabold text-slate-900">Checkout links</div>
                <div className="text-sm text-slate-600 mt-1">
                  This demo opens product pages (real checkout coming later).
                </div>
              </div>

              <button
                onClick={onClose}
                className="h-10 w-10 rounded-2xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center"
                aria-label="Close"
              >
                <X className="h-5 w-5 text-slate-700" />
              </button>
            </div>
          </div>

          <div className="max-h-[62vh] overflow-y-auto no-scrollbar px-6 pb-6" data-modal-scroll="true">
            <div className="mt-1 rounded-2xl border border-slate-100 bg-slate-50 p-4 flex justify-between items-center">
              <div className="text-xs font-black uppercase tracking-widest text-slate-400">Subtotal</div>
              <div className="text-xl font-black text-slate-900">${subtotal.toFixed(2)}</div>
            </div>

            {postBuyLeadOpen ? (
              leadStatus === "saved" ? (
                <div className="mt-4 bg-emerald-50 border border-emerald-100 rounded-2xl p-4">
                  <div className="font-black text-emerald-700">Alerts enabled ✅</div>
                  <div className="text-sm text-emerald-700/80 mt-1">
                    We’ll email you if this item drops in price or a close alternative is cheaper.
                  </div>
                </div>
              ) : (
                <div className="mt-4 bg-slate-50 border border-slate-200 rounded-2xl p-4">
                  <div className="font-black text-slate-900">
                    Get price-drop alerts for {lastBoughtName || "this item"}
                  </div>
                  <div className="text-sm text-slate-600 mt-1">
                    We’ll email you if it drops — or if a similar item is cheaper.
                  </div>

                  {leadEmail?.trim() ? (
                    <div className="mt-3 text-xs text-slate-600">
                      Sending alerts to <span className="font-extrabold text-slate-900">{leadEmail.trim()}</span>
                    </div>
                  ) : (
                    <input
                      value={leadEmail}
                      onChange={(e) => setLeadEmail(e.target.value)}
                      placeholder="you@example.com"
                      className="mt-3 w-full px-4 py-4 rounded-2xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-[var(--seligo-primary)]"
                    />
                  )}

                  {leadError && <div className="text-rose-600 text-sm font-bold mt-2">{leadError}</div>}

                  <button
                    onClick={() => void handleLeadClick()}
                    disabled={leadStatus === "saving"}
                    className="mt-3 w-full py-4 bg-[var(--seligo-cta)] hover:bg-[#fb8b3a] text-white rounded-2xl font-black disabled:opacity-60"
                  >
                    {leadStatus === "saving" ? "Saving..." : leadEmail?.trim() ? "Enable alerts" : "Get alerts"}
                  </button>

                  <div className="text-[11px] text-slate-400 mt-3 leading-snug">
                    No spam. Unsubscribe anytime.
                  </div>
                </div>
              )
            ) : null}

            {(cart.length > 0 || wishlist.length > 0) && (
              <div className="mt-4 space-y-3">
                {cart.length > 0 &&
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
                        onClick={() => void handleBuy(p)}
                        className="shrink-0 px-4 py-2 rounded-xl bg-[var(--seligo-cta)] hover:bg-[#fb8b3a] text-white font-black text-xs uppercase tracking-widest active:scale-95 transition flex items-center gap-1"
                      >
                        <span>Buy</span>
                        <span className="opacity-90">↗</span>
                      </button>
                    </div>
                  ))}

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
                            onClick={() => {
                              onClose();
                              onOpenProduct?.(p);
                            }}
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
            )}

            <div className="mt-4 rounded-2xl bg-slate-50 border border-slate-100 p-4">
              <div className="text-[11px] text-slate-500 leading-relaxed">
                Seligo may earn a commission if you buy through links. Links may become affiliate links later.
              </div>
              <div className="mt-3 flex items-center justify-center gap-4 text-[11px] font-bold text-slate-400">
                <button
                  type="button"
                  onClick={onPrivacy}
                  className="hover:text-slate-600"
                >
                  Privacy
                </button>
                <button
                  type="button"
                  onClick={onTerms}
                  className="hover:text-slate-600"
                >
                  Terms
                </button>
                <button
                  type="button"
                  onClick={onDisclosure}
                  className="hover:text-slate-600"
                >
                  Disclosure
                </button>
              </div>
            </div>
          </div>

          <div
            className="sticky bottom-0 bg-white/95 backdrop-blur-xl border-t border-slate-100 px-6 pt-4"
            style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
          >
            <button
              onClick={onClose}
              className="w-full h-12 rounded-2xl bg-slate-900 text-white font-extrabold"
            >
              Back to browsing
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
export default CheckoutLinksModal;
