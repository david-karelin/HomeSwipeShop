import * as tf from "@tensorflow/tfjs";
import * as cocoSsd from "@tensorflow-models/coco-ssd";
import * as mobilenet from "@tensorflow-models/mobilenet";

export type RoomScanAnalysis = {
  roomType: string | null;
  vibeTags: string[];
  recommendedCategories: string[];
  recommendedTags: string[];
  avoidTags: string[];
  oneSentenceSummary: string;
  productIdeas?: Array<{ title: string; category: string; searchKeywords: string[]; why: string }>;
  debug?: any;
};

let cocoModel: cocoSsd.ObjectDetection | null = null;
let mobileModel: mobilenet.MobileNet | null = null;
let modelsPromise: Promise<void> | null = null;

async function loadModels() {
  if (modelsPromise) return modelsPromise;

  modelsPromise = (async () => {
    await tf.setBackend("webgl").catch(() => tf.setBackend("cpu"));
    await tf.ready();

    if (!cocoModel) {
      console.log("[RoomScan] loading coco...");
      cocoModel = await cocoSsd.load({
        base: "lite_mobilenet_v2",
        modelUrl: "/tfjs/coco-ssd/model.json",
      });
      console.log("[RoomScan] coco loaded ✅");
    }

    if (!mobileModel) {
      try {
        console.log("[RoomScan] loading mobilenet...");
        mobileModel = await mobilenet.load({
          version: 1,
          alpha: 1.0,
        });
        console.log("[RoomScan] mobilenet loaded ✅");
      } catch (e) {
        console.warn("[RoomScan] mobilenet failed (continuing without it):", e);
        mobileModel = null;
      }
    }
  })().catch((e) => {
    modelsPromise = null;
    throw e;
  });

  return modelsPromise;
}

export async function preloadRoomScanModels() {
  await loadModels();
}

function downscaleToCanvas(file: File, maxSide = 640): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);

      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;

      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(objectUrl);
      resolve(canvas);
    };

    img.onerror = (e) => {
      URL.revokeObjectURL(objectUrl);
      reject(e);
    };

    img.src = objectUrl;
  });
}

function rgbToHex(r: number, g: number, b: number) {
  const to = (n: number) => n.toString(16).padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}

