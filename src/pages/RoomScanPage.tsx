import React, { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Sparkles, Image as ImageIcon, X, CheckCircle2, RotateCcw, ArrowRight } from "lucide-react";
import type { Product } from "../../types";
import {
  analyzeRoomLocally,
  preloadRoomScanModels,
  type RoomScanAnalysis,
} from "../services/localRoomScan";

type Props = {
  onApply: (a: RoomScanAnalysis) => Promise<void>;
  picks: { product: Product; rationale: string[] }[];
  pickStatus: "idle" | "loading" | "ready" | "error";
  onSavePick: (p: Product) => void | Promise<void>;
  onBagPick: (p: Product) => void | Promise<void>;
  onDismissPick: (productId: string) => void;
  onGoExplore: () => void;
  onScanAgain?: () => void;
};

const withTimeout = async <T,>(p: Promise<T>, ms: number, label: string): Promise<T> => {
  let t: number | undefined;
  const timeout = new Promise<T>((_, reject) => {
    t = window.setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)), ms);
  });

  try {
    return await Promise.race([p, timeout]);
  } finally {
    if (t) window.clearTimeout(t);
  }
};

export default function RoomScanPage({
  onApply,
  picks,
  pickStatus,
  onSavePick,
  onBagPick,
  onDismissPick,
  onGoExplore,
  onScanAgain,
}: Props) {
  const [roomText, setRoomText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [scanStatus, setScanStatus] = useState<"idle" | "scanning" | "success" | "error">("idle");
  const [modelReady, setModelReady] = useState(false);
  const [analysis, setAnalysis] = useState<RoomScanAnalysis | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [screen, setScreen] = useState<"main" | "preview">("main");
  const cameraRef = useRef<HTMLInputElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const hadAnyPicksRef = useRef(false);

  useEffect(() => {
    if (picks.length > 0) hadAnyPicksRef.current = true;
  }, [picks.length]);

  const showClearedCard = useMemo(() => {
    return (
      pickStatus === "ready" &&
      picks.length === 0 &&
      (
        hadAnyPicksRef.current ||
        (scanStatus === "success" && !!analysis)
      )
    );
  }, [pickStatus, picks.length, scanStatus, analysis]);

  const canScan = useMemo(() => roomText.trim().length > 0 || !!file, [roomText, file]);

  const resetInputs = () => {
    if (cameraRef.current) cameraRef.current.value = "";
    if (uploadRef.current) uploadRef.current.value = "";
  };

  const pickFile = (f: File | null) => {
    setAnalysis(null);
    setError(null);
    setScanStatus("idle");

    if (previewUrl) URL.revokeObjectURL(previewUrl);

    setFile(f);

    if (!f) {
      setPreviewUrl(null);
      resetInputs();
      return;
    }

    setPreviewUrl(URL.createObjectURL(f));
    resetInputs();
  };

  const onPick = (f?: File | null) => pickFile(f ?? null);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        await withTimeout(preloadRoomScanModels(), 20000, "Loading AI engine");
        if (alive) setModelReady(true);
      } catch (e: any) {
        if (alive) setError(e?.message ?? "AI engine failed to load.");
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!loading) return;

    setProgress(0);
    const id = window.setInterval(() => {
      setProgress((p) => {
        const cap = 95;
        if (p >= cap) return cap;
        const inc = Math.max(1, Math.floor(Math.random() * 7));
        return Math.min(cap, p + inc);
      });
    }, 120);

    return () => window.clearInterval(id);
  }, [loading]);

  const runScan = async () => {
    hadAnyPicksRef.current = false;
    setError(null);
    setLoading(true);
    setAnalysis(null);
    setScanStatus("scanning");
    setProgress(0);

    try {
      setProgress(35);
      const a = await withTimeout(analyzeRoomLocally(file, roomText), 25000, "Local AI scan");
      setAnalysis(a);
      await Promise.resolve(onApply(a));
      setProgress(100);
      setScanStatus("success");
      if ("vibrate" in navigator) (navigator as any).vibrate?.(20);
    } catch (e: any) {
      console.error("[RoomScan] failed:", e);
      setError(e?.message ?? "RoomScan failed.");
      setScanStatus("error");
      setProgress(0);
    } finally {
      setLoading(false);
    }
  };

  const resetLocalScanUI = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(null);
    setPreviewUrl(null);
    setRoomText("");
    setProgress(0);
    setLoading(false);
    setError(null);
    setScanStatus("idle");
    setAnalysis(null);
    setScreen("main");
    resetInputs();

    hadAnyPicksRef.current = false;
  };

  const handleScanAgain = () => {
    resetLocalScanUI();
    onScanAgain?.();
  };

  const overlayVisible = loading || scanStatus === "success";
  const showScanline = loading;

  const ScanOverlay = overlayVisible ? (
    <>
      <div
        className="seligo-scangrid absolute inset-0 opacity-30"
        style={{
          backgroundImage:
            "linear-gradient(to right, rgba(14,165,233,.35) 1px, transparent 1px), linear-gradient(to bottom, rgba(14,165,233,.25) 1px, transparent 1px)",
          backgroundSize: "20px 20px",
          animation: loading ? "seligo-grid 1.2s linear infinite" : "none",
          mixBlendMode: "multiply",
        }}
      />
      <div
        className="seligo-glow absolute inset-0"
        style={{
          background: "radial-gradient(circle at 50% 35%, rgba(14,165,233,.35), transparent 55%)",
          animation: loading ? "seligo-glow 1.4s ease-in-out infinite" : "seligo-glow 2.4s ease-in-out infinite",
        }}
      />
      {showScanline && (
        <div
          className="seligo-scanline absolute left-0 right-0 h-10"
          style={{
            background:
              "linear-gradient(to bottom, transparent, rgba(34,197,94,.25), rgba(14,165,233,.55), rgba(34,197,94,.25), transparent)",
            boxShadow: "0 0 20px rgba(14,165,233,.35)",
            animation: "seligo-scanY 1.1s linear infinite",
          }}
        />
      )}
      <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between gap-3">
        <div
          className={`text-xs font-semibold text-white px-2 py-1 rounded-lg ${
            scanStatus === "success" ? "bg-emerald-600" : "bg-black/55"
          }`}
        >
          {scanStatus === "success" ? "Scan complete ✅" : "Scanning…"}
        </div>

        <div className="flex-1 h-2 rounded-full bg-white/25 overflow-hidden">
          <div
            className="h-full rounded-full"
            style={{ width: `${progress}%`, background: "var(--seligo-primary)" }}
          />
        </div>

        <div className="text-xs font-semibold text-white px-2 py-1 rounded-lg bg-black/55 tabular-nums">
          {scanStatus === "success" ? "Done" : `${progress}%`}
        </div>
      </div>
    </>
  ) : null;

  const ImageBlock = (
    <div
      className={`relative rounded-2xl overflow-hidden border bg-black/5 ${
        scanStatus === "success" ? "border-emerald-400 ring-4 ring-emerald-200" : "border-black/10"
      }`}
    >
      <style>{`
        @keyframes seligo-scanY {
          0% { transform: translateY(-30%); opacity: 0; }
          10% { opacity: 1; }
          90% { opacity: 1; }
          100% { transform: translateY(130%); opacity: 0; }
        }
        @keyframes seligo-grid {
          0% { background-position: 0px 0px; }
          100% { background-position: 40px 40px; }
        }
        @keyframes seligo-glow {
          0%, 100% { opacity: .25; }
          50% { opacity: .5; }
        }
        @media (prefers-reduced-motion: reduce) {
          .seligo-scanline, .seligo-scangrid, .seligo-glow { animation: none !important; }
        }
      `}</style>

      {previewUrl ? (
        <button
          type="button"
          onClick={() => setScreen("preview")}
          className="w-full text-left select-none"
          title="Tap to expand"
        >
          <img
            src={previewUrl}
            alt="Room preview"
            className={`w-full h-56 object-cover ${loading ? "scale-[1.02]" : ""}`}
            style={{
              filter: loading ? "contrast(1.1) saturate(1.15)" : "none",
            }}
          />
        </button>
      ) : (
        <div className="h-56 w-full flex flex-col items-center justify-center text-black/50 bg-gradient-to-b from-slate-50 to-slate-100 border border-dashed border-black/20">
          <ImageIcon className="h-9 w-9 text-slate-500" />
          <div className="text-sm mt-1">Upload a room image (optional)</div>
          <div className="text-[11px] mt-1 text-black/45">Take photo (recommended)</div>
        </div>
      )}

      {ScanOverlay}
    </div>
  );

  const FooterCTA = (
    <div className="shrink-0 sticky bottom-0 border-t border-black/10 bg-white/80 backdrop-blur-xl px-4 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
      {error && <div className="text-sm text-red-600 font-semibold mb-2">{error}</div>}

      <button
        disabled={!canScan || loading || scanStatus === "success" || !modelReady}
        onClick={runScan}
        className="w-full rounded-2xl px-4 py-4 text-white font-extrabold disabled:opacity-50 disabled:cursor-not-allowed select-none shadow-sm"
        style={{ background: "var(--seligo-cta)", opacity: 1 }}
      >
        {scanStatus === "success"
          ? "Updated ✅"
          : scanStatus === "error"
            ? "Retry Scan"
            : loading
              ? "Analyzing..."
              : "Scan & Update My Feed"}
      </button>

      <div className="mt-2 text-[11px] text-black/50 text-center">
        This updates your interests + feed instantly.
      </div>

      {!modelReady && !error && (
        <div className="text-[11px] text-black/50 text-center mt-2">
          Loading AI engine… (first run downloads models)
        </div>
      )}
    </div>
  );

  return (
    <div className="h-full flex flex-col">
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => onPick(e.target.files?.[0])}
      />

      <input
        ref={uploadRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => onPick(e.target.files?.[0])}
      />

      <div className="mx-auto w-full max-w-md flex-1 flex flex-col min-h-0">
        <div className="flex-1 overflow-y-auto no-scrollbar px-4 pt-4 pb-[calc(7.5rem+env(safe-area-inset-bottom))] space-y-4 min-h-0">
          {screen === "preview" ? (
            <>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setScreen("main")}
                  className="p-2 rounded-2xl hover:bg-black/5 select-none"
                >
                  <ArrowLeft className="h-5 w-5" />
                </button>

                <div className="flex-1">
                  <div className="text-lg font-semibold leading-tight">RoomScan Preview</div>
                  <div className="text-xs text-black/60">Confirm the scan or tweak the prompt.</div>
                </div>
              </div>

              <div
                className={`relative rounded-2xl overflow-hidden border bg-black/5 ${
                  scanStatus === "success" ? "border-emerald-400 ring-4 ring-emerald-200" : "border-black/10"
                }`}
              >
                {previewUrl ? (
                  <img
                    src={previewUrl}
                    alt="Room preview full"
                    className="w-full aspect-[4/3] object-cover bg-black/5"
                    style={{ filter: loading ? "contrast(1.1) saturate(1.15)" : "none" }}
                  />
                ) : (
                  <div className="h-56 flex items-center justify-center text-black/50">No image selected</div>
                )}
                {ScanOverlay}
              </div>

              <div className="rounded-2xl border border-black/10 p-4 space-y-4 bg-white shadow-sm">
                <div className="text-sm font-semibold">Describe the room / vibe</div>
                <textarea
                  value={roomText}
                  onChange={(e) => {
                    setRoomText(e.target.value);
                    setScanStatus("idle");
                  }}
                  className="w-full min-h-[110px] rounded-xl border border-black/10 p-3 outline-none focus:ring-2 focus:ring-[var(--seligo-primary)] bg-white"
                  placeholder="Example: Small bedroom, low light, cozy modern vibe, neutral colors…"
                />
                <div className="mt-2 text-[11px] text-black/55">
                  Tip: mention size, lighting, colors, and what you want to change.
                </div>

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => cameraRef.current?.click()}
                    className="flex-1 rounded-xl px-3 py-3 border border-black/10 hover:bg-black/5 select-none text-sm font-semibold"
                  >
                    Take Photo
                  </button>
                  <button
                    type="button"
                    onClick={() => uploadRef.current?.click()}
                    className="flex-1 rounded-xl px-3 py-3 border border-black/10 hover:bg-black/5 select-none text-sm font-semibold"
                  >
                    Upload Photo
                  </button>
                </div>

                {file && (
                  <div className="flex items-center justify-between gap-3 rounded-xl bg-black/5 px-3 py-2">
                    <div className="text-xs text-black/70 truncate">Selected: {file.name}</div>
                    <button
                      type="button"
                      className="text-xs font-semibold text-black/60 hover:text-black select-none"
                      onClick={() => pickFile(null)}
                    >
                      Remove
                    </button>
                  </div>
                )}

                {analysis && (
                  <div className="rounded-2xl bg-black/5 p-4 text-sm shadow-sm">
                    <div className="flex items-center justify-between gap-3">
                      <div className="font-semibold">RoomScan Summary</div>
                      <div className="text-[11px] text-black/50">Applied to feed</div>
                    </div>

                    <div className="mt-2 text-black/80">{analysis.oneSentenceSummary}</div>

                    <div className="mt-3 space-y-1">
                      <div><span className="font-semibold">Vibe:</span> {analysis.vibeTags.join(", ") || "—"}</div>
                      <div><span className="font-semibold">Categories:</span> {analysis.recommendedCategories.join(", ") || "—"}</div>
                      {!!analysis.avoidTags?.length && (
                        <div><span className="font-semibold">Avoid:</span> {analysis.avoidTags.join(", ")}</div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <div
                  className="h-10 w-10 rounded-2xl flex items-center justify-center"
                  style={{ background: "var(--seligo-primary)" }}
                >
                  <Sparkles className="h-5 w-5 text-white" />
                </div>
                <div>
                  <div className="text-lg font-semibold leading-tight">RoomScan</div>
                  <div className="text-xs text-black/60">Scan your space → we personalize picks instantly.</div>
                </div>
              </div>

              {ImageBlock}

              {scanStatus === "success" && !showClearedCard && (
                <div className="animate-in fade-in zoom-in duration-300 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-emerald-800 text-sm font-bold">
                  ✅ Scan complete — your feed was updated.
                </div>
              )}

              {pickStatus === "loading" && (
                <div className="rounded-2xl border border-black/10 bg-white p-4 text-sm font-semibold">
                  Curating picks for your room…
                </div>
              )}

              {pickStatus === "error" && (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-700">
                  Couldn’t generate picks right now — try scanning again.
                </div>
              )}

              {showClearedCard ? (
                <div className="pt-1">
                  <div className="rounded-3xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                    <div className="p-5 bg-gradient-to-br from-slate-50 to-white">
                      <div className="flex items-start gap-3">
                        <div className="shrink-0 rounded-2xl bg-emerald-50 p-3 border border-emerald-100">
                          <CheckCircle2 className="h-6 w-6 text-emerald-600" />
                        </div>
                        <div className="min-w-0">
                          <div className="text-lg font-semibold text-slate-900">
                            Curated list cleared ✅
                          </div>
                          <div className="text-sm text-slate-600 mt-1">
                            You’re all set — your feed stays updated based on your scan. Want another pass or jump back into Explore?
                          </div>
                        </div>
                      </div>

                      <div className="mt-5 flex gap-3">
                        <button
                          type="button"
                          onClick={handleScanAgain}
                          className="flex-1 inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold text-white shadow-sm"
                          style={{ backgroundColor: "var(--seligo-primary)" }}
                        >
                          <RotateCcw className="h-4 w-4" />
                          Scan again
                        </button>

                        <button
                          type="button"
                          onClick={onGoExplore}
                          className="flex-1 inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold bg-white border border-slate-200 text-slate-900"
                        >
                          Go to Explore
                          <ArrowRight className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  {pickStatus === "ready" && picks.length > 0 && (
                    <div className="rounded-2xl border border-black/10 bg-white p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="font-extrabold text-slate-900">Top picks for your room</div>
                        <button
                          onClick={onGoExplore}
                          className="text-xs font-black text-[var(--seligo-primary)] hover:underline"
                        >
                          See more →
                        </button>
                      </div>

                      <div className="text-xs text-black/60">Based on your scan + your vibe.</div>

                      <div className="space-y-3">
                        {picks.map(({ product, rationale }) => (
                          <div key={product.id} className="relative flex gap-3 border border-black/5 rounded-2xl p-3">
                            <button
                              type="button"
                              onClick={() => onDismissPick(product.id)}
                              className="absolute top-2 right-2 w-9 h-9 rounded-xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center"
                              aria-label="Dismiss"
                              title="Dismiss"
                            >
                              <X className="w-4 h-4 text-slate-600" />
                            </button>

                            <img
                              src={product.imageUrl}
                              className="w-16 h-16 rounded-xl object-cover bg-slate-100"
                              alt={product.name}
                            />

                            <div className="min-w-0 flex-1 pr-10">
                              <div className="font-black text-slate-900 truncate">{product.name}</div>
                              <div className="text-[11px] text-black/55 truncate">
                                {(product.brand || "Seligo.AI")} • ${Number(product.price || 0).toFixed(2)}
                              </div>

                              <ul className="mt-2 text-[11px] text-slate-700 list-disc pl-4 space-y-1">
                                {rationale.map((r, idx) => (
                                  <li key={idx}>{r}</li>
                                ))}
                              </ul>

                              <div className="mt-3 flex gap-2">
                                <button
                                  onClick={() => {
                                    void onSavePick(product);
                                    onDismissPick(product.id);
                                  }}
                                  className="flex-1 rounded-xl py-2 bg-slate-100 text-slate-900 font-extrabold text-xs"
                                >
                                  Save
                                </button>
                                <button
                                  onClick={() => {
                                    void onBagPick(product);
                                    onDismissPick(product.id);
                                  }}
                                  className="flex-1 rounded-xl py-2 text-white font-extrabold text-xs"
                                  style={{ background: "var(--seligo-cta)" }}
                                >
                                  Add to Bag
                                </button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {pickStatus === "ready" && picks.length === 0 && (
                    <div className="rounded-2xl border border-black/10 bg-white p-4 text-sm">
                      Scan applied — tap <b>See more →</b> to explore your updated feed.
                    </div>
                  )}
                </>
              )}

              {(pickStatus === "ready" || scanStatus === "success") && !showClearedCard && (
                <button
                  type="button"
                  onClick={onGoExplore}
                  className="mt-3 w-full rounded-2xl px-4 py-3 font-extrabold border border-black/10 bg-white hover:bg-black/5"
                >
                  Go to Explore →
                </button>
              )}

              <div className="rounded-2xl border border-black/10 p-4 space-y-4 bg-white shadow-sm">
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => cameraRef.current?.click()}
                    className="flex-1 rounded-xl px-3 py-3 border border-black/10 hover:bg-black/5 select-none text-sm font-semibold"
                  >
                    Take Photo
                  </button>
                  <button
                    type="button"
                    onClick={() => uploadRef.current?.click()}
                    className="flex-1 rounded-xl px-3 py-3 border border-black/10 hover:bg-black/5 select-none text-sm font-semibold"
                  >
                    Upload Photo
                  </button>
                </div>

                {file && (
                  <div className="flex items-center justify-between gap-3 rounded-xl bg-black/5 px-3 py-2">
                    <div className="text-xs text-black/70 truncate">Selected: {file.name}</div>
                    <button
                      type="button"
                      className="text-xs font-semibold text-black/60 hover:text-black select-none"
                      onClick={() => pickFile(null)}
                    >
                      Remove
                    </button>
                  </div>
                )}

                <div>
                  <div className="text-sm font-semibold mb-1">Describe the room / vibe</div>
                  <textarea
                    value={roomText}
                    onChange={(e) => {
                      setRoomText(e.target.value);
                      setScanStatus("idle");
                    }}
                    className="w-full min-h-[110px] rounded-xl border border-black/10 p-3 outline-none focus:ring-2 focus:ring-[var(--seligo-primary)] bg-white"
                    placeholder="Example: Small bedroom, low light, want cozy modern vibe, neutral colors, need storage…"
                  />
                  <div className="mt-2 text-[11px] text-black/55">
                    Tip: mention size, lighting, colors, and what you want to change.
                  </div>
                </div>
              </div>

              {analysis && (
                <div className="rounded-2xl bg-black/5 p-4 text-sm shadow-sm">
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-semibold">RoomScan Summary</div>
                    <div className="text-[11px] text-black/50">Applied to feed</div>
                  </div>

                  <div className="mt-2 text-black/80">{analysis.oneSentenceSummary}</div>

                  <div className="mt-3 space-y-1">
                    <div><span className="font-semibold">Vibe:</span> {analysis.vibeTags.join(", ") || "—"}</div>
                    <div><span className="font-semibold">Categories:</span> {analysis.recommendedCategories.join(", ") || "—"}</div>
                    {!!analysis.avoidTags?.length && (
                      <div><span className="font-semibold">Avoid:</span> {analysis.avoidTags.join(", ")}</div>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {FooterCTA}
      </div>
    </div>
  );
}
