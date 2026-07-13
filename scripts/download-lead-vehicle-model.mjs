#!/usr/bin/env node
/**
 * Downloads the Apache-licensed COCO SSD MobileNet v1 quantized TFLite model
 * used by on-device lead-vehicle detection.
 *
 * https://www.tensorflow.org/lite/examples/object_detection/overview
 */
import { copyFileSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const outDir = path.join(root, "assets/models");
const outFile = path.join(outDir, "coco_ssd_mobilenet_v1.tflite");
const zipUrl =
  "https://storage.googleapis.com/download.tensorflow.org/models/tflite/coco_ssd_mobilenet_v1_1.0_quant_2018_06_29.zip";

mkdirSync(outDir, { recursive: true });
if (existsSync(outFile)) {
  console.log("Model already present:", outFile);
  process.exit(0);
}

const tmpZip = path.join(outDir, "coco_ssd.zip");
console.log("Downloading", zipUrl);
execFileSync("curl", ["-fsSL", "-o", tmpZip, zipUrl], { stdio: "inherit" });
execFileSync("unzip", ["-o", tmpZip, "-d", outDir], { stdio: "inherit" });
const detect = path.join(outDir, "detect.tflite");
if (!existsSync(detect)) {
  console.error("detect.tflite missing after unzip");
  process.exit(1);
}
copyFileSync(detect, outFile);
try {
  unlinkSync(tmpZip);
} catch {
  // ignore
}
console.log("Wrote", outFile);
