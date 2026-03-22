import * as tf from "@tensorflow/tfjs";
import * as cocoSsd from "@tensorflow-models/coco-ssd";
import * as mobilenet from "@tensorflow-models/mobilenet";
import { logRoomScanDebug } from "../lib/debug";

export type RoomScanModels = {
  cocoModel: cocoSsd.ObjectDetection;
  mobileModel: mobilenet.MobileNet | null;
};

let cocoModel: cocoSsd.ObjectDetection | null = null;
let mobileModel: mobilenet.MobileNet | null = null;
let modelsPromise: Promise<RoomScanModels> | null = null;

export async function getRoomScanModels(): Promise<RoomScanModels> {
  if (modelsPromise) return modelsPromise;

  modelsPromise = (async () => {
    await tf.setBackend("webgl").catch(() => tf.setBackend("cpu"));
    await tf.ready();

    if (!cocoModel) {
      logRoomScanDebug("[RoomScan] loading coco...");
      cocoModel = await cocoSsd.load({
        base: "lite_mobilenet_v2",
        modelUrl: "/tfjs/coco-ssd/model.json",
      });
      logRoomScanDebug("[RoomScan] coco loaded ✅");
    }

    if (!mobileModel) {
      try {
        logRoomScanDebug("[RoomScan] loading mobilenet...");
        mobileModel = await mobilenet.load({
          version: 1,
          alpha: 1.0,
        });
        logRoomScanDebug("[RoomScan] mobilenet loaded ✅");
      } catch (error) {
        logRoomScanDebug("[RoomScan] mobilenet failed (continuing without it):", error);
        mobileModel = null;
      }
    }

    return {
      cocoModel: cocoModel!,
      mobileModel,
    };
  })().catch((error) => {
    modelsPromise = null;
    throw error;
  });
}

export async function preloadRoomScanModels() {
  await getRoomScanModels();
}