import React, { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Sparkles, X, CheckCircle2, RotateCcw, ArrowRight } from "lucide-react";
import type { Product } from "../../types";
import * as Firestore from "../../firestoreService";
import {
  analyzeRoomLocally,
  preloadRoomScanModels,
  type RoomScanAnalysis,
} from "../services/localRoomScan";
import { validateRoomScanImage } from "../services/roomScanGate";

function buildRoomScanShareUrl() {
  const u = new URL(window.location.href);
  u.searchParams.delete("admin");
  u.searchParams.set("utm_source", "share");
  u.searchParams.set("utm_medium", "roomscan");
  u.searchParams.set("utm_campaign", "viral");
  u.searchParams.set("open", "roomscan");
  return u.toString();
}

type Props = {
  onApply: (a: RoomScanAnalysis) => Promise<void>;
  picks: { product: Product; rationale: string[] }[];
  pickStatus: "idle" | "loading" | "ready" | "error";
  onSavePick: (p: Product) => void | Promise<void>;
  onBagPick: (p: Product) => void | Promise<void>;
  onEmailPicks: () => void | Promise<void>;
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

const scanSteps = [
  "Checking image",
  "Reading room vibe",
  "Matching upgrades",
];

async function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);

  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = reject;
      element.src = url;
    });

    return image;
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

type ImageMeta = {
  width: number;
  height: number;
  aspect: number;
};

function getImageMeta(image: HTMLImageElement): ImageMeta {
  const width = image.naturalWidth || image.width || 0;
  const height = image.naturalHeight || image.height || 0;

  return {
    width,
    height,
    aspect: height > 0 ? width / height : 1,
  };
}

function getRoomPhotoPreflightError(meta: ImageMeta): string | null {
  if (meta.width < 480 || meta.height < 480) {
    return "Use a clearer room photo. Wide shots with more of the room visible work best.";
  }

  if (meta.aspect < 0.5 || meta.aspect > 2.2) {
    return "Use a normal room photo instead of a very narrow crop or screenshot.";
  }

  return null;
}

