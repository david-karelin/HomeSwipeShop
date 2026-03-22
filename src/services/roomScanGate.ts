import type * as cocoSsd from "@tensorflow-models/coco-ssd";
import type * as mobilenet from "@tensorflow-models/mobilenet";
import { getRoomScanModels } from "./roomScanModels";

export type RoomScanValidation = {
  ok: boolean;
  reason?: string;
  roomScore: number;
  objects: string[];
  labels: string[];
};

type NormalizedDetection = {
  className: string;
  score: number;
  areaRatio: number;
};

const STRONG_ROOM_OBJECTS = new Set([
  "bed",
  "couch",
  "dining table",
  "tv",
  "sink",
  "toilet",
  "refrigerator",
  "oven",
  "microwave",
]);

const WEAK_ROOM_OBJECTS = new Set([
  "chair",
  "laptop",
  "keyboard",
  "mouse",
  "book",
  "vase",
  "potted plant",
  "clock",
]);

const NON_ROOM_OBJECTS = new Set([
  "person",
  "dog",
  "cat",
  "bird",
  "horse",
  "sheep",
  "cow",
  "car",
  "bus",
  "truck",
  "bicycle",
  "sports ball",
  "banana",
  "apple",
  "pizza",
  "sandwich",
]);

const ROOM_SCENE_HINTS = [
  "living room",
  "bedroom",
  "interior",
  "apartment",
  "office",
  "desk",
  "dining room",
  "bookcase",
  "room",
  "empty room",
  "interior design",
  "floor",
  "wall",
  "window",
  "door",
  "corner",
  "closet",
  "wardrobe",
  "sliding door",
  "shoji",
];

const NON_ROOM_SCENE_HINTS = [
  "restaurant",
  "grocery store",
  "beach",
  "mountain",
  "forest",
  "street",
  "park",
  "dog",
  "cat",
  "car",
  "bicycle",
  "packet",
  "product",
  "website",
  "selfie",
  "portrait",
];

function getImageSize(imageEl: HTMLImageElement | HTMLCanvasElement) {
  const width =
    imageEl instanceof HTMLImageElement
      ? imageEl.naturalWidth || imageEl.width || 1
      : imageEl.width || 1;

  const height =
    imageEl instanceof HTMLImageElement
      ? imageEl.naturalHeight || imageEl.height || 1
      : imageEl.height || 1;

  return { width, height, area: Math.max(1, width * height) };
}

function normalizeDetections(
  imageEl: HTMLImageElement | HTMLCanvasElement,
  detections: cocoSsd.DetectedObject[]
): NormalizedDetection[] {
  const { area } = getImageSize(imageEl);

  return detections
    .filter((detection) => (detection.score ?? 0) >= 0.35)
    .map((detection) => {
      const className = String(detection.class || "").toLowerCase().trim();
      const score = Number(detection.score ?? 0);

      const bbox = Array.isArray(detection.bbox) ? detection.bbox : [0, 0, 0, 0];
      const boxWidth = Math.max(0, Number(bbox[2] ?? 0));
      const boxHeight = Math.max(0, Number(bbox[3] ?? 0));
      const areaRatio = Math.max(0, (boxWidth * boxHeight) / area);

      return {
        className,
        score,
        areaRatio,
      };
    })
    .filter((detection) => Boolean(detection.className));
}

function normalizeLabels(predictions: mobilenet.ClassificationResult[]) {
  return predictions
    .map((prediction) => String(prediction.className || "").trim())
    .filter(Boolean);
}

function includesAnyHint(text: string, hints: string[]) {
  return hints.some((hint) => text.includes(hint));
}

