import React, { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import type { Product } from "../types";
import * as Firestore from "../firestoreService";

const AMAZON_TAG = import.meta.env.VITE_AMAZON_ASSOC_TAG || "";

type ConfirmVariant = "A" | "B";

function getConfirmVariantNew(): ConfirmVariant {
  const key = "seligo_confirm_new_variant_v1";

  try {
    const value = sessionStorage.getItem(key);
    if (value === "A" || value === "B") return value;

    const pick: ConfirmVariant = Math.random() < 0.5 ? "A" : "B";
    sessionStorage.setItem(key, pick);
    return pick;
  } catch {
    return Math.random() < 0.5 ? "A" : "B";
  }
}


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
  hasSavedLeadEmail: boolean;
  leadStatus: "idle" | "saving" | "saved" | "error";
  leadError: string;
  onSubmitLead: () => Promise<boolean>;
  postBuyLeadOpen: boolean;
  setPostBuyLeadOpen: (v: boolean) => void;
  roomscanLeadRequestNonce?: number;
  leadSource: "cart_confirm" | "post_buy_panel" | "roomscan";
  setLeadSource: (v: "cart_confirm" | "post_buy_panel" | "roomscan") => void;
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
  hasSavedLeadEmail,
  leadStatus,
  leadError,
  onSubmitLead,
  postBuyLeadOpen,
  setPostBuyLeadOpen,
  roomscanLeadRequestNonce = 0,
  leadSource,
  setLeadSource,
  onOpenProduct,
}) => {
  const [pendingBuy, setPendingBuy] = useState<Product | null>(null);
  const [confirmVariant, setConfirmVariant] = useState<ConfirmVariant>("A");
  const [lastBuyProduct, setLastBuyProduct] = useState<Product | null>(null);
  const [lastBoughtName, setLastBoughtName] = useState<string>("");
  const [postBuyPrompted, setPostBuyPrompted] = useState(false);
  const [leadPanelPulse, setLeadPanelPulse] = useState(false);
  const leadInputRef = useRef<HTMLInputElement | null>(null);
  const leadSourceRef = useRef<"cart_confirm" | "post_buy_panel" | "roomscan">(leadSource);
  const leadPromptShownRef = useRef<Record<string, boolean>>({});
  const lastRoomscanLeadRequestRef = useRef(0);
  const primaryChoiceLoggedRef = useRef(false);
  const confirmInterceptedRef = useRef(false);

  useEffect(() => {
    leadSourceRef.current = leadSource;
  }, [leadSource]);

  function pulseLeadPanel() {
    setLeadPanelPulse(true);
    window.setTimeout(() => setLeadPanelPulse(false), 900);
  }

  function openLeadPanel(src: "cart_confirm" | "post_buy_panel" | "roomscan", name?: string) {
    leadSourceRef.current = src;
    setLeadSource(src);
    if (name) setLastBoughtName(name);
    setPostBuyLeadOpen(true);

    if (!leadPromptShownRef.current[src]) {
      leadPromptShownRef.current[src] = true;
      void Firestore.logEvent({
        type: "view_change",
        view: "checkout",
        source: src,
        meta: {
          panel: "lead_prompt_shown",
        },
      }).catch(console.warn);
    }

    requestAnimationFrame(() => {
      const panel = document.querySelector('[data-lead-panel="1"]') as HTMLElement | null;

      if (!panel) {
        requestAnimationFrame(() => {
          const panel2 = document.querySelector('[data-lead-panel="1"]') as HTMLElement | null;
          const scroller2 = panel2?.closest('[data-modal-scroll="true"]') as HTMLElement | null;
          if (panel2 && scroller2) {
            const top = panel2.offsetTop - scroller2.clientHeight / 2 + panel2.clientHeight / 2;
            scroller2.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
          } else {
            panel2?.scrollIntoView({ behavior: "smooth", block: "center" });
          }
          pulseLeadPanel();
        });
        return;
      }

      const scroller = panel.closest('[data-modal-scroll="true"]') as HTMLElement | null;
      if (scroller) {
        const top = panel.offsetTop - scroller.clientHeight / 2 + panel.clientHeight / 2;
        scroller.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
      } else {
        panel.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      pulseLeadPanel();
    });
  }

  useEffect(() => {
    if (!open && !postBuyLeadOpen) return;
    if (leadEmail?.trim()) return;

    try {
      const saved = localStorage.getItem("seligo_lead_email") || "";
      if (saved) setLeadEmail(saved);
    } catch {
      // ignore storage failures
    }
  }, [open, postBuyLeadOpen, leadEmail]);

  useEffect(() => {
    if (!open) return;
    if (!roomscanLeadRequestNonce) return;
    if (roomscanLeadRequestNonce === lastRoomscanLeadRequestRef.current) return;

    lastRoomscanLeadRequestRef.current = roomscanLeadRequestNonce;
    openLeadPanel("roomscan", "these picks");
  }, [open, roomscanLeadRequestNonce]);

  useEffect(() => {
    if (!open) return;
    void Firestore.ensureUserReady().catch(console.warn);
  }, [open]);

  useEffect(() => {
    if (open) confirmInterceptedRef.current = false;
  }, [open]);

  useEffect(() => {
    if (open) return;
    setPostBuyLeadOpen(false);
    setPostBuyPrompted(false);
  }, [open, setPostBuyLeadOpen]);

  // Keep panel visible after successful lead so user can continue to retailer
  useEffect(() => {
    if (leadStatus !== "saved") return;
  }, [leadStatus, setPostBuyLeadOpen]);

  useEffect(() => {
    if (!postBuyLeadOpen) return;
    if (leadEmail?.trim()) return;
    const t = window.setTimeout(() => leadInputRef.current?.focus(), 50);
    return () => window.clearTimeout(t);
  }, [postBuyLeadOpen, leadEmail]);

  const preferRetailer = hasSavedLeadEmail;

  function openConfirm(p: Product) {
    const isReturning = hasSavedLeadEmail;
    const variant: ConfirmVariant = isReturning ? "A" : getConfirmVariantNew();

    setPendingBuy(p);
    setConfirmVariant(variant);
    setLastBuyProduct(p);

    void Firestore.logEvent({
      type: "view_change",
      view: "checkout",
      source: "cart_confirm",
      productId: p.id,
      meta: {
        panel: "cart_confirm_card_shown",
        preferRetailer: isReturning ? 1 : 0,
        variant,
      },
    }).catch(console.warn);
  }

  useEffect(() => {
    primaryChoiceLoggedRef.current = false;
  }, [pendingBuy?.id]);

  async function handleBuy(
    product: Product,
    sourceOverride?: CheckoutLinksModalProps["leadSource"],
    opts?: { skipPostBuyPrompt?: boolean; bypassConfirmGate?: boolean }
  ) {
    const url = getPurchaseUrl(product);
    if (!url) return;

    if (!opts?.bypassConfirmGate && !hasSavedLeadEmail && !confirmInterceptedRef.current) {
      confirmInterceptedRef.current = true;
      openConfirm(product);
      return;
    }

    setLastBuyProduct(product);

    // Open outbound immediately
    window.open(url, "_blank", "noopener,noreferrer");

    void Firestore.logEvent({
      type: "checkout_item_open",
      view: "checkout",
      source: sourceOverride ?? "cart_confirm",
      productId: product.id,
      purchaseUrl: url,
      meta: {
        category: product.category ?? "",
        price: Number(product.price ?? 0),
      },
    }).catch(console.warn);

    // Log buy_click with clear source
    void Firestore.logEvent({
      type: "buy_click",
      view: "checkout",
      source: sourceOverride ?? "cart_confirm",
      productId: product.id,
      purchaseUrl: url,
      meta: {
        category: product.category ?? "",
        price: Number(product.price ?? 0),
      },
    }).catch(console.warn);

    if (opts?.skipPostBuyPrompt) return;

    let saved = false;
    try {
      saved = localStorage.getItem("seligo_lead_saved") === "1";
    } catch {}

    if (!postBuyPrompted) {
      setPostBuyPrompted(true);

      if (!saved) {
        openLeadPanel("post_buy_panel", product.name ?? (product as any).title ?? "this item");
      } else {
        void Firestore.logEvent({
          type: "view_change",
          view: "checkout",
          source: "post_buy_panel",
          meta: { panel: "lead_prompt_eligible_saved" },
        }).catch(console.warn);
      }
    }
  }

  const handleLeadClick = async () => {
    await onSubmitLead();
  };

  const logPrimaryConfirmChoice = (choice: "email" | "retailer" | "dismiss") => {
    if (!pendingBuy) return;
    if (primaryChoiceLoggedRef.current) return;
    primaryChoiceLoggedRef.current = true;

    const variant: ConfirmVariant = preferRetailer ? "A" : confirmVariant;

    void Firestore.logEvent({
      type: "view_change",
      view: "checkout",
      source: "cart_confirm",
      productId: pendingBuy.id,
      meta: {
        panel: "cart_confirm_primary_choice",
        choice,
        preferRetailer: preferRetailer ? 1 : 0,
        variant,
      },
    }).catch(console.warn);
  };

  const onConfirmRetailer = () => {
    if (!pendingBuy) return;

    logPrimaryConfirmChoice("retailer");

    void Firestore.logEvent({
      type: "view_change",
      view: "checkout",
      source: "cart_confirm",
      productId: pendingBuy.id,
      meta: {
        panel: "cart_confirm_open_retailer_click",
        preferRetailer: preferRetailer ? 1 : 0,
        variant: preferRetailer ? "A" : confirmVariant,
      },
    }).catch(console.warn);

    void handleBuy(pendingBuy, "cart_confirm", { bypassConfirmGate: true });
    setPendingBuy(null);
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

            {pendingBuy && (
              <div className="mt-3 rounded-2xl border border-slate-200 bg-white p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-black text-slate-900">
                      Want this cart + cheaper alternatives emailed?
                    </div>
                    <div className="text-sm text-slate-600 mt-1">
                      We’ll send links + price drops. No spam.
                    </div>
                    {!preferRetailer && confirmVariant === "B" ? (
                      <div className="mt-2 text-xs text-slate-600">
                        Instant links to your cart + price-drop alerts.
                      </div>
                    ) : null}
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      logPrimaryConfirmChoice("dismiss");
                      void Firestore.logEvent({
                        type: "view_change",
                        view: "checkout",
                        source: "cart_confirm",
                        productId: pendingBuy.id,
                        meta: {
                          panel: "cart_confirm_dismiss",
                          preferRetailer: preferRetailer ? 1 : 0,
                          variant: preferRetailer ? "A" : confirmVariant,
                        },
                      }).catch(console.warn);
                      setPendingBuy(null);
                    }}
                    className="h-9 w-9 rounded-xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center"
                    aria-label="Dismiss"
                    title="Dismiss"
                  >
                    <span className="text-slate-700 font-black">×</span>
                  </button>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2">
                  {!preferRetailer ? (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          logPrimaryConfirmChoice("email");
                          void Firestore.logEvent({
                            type: "view_change",
                            view: "checkout",
                            source: "cart_confirm",
                            productId: pendingBuy.id,
                            meta: {
                              panel: "cart_confirm_email_click",
                              preferRetailer: preferRetailer ? 1 : 0,
                              variant: preferRetailer ? "A" : confirmVariant,
                            },
                          }).catch(console.warn);
                          openLeadPanel("cart_confirm");
                        }}
                        className="h-12 rounded-2xl bg-[var(--seligo-cta)] hover:bg-[#fb8b3a] text-white font-extrabold active:scale-95 transition"
                      >
                        Email me links
                      </button>

                      <button
                        type="button"
                        onClick={onConfirmRetailer}
                        className="h-12 rounded-2xl border border-slate-200 bg-white text-slate-900 font-extrabold hover:bg-slate-50 active:scale-95 transition"
                      >
                        Open retailer ↗
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={onConfirmRetailer}
                        className="h-12 rounded-2xl bg-[var(--seligo-cta)] hover:bg-[#fb8b3a] text-white font-extrabold active:scale-95 transition"
                      >
                        Open retailer ↗
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          logPrimaryConfirmChoice("email");
                          void Firestore.logEvent({
                            type: "view_change",
                            view: "checkout",
                            source: "cart_confirm",
                            productId: pendingBuy.id,
                            meta: {
                              panel: "cart_confirm_email_click",
                              preferRetailer: preferRetailer ? 1 : 0,
                              variant: preferRetailer ? "A" : confirmVariant,
                            },
                          }).catch(console.warn);
                          openLeadPanel("cart_confirm");
                        }}
                        className="h-12 rounded-2xl bg-slate-900 hover:bg-slate-800 text-white font-extrabold active:scale-95 transition"
                      >
                        Email me links
                      </button>
                    </>
                  )}
                </div>

                <div className="mt-3 text-[11px] text-slate-400 leading-snug">
                  Tip: If you drop your email once, it becomes 1-tap next time.
                </div>
              </div>
            )}

            {postBuyLeadOpen ? (
              leadStatus === "saved" ? (
                <div data-lead-panel="1" className={`mt-4 bg-emerald-50 border border-emerald-100 rounded-2xl p-4 ${leadPanelPulse ? "animate-pulse" : ""}`}>
                  <div className="font-black text-emerald-700">Alerts enabled ✅</div>
                  <div className="text-sm text-emerald-700/80 mt-1">
                    We’ll email you if this item drops in price or a close alternative is cheaper.
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      const p = pendingBuy ?? lastBuyProduct;
                      if (!p) return;
                      void handleBuy(p, leadSourceRef.current, { skipPostBuyPrompt: true, bypassConfirmGate: true });
                      setPendingBuy(null);
                      setPostBuyLeadOpen(false);
                    }}
                    className="mt-3 w-full h-12 rounded-2xl bg-[var(--seligo-cta)] hover:bg-[#fb8b3a] text-white font-extrabold flex items-center justify-center gap-1 active:scale-95 transition"
                  >
                    Continue to retailer ↗
                  </button>
                </div>
              ) : (
                <div data-lead-panel="1" className={`mt-4 bg-slate-50 border border-slate-200 rounded-2xl p-4 ${leadPanelPulse ? "animate-pulse" : ""}`}>
                  <div className="font-black text-slate-900">
                    Email me my cart links + price drops
                  </div>
                  <div className="text-sm text-slate-600 mt-1">
                    Includes {leadSource === "roomscan" ? "these picks" : (lastBoughtName || "this item")} plus cheaper alternatives.
                  </div>

                  {leadEmail?.trim() ? (
                    <div className="mt-3 text-xs text-slate-600 flex items-center justify-between gap-2">
                      <div>
                        Sending alerts to <span className="font-extrabold text-slate-900">{leadEmail.trim()}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setLeadEmail("")}
                        className="text-slate-700 font-extrabold underline"
                      >
                        Change
                      </button>
                    </div>
                  ) : (
                    <input
                      ref={leadInputRef}
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
                    {leadStatus === "saving"
                      ? "Saving..."
                      : leadEmail?.trim()
                        ? `Send links to ${leadEmail.trim()}`
                        : "Get alerts"}
                  </button>

                  {leadEmail?.trim() ? (
                    <div className="text-[11px] text-slate-500 mt-2">Receipt + price drops</div>
                  ) : null}

                  <button
                    type="button"
                    onClick={() => setPostBuyLeadOpen(false)}
                    className="mt-2 text-xs text-slate-500 hover:text-slate-700 underline"
                  >
                    No thanks
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
                        onClick={() => {
                          setPostBuyLeadOpen(false);
                          openConfirm(p);
                        }}
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
