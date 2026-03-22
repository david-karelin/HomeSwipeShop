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
  const hasSelections = selected.length > 0;

  const toggleCategory = (id: string) => {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  return (
    <div className="min-h-screen bg-[#EEF2F7] px-4 pt-5 pb-8">
      <div className="mx-auto w-full max-w-[560px]">
        <div className="rounded-[30px] bg-white p-5 shadow-[0_18px_50px_rgba(15,23,42,0.08)] sm:p-6">
          <div className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
            <span className="mr-2">✨</span>
            <span>{onboardingCopy.interestsEyebrow}</span>
          </div>

          <h1 className="mt-4 max-w-[320px] text-[40px] font-black leading-[0.92] tracking-[-0.045em] text-slate-950 sm:max-w-[380px] sm:text-[50px]">
            {onboardingCopy.interestsTitle}
          </h1>

          <p className="mt-3 max-w-[340px] text-[16px] leading-7 text-slate-600 sm:text-[17px]">
            {onboardingCopy.interestsSubtitle}
          </p>
        </div>

        <div className="mt-3.5 grid grid-cols-2 gap-3">
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
                aria-pressed={isActive}
                onClick={() => toggleCategory(category.id)}
                className={`relative min-h-[144px] rounded-[24px] p-4 text-left transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 ${
                  isActive
                    ? "bg-sky-50 ring-2 ring-sky-500 shadow-[0_16px_36px_rgba(14,165,233,0.14)]"
                    : "bg-white ring-1 ring-slate-200 shadow-[0_10px_24px_rgba(15,23,42,0.05)] hover:-translate-y-[1px] hover:shadow-[0_14px_32px_rgba(15,23,42,0.08)]"
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="text-[25px] leading-none">{category.emoji}</div>

                  <div
                    className={`flex h-6 w-6 items-center justify-center rounded-full text-sm font-bold transition ${
                      isActive
                        ? "bg-sky-500 text-white shadow"
                        : "bg-slate-100 text-transparent"
                    }`}
                  >
                    ✓
                  </div>
                </div>

                <div className="mt-5 text-[15px] font-extrabold tracking-[-0.02em] text-slate-950 sm:text-[16px]">
                  {interestLabel}
                </div>

                <div className="mt-2 pr-1 text-[13px] leading-5 text-slate-500 sm:text-[14px]">
                  {interestDescription}
                </div>
              </button>
            );
          })}
        </div>

        <div className="sticky bottom-0 z-10 mt-4 bg-gradient-to-t from-[#EEF2F7] via-[#EEF2F7]/95 to-transparent pt-4 pb-[calc(env(safe-area-inset-bottom,0px)+6px)] backdrop-blur-[2px]">
          <div className="mb-2 flex items-center justify-between px-1 text-[13px] font-semibold text-slate-500">
            <span>
              {hasSelections
                ? `${selected.length} selected`
                : "Choose a few to personalize your feed"}
            </span>
          </div>

          <button
            type="button"
            onClick={() => void onContinue?.(selected)}
            className={`group w-full rounded-full px-5 py-4 text-[16px] font-black tracking-[-0.02em] transition-all duration-200 ${
              hasSelections && !isLoading
                ? "bg-[var(--seligo-cta)] text-white shadow-[0_18px_40px_rgba(251,146,60,0.30)] hover:-translate-y-[1px] hover:shadow-[0_22px_44px_rgba(251,146,60,0.38)] hover:brightness-[1.03] active:scale-[0.99]"
                : "cursor-not-allowed bg-slate-300 text-slate-500"
            }`}
            disabled={!hasSelections || isLoading}
          >
            <span className="inline-flex items-center gap-2">
              {isLoading
                ? onboardingCopy.interestsLoadingCta
                : onboardingCopy.interestsCta}
              {!isLoading ? (
                <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
              ) : null}
            </span>
          </button>

          <div className="mt-3 flex items-center justify-between px-1 text-[14px] font-semibold text-slate-600">
            <button
              type="button"
              onClick={onHowItWorks}
              className="transition hover:text-slate-950"
            >
              {onboardingCopy.interestsHowItWorksCta}
            </button>

            <button
              type="button"
              onClick={onRoomScan}
              className="transition hover:text-slate-950"
            >
              {onboardingCopy.interestsRoomScanCta}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}