function extractPalette(canvas: HTMLCanvasElement, sampleStep = 16) {
  const ctx = canvas.getContext("2d")!;
  const width = canvas.width;
  const height = canvas.height;
  const { data } = ctx.getImageData(0, 0, width, height);

  const buckets = new Map<string, number>();
  for (let y = 0; y < height; y += sampleStep) {
    for (let x = 0; x < width; x += sampleStep) {
      const i = (y * width + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const key = `${Math.round(r / 32) * 32},${Math.round(g / 32) * 32},${Math.round(b / 32) * 32}`;
      buckets.set(key, (buckets.get(key) ?? 0) + 1);
    }
  }

  const top = [...buckets.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  return top.map(([k]) => {
    const [r, g, b] = k.split(",").map(Number);
    return rgbToHex(r, g, b);
  });
}

function inferRoomType(objects: string[]) {
  if (objects.includes("bed")) return "bedroom";
  if (objects.includes("couch") || objects.includes("sofa")) return "living room";
  if (objects.includes("dining table")) return "dining";
  if (objects.includes("toilet") || objects.includes("sink")) return "bathroom";
  return null;
}

function tagsFromObjects(objects: string[]) {
  const cats: string[] = [];
  const tags: string[] = [];

  if (objects.includes("bed")) cats.push("bedding");
  if (objects.includes("couch") || objects.includes("sofa") || objects.includes("chair")) cats.push("seating");
  if (objects.includes("dining table") || objects.includes("table")) cats.push("tables");
  if (objects.includes("potted plant")) cats.push("plants");
  if (objects.includes("lamp")) cats.push("lighting");

  if (objects.includes("bed")) tags.push("cozy", "textured", "throw-pillows");
  if (objects.includes("lamp")) tags.push("warm-lighting");
  if (!objects.includes("rug")) tags.push("add-rug");
  if (!objects.includes("potted plant")) tags.push("add-plants");
  if (!objects.includes("wall")) tags.push("wall-art");

  return { cats: Array.from(new Set(cats)), tags: Array.from(new Set(tags)) };
}

function vibeFromPalette(hex: string[]) {
  const vibe: string[] = [];
  const joined = hex.join(" ").toLowerCase();

  if (joined.includes("#00") || joined.includes("#20") || joined.includes("#40")) vibe.push("cool");
  if (joined.includes("#c0") || joined.includes("#e0")) vibe.push("bright");
  if (joined.includes("#80") || joined.includes("#a0")) vibe.push("neutral");

  const tealish = hex.some((h) => {
    const r = parseInt(h.slice(1, 3), 16);
    const g = parseInt(h.slice(3, 5), 16);
    const b = parseInt(h.slice(5, 7), 16);
    return g > r && b > r && g > 80 && b > 80;
  });
  if (tealish) vibe.push("teal", "modern");

  return Array.from(new Set(vibe));
}

function buildProductIdeas(
  objects: string[],
  palette: string[],
  roomType: string | null,
  recommendedCategories: string[],
  recommendedTags: string[]
) {
  const ideas: Array<{ title: string; category: string; searchKeywords: string[]; why: string }> = [];

  if (!objects.includes("lamp")) {
    ideas.push({
      title: "Warm bedside lamp",
      category: "lighting",
      searchKeywords: ["warm bedside lamp", "ambient table lamp", roomType ?? "room lighting"],
      why: "Adds softer evening light and improves comfort.",
    });
  }

  if (!objects.includes("rug")) {
    ideas.push({
      title: "Neutral area rug",
      category: "rugs",
      searchKeywords: ["neutral area rug", "soft textured rug", "modern rug"],
      why: "Grounds the space and adds warmth underfoot.",
    });
  }

  const tealish = palette.some((h) => {
    const r = parseInt(h.slice(1, 3), 16);
    const g = parseInt(h.slice(3, 5), 16);
    const b = parseInt(h.slice(5, 7), 16);
    return g > r && b > r && g > 80 && b > 80;
  });

  if (tealish) {
    ideas.push({
      title: "Warm wood accents",
      category: "decor",
      searchKeywords: ["warm wood decor", "walnut accent pieces", "wood tray decor"],
      why: "Balances cool teal tones with natural warmth.",
    });
  }

  if (recommendedCategories.includes("storage")) {
    ideas.push({
      title: "Slim storage organizer",
      category: "storage",
      searchKeywords: ["small space organizer", "decorative storage bins", "entryway storage"],
      why: "Keeps clutter down without sacrificing style.",
    });
  }

  if (recommendedTags.includes("statement-piece")) {
    ideas.push({
      title: "Statement accent piece",
      category: "wall_art",
      searchKeywords: ["statement wall art", "bold decor accent", "modern gallery piece"],
      why: "Introduces personality and a focal point.",
    });
  }

  return ideas.slice(0, 5);
}

export async function analyzeRoomLocally(file: File | null, roomText: string): Promise<RoomScanAnalysis> {
  await loadModels();

  const text = (roomText || "").toLowerCase();
  const avoidTags: string[] = [];
  if (text.includes("no clutter") || text.includes("declutter")) avoidTags.push("cluttered");
  if (text.includes("no black")) avoidTags.push("black-heavy");

  let objects: string[] = [];
  let palette: string[] = [];
  let mobileTop: string[] = [];

  if (file) {
    const canvas = await downscaleToCanvas(file);
    palette = extractPalette(canvas);

    const preds = await cocoModel!.detect(canvas);
    objects = preds
      .filter((p) => (p.score ?? 0) >= 0.45)
      .map((p) => p.class);

    if (mobileModel) {
      const m = await mobileModel.classify(canvas as any);
      mobileTop = m.slice(0, 3).map((x) => x.className);
    }
  }

  const roomType = inferRoomType(objects);
  const { cats, tags } = tagsFromObjects(objects);
  const vibeTags = file ? vibeFromPalette(palette) : [];

  const recommendedCategories = Array.from(
    new Set([
      ...(roomType ? [roomType] : []),
      ...cats,
      ...(text.includes("storage") ? ["storage"] : []),
      ...(text.includes("mirror") ? ["mirrors"] : []),
      ...(text.includes("art") ? ["wall_art"] : []),
    ])
  );

  const recommendedTags = Array.from(
    new Set([
      ...vibeTags,
      ...tags,
      ...(text.includes("cozy") ? ["cozy"] : []),
      ...(text.includes("fun") || text.includes("cool") ? ["statement-piece", "led-lights"] : []),
    ])
  );

  const oneSentenceSummary =
    `Detected ${roomType ?? "a room"} with ${vibeTags.length ? vibeTags.join(", ") : "a flexible"} vibe. ` +
    `Recommend ${recommendedCategories.slice(0, 3).join(", ") || "core decor"} and ${recommendedTags.slice(0, 3).join(", ") || "cozy upgrades"}.`;

  const productIdeas = buildProductIdeas(objects, palette, roomType, recommendedCategories, recommendedTags);

  return {
    roomType,
    vibeTags,
    recommendedCategories,
    recommendedTags,
    avoidTags,
    oneSentenceSummary,
    productIdeas,
    debug: { objects, palette, mobileTop },
  };
}