export async function validateRoomScanImage(
  imageEl: HTMLImageElement | HTMLCanvasElement,
  roomText?: string
): Promise<RoomScanValidation> {
  const { cocoModel, mobileModel } = await getRoomScanModels();

  const normalizedRoomText = String(roomText || "").toLowerCase();
  const hasUserRoomIntentHint =
    /\b(room|bedroom|empty room|interior|space|wall|window|door|corner)\b/.test(normalizedRoomText);

  const [scenePredictions, detections] = await Promise.all([
    mobileModel ? mobileModel.classify(imageEl, 5).catch(() => []) : Promise.resolve([]),
    cocoModel.detect(imageEl, 12),
  ]);

  const normalized = normalizeDetections(imageEl, detections);
  const objects = normalized.map((detection) => detection.className);
  const uniqueObjects = [...new Set(objects)];
  const labels = normalizeLabels(scenePredictions);
  const labelText = labels.join(" | ").toLowerCase();

  const strongRoomDetections = normalized.filter((detection) =>
    STRONG_ROOM_OBJECTS.has(detection.className)
  );

  const weakRoomDetections = normalized.filter((detection) =>
    WEAK_ROOM_OBJECTS.has(detection.className)
  );

  const nonRoomDetections = normalized.filter((detection) =>
    NON_ROOM_OBJECTS.has(detection.className)
  );

  const roomObjectCount = strongRoomDetections.length + weakRoomDetections.length;
  const uniqueRoomObjectCount = uniqueObjects.filter(
    (objectName) =>
      STRONG_ROOM_OBJECTS.has(objectName) || WEAK_ROOM_OBJECTS.has(objectName)
  ).length;

  const hasRoomSceneHint = includesAnyHint(labelText, ROOM_SCENE_HINTS);
  const hasNonRoomSceneHint = includesAnyHint(labelText, NON_ROOM_SCENE_HINTS);

  const personCount = objects.filter((objectName) => objectName === "person").length;
  const personRatio = objects.length > 0 ? personCount / objects.length : 0;

  const biggestWeakObjectArea = weakRoomDetections.reduce(
    (max, detection) => Math.max(max, detection.areaRatio),
    0
  );

  const biggestStrongObjectArea = strongRoomDetections.reduce(
    (max, detection) => Math.max(max, detection.areaRatio),
    0
  );

  let roomScore = 0;

  roomScore += strongRoomDetections.length * 3;
  roomScore += weakRoomDetections.length * 1.25;
  roomScore -= nonRoomDetections.length * 2.25;

  if (hasRoomSceneHint) roomScore += 2.5;
  if (hasNonRoomSceneHint) roomScore -= 4.5;

  if (personRatio > 0.55) roomScore -= 4;
  if (personRatio > 0.8) roomScore -= 3;

  if (roomObjectCount === 0 && !hasRoomSceneHint) roomScore -= 3;
  if (strongRoomDetections.length === 0 && uniqueRoomObjectCount <= 1) roomScore -= 2.5;

  const hasStrongAnchor = strongRoomDetections.some((detection) => detection.score >= 0.45);
  const hasMultipleRoomObjects = uniqueRoomObjectCount >= 2;

  // allow scene support without requiring a detected object
  const hasReliableSceneSupport = hasRoomSceneHint || hasUserRoomIntentHint;

  // allow empty rooms if they are not dominated by negative signals
  const hasEmptyRoomSceneSupport =
    (hasRoomSceneHint || hasUserRoomIntentHint) &&
    roomObjectCount === 0 &&
    nonRoomDetections.length === 0 &&
    personRatio < 0.2;

  const weakCloseupOnly =
    strongRoomDetections.length === 0 &&
    uniqueRoomObjectCount === 1 &&
    biggestWeakObjectArea > 0.42;

  const dominatedByNegative =
    nonRoomDetections.length >= Math.max(2, roomObjectCount + 1) || personRatio > 0.75;

  const oversizedSingleWeakObject =
    strongRoomDetections.length === 0 &&
    weakRoomDetections.length === 1 &&
    biggestWeakObjectArea > 0.58;

  const noMeaningfulRoomEvidence =
    !hasStrongAnchor &&
    !hasMultipleRoomObjects &&
    !hasReliableSceneSupport &&
    !hasEmptyRoomSceneSupport;

  const minRequiredScore = hasEmptyRoomSceneSupport ? 0 : 1.5;

  console.log("[RoomScanGate]", {
    roomText,
    hasUserRoomIntentHint,
    hasRoomSceneHint,
    roomObjectCount,
    nonRoomDetections: nonRoomDetections.length,
    personRatio,
    hasEmptyRoomSceneSupport,
    minRequiredScore,
    roomScore,
  });

  const ok =
    roomScore >= minRequiredScore &&
    !weakCloseupOnly &&
    !oversizedSingleWeakObject &&
    !dominatedByNegative &&
    !noMeaningfulRoomEvidence;

  let reason: string | undefined;

  if (!ok) {
    if (dominatedByNegative) {
      reason =
        "This looks more like a person, pet, or non-room photo. Try a wider room shot with the bed, desk, wall, shelf, or corner visible.";
    } else if (weakCloseupOnly || oversizedSingleWeakObject) {
      reason =
        "This looks like a close-up, not a full room photo. Step back and capture more of the room.";
    } else if (!hasStrongAnchor && !hasMultipleRoomObjects && !hasReliableSceneSupport) {
      reason =
        "We couldn’t confirm this is a real room. Try a wider photo that shows the bed, desk, wall, shelf, or room corner.";
    } else {
      reason =
        "This doesn’t look like a room photo. Try a wider shot that shows your bed, desk, wall, shelf, or room corner.";
    }
  }

  return {
    ok,
    reason,
    roomScore: Number(roomScore.toFixed(2)),
    objects: uniqueObjects,
    labels,
  };
}