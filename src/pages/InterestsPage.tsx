import { useState } from "react";
import { ArrowRight } from "lucide-react";

import { onboardingCopy } from "../content/copy";
import { VIBE_CATEGORIES } from "../constants";

type InterestsPageProps = {
  initialSelectedIds?: string[];
  isLoading?: boolean;
  onContinue?: (selectedIds: string[]) => void | Promise<void>;
  onHowItWorks?: () => void;
  onRoomScan?: () => void;
};

export default function InterestsPage({
  initialSelectedIds = [],
  isLoading = false,
  onContinue,
  onHowItWorks,
  onRoomScan,
}: InterestsPageProps) {
  const [selected, setSelected] = useState<string[]>(initialSelectedIds);

  const toggleCategory = (id: string) => {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(14,165,233,0.14),_transparent_38%),linear-gradient(180deg,#f8fafc_0%,#eef2ff_100%)] px-5 pt-6 pb-24 sm:px-6">
      <div className="mx-auto max-w-xl">
        <div className="rounded-[2rem] border border-white/80 bg-white/90 px-5 py-6 shadow-[0_32px_80px_-40px_rgba(15,23,42,0.45)] backdrop-blur sm:px-7 sm:py-7">
          <div className="inline-flex items-center gap-2 rounded-full border border-slate-200/80 bg-slate-50/90 px-3 py-1.5 shadow-sm">
            <span className="text-sm">✨</span>
            <span className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">
              {onboardingCopy.interestsEyebrow}
            </span>
          </div>

          <h1 className="mt-5 max-w-[10ch] text-[2.65rem] font-black leading-[0.9] tracking-[-0.05em] text-slate-950 sm:text-[3.35rem]">
            {onboardingCopy.interestsTitle}
          </h1>

          <p className="mt-3 max-w-[33ch] text-[15px] leading-6 text-slate-600 sm:text-base">
            {onboardingCopy.interestsSubtitle}
          </p>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {VIBE_CATEGORIES.map((category) => {
            const isActive = selected.includes(category.id);
            const interestLabel =
              onboardingCopy.interestLabels[category.id] ?? category.label;
            const interestDescription =
              onboardingCopy.interestDescriptions[category.id] ??
              category.description;

            return (
              <button
                key={category.id}
                type="button"
                onClick={() => toggleCategory(category.id)}
                className={`rounded-[1.75rem] border px-5 py-5 text-left transition duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300 ${
                  isActive
                    ? "border-slate-950 bg-slate-950 text-white shadow-[0_28px_64px_-36px_rgba(15,23,42,0.9)]"
                    : "border-white/70 bg-white/90 text-slate-900 shadow-[0_18px_45px_-30px_rgba(15,23,42,0.45)] hover:-translate-y-0.5 hover:shadow-[0_28px_64px_-34px_rgba(15,23,42,0.42)]"
                }`}
              >
                <div className="text-3xl">{category.emoji}</div>

                <div className="mt-4 text-lg font-black">{interestLabel}</div>

                <div
                  className={`mt-1 text-sm leading-6 ${
                    isActive ? "text-white/80" : "text-slate-500"
                  }`}
                >
                  {interestDescription}
                </div>
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={() => void onContinue?.(selected)}
          className="mt-8 flex h-15 w-full items-center justify-center gap-2 rounded-[1.75rem] bg-slate-950 px-5 text-[15px] font-black tracking-[0.01em] text-white shadow-[0_28px_72px_-32px_rgba(15,23,42,0.75)] ring-1 ring-slate-950/10 transition duration-200 active:scale-[0.99] disabled:opacity-50 disabled:shadow-none"
          disabled={selected.length === 0 || isLoading}
        >
          <span>
            {isLoading
              ? onboardingCopy.interestsLoadingCta
              : onboardingCopy.interestsCta}
          </span>
          {!isLoading ? <ArrowRight className="h-4 w-4" /> : null}
        </button>

        <div className="mt-4 flex items-center justify-between px-1 text-sm">
          <button
            type="button"
            onClick={onHowItWorks}
            className="font-semibold text-slate-700 transition hover:text-slate-950"
          >
            {onboardingCopy.interestsHowItWorksCta}
          </button>
          <button
            type="button"
            onClick={onRoomScan}
            className="font-semibold text-slate-500 transition hover:text-slate-900"
          >
            {onboardingCopy.interestsRoomScanCta}
          </button>
        </div>
      </div>
    </div>
  );
}