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
import {
  analyzeRoomWithGemini,
  geminiToRoomScanAnalysis,
} from "../services/geminiVisionAnalysis";

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
  "Reading vibe",
  "Matching picks",
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
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const captureCanvasRef = useRef<HTMLCanvasElement>(null);
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
          title: "Seligo RoomScan",
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
      setShareNote("Couldn't share automatically — copy the URL from the address bar.");
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

  // ─── In-app camera (getUserMedia) ───────────────────────────────────────────
  const openCamera = async () => {
    setCameraError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      // Browser doesn't support getUserMedia — fall back to file input
      cameraRef.current?.click();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 960 } },
      });
      streamRef.current = stream;
      setCameraOpen(true);
      // Attach stream to video element after state update paints the element
      requestAnimationFrame(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
        }
      });
    } catch {
      // Permission denied or no camera — fall back to native file input
      cameraRef.current?.click();
    }
  };

  const closeCamera = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraOpen(false);
    setCameraError(null);
    if (videoRef.current) videoRef.current.srcObject = null;
  };

  const capturePhoto = () => {
    const video = videoRef.current;
    const canvas = captureCanvasRef.current;
    if (!video || !canvas) return;

    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 960;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    closeCamera();

    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        pickFile(new File([blob], `room-scan-${Date.now()}.jpg`, { type: "image/jpeg" }));
      },
      "image/jpeg",
      0.92
    );
  };

  // Auto-open camera immediately when page mounts (cal.ai-style UX)
  useEffect(() => {
    void openCamera();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Stop camera stream on unmount
  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

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
            "This doesn't look like a room photo. Try a wider shot that shows your bed, desk, wall, shelf, or room corner."
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

      // Try Gemini Vision first (CLIP-like semantic analysis), fall back to local TF.js
      let a: RoomScanAnalysis;
      const geminiResult = await withTimeout(
        analyzeRoomWithGemini(file, roomText),
        20000,
        "Gemini vision"
      ).catch(() => null);

      if (geminiResult) {
        const avoidTags: string[] = [];
        const text = roomText.toLowerCase();
        if (text.includes("no clutter") || text.includes("declutter")) avoidTags.push("cluttered");
        if (text.includes("no black")) avoidTags.push("black-heavy");
        a = geminiToRoomScanAnalysis(geminiResult, avoidTags) as RoomScanAnalysis;
      } else {
        a = await withTimeout(
          analyzeRoomLocally(file, roomText),
          25000,
          "Local AI scan"
        );
      }

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
    pickImpRef.current.clear();
  };

  const handleScanAgain = () => {
    pickImpRef.current.clear();
    resetLocalScanUI();
    onScanAgain?.();
  };

  // ─── Inline scan overlay (rendered inside the photo zone) ───────────────────
  const overlayVisible = loading || scanStatus === "success";
  const showScanline = loading;
  const scanStageLabel =
    scanStatus === "success"
      ? "Done ✓"
      : scanStage === "checking"
        ? "Checking…"
        : scanStage === "analyzing"
          ? "Reading vibe…"
          : scanStage === "matching"
            ? "Matching picks…"
            : "Scanning…";

  const ScanOverlayContent = overlayVisible ? (
    <>
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
          0%, 100% { opacity: .18; }
          50% { opacity: .42; }
        }
        @media (prefers-reduced-motion: reduce) {
          .seligo-scanline, .seligo-scangrid, .seligo-glow { animation: none !important; }
        }
      `}</style>
      <div
        className="seligo-scangrid absolute inset-0"
        style={{
          backgroundImage:
            "linear-gradient(to right, rgba(14,165,233,.25) 1px, transparent 1px), linear-gradient(to bottom, rgba(14,165,233,.18) 1px, transparent 1px)",
          backgroundSize: "22px 22px",
          animation: loading ? "seligo-grid 1.2s linear infinite" : "none",
          mixBlendMode: "multiply",
          opacity: 0.35,
        }}
      />
      <div
        className="seligo-glow absolute inset-0"
        style={{
          background: "radial-gradient(circle at 50% 38%, rgba(14,165,233,.28), transparent 55%)",
          animation: loading ? "seligo-glow 1.4s ease-in-out infinite" : "seligo-glow 2.6s ease-in-out infinite",
        }}
      />
      {showScanline && (
        <div
          className="seligo-scanline absolute left-0 right-0 h-10"
          style={{
            background:
              "linear-gradient(to bottom, transparent, rgba(34,197,94,.18), rgba(14,165,233,.48), rgba(34,197,94,.18), transparent)",
            boxShadow: "0 0 18px rgba(14,165,233,.28)",
            animation: "seligo-scanY 1.1s linear infinite",
          }}
        />
      )}
      {/* Status bar at bottom of photo */}
      <div className="absolute bottom-0 left-0 right-0 flex items-center gap-2 px-3 py-2.5 bg-gradient-to-t from-black/50 to-transparent">
        <span
          className={`text-[11px] font-bold text-white px-2.5 py-1 rounded-full backdrop-blur-sm ${
            scanStatus === "success" ? "bg-emerald-600/85" : "bg-black/55"
          }`}
        >
          {scanStageLabel}
        </span>
        <div className="flex-1 h-1.5 rounded-full bg-white/20 overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{ width: `${progress}%`, background: "var(--seligo-primary)" }}
          />
        </div>
        <span className="text-[11px] font-bold text-white tabular-nums bg-black/55 backdrop-blur-sm px-2 py-1 rounded-full">
          {scanStatus === "success" ? "100%" : `${progress}%`}
        </span>
      </div>
    </>
  ) : null;

  // ─── Shared photo zone ───────────────────────────────────────────────────────
  const PhotoZone = (
    <div
      className={`relative overflow-hidden bg-slate-100 ${
        scanStatus === "success"
          ? "ring-2 ring-inset ring-emerald-400/60"
          : roomScanReason
            ? "ring-2 ring-inset ring-rose-300"
            : ""
      }`}
      style={{ aspectRatio: "4/3" }}
    >
      {previewUrl ? (
        <button
          type="button"
          onClick={() => setScreen("preview")}
          className="absolute inset-0 w-full h-full"
          title="Expand photo"
        >
          <img
            src={previewUrl}
            alt="Room preview"
            className="w-full h-full object-cover transition-all duration-300"
            style={{ filter: loading ? "contrast(1.04) saturate(1.06)" : "none" }}
          />
          {!loading && !overlayVisible && (
            <div className="absolute top-3 right-3 rounded-full bg-black/35 backdrop-blur-sm px-2.5 py-1 text-[11px] font-semibold text-white">
              Expand ↗
            </div>
          )}
        </button>
      ) : (
        <button
          type="button"
          className="absolute inset-0 w-full h-full flex flex-col items-center justify-center gap-3 bg-gradient-to-br from-slate-50 to-slate-100 hover:from-orange-50/50 hover:to-slate-100 transition-colors"
          onClick={() => uploadRef.current?.click()}
        >
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white shadow-sm border border-slate-200">
            <svg className="h-7 w-7 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </div>
          <div className="text-center">
            <p className="text-[13px] font-bold text-slate-700">Tap to upload a room photo</p>
            <p className="text-xs text-slate-400 mt-0.5">Bedroom · desk · shelf · any corner</p>
          </div>
        </button>
      )}
      {ScanOverlayContent}
    </div>
  );

  return (
    <div className="min-h-0 h-full flex flex-col bg-[#fffaf6]">
      {/* Hidden file inputs */}
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

      <div className="min-h-0 flex-1 overflow-y-auto no-scrollbar">

        {/* ── PREVIEW SCREEN ──────────────────────────────────────────────── */}
        {screen === "preview" ? (
          <div className="px-4 pt-4 pb-[104px] space-y-3">
            {/* Header */}
            <div className="flex items-center gap-3">
              <button
                onClick={() => setScreen("main")}
                className="p-2.5 rounded-2xl bg-white border border-slate-200 shadow-sm hover:bg-slate-50 select-none transition-colors"
              >
                <ArrowLeft className="h-5 w-5 text-slate-700" />
              </button>
              <div className="flex-1">
                <div className="text-base font-black text-slate-900">Room photo</div>
                <div className="text-xs text-slate-500">Review or adjust before scanning</div>
              </div>
            </div>

            {/* Full photo */}
            <div className={`overflow-hidden rounded-[2rem] border ${
              scanStatus === "success" ? "border-emerald-300 ring-2 ring-emerald-100" : "border-slate-200"
            }`}>
              {previewUrl ? (
                <div className="relative">
                  <img
                    src={previewUrl}
                    alt="Room preview"
                    className="w-full object-cover"
                    style={{ aspectRatio: "4/3", filter: loading ? "contrast(1.08) saturate(1.1)" : "none" }}
                  />
                  {ScanOverlayContent}
                </div>
              ) : (
                <div className="h-52 flex items-center justify-center text-slate-400 text-sm bg-slate-50">
                  No image selected
                </div>
              )}
            </div>

            {/* Controls card */}
            <div className="rounded-[2rem] border border-slate-200/80 bg-white p-5 space-y-4 shadow-sm">
              <div>
                <div className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mb-2">
                  Optional notes
                </div>
                <textarea
                  value={roomText}
                  onChange={(e) => { setRoomText(e.target.value); setScanStatus("idle"); }}
                  className="w-full min-h-[80px] rounded-2xl border border-slate-200 bg-slate-50/60 p-3 text-[14px] text-slate-900 outline-none focus:ring-2 focus:ring-[var(--seligo-primary)] resize-none"
                  placeholder="Small bedroom, cozy modern, low light, neutral tones…"
                />
                <p className="mt-1.5 text-[11px] text-slate-400">Mention size, lighting, colors, or what you want to change.</p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => void openCamera()}
                  className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-100 transition-colors"
                >
                  Take photo
                </button>
                <button
                  type="button"
                  onClick={() => uploadRef.current?.click()}
                  className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-100 transition-colors"
                >
                  Upload photo
                </button>
              </div>
              {error && (
                <div className="rounded-2xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-600">
                  {error}
                </div>
              )}
              <button
                type="button"
                disabled={scanStatus === "success" ? false : !canScan || loading || !modelReady}
                onClick={scanStatus === "success" ? handleScanAgain : runScan}
                className="w-full h-[52px] rounded-2xl text-white text-[15px] font-black shadow-[0_10px_28px_rgba(251,146,60,0.22)] disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none transition-all"
                style={{ background: "linear-gradient(90deg, var(--seligo-cta), #f97316)" }}
              >
                {scanStatus === "success" ? "↺ Scan again" : loading ? `Scanning… ${progress}%` : "Scan my room →"}
              </button>
              {!modelReady && !error && (
                <p className="text-center text-[11px] text-slate-400">Loading AI engine…</p>
              )}
            </div>
          </div>

        ) : (
          /* ── MAIN SCREEN ──────────────────────────────────────────────────── */
          <div className="pb-[104px] space-y-3">

            {/* ── Hero card with photo zone ──── */}
            <div className="bg-white border-b border-slate-100 shadow-sm">
              {/* Hero text */}
              <div className="px-5 pt-5 pb-4 flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="inline-flex items-center gap-1.5 rounded-full bg-orange-50 border border-orange-100 px-3 py-1 text-[11px] font-black uppercase tracking-[0.16em] text-orange-600">
                    <Sparkles className="h-3 w-3" />
                    RoomScan
                  </div>
                  <h2 className="mt-2.5 text-[24px] font-black tracking-[-0.035em] text-slate-900 leading-[1.08]">
                    Picks for your<br />actual room
                  </h2>
                  <p className="mt-2 text-[13px] text-slate-500 leading-relaxed max-w-[260px]">
                    Upload a room photo — get affordable, renter-friendly décor matched to your space.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {["Mostly under $50", "Bedrooms & desks", "Renter-friendly"].map((t) => (
                      <span
                        key={t}
                        className="rounded-full bg-slate-50 border border-slate-200 px-2.5 py-1 text-[11px] font-semibold text-slate-500"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={onGoExplore}
                  className="shrink-0 flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 hover:bg-slate-200 transition-colors"
                  aria-label="Close"
                >
                  <X className="h-4 w-4 text-slate-600" />
                </button>
              </div>

              {/* Photo zone */}
              {PhotoZone}

              {/* Photo action buttons */}
              <div className="px-4 py-3 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => void openCamera()}
                  className="flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-100 transition-colors select-none"
                >
                  <svg className="h-4 w-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  Camera
                </button>
                <button
                  type="button"
                  onClick={() => uploadRef.current?.click()}
                  className="flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-100 transition-colors select-none"
                >
                  <svg className="h-4 w-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                  </svg>
                  Upload
                </button>
              </div>
            </div>

            {/* ── Error: bad photo ───────── */}
            {roomScanReason && (
              <div className="mx-4 rounded-[1.75rem] border border-rose-200 bg-rose-50 p-4">
                <div className="flex items-start gap-3">
                  <div className="shrink-0 rounded-xl bg-rose-100 p-2 mt-0.5">
                    <X className="h-4 w-4 text-rose-600" />
                  </div>
                  <div>
                    <div className="font-black text-rose-800 text-[13px]">Use a real room photo</div>
                    <div className="mt-1 text-xs text-rose-600/90 leading-relaxed">{roomScanReason}</div>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {["Bed or desk area", "Full room corner", "Wall + shelf view"].map((tip) => (
                    <span key={tip} className="rounded-full border border-rose-200 bg-white px-2.5 py-1 text-xs font-semibold text-rose-700">
                      {tip}
                    </span>
                  ))}
                </div>
                {showRoomScanDebug && gateInfo && (
                  <div className="mt-3 rounded-2xl bg-white/70 border border-rose-100 px-3 py-2 text-xs text-slate-600">
                    Room score: <strong>{gateInfo.roomScore}</strong>
                    {gateInfo.objects.length > 0 && <> · Detected: {gateInfo.objects.join(", ")}</>}
                  </div>
                )}
              </div>
            )}

            {(error && !roomScanReason) && (
              <div className="mx-4 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-700">
                Couldn't scan this photo — try another room shot.
              </div>
            )}

            {/* ── Scan CTA card ──────────── */}
            <div className="mx-4 rounded-[2rem] border border-slate-200/80 bg-white p-5 shadow-sm space-y-4">

              {/* Step indicators */}
              <div className="flex items-center">
                {scanSteps.map((step, index) => {
                  const done = index < currentScanStep || scanStatus === "success";
                  const active = index === currentScanStep && loading;
                  const upcoming = !done && !active;
                  return (
                    <React.Fragment key={step}>
                      <div className="flex flex-col items-center gap-1.5 flex-1">
                        <div
                          className={[
                            "w-7 h-7 rounded-full flex items-center justify-center text-xs font-black transition-all duration-300",
                            done ? "bg-emerald-500 text-white" :
                            active ? "bg-[var(--seligo-cta)] text-white ring-4 ring-orange-100 scale-110" :
                            "bg-slate-100 text-slate-400",
                          ].join(" ")}
                        >
                          {done ? "✓" : index + 1}
                        </div>
                        <span className={`text-[10px] font-semibold text-center leading-tight ${upcoming ? "text-slate-400" : active ? "text-[var(--seligo-cta)]" : "text-slate-600"}`}>
                          {step}
                        </span>
                      </div>
                      {index < scanSteps.length - 1 && (
                        <div className={`h-0.5 flex-1 mb-5 transition-all duration-500 ${done ? "bg-emerald-400" : "bg-slate-200"}`} />
                      )}
                    </React.Fragment>
                  );
                })}
              </div>

              {/* Optional room notes */}
              <div>
                <div className="mb-1.5 text-[11px] font-black uppercase tracking-[0.16em] text-slate-400">
                  Optional — describe your room
                </div>
                <textarea
                  value={roomText}
                  onChange={(e) => { setRoomText(e.target.value); setScanStatus("idle"); }}
                  className="w-full min-h-[72px] rounded-2xl border border-slate-200 bg-slate-50/60 p-3 text-[13px] text-slate-900 outline-none focus:ring-2 focus:ring-[var(--seligo-primary)] resize-none placeholder:text-slate-400"
                  placeholder="Small bedroom, cozy modern vibe, low light, want better desk area…"
                />
              </div>

              {/* Scan button */}
              <button
                type="button"
                disabled={scanStatus === "success" ? false : !canScan || loading || !modelReady}
                onClick={scanStatus === "success" ? handleScanAgain : runScan}
                className="w-full h-[52px] rounded-2xl text-white text-[15px] font-black tracking-[-0.02em] shadow-[0_10px_28px_rgba(251,146,60,0.22)] disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none transition-all active:scale-[0.99]"
                style={{ background: "linear-gradient(90deg, var(--seligo-cta), #f97316)" }}
              >
                {scanStatus === "success"
                  ? "↺ Scan again"
                  : loading
                    ? `Scanning… ${progress}%`
                    : !canScan
                      ? "Upload a photo first"
                      : !modelReady
                        ? "Loading AI…"
                        : "Scan my room →"}
              </button>

              {!modelReady && !error && (
                <p className="text-center text-[11px] text-slate-400">
                  AI engine loading — first run may take a moment
                </p>
              )}
            </div>

            {/* ── Success banner ─────────── */}
            {scanStatus === "success" && !showClearedCard && picks.length === 0 && pickStatus !== "loading" && (
              <div className="mx-4 rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-start gap-3">
                  <div className="shrink-0 text-2xl">🔍</div>
                  <div>
                    <div className="font-black text-slate-900">No specific picks found</div>
                    <p className="mt-1 text-sm text-slate-500 leading-relaxed">
                      We couldn't match room-specific picks from this photo, but your feed has been updated based on the room's style.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={onGoExplore}
                  className="mt-4 w-full py-3 rounded-2xl font-black text-white text-sm"
                  style={{ background: "var(--seligo-cta)" }}
                >
                  Browse updated feed →
                </button>
                {onScanAgain && (
                  <button
                    type="button"
                    onClick={onScanAgain}
                    className="mt-2 w-full py-3 rounded-2xl bg-slate-100 text-slate-900 font-black text-sm hover:bg-slate-200 transition-colors"
                  >
                    Try a different photo
                  </button>
                )}
              </div>
            )}

            {/* ── Picks loading ──────────── */}
            {pickStatus === "loading" && (
              <div className="mx-4 rounded-2xl border border-slate-200 bg-white p-4 flex items-center gap-3">
                <div className="w-5 h-5 rounded-full border-2 border-slate-200 border-t-[var(--seligo-cta)] animate-spin shrink-0" />
                <span className="text-sm font-semibold text-slate-700">Curating picks for your room…</span>
              </div>
            )}

            {pickStatus === "error" && (
              <div className="mx-4 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-700">
                Couldn't generate picks right now — try scanning again.
              </div>
            )}

            {/* ── Picks grid ────────────── */}
            {pickStatus === "ready" && picks.length > 0 && !showClearedCard && (
              <div className="mx-4 rounded-[2rem] border border-slate-200 bg-white overflow-hidden shadow-sm">
                {/* Picks header */}
                <div className="px-4 pt-4 pb-3 border-b border-slate-100">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="font-black text-slate-900 text-[15px]">Picks for your room</div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        {picks.length} curated find{picks.length === 1 ? "" : "s"} based on your space
                      </div>
                    </div>
                    <button
                      onClick={onGoExplore}
                      className="text-xs font-black text-[var(--seligo-primary)] hover:underline shrink-0"
                    >
                      See more →
                    </button>
                  </div>
                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        picks.forEach(({ product }) => void onSavePick(product));
                      }}
                      className="flex-1 h-11 rounded-2xl border-2 border-slate-200 bg-white text-slate-800 text-sm font-extrabold transition-all active:scale-[0.99]"
                    >
                      Save all picks
                    </button>
                    <button
                      type="button"
                      onClick={() => void onEmailPicks()}
                      className="flex-1 h-11 rounded-2xl bg-[var(--seligo-cta)] hover:brightness-105 text-white text-sm font-extrabold transition-all active:scale-[0.99]"
                    >
                      Email my picks
                    </button>
                  </div>
                </div>

                {/* Pick cards */}
                <div className="divide-y divide-slate-100">
                  {picks.map(({ product, rationale }) => (
                    <div key={product.id} className="relative p-4 flex gap-3">
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
                        className="absolute top-3 right-3 w-7 h-7 rounded-xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center transition-colors"
                        aria-label="Dismiss"
                      >
                        <X className="w-3.5 h-3.5 text-slate-500" />
                      </button>

                      <img
                        src={product.imageUrl}
                        alt={product.name}
                        className="w-20 h-20 rounded-2xl object-cover bg-slate-100 shrink-0"
                      />

                      <div className="min-w-0 flex-1 pr-8">
                        <div className="font-black text-slate-900 text-sm leading-tight line-clamp-2">
                          {product.name}
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5 font-semibold">
                          ${Number(product.price || 0).toFixed(2)}
                        </div>
                        {rationale.length > 0 && (
                          <div className="mt-1 text-[11px] text-slate-500 leading-relaxed line-clamp-2">
                            {rationale[0]}
                          </div>
                        )}
                        <div className="mt-2.5 flex gap-2">
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
                            className="flex-1 rounded-xl py-2 bg-slate-100 hover:bg-slate-200 text-slate-900 text-xs font-extrabold transition-colors"
                          >
                            Save
                          </button>
                          <button
                            onClick={() => void onBagPick(product)}
                            className="flex-1 rounded-xl py-2 text-white text-xs font-extrabold transition-all active:scale-[0.98]"
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

            {/* ── Cleared card ───────────── */}
            {showClearedCard && (
              <div className="mx-4 rounded-[2rem] border border-slate-200 bg-white overflow-hidden shadow-sm">
                <div className="p-5">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 rounded-2xl bg-emerald-50 border border-emerald-100 flex items-center justify-center shrink-0">
                      <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                    </div>
                    <div>
                      <div className="font-black text-slate-900 text-[15px]">All cleared!</div>
                      <div className="text-xs text-slate-500 mt-0.5">Feed updated with your scan results.</div>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={handleScanAgain}
                      className="flex-1 rounded-2xl px-4 py-3 text-sm font-bold text-white flex items-center justify-center gap-1.5 transition-all"
                      style={{ backgroundColor: "var(--seligo-primary)" }}
                    >
                      <RotateCcw className="w-4 h-4" />
                      Scan again
                    </button>
                    <button
                      type="button"
                      onClick={onGoExplore}
                      className="flex-1 rounded-2xl px-4 py-3 text-sm font-bold bg-slate-100 hover:bg-slate-200 text-slate-900 flex items-center justify-center gap-1.5 transition-colors"
                    >
                      Explore
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  </div>
                  <button
                    onClick={handleShare}
                    className="mt-2 w-full rounded-2xl py-3 text-sm font-extrabold text-white transition-all active:scale-[0.99]"
                    style={{ background: "var(--seligo-cta)" }}
                  >
                    Share RoomScan
                  </button>
                  {shareNote && (
                    <p className="mt-1.5 text-xs text-slate-500 text-center">{shareNote}</p>
                  )}
                </div>
              </div>
            )}

            {/* ── Go explore CTA ─────────── */}
            {(pickStatus === "ready" || scanStatus === "success") && !showClearedCard && (
              <button
                type="button"
                onClick={onGoExplore}
                className="mx-4 w-[calc(100%-2rem)] rounded-2xl border border-slate-200 bg-white py-3.5 font-extrabold text-sm text-slate-900 hover:bg-slate-50 transition-colors"
              >
                Go to Explore →
              </button>
            )}

            {/* ── Debug panel ────────────── */}
            {showRoomScanDebug && (scanStatus === "success" || scanStatus === "error") && gateInfo && (
              <div className="mx-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-xs space-y-1">
                <div className="font-black text-slate-500 uppercase tracking-wide text-[10px] mb-2">RoomScan debug</div>
                <div>Room score: <strong>{gateInfo.roomScore}</strong></div>
                <div>Objects: {gateInfo.objects.join(", ") || "—"}</div>
                <div>Labels: {gateInfo.labels.join(", ") || "—"}</div>
              </div>
            )}

          </div>
        )}
      </div>

      {/* ── In-app camera overlay ──────────────────────────────────────── */}
      {cameraOpen && (
        <div className="fixed inset-0 z-[1000] bg-black flex flex-col">
          {/* Top bar */}
          <div className="flex items-center justify-between px-4 pt-12 pb-4">
            <button
              type="button"
              onClick={closeCamera}
              className="p-2.5 rounded-2xl bg-white/10 backdrop-blur-sm hover:bg-white/20 transition-colors"
              aria-label="Close camera"
            >
              <X className="h-5 w-5 text-white" />
            </button>
            <p className="text-white text-sm font-semibold tracking-wide">Point at your room</p>
            <div className="w-10" />
          </div>

          {/* Viewfinder */}
          <div className="flex-1 relative overflow-hidden">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover"
            />
            {/* Corner guides */}
            {[
              "top-4 left-4 border-t-2 border-l-2 rounded-tl-2xl",
              "top-4 right-4 border-t-2 border-r-2 rounded-tr-2xl",
              "bottom-4 left-4 border-b-2 border-l-2 rounded-bl-2xl",
              "bottom-4 right-4 border-b-2 border-r-2 rounded-br-2xl",
            ].map((cls, i) => (
              <div key={i} className={`absolute w-8 h-8 border-white/60 ${cls}`} />
            ))}
            {cameraError && (
              <div className="absolute inset-x-4 bottom-6 rounded-2xl bg-black/60 backdrop-blur-sm px-4 py-3 text-sm text-white text-center font-semibold">
                {cameraError}
              </div>
            )}
          </div>

          {/* Capture button */}
          <div className="pb-14 pt-6 flex justify-center">
            <button
              type="button"
              onClick={capturePhoto}
              aria-label="Capture photo"
              className="w-20 h-20 rounded-full border-4 border-white/40 bg-white/20 backdrop-blur-sm flex items-center justify-center hover:bg-white/30 active:scale-95 transition-all"
            >
              <div className="w-14 h-14 rounded-full bg-white shadow-lg" />
            </button>
          </div>
        </div>
      )}

      {/* Hidden canvas used to capture frames from getUserMedia stream */}
      <canvas ref={captureCanvasRef} className="hidden" />
    </div>
  );
}
