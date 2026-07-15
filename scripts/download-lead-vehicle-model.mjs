#!/usr/bin/env node
/**
 * Downloads MediaPipe EfficientDet-Lite2 (int8) for on-device vehicle detection.
 * Lite2 is materially more accurate than Lite0 on road scenes while still mobile-friendly.
 *
 * https://developers.google.com/mediapipe/solutions/vision/object_detector
 */
import { existsSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const outDir = path.join(root, "assets/models");
const outFile = path.join(outDir, "efficientdet_lite2.tflite");
const modelUrl =
  "https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite2/int8/1/efficientdet_lite2.tflite";

mkdirSync(outDir, { recursive: true });
if (existsSync(outFile)) {
  console.log("Model already present:", outFile);
  process.exit(0);
}

console.log("Downloading", modelUrl);
execFileSync("curl", ["-fsSL", "-o", outFile, modelUrl], { stdio: "inherit" });
console.log("Wrote", outFile);