export default function RoomScanPage({
  onApply,
  picks,
  pickStatus,
  onSavePick,
  onBagPick,
  onEmailPicks,
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
  const [scanStage, setScanStage] = useState<"idle" | "checking" | "analyzing" | "matching" | "error">("idle");

  // Deduped pick impression tracking
  const pickImpRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (pickStatus === "idle") pickImpRef.current.clear();
  }, [pickStatus]);

  useEffect(() => {
    if (pickStatus !== "ready") return;
    if (!picks.length) return;

    for (const { product } of picks) {
      const key = product.id;
      if (pickImpRef.current.has(key)) continue;

      pickImpRef.current.add(key);
      void Firestore.logEvent({
        type: "pick_impression",
        productId: product.id,
        view: "roomscan",
        source: "roomscan_pick",
        meta: {
          category: product.category ?? "",
          tags: Array.isArray(product.tags) ? product.tags : [],
          price: Number(product.price ?? 0),
        },
      }).catch(console.warn);
    }
  }, [pickStatus, picks]);

  const [modelReady, setModelReady] = useState(false);
  const [analysis, setAnalysis] = useState<RoomScanAnalysis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [roomScanReason, setRoomScanReason] = useState("");
  const [gateInfo, setGateInfo] = useState<{
    roomScore: number;
    objects: string[];
    labels: string[];
  } | null>(null);
  const [shareNote, setShareNote] = useState<string>("");

  const [screen, setScreen] = useState<"main" | "preview">("main");
  const cameraRef = useRef<HTMLInputElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const hadAnyPicksRef = useRef(false);
  const emailCtaShownRef = useRef(false);

  useEffect(() => {
    if (pickStatus !== "ready" || picks.length === 0) {
      emailCtaShownRef.current = false;
      return;
    }

    if (emailCtaShownRef.current) return;
    emailCtaShownRef.current = true;

    void Firestore.logEvent({
      type: "view_change",
      view: "roomscan",
      source: "roomscan",
      meta: { panel: "roomscan_email_cta_shown" },
    }).catch(console.warn);
  }, [pickStatus, picks.length]);

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

  const canScan = useMemo(() => !!file, [file]);

  const currentScanStep = useMemo(() => {
    if (scanStatus === "success" || pickStatus === "ready") return 2;
    if (scanStage === "checking") return 0;
    if (scanStage === "analyzing") return 1;
    if (scanStage === "matching" || pickStatus === "loading") return 2;
    return -1;
  }, [pickStatus, scanStage, scanStatus]);

  const showRoomScanDebug = useMemo(() => {
    if (typeof window === "undefined") return false;

    const params = new URLSearchParams(window.location.search);
    return import.meta.env.DEV || params.get("admin") === "1";
  }, []);

  const shareUrl = useMemo(() => {
    if (typeof window === "undefined") return "";
    return buildRoomScanShareUrl();
  }, []);

  const handleShare = async () => {
    if (!shareUrl) return;

    void Firestore.logEvent({
      type: "share_click",
      source: "roomscan_cleared",
      meta: { url: shareUrl },
    }).catch(console.warn);

    setShareNote("");

    try {
      if (navigator.share) {
        await navigator.share({
          title: "Seligo.AI RoomScan",
          text: "Try this RoomScan — it curates decor picks from a room photo.",
          url: shareUrl,
        });
        setShareNote("Shared ✅");
        return;
      }
    } catch {
      // user cancelled share sheet or it failed; fall back to copy
    }

    try {
      await navigator.clipboard.writeText(shareUrl);
      setShareNote("Link copied ✅");
    } catch {
      setShareNote("Couldn’t share automatically — copy the URL from the address bar.");
    }
  };

  const resetInputs = () => {
    if (cameraRef.current) cameraRef.current.value = "";
    if (uploadRef.current) uploadRef.current.value = "";
  };

  const pickFile = (f: File | null) => {
    setAnalysis(null);
    setError(null);
    setRoomScanReason("");
    setGateInfo(null);
    setScanStatus("idle");
    setScanStage("idle");
    setScreen("main");

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
    setRoomScanReason("");
    setGateInfo(null);

    if (!file) {
      setError("Upload a real room photo to start.");
      setScanStatus("error");
      setScanStage("error");
      return;
    }

    if (!file.type.startsWith("image/")) {
      setError("Please upload an image file.");
      setScanStatus("error");
      setScanStage("error");
      return;
    }

    void Firestore.logEvent({
      type: "scan_start",
      view: "roomscan",
      source: "roomscan",
    }).catch(console.warn);
    setLoading(true);
    setAnalysis(null);
    setScanStatus("scanning");
    setScanStage("checking");
    setProgress(8);

    try {
      const image = await withTimeout(loadImageFromFile(file), 10000, "Loading room image");
      const meta = getImageMeta(image);
      const preflightError = getRoomPhotoPreflightError(meta);

      if (preflightError) {
        setScanStatus("error");
        setScanStage("error");
        setProgress(0);
        setRoomScanReason(preflightError);

        void Firestore.logEvent({
          type: "scan_fail",
          view: "roomscan",
          source: "roomscan_preflight",
          meta: {
            width: meta.width,
            height: meta.height,
            aspect: Number(meta.aspect.toFixed(2)),
          },
        }).catch(console.warn);

        return;
      }

      const gate = await withTimeout(
        validateRoomScanImage(image, roomText),
        15000,
        "Validating room photo"
      );

      setGateInfo({
        roomScore: gate.roomScore,
        objects: gate.objects.slice(0, 6),
        labels: gate.labels.slice(0, 4),
      });

      if (!gate.ok) {
        setScanStatus("error");
        setScanStage("error");
        setProgress(0);
        setRoomScanReason(
          gate.reason ||
            "This doesn’t look like a room photo. Try a wider shot that shows your bed, desk, wall, shelf, or room corner."
        );

        void Firestore.logEvent({
          type: "scan_fail",
          view: "roomscan",
          source: "roomscan_gate",
          meta: {
            roomScore: gate.roomScore,
            objects: gate.objects,
            labels: gate.labels,
            width: meta.width,
            height: meta.height,
            aspect: Number(meta.aspect.toFixed(2)),
          },
        }).catch(console.warn);

        return;
      }

      setProgress(34);
      setScanStage("analyzing");
      const a = await withTimeout(
        analyzeRoomLocally(file, roomText),
        25000,
        "Local AI scan"
      );
      setAnalysis(a);
      setProgress(72);
      setScanStage("matching");
      await Promise.resolve(onApply(a));
      void Firestore.logEvent({
        type: "scan_success",
        view: "roomscan",
        source: "roomscan",
        meta: {
          hasImage: Boolean(file),
          hasDescription: roomText.trim().length > 0,
          objectsDetected: Array.isArray(a?.debug?.objects) ? a.debug.objects.length : 0,
          width: meta.width,
          height: meta.height,
          aspect: Number(meta.aspect.toFixed(2)),
          gateRoomScore: gate.roomScore,
        },
      }).catch(console.warn);
      setProgress(100);
      setScanStatus("success");
      setScanStage("idle");
      if ("vibrate" in navigator) (navigator as any).vibrate?.(20);
    } catch (e: any) {
      console.error("[RoomScan] failed:", e);
      setError(e?.message ?? "RoomScan failed.");
      setScanStatus("error");
      setScanStage("error");
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
    setRoomScanReason("");
    setGateInfo(null);
    setShareNote("");
    setScanStatus("idle");
    setScanStage("idle");
    setAnalysis(null);
    setScreen("main");
    resetInputs();

    hadAnyPicksRef.current = false;
    pickImpRef.current.clear(); // clear dedupe set on local reset
  };

  const handleScanAgain = () => {
    // ✅ reset pick impression dedupe
    pickImpRef.current.clear();
    resetLocalScanUI();
    onScanAgain?.();
  };

  const overlayVisible = loading || scanStatus === "success";
  const showScanline = loading;
  const scanStageLabel =
    scanStatus === "success"
      ? "Scan complete ✅"
      : scanStage === "checking"
        ? "Checking image…"
        : scanStage === "analyzing"
          ? "Reading room vibe…"
          : scanStage === "matching"
            ? "Matching upgrades…"
            : "Scanning…";

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
          {scanStageLabel}
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
      className={`relative overflow-hidden bg-slate-100 ${
        scanStatus === "success"
          ? "ring-4 ring-emerald-100 ring-inset"
          : roomScanReason
            ? "ring-2 ring-rose-200 ring-inset"
            : ""
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

      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(251,146,60,0.12),transparent_55%)]" />
      <div className="pointer-events-none absolute inset-6 rounded-[1.5rem] border border-white/60" />
      <div className="pointer-events-none absolute left-6 right-6 top-6 h-12 rounded-t-[1.5rem] border-x border-t border-orange-300/55" />
      <div className="pointer-events-none absolute left-6 right-6 bottom-6 h-12 rounded-b-[1.5rem] border-x border-b border-orange-300/55" />

      {previewUrl ? (
        <button
          type="button"
          onClick={() => setScreen("preview")}
          className="relative w-full text-left select-none"
          title="Expand room photo"
        >
          <img
            src={previewUrl}
            alt="Room preview"
            className={`w-full aspect-[3/4] object-contain bg-slate-100 transition-transform duration-300 ${loading ? "scale-[1.02]" : ""}`}
            style={{
              filter: loading ? "contrast(1.05) saturate(1.08)" : "none",
            }}
          />

          <div className="pointer-events-none absolute left-4 top-4 rounded-full bg-white/88 px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.18em] text-slate-600 backdrop-blur-sm border border-white/70 shadow-sm">
            Expand photo
          </div>
        </button>
      ) : (
        <div className="relative flex aspect-[3/4] w-full items-end justify-center p-5 text-center bg-[linear-gradient(180deg,#f8fafc_0%,#e2e8f0_100%)]">
          <div className="max-w-[82%] rounded-2xl bg-white/80 px-4 py-3 shadow-sm backdrop-blur border border-white/80">
            <div className="text-sm font-black text-slate-900">Center your room</div>
            <div className="mt-1 text-xs text-slate-500 leading-5">
              Show the bed, desk, wall, shelf, or corner — not a product close-up.
            </div>
          </div>
        </div>
      )}

      {ScanOverlay}
    </div>
  );

  return (
    <div className="min-h-0 h-full flex flex-col bg-[#fffaf6]">
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

      <div className="min-h-0 flex-1 overflow-y-auto no-scrollbar px-4 pt-4 pb-[104px] space-y-4">
          {screen === "preview" ? (
            <>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setScreen("main")}
                  className="p-2 rounded-2xl hover:bg-slate-100 select-none"
                >
                  <ArrowLeft className="h-5 w-5" />
                </button>

                <div className="flex-1">
                  <div className="text-lg font-semibold leading-tight">RoomScan Preview</div>
                  <div className="text-xs text-slate-500">Confirm the scan or tweak the prompt.</div>
                </div>
              </div>

              <div
                className={`relative overflow-hidden rounded-[2rem] border bg-slate-100 ${
                  scanStatus === "success" ? "border-emerald-300 ring-4 ring-emerald-100" : "border-slate-200"
                }`}
              >
                {previewUrl ? (
                  <img
                    src={previewUrl}
                    alt="Room preview full"
                    className="w-full aspect-[4/3] object-cover bg-slate-100"
                    style={{ filter: loading ? "contrast(1.1) saturate(1.15)" : "none" }}
                  />
                ) : (
                  <div className="h-56 flex items-center justify-center text-slate-500">No image selected</div>
                )}
                {ScanOverlay}
              </div>

              <div className="rounded-[1.75rem] border border-slate-200/80 p-4 space-y-4 bg-white shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
                <div>
                  <div className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">
                    Refine your scan
                  </div>
                  <div className="mt-1 text-lg font-black text-slate-900">
                    Adjust the photo or prompt
                  </div>
                </div>

                <div>
                  <div className="mb-1.5 text-sm font-semibold text-slate-800">Add optional notes</div>
                  <textarea
                    value={roomText}
                    onChange={(e) => {
                      setRoomText(e.target.value);
                      setScanStatus("idle");
                    }}
                    className="w-full min-h-[96px] rounded-2xl border border-slate-200 bg-slate-50/60 p-3.5 text-slate-900 outline-none focus:ring-2 focus:ring-[var(--seligo-primary)]"
                    placeholder="Small bedroom, low light, cozy modern vibe, neutral colors…"
                  />
                  <div className="mt-2 text-[11px] text-slate-500">
                    Tip: mention size, lighting, colors, and what you want to change.
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    onClick={() => cameraRef.current?.click()}
                    className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3.5 text-sm font-semibold text-slate-800 select-none hover:bg-slate-100 transition-colors"
                  >
                    Take photo
                  </button>
                  <button
                    type="button"
                    onClick={() => uploadRef.current?.click()}
                    className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3.5 text-sm font-semibold text-slate-800 select-none hover:bg-slate-100 transition-colors"
                  >
                    Upload photo
                  </button>
                </div>

                {file && (
                  <div className="flex items-center justify-between gap-3 rounded-2xl bg-slate-50 px-3 py-2.5 border border-slate-200/70">
                    <div className="text-xs text-slate-600 truncate">
                      Selected: <span className="font-semibold">{file.name}</span>
                    </div>
                    <button
                      type="button"
                      className="text-xs font-semibold text-slate-500 hover:text-slate-800 select-none"
                      onClick={() => pickFile(null)}
                    >
                      Remove
                    </button>
                  </div>
                )}

                {analysis && (
                  <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <div className="font-semibold text-slate-900">RoomScan Summary</div>
                      <div className="text-[11px] text-slate-500">Applied to feed</div>
                    </div>

                    <div className="mt-2 text-slate-700">{analysis.oneSentenceSummary}</div>

                    <div className="mt-3 space-y-1 text-slate-700">
                      <div><span className="font-semibold text-slate-900">Vibe:</span> {analysis.vibeTags.join(", ") || "—"}</div>
                      <div><span className="font-semibold text-slate-900">Categories:</span> {analysis.recommendedCategories.join(", ") || "—"}</div>
                      {!!analysis.avoidTags?.length && (
                        <div><span className="font-semibold text-slate-900">Avoid:</span> {analysis.avoidTags.join(", ")}</div>
                      )}
                    </div>
                  </div>
                )}

                {error && (
                  <div className="rounded-xl border border-rose-100 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-600">
                    {error}
                  </div>
                )}

                <button
                  type="button"
                  disabled={scanStatus === "success" ? false : !canScan || loading || !modelReady}
                  onClick={scanStatus === "success" ? handleScanAgain : runScan}
                  className="mt-4 h-12 w-full rounded-2xl text-white font-extrabold disabled:cursor-not-allowed disabled:opacity-50 shadow-[0_16px_34px_rgba(251,146,60,0.24)]"
                  style={{ background: "linear-gradient(90deg, var(--seligo-cta), #f97316)" }}
                >
                  {scanStatus === "success"
                    ? "Scan again"
                    : scanStatus === "error"
                      ? "Try another room photo"
                      : loading
                        ? "Scanning your room..."
                        : "Scan my room"}
                </button>

                <div className="mt-2 text-center text-[10px] font-medium text-slate-500">
                  Room-only AI • personalized picks • renter-friendly upgrades
                </div>

                {!modelReady && !error && (
                  <div className="mt-1.5 text-center text-[10px] text-slate-400">
                    Loading AI engine… first run may take a moment
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              <div className="rounded-[2rem] border border-orange-100 bg-white/90 p-5 shadow-sm backdrop-blur-xl">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="inline-flex items-center gap-2 rounded-full bg-orange-50 px-3 py-1 text-[11px] font-black uppercase tracking-[0.18em] text-orange-600">
                      <Sparkles className="h-3.5 w-3.5" />
                      AI RoomScan
                    </div>

                    <h2 className="mt-3 text-[28px] font-black tracking-[-0.04em] text-slate-900">
                      Scan your room
                    </h2>

                    <p className="mt-2 max-w-[32rem] text-sm leading-relaxed text-slate-600">
                      Get affordable, renter-friendly picks based on your actual space.
                    </p>

                    <div className="mt-3 flex flex-wrap gap-2">
                      {[
                        "Room-only scan",
                        "Best for bedrooms + desks",
                        "Mostly under $50",
                      ].map((item) => (
                        <div
                          key={item}
                          className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.16em] text-slate-600"
                        >
                          {item}
                        </div>
                      ))}
                    </div>

                    <div className="mt-3 text-[12px] font-semibold text-slate-500">
                      Works best with wide room shots — not product close-ups, selfies, or random objects.
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={onGoExplore}
                    className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-100"
                    aria-label="Close"
                  >
                    <X className="h-5 w-5 text-slate-600" />
                  </button>
                </div>
              </div>

              <div className="rounded-[2rem] border border-slate-200 bg-white shadow-sm overflow-hidden">
                {ImageBlock}

                <div className="px-4 pt-3 pb-4">
                  <div className="grid grid-cols-2 gap-2.5">
                    <button
                      type="button"
                      onClick={() => cameraRef.current?.click()}
                      className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm font-semibold text-slate-800 select-none hover:bg-slate-100 transition-colors"
                    >
                      Take photo
                    </button>
                    <button
                      type="button"
                      onClick={() => uploadRef.current?.click()}
                      className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm font-semibold text-slate-800 select-none hover:bg-slate-100 transition-colors"
                    >
                      Upload photo
                    </button>
                  </div>

                  {file && (
                    <div className="mt-3 flex items-center justify-between gap-3 rounded-2xl bg-slate-50 px-3 py-2.5 border border-slate-200/70">
                      <div className="text-xs text-slate-600 truncate">
                        Selected: <span className="font-semibold">{file.name}</span>
                      </div>
                      <button
                        type="button"
                        className="text-xs font-semibold text-slate-500 hover:text-slate-800 select-none"
                        onClick={() => pickFile(null)}
                      >
                        Remove
                      </button>
                    </div>
                  )}

                  {error && (
                    <div className="mt-3 rounded-xl border border-rose-100 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-600">
                      {error}
                    </div>
                  )}

                  <button
                    type="button"
                    disabled={scanStatus === "success" ? false : !canScan || loading || !modelReady}
                    onClick={scanStatus === "success" ? handleScanAgain : runScan}
                    className="mt-4 h-12 w-full rounded-2xl text-white font-extrabold disabled:cursor-not-allowed disabled:opacity-50 shadow-[0_16px_34px_rgba(251,146,60,0.24)]"
                    style={{ background: "linear-gradient(90deg, var(--seligo-cta), #f97316)" }}
                  >
                    {scanStatus === "success"
                      ? "Scan again"
                      : scanStatus === "error"
                        ? "Try another room photo"
                        : loading
                          ? "Scanning your room..."
                          : "Scan my room"}
                  </button>

                  <div className="mt-2 text-center text-[10px] font-medium text-slate-500">
                    Room-only AI • personalized picks • renter-friendly upgrades
                  </div>

                  {!modelReady && !error && (
                    <div className="mt-1.5 text-center text-[10px] text-slate-400">
                      Loading AI engine… first run may take a moment
                    </div>
                  )}
                </div>
              </div>

              <div className="rounded-[1.5rem] border border-slate-200 bg-white p-4 shadow-sm">
                <div className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">
                  Best results
                </div>

                <div className="mt-3 grid grid-cols-2 gap-3">
                  <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3">
                    <div className="text-xs font-black uppercase tracking-[0.16em] text-emerald-700">
                      Good
                    </div>
                    <div className="mt-2 text-sm font-semibold text-slate-900">
                      Wide room shot
                    </div>
                    <div className="mt-1 text-xs leading-relaxed text-slate-600">
                      Show the bed, desk, wall, shelf, or room corner.
                    </div>
                  </div>

                  <div className="rounded-2xl border border-rose-200 bg-rose-50 p-3">
                    <div className="text-xs font-black uppercase tracking-[0.16em] text-rose-700">
                      Skip
                    </div>
                    <div className="mt-2 text-sm font-semibold text-slate-900">
                      Close-ups / selfies
                    </div>
                    <div className="mt-1 text-xs leading-relaxed text-slate-600">
                      Avoid product shots, faces, pets, screenshots, or random objects.
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-[1.5rem] border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">
                    Scan progress
                  </div>

                  <div className="text-[11px] font-bold text-slate-500">
                    {scanStatus === "success" ? "Complete" : loading ? `${progress}%` : "Ready"}
                  </div>
                </div>

                <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-200/80">
                  <div
                    className="h-full rounded-full transition-all duration-500 shadow-sm"
                    style={{
                      width: `${scanStatus === "success" ? 100 : progress}%`,
                      background: "linear-gradient(90deg, var(--seligo-cta), #f97316)",
                    }}
                  />
                </div>

                <div className="mt-4 space-y-2">
                  {scanSteps.map((step, index) => {
                    const active = index <= currentScanStep;
                    const isCurrent = index === currentScanStep && loading;

                    return (
                      <div key={step} className="flex items-center gap-3">
                        <div
                          className={[
                            "h-3 w-3 rounded-full transition-all",
                            active ? "bg-[var(--seligo-cta)]" : "bg-slate-200",
                            isCurrent ? "ring-4 ring-orange-100" : "",
                          ].join(" ")}
                        />
                        <div
                          className={
                            active
                              ? "text-sm font-semibold text-slate-800"
                              : "text-sm text-slate-400"
                          }
                        >
                          {step}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {roomScanReason ? (
                <div className="rounded-[1.5rem] border border-rose-200 bg-rose-50 p-4">
                  <div className="font-black text-rose-700">Use a real room photo</div>
                  <div className="mt-1 text-sm text-rose-700/80">{roomScanReason}</div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    {[
                      "Show the bed",
                      "Show the desk",
                      "Show a wider corner",
                      "Avoid selfies",
                      "Avoid product close-ups",
                    ].map((tip) => (
                      <div
                        key={tip}
                        className="rounded-full border border-rose-200 bg-white px-3 py-1.5 text-xs font-bold text-rose-700"
                      >
                        {tip}
                      </div>
                    ))}
                  </div>

                  {showRoomScanDebug && gateInfo ? (
                    <div className="mt-3 rounded-2xl border border-rose-100 bg-white/80 p-3">
                      <div className="text-[11px] font-black uppercase tracking-[0.18em] text-rose-500">
                        Scan check
                      </div>

                      <div className="mt-2 text-xs text-slate-600">
                        Room score: <span className="font-black text-slate-900">{gateInfo.roomScore}</span>
                      </div>

                      {!!gateInfo.objects.length && (
                        <div className="mt-2 text-xs text-slate-600">
                          Detected:{" "}
                          <span className="font-semibold text-slate-800">
                            {gateInfo.objects.join(", ")}
                          </span>
                        </div>
                      )}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {showRoomScanDebug && (scanStatus === "success" || scanStatus === "error") && gateInfo ? (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">
                    RoomScan debug
                  </div>

                  <div className="mt-3 space-y-2 text-xs text-slate-700">
                    <div>
                      <span className="font-black text-slate-900">Room score:</span> {gateInfo.roomScore}
                    </div>
                    <div>
                      <span className="font-black text-slate-900">Objects:</span>{" "}
                      {gateInfo.objects.length ? gateInfo.objects.join(", ") : "—"}
                    </div>
                    <div>
                      <span className="font-black text-slate-900">Labels:</span>{" "}
                      {gateInfo.labels.length ? gateInfo.labels.join(", ") : "—"}
                    </div>
                  </div>
                </div>
              ) : null}

              {scanStatus === "success" && !showClearedCard && (
                <div className="animate-in fade-in zoom-in duration-300 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-emerald-800 text-sm font-bold">
                  ✅ Scan complete — your feed was updated.
                </div>
              )}

              {error && !roomScanReason && (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-700">
                  We couldn’t scan that image. Try another room photo.
                </div>
              )}

              {pickStatus === "loading" && (
                <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm font-semibold text-slate-700">
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
                          Explore
                          <ArrowRight className="h-4 w-4" />
                        </button>
                      </div>

                      <div className="mt-3 flex items-center gap-2">
                        <button
                          onClick={handleShare}
                          className="w-full rounded-xl py-3 font-extrabold text-sm text-white"
                          style={{ background: "var(--seligo-cta)" }}
                        >
                          Share RoomScan
                        </button>
                      </div>

                      {shareNote ? (
                        <div className="mt-2 text-xs text-slate-500 text-center">{shareNote}</div>
                      ) : null}
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  {pickStatus === "ready" && picks.length > 0 && (
                    <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3 shadow-sm">
                      <div className="flex items-center justify-between">
                        <div className="font-extrabold text-slate-900">Top picks for your room</div>
                        <button
                          onClick={onGoExplore}
                          className="text-xs font-black text-[var(--seligo-primary)] hover:underline"
                        >
                          See more →
                        </button>
                      </div>

                      <div className="text-xs text-slate-500">
                        Based on your room photo, detected vibe, and budget-friendly fit.
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          void onEmailPicks();
                        }}
                        className="w-full h-12 rounded-2xl bg-[var(--seligo-cta)] hover:bg-[#fb8b3a] text-white font-extrabold active:scale-95 transition"
                      >
                        Email me these picks
                      </button>

                      <div className="space-y-3">
                        {picks.map(({ product, rationale }) => (
                          <div key={product.id} className="relative flex gap-3 border border-slate-200 rounded-2xl p-3 bg-slate-50/40">
                            <button
                              type="button"
                              onClick={() => {
                                void Firestore.logEvent({
                                  type: "pick_dismiss",
                                  productId: product.id,
                                  source: "roomscan_pick",
                                  view: "roomscan",
                                  meta: {
                                    category: product.category ?? "",
                                    tags: Array.isArray(product.tags) ? product.tags : [],
                                    price: Number(product.price ?? 0),
                                  },
                                }).catch(console.warn);

                                onDismissPick(product.id);
                              }}
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
                              <div className="text-[11px] text-slate-500 truncate">
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
                                    void Firestore.logEvent({
                                      type: "pick_save",
                                      productId: product.id,
                                      source: "roomscan_pick",
                                      view: "roomscan",
                                      meta: {
                                        category: product.category ?? "",
                                        tags: Array.isArray(product.tags) ? product.tags : [],
                                        price: Number(product.price ?? 0),
                                      },
                                    }).catch(console.warn);
                                    void onSavePick(product);
                                  }}
                                  className="flex-1 rounded-xl py-2 bg-slate-100 text-slate-900 font-extrabold text-xs"
                                >
                                  Save
                                </button>
                                <button
                                  onClick={() => {
                                    void onBagPick(product);
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
                    <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-700">
                      Scan applied — tap <b>See more →</b> to explore your updated feed.
                    </div>
                  )}
                </>
              )}

              {(pickStatus === "ready" || scanStatus === "success") && !showClearedCard && (
                <button
                  type="button"
                  onClick={onGoExplore}
                  className="mt-3 w-full rounded-2xl px-4 py-3 font-extrabold border border-slate-200 bg-white hover:bg-slate-50 text-slate-900"
                >
                  Go to Explore →
                </button>
              )}

              <div className="rounded-[1.75rem] border border-slate-200/80 p-4 space-y-4 bg-white shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
                <div>
                  <div className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">
                    Add a room photo
                  </div>
                  <div className="mt-1 text-lg font-black text-slate-900">
                    Help Seligo understand your space
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    onClick={() => cameraRef.current?.click()}
                    className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3.5 text-sm font-semibold text-slate-800 select-none hover:bg-slate-100 transition-colors"
                  >
                    Take photo
                  </button>
                  <button
                    type="button"
                    onClick={() => uploadRef.current?.click()}
                    className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3.5 text-sm font-semibold text-slate-800 select-none hover:bg-slate-100 transition-colors"
                  >
                    Upload photo
                  </button>
                </div>

                {file && (
                  <div className="flex items-center justify-between gap-3 rounded-2xl bg-slate-50 px-3 py-2.5 border border-slate-200/70">
                    <div className="text-xs text-slate-600 truncate">
                      Selected: <span className="font-semibold">{file.name}</span>
                    </div>
                    <button
                      type="button"
                      className="text-xs font-semibold text-slate-500 hover:text-slate-800 select-none"
                      onClick={() => pickFile(null)}
                    >
                      Remove
                    </button>
                  </div>
                )}

                <div>
                  <div className="mb-1.5 text-sm font-semibold text-slate-800">Add optional notes</div>
                  <textarea
                    value={roomText}
                    onChange={(e) => {
                      setRoomText(e.target.value);
                      setScanStatus("idle");
                    }}
                    className="w-full min-h-[96px] rounded-2xl border border-slate-200 bg-slate-50/60 p-3.5 text-slate-900 outline-none focus:ring-2 focus:ring-[var(--seligo-primary)]"
                    placeholder="Small bedroom, low light, cozy modern vibe, neutral colors, want better storage near the desk…"
                  />
                  <div className="mt-2 text-[11px] text-slate-500">
                    Mention lighting, colors, budget, or what part of the room needs help.
                  </div>
                </div>
              </div>

              {analysis && (
                <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4 text-sm shadow-sm">
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-semibold text-slate-900">RoomScan Summary</div>
                    <div className="text-[11px] text-slate-500">Applied to feed</div>
                  </div>

                  <div className="mt-2 text-slate-700">{analysis.oneSentenceSummary}</div>

                  <div className="mt-3 space-y-1 text-slate-700">
                    <div><span className="font-semibold text-slate-900">Vibe:</span> {analysis.vibeTags.join(", ") || "—"}</div>
                    <div><span className="font-semibold text-slate-900">Categories:</span> {analysis.recommendedCategories.join(", ") || "—"}</div>
                    {!!analysis.avoidTags?.length && (
                      <div><span className="font-semibold text-slate-900">Avoid:</span> {analysis.avoidTags.join(", ")}</div>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
      </div>
    </div>
  );
}
