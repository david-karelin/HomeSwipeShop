import { useState } from "react";

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
    <div className="min-h-screen bg-slate-50 px-5 pt-8 pb-24">
      <div className="mx-auto max-w-2xl">
        <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 shadow-sm">
          <span className="text-sm">✨</span>
          <span className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">
            Affordable room upgrades
          </span>
        </div>

        <h1 className="mt-4 text-4xl font-black tracking-tight text-slate-900">
          Build Your Vibe
        </h1>

        <p className="mt-3 max-w-xl text-sm leading-6 text-slate-600">
          Pick the types of upgrades you want most. We&apos;ll build your first
          feed around cheap, aesthetic finds for your bedroom, desk, or
          apartment.
        </p>

        <div className="mt-5 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={onHowItWorks}
            className="rounded-full border border-slate-200 bg-white px-4 py-2 text-[11px] font-black uppercase tracking-[0.18em] text-slate-600 shadow-sm"
          >
            How it works
          </button>
          <button
            type="button"
            onClick={onRoomScan}
            className="rounded-full border border-slate-200 bg-white px-4 py-2 text-[11px] font-black uppercase tracking-[0.18em] text-slate-600 shadow-sm"
          >
            Scan my room instead
          </button>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {VIBE_CATEGORIES.map((category) => {
            const isActive = selected.includes(category.id);

            return (
              <button
                key={category.id}
                type="button"
                onClick={() => toggleCategory(category.id)}
                className={`rounded-3xl border p-5 text-left transition ${
                  isActive
                    ? "border-slate-900 bg-slate-900 text-white shadow-lg"
                    : "border-slate-200 bg-white text-slate-900 shadow-sm"
                }`}
              >
                <div className="text-3xl">{category.emoji}</div>

                <div className="mt-4 text-lg font-black">{category.label}</div>

                <div
                  className={`mt-1 text-sm leading-6 ${
                    isActive ? "text-white/80" : "text-slate-500"
                  }`}
                >
                  {category.description}
                </div>
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={() => void onContinue?.(selected)}
          className="mt-8 h-14 w-full rounded-3xl bg-[var(--seligo-cta)] text-base font-black text-white shadow-sm transition active:scale-[0.99] disabled:opacity-50"
          disabled={selected.length === 0 || isLoading}
        >
          {isLoading ? "Generating feed..." : "Generate My Feed ✨"}
        </button>
      </div>
    </div>
  );
}