#!/usr/bin/env node
/**
 * Downloads EfficientDet-Lite2 (448px, COCO) for on-device vehicle detection.
 *
 * IMPORTANT: this must be the TFLite *Task Library* build that ships the
 * TFLite_Detection_PostProcess op (4 outputs: locations, classes, scores,
 * num_detections) plus embedded label metadata. The MediaPipe build of the same
 * model only exposes 2 raw outputs and the Task Vision ObjectDetector rejects it
 * with "Mobile SSD models are expected to have exactly 4 outputs, found 2",
 * silently disabling on-device detection. This is the model the official
 * TensorFlow Lite Android object-detection example uses.
 */
import { existsSync, mkdirSync, statSync, unlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const outDir = path.join(root, "assets/models");
const outFile = path.join(outDir, "efficientdet_lite2.tflite");
const modelUrl =
  "https://storage.googleapis.com/download.tensorflow.org/models/tflite/task_library/object_detection/android/lite-model_efficientdet_lite2_detection_metadata_1.tflite";

// The Task-Library Lite2 model is ~7MB. If a much smaller/older (incompatible
// MediaPipe) file is present, force a re-download.
const MIN_VALID_BYTES = 4_000_000;

mkdirSync(outDir, { recursive: true });
if (existsSync(outFile)) {
  const size = statSync(outFile).size;
  if (size >= MIN_VALID_BYTES) {
    console.log("Model already present:", outFile, `(${size} bytes)`);
    process.exit(0);
  }
  console.log("Existing model looks wrong size, re-downloading:", size, "bytes");
  unlinkSync(outFile);
}

console.log("Downloading", modelUrl);
execFileSync("curl", ["-fsSL", "-o", outFile, modelUrl], { stdio: "inherit" });
console.log("Wrote", outFile, `(${statSync(outFile).size} bytes)`);
