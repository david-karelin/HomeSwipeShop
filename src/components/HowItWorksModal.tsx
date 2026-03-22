import { useEffect } from "react";
import { onboardingCopy } from "../content/copy";

export default function HowItWorksModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[10000] bg-black/45"
      onClick={onClose}
      aria-modal="true"
      role="dialog"
    >
      <div className="absolute inset-x-0 bottom-0 flex justify-center p-3 sm:p-4">
        <div
          className="w-full max-w-md max-h-[88vh] overflow-y-auto rounded-[28px] bg-white shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="sticky top-0 z-10 rounded-t-[28px] bg-white px-5 pt-3 pb-2">
            <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-slate-200" />

            <div className="flex items-start justify-between gap-3">
              <div className="pr-2">
                <h2 className="text-2xl font-black tracking-tight text-slate-900">
                  {onboardingCopy.heroTitle}
                </h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  {onboardingCopy.heroSubtitle}
                </p>
              </div>

              <button
                type="button"
                onClick={onClose}
                className="shrink-0 rounded-full border border-slate-200 px-3 py-1.5 text-sm font-bold text-slate-600"
              >
                {onboardingCopy.modalCloseLabel}
              </button>
            </div>
          </div>

          <div className="px-5 pb-5">
            <div className="mt-3 space-y-3">
              {onboardingCopy.featureCards.map((card) => (
                <div
                  key={card.title}
                  className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
                >
                  <div className="text-2xl">{card.emoji}</div>
                  <div className="mt-2 text-base font-black text-slate-900">
                    {card.title}
                  </div>
                  <div className="mt-1 text-sm leading-6 text-slate-600">
                    {card.description}
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-5 rounded-2xl bg-slate-50 p-4">
              <div className="text-xs font-black uppercase tracking-[0.2em] text-slate-500">
                {onboardingCopy.howItWorksTitle}
              </div>

              <div className="mt-3 space-y-3">
                {onboardingCopy.howItWorksSteps.map((step, i) => (
                  <div key={step} className="flex gap-3">
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-black text-white">
                      {i + 1}
                    </div>
                    <div className="text-sm leading-6 text-slate-700">
                      {step}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="mt-5 h-12 w-full rounded-2xl bg-[var(--seligo-cta)] text-sm font-black text-white shadow-sm active:scale-[0.99] transition"
            >
              {onboardingCopy.heroCta}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
