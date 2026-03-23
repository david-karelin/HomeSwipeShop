import React, { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import type { Product } from "../types";
import * as Firestore from "../firestoreService";
import {
  getResolvedPurchaseUrl,
  type RetailerLinkOptions,
} from "../retailerLinks";
import {
  normalizeRetailerPlacement,
  shouldIncludeCheckoutOpen,
  type RetailerClickSource,
  type RetailerClickView,
  type RetailerPlacement,
} from "../src/lib/retailerClicks";
import { AFFILIATE_DISCLOSURE_TEXT } from "../src/lib/affiliateConfig";

type ConfirmVariant = "A" | "B";

type PendingBuyIntent = {
  product: Product;
  source: RetailerClickSource;
  view: RetailerClickView;
  placement: RetailerPlacement;
  purchaseUrl: string;
  includeCheckoutOpen: boolean;
  skipPostBuyPrompt?: boolean;
};

type BuyIntentOverrides = Pick<
  RetailerLinkOptions,
  "source" | "view" | "placement" | "purchaseUrl" | "includeCheckoutOpen"
> & {
  skipPostBuyPrompt?: boolean;
  bypassConfirmGate?: boolean;
};

const getLeadBuyIntent = (
  source: "cart_confirm" | "post_buy_panel" | "roomscan"
): Pick<PendingBuyIntent, "source" | "view" | "placement"> => {
  if (source === "roomscan") {
    return {
      source: "roomscan",
      view: "roomscan",
      placement: "continue_to_retailer",
    };
  }

  return {
    source: "checkout_modal",
    view: "checkout",
    placement: "continue_to_retailer",
  };
};

function variantFromSessionId(sessionId: string): ConfirmVariant {
  let hash = 0;
  for (let index = 0; index < sessionId.length; index += 1) {
    hash = (hash * 31 + sessionId.charCodeAt(index)) | 0;
  }

  return Math.abs(hash) % 2 === 0 ? "A" : "B";
}

type CheckoutLinksModalProps = {
  open: boolean;
  onClose: () => void;
  showActionToast: (label: string) => void;
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
  onOpenProduct?: (p: Product) => void;
  onOpenRetailerLink: (product: Product, opts?: RetailerLinkOptions) => void;
  onRemoveCartItem: (productId: string) => void;
  onMoveCartItemToSaved: (p: Product) => void;
  onRemoveSavedItem: (productId: string) => void;
  onMoveSavedItemToBag: (p: Product) => void;
};

const CheckoutLinksModal: React.FC<CheckoutLinksModalProps> = ({
  open,
  onClose,
  showActionToast,
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
  onOpenRetailerLink,
  onRemoveCartItem,
  onMoveCartItemToSaved,
  onRemoveSavedItem,
  onMoveSavedItemToBag,
}) => {
  const [pendingBuy, setPendingBuy] = useState<Product | null>(null);
  const [pendingBuyIntent, setPendingBuyIntent] = useState<PendingBuyIntent | null>(null);
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

  const bagCount = cart.length;
  const savedCount = wishlist.length;
  const totalCount = bagCount + savedCount;
  const isCheckoutEmpty = bagCount === 0 && savedCount === 0;
  const preferRetailer = hasSavedLeadEmail;

  const clearPendingBuyState = () => {
    setPendingBuy(null);
    setPendingBuyIntent(null);
    confirmInterceptedRef.current = false;
  };

  const handleClose = () => {
    clearPendingBuyState();
    setPostBuyLeadOpen(false);
    setPostBuyPrompted(false);
    onClose();
  };

  useEffect(() => {
    leadSourceRef.current = leadSource;
  }, [leadSource]);

  useEffect(() => {
    if (!isCheckoutEmpty) return;

    clearPendingBuyState();
    setPostBuyLeadOpen(false);
  }, [isCheckoutEmpty, setPostBuyLeadOpen]);

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
      }).catch(() => {});
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
    } catch {}
  }, [open, postBuyLeadOpen, leadEmail, setLeadEmail]);

  useEffect(() => {
    if (!open) return;
    if (!roomscanLeadRequestNonce) return;
    if (roomscanLeadRequestNonce === lastRoomscanLeadRequestRef.current) return;

    lastRoomscanLeadRequestRef.current = roomscanLeadRequestNonce;
    openLeadPanel("roomscan", "these picks");
  }, [open, roomscanLeadRequestNonce]);

  useEffect(() => {
    if (!open) return;
    void Firestore.ensureUserReady().catch(() => {});
  }, [open]);

  useEffect(() => {
    if (open) confirmInterceptedRef.current = false;
  }, [open]);

  useEffect(() => {
    if (open) return;
    clearPendingBuyState();
    setPostBuyLeadOpen(false);
    setPostBuyPrompted(false);
  }, [open, setPostBuyLeadOpen]);

  useEffect(() => {
    if (!postBuyLeadOpen) return;
    if (leadEmail?.trim()) return;

    const t = window.setTimeout(() => leadInputRef.current?.focus(), 50);
    return () => window.clearTimeout(t);
  }, [postBuyLeadOpen, leadEmail]);

  const getCheckoutPlacement = (productId: string): RetailerPlacement => {
    return wishlist.some((item) => item.id === productId)
      ? "checkout_saved_item"
      : "checkout_cart_item";
  };

  const getCheckoutModalBuyContext = (
    product: Product
  ): Pick<PendingBuyIntent, "source" | "view" | "placement"> => {
    if (postBuyLeadOpen) return getLeadBuyIntent(leadSourceRef.current);

    return {
      source: "checkout_modal",
      view: "checkout",
      placement: getCheckoutPlacement(product.id),
    };
  };

  const resolveBuyIntent = (
    product: Product,
    opts?: BuyIntentOverrides
  ): PendingBuyIntent | null => {
    const defaults = getCheckoutModalBuyContext(product);
    const source = opts?.source ?? defaults.source;
    const view = opts?.view ?? defaults.view;
    const placement = normalizeRetailerPlacement(opts?.placement, defaults.placement);
    const purchaseUrl = getResolvedPurchaseUrl(product, opts?.purchaseUrl);

    if (!purchaseUrl) return null;

    return {
      product,
      source,
      view,
      placement,
      purchaseUrl,
      includeCheckoutOpen: opts?.includeCheckoutOpen ?? shouldIncludeCheckoutOpen(source, view),
      skipPostBuyPrompt: opts?.skipPostBuyPrompt,
    };
  };

  function openConfirm(intent: PendingBuyIntent) {
    const { product } = intent;
    const isReturning = hasSavedLeadEmail;
    const sessionId = Firestore.getOrCreateSessionId();
    const variant: ConfirmVariant = isReturning ? "A" : variantFromSessionId(sessionId);

    setPendingBuy(product);
    setPendingBuyIntent(intent);
    setConfirmVariant(variant);
    setLastBuyProduct(product);

    void Firestore.logEvent({
      type: "view_change",
      view: "checkout",
      source: "cart_confirm",
      productId: product.id,
      meta: {
        panel: "cart_confirm_card_shown",
        preferRetailer: isReturning ? 1 : 0,
        variant,
      },
    }).catch(() => {});
  }

  useEffect(() => {
    primaryChoiceLoggedRef.current = false;
  }, [pendingBuy?.id]);

  async function handleBuy(
    product: Product,
    opts?: BuyIntentOverrides
  ) {
    const intent = resolveBuyIntent(product, opts);
    if (!intent) {
      showActionToast("This product link isn't available right now.");
      return;
    }

    if (!opts?.bypassConfirmGate && !hasSavedLeadEmail && !confirmInterceptedRef.current) {
      confirmInterceptedRef.current = true;
      openConfirm(intent);
      return;
    }

    setLastBuyProduct(product);

    onOpenRetailerLink(product, {
      source: intent.source,
      view: intent.view,
      placement: intent.placement,
      purchaseUrl: intent.purchaseUrl,
      includeCheckoutOpen: intent.includeCheckoutOpen,
    });

    if (intent.skipPostBuyPrompt) return;

    let saved = false;
    try {
      saved = localStorage.getItem("seligo_lead_saved") === "1";
    } catch {}

    if (!postBuyPrompted) {
      setPostBuyPrompted(true);

      if (!saved) {
        openLeadPanel("post_buy_panel", product.name ?? "this item");
      } else {
        void Firestore.logEvent({
          type: "view_change",
          view: "checkout",
          source: "post_buy_panel",
          meta: { panel: "lead_prompt_eligible_saved" },
        }).catch(() => {});
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
    }).catch(() => {});
  };

  const onConfirmRetailer = () => {
    if (!pendingBuy || !pendingBuyIntent) {
      clearPendingBuyState();
      return;
    }

    const intent = pendingBuyIntent;

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
    }).catch(() => {});

    clearPendingBuyState();

    void handleBuy(intent.product, {
      bypassConfirmGate: true,
      skipPostBuyPrompt: intent.skipPostBuyPrompt,
      source: intent.source,
      view: intent.view,
      placement: intent.placement,
      purchaseUrl: intent.purchaseUrl,
      includeCheckoutOpen: intent.includeCheckoutOpen,
    });
  };

  useEffect(() => {
    if (!open) return;

    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
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
        onClick={handleClose}
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
                <div className="text-[11px] font-black uppercase tracking-[0.18em] text-sky-500/85">
                  Review your picks
                </div>
                <div className="mt-1 text-xl font-extrabold text-slate-900">
                  Your room shortlist
                </div>
                <div className="mt-1 text-sm text-slate-600">
                  Compare saved upgrades, review your bag, and open retailer links when
                  you’re ready.
                </div>
              </div>

              <button
                onClick={handleClose}
                className="h-10 w-10 rounded-2xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center"
                aria-label="Close"
              >
                <X className="h-5 w-5 text-slate-700" />
              </button>
            </div>
          </div>

          <div
            className="max-h-[62vh] overflow-y-auto overscroll-contain no-scrollbar px-6 pb-6"
            data-modal-scroll="true"
          >
            <div className="mt-1 rounded-[1.5rem] border border-slate-100 bg-slate-50 p-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">
                    Bag subtotal
                  </div>
                  <div className="mt-1 text-2xl font-black text-slate-900">
                    {isCheckoutEmpty ? "$0.00" : `$${subtotal.toFixed(2)}`}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    {bagCount} in bag • {savedCount} saved
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-right">
                  <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">
                    Total picks
                  </div>
                  <div className="mt-1 text-lg font-black text-slate-900">{totalCount}</div>
                </div>
              </div>
            </div>

            {pendingBuy && (
              <div className="mt-3 rounded-[1.5rem] border border-slate-200 bg-white p-4 shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-black text-slate-900">Send this shortlist to your inbox?</div>
                    <div className="mt-1 text-sm text-slate-600">
                      Get retailer links, saved picks, and price-drop alerts in one place.
                    </div>
                    <div className="mt-2 text-xs text-slate-600">
                      One email now makes future checkout 1-tap.
                    </div>
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
                      }).catch(() => {});
                      clearPendingBuyState();
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
                          }).catch(() => {});
                          openLeadPanel("cart_confirm");
                        }}
                        className="h-12 rounded-2xl bg-[var(--seligo-cta)] hover:bg-[#fb8b3a] text-white font-extrabold active:scale-95 transition"
                      >
                        Send me links
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
                          }).catch(() => {});
                          openLeadPanel("cart_confirm");
                        }}
                        className="h-12 rounded-2xl bg-slate-900 hover:bg-slate-800 text-white font-extrabold active:scale-95 transition"
                      >
                        Send me links
                      </button>
                    </>
                  )}
                </div>

                <div className="mt-3 text-[11px] text-slate-400 leading-snug">
                  Tip: Save your email once and future checkout becomes 1-tap.
                </div>
              </div>
            )}

            {postBuyLeadOpen ? (
              leadStatus === "saved" ? (
                <div
                  data-lead-panel="1"
                  className={`mt-4 rounded-[1.5rem] border border-emerald-100 bg-emerald-50 p-4 ${leadPanelPulse ? "animate-pulse" : ""}`}
                >
                  <div className="font-black text-emerald-700">Alerts enabled ✅</div>
                  <div className="mt-1 text-sm text-emerald-700/80">
                    We’ll email you if this item drops in price or a close alternative is cheaper.
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      const p = pendingBuy ?? lastBuyProduct;
                      if (!p) return;
                      const leadBuyIntent = getLeadBuyIntent(leadSourceRef.current);
                      void handleBuy(p, {
                        skipPostBuyPrompt: true,
                        bypassConfirmGate: true,
                        source: leadBuyIntent.source,
                        view: leadBuyIntent.view,
                        placement: leadBuyIntent.placement,
                      });
                      clearPendingBuyState();
                      setPostBuyLeadOpen(false);
                    }}
                    className="mt-3 w-full h-12 rounded-2xl bg-[var(--seligo-cta)] hover:bg-[#fb8b3a] text-white font-extrabold flex items-center justify-center gap-1 active:scale-95 transition"
                  >
                    Continue to retailer ↗
                  </button>
                </div>
              ) : (
                <div
                  data-lead-panel="1"
                  className={`mt-4 rounded-[1.5rem] border border-slate-200 bg-slate-50 p-4 ${leadPanelPulse ? "animate-pulse" : ""}`}
                >
                  <div className="font-black text-slate-900">Send my links</div>
                  <div className="mt-1 text-sm text-slate-600">
                    Includes {leadSource === "roomscan" ? "these picks" : lastBoughtName || "this item"} plus
                    saved upgrades and price-drop alerts.
                  </div>

                  {leadEmail?.trim() ? (
                    <div className="mt-3 text-xs text-slate-600 flex items-center justify-between gap-2">
                      <div>
                        Sending to <span className="font-extrabold text-slate-900">{leadEmail.trim()}</span>
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

                  {leadError ? (
                    <div className="mt-2 text-rose-600 text-sm font-bold">{leadError}</div>
                  ) : null}

                  <button
                    onClick={() => void handleLeadClick()}
                    disabled={leadStatus === "saving"}
                    className="mt-3 w-full py-4 bg-[var(--seligo-cta)] hover:bg-[#fb8b3a] text-white rounded-2xl font-black disabled:opacity-60"
                  >
                    {leadStatus === "saving"
                      ? "Saving..."
                      : leadEmail?.trim()
                        ? `Send links to ${leadEmail.trim()}`
                        : "Send my links"}
                  </button>

                  {leadEmail?.trim() ? (
                    <div className="text-[11px] text-slate-500 mt-2">Retailer links + price drops</div>
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

            {isCheckoutEmpty ? (
              <div className="mt-4 rounded-[1.75rem] border border-slate-200 bg-gradient-to-b from-slate-50 to-white p-5 text-center">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-orange-100 bg-orange-50">
                  <span className="text-2xl">✨</span>
                </div>

                <div className="mt-4 text-base font-black text-slate-900">
                  Your shortlist is clear
                </div>

                <div className="mt-2 text-sm leading-relaxed text-slate-500">
                  Add more upgrades from Explore, Saved, or RoomScan when you’re ready.
                </div>

                <button
                  type="button"
                  onClick={handleClose}
                  className="mt-4 h-11 w-full rounded-2xl bg-slate-900 font-extrabold text-white"
                >
                  Back to Explore
                </button>
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                {cart.length > 0 &&
                  cart.map((p) => (
                    <div
                      key={p.id}
                      className="rounded-[1.5rem] border border-slate-100 bg-white p-3 shadow-[0_10px_30px_rgba(15,23,42,0.05)]"
                    >
                      <div className="flex gap-3">
                        <img
                          src={p.imageUrl}
                          alt={p.name}
                          className="h-16 w-16 rounded-2xl object-cover bg-slate-100"
                        />

                        <div className="min-w-0 flex-1">
                          <div className="text-[10px] font-black uppercase tracking-[0.18em] text-orange-500">
                            In your bag
                          </div>

                          <div className="mt-1 truncate font-black text-slate-900">{p.name}</div>

                          <div className="mt-1 text-xs text-slate-500 truncate">
                            {p.brand ?? "Seligo.AI"} • ${Number(p.price ?? 0).toFixed(2)}
                          </div>

                          <div className="mt-3 grid grid-cols-2 gap-2">
                            <button
                              onClick={() => {
                                handleClose();
                                onOpenProduct?.(p);
                              }}
                              className="h-10 rounded-xl border border-slate-200 bg-white text-xs font-black text-slate-700"
                            >
                              View
                            </button>

                            <button
                              onClick={() => {
                                setPostBuyLeadOpen(false);
                                void handleBuy(p);
                              }}
                              className="h-10 rounded-xl text-xs font-black text-white active:scale-[0.98] transition"
                              style={{ background: "var(--seligo-cta)" }}
                            >
                              Open retailer ↗
                            </button>
                          </div>

                          <div className="mt-2 flex items-center gap-3 text-[11px] font-bold">
                            <button
                              onClick={() => {
                                setPostBuyLeadOpen(false);
                                onMoveCartItemToSaved(p);
                              }}
                              className="text-slate-500 hover:text-slate-800"
                            >
                              Move to Saved
                            </button>

                            <button
                              onClick={() => {
                                setPostBuyLeadOpen(false);
                                onRemoveCartItem(p.id);
                              }}
                              className="text-slate-400 hover:text-slate-700"
                            >
                              Remove
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}

                {wishlist.length > 0 && (
                  <div className="pt-2">
                    <div className="mb-2 text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">
                      Saved for later
                    </div>

                    <div className="space-y-3">
                      {wishlist.map((p) => (
                        <div
                          key={`${p.id}-wish`}
                          className="rounded-[1.5rem] border border-slate-100 bg-white p-3 opacity-95"
                        >
                          <div className="flex gap-3">
                            <img
                              src={p.imageUrl}
                              alt={p.name}
                              className="h-14 w-14 rounded-2xl object-cover bg-slate-100"
                            />

                            <div className="min-w-0 flex-1">
                              <div className="text-[10px] font-black uppercase tracking-[0.18em] text-rose-500">
                                Saved upgrade
                              </div>

                              <div className="mt-1 truncate font-black text-slate-900">{p.name}</div>

                              <div className="mt-1 text-xs text-slate-500 truncate">
                                ${Number(p.price ?? 0).toFixed(2)}
                              </div>

                              <div className="mt-3 grid grid-cols-2 gap-2">
                                <button
                                  onClick={() => {
                                    handleClose();
                                    onOpenProduct?.(p);
                                  }}
                                  className="h-10 rounded-xl border border-slate-200 bg-white text-xs font-black text-slate-700"
                                >
                                  View
                                </button>

                                <button
                                  onClick={() => {
                                    setPostBuyLeadOpen(false);
                                    onMoveSavedItemToBag(p);
                                  }}
                                  className="h-10 rounded-xl text-xs font-black text-white active:scale-[0.98] transition"
                                  style={{ background: "var(--seligo-cta)" }}
                                >
                                  Move to Bag
                                </button>
                              </div>

                              <div className="mt-2 flex items-center gap-3 text-[11px] font-bold">
                                <button
                                  onClick={() => {
                                    setPostBuyLeadOpen(false);
                                    onRemoveSavedItem(p.id);
                                  }}
                                  className="text-slate-400 hover:text-slate-700"
                                >
                                  Remove
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="mt-4 rounded-2xl bg-slate-50 border border-slate-100 p-4">
              <div className="text-[11px] text-slate-500 leading-relaxed">
                {AFFILIATE_DISCLOSURE_TEXT}
              </div>

              <div className="mt-3 flex items-center justify-center gap-4 text-[11px] font-bold text-slate-500">
                <button type="button" onClick={onPrivacy} className="hover:text-slate-600">
                  Privacy
                </button>
                <button type="button" onClick={onTerms} className="hover:text-slate-600">
                  Terms
                </button>
                <button type="button" onClick={onDisclosure} className="hover:text-slate-600">
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
              onClick={handleClose}
              className="w-full h-12 rounded-2xl bg-slate-900 text-white font-extrabold"
            >
              {isCheckoutEmpty ? "Back to Explore" : "Keep Exploring"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CheckoutLinksModal;
