import React from "react";

type Props = { open: boolean; onClose: () => void };

export default function HowItWorksModal({ open, onClose }: Props) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] bg-black/60 flex items-center justify-center p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-lg max-h-[90vh] overflow-hidden flex flex-col rounded-2xl bg-white shadow-2xl">
        <div className="shrink-0 p-4 border-b border-slate-100 flex items-start justify-between gap-4">
          <div>
            <div className="text-2xl font-black text-slate-900">How Seligo.AI works</div>
            <div className="text-slate-500 text-sm mt-1">A quick 30-second overview.</div>
          </div>
          <button
            onClick={onClose}
            className="w-10 h-10 rounded-xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-600"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4 space-y-4 text-slate-700">
          <div className="rounded-2xl border border-slate-100 p-4">
            <div className="font-black text-slate-900">1) Swipe to discover</div>
            <div className="text-sm text-slate-600 mt-1">
              Swipe left to pass. Swipe right to save matches. Over time, your feed adapts to what you like.
            </div>
          </div>

          <div className="rounded-2xl border border-slate-100 p-4">
            <div className="font-black text-slate-900">2) Personalization</div>
            <div className="text-sm text-slate-600 mt-1">
              We use your likes/passes to rank future items. Your “Insights” vibe updates as you interact.
            </div>
          </div>

          <div className="rounded-2xl border border-slate-100 p-4">
            <div className="font-black text-slate-900">3) Checkout links</div>
            <div className="text-sm text-slate-600 mt-1">
              For now, “Open” launches affiliate product pages (real in-app checkout is coming later).
            </div>
          </div>

          <div className="text-[12px] text-slate-500 leading-snug">
            Disclosure: some links may be affiliate links. We may earn a commission at no extra cost to you.
          </div>
        </div>

        <div className="shrink-0 p-4 border-t border-slate-100">
          <button
            onClick={onClose}
            className="w-full py-4 rounded-2xl bg-slate-900 text-white font-black hover:bg-slate-800 active:scale-95 transition"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
