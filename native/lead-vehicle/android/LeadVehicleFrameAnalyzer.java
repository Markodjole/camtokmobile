package com.camtok.mobile.leadvehicle;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.RectF;
import android.util.Base64;
import android.util.Log;

import androidx.annotation.Nullable;

import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.WritableArray;
import com.facebook.react.bridge.WritableMap;

import org.tensorflow.lite.DataType;
import org.tensorflow.lite.support.image.ColorSpaceType;
import org.tensorflow.lite.support.image.ImageProperties;
import org.tensorflow.lite.support.image.TensorImage;
import org.tensorflow.lite.support.label.Category;
import org.tensorflow.lite.task.core.BaseOptions;
import org.tensorflow.lite.task.vision.detector.Detection;
import org.tensorflow.lite.task.vision.detector.ObjectDetector;
import org.tensorflow.lite.task.vision.detector.ObjectDetector.ObjectDetectorOptions;
import org.webrtc.VideoFrame;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.io.ByteArrayOutputStream;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * EfficientDet-Lite2 (448×448) on WebRTC frames via TFLite Task Vision, run as a
 * 2×2 tiled sweep + one full-frame pass so small/distant vehicles are detected.
 * All COCO vehicle classes collapse to a single "vehicle" label for downstream
 * logic. Runs off the capture thread; newest-frame-wins when busy.
 */
public final class LeadVehicleFrameAnalyzer {
    private static final String TAG = "LeadVehicleDetect";
    private static final String MODEL_ASSET = "models/efficientdet_lite2.tflite";
    /** EfficientDet-Lite2 native input is 448 — feeding 320 wasted resolution and
     *  missed small/distant vehicles. Feed full 448 so more vehicles are found. */
    private static final int INPUT_SIZE = 448;
    private static final int MAX_RESULTS = 50;
    /** Native pre-filter; strict vehicle gate runs in JS before overlay/counting. */
    private static final float MIN_SCORE = 0.30f;
    /** Greedy NMS — one box per physical object. */
    private static final float NMS_IOU = 0.45f;
    /** Throttled to leave CPU for the live video encoder — running inference
     *  flat-out starved the encoder and WebRTC dropped the stream resolution. */
    private static final long MIN_INTERVAL_MS = 150L;
    /** JPEG samples for server refine (~2.5 FPS). */
    private static final long JPEG_SAMPLE_INTERVAL_MS = 400L;
    private static final int JPEG_QUALITY = 65;

    private static final LeadVehicleFrameAnalyzer INSTANCE = new LeadVehicleFrameAnalyzer();

    private final ExecutorService executor =
            Executors.newSingleThreadExecutor(
                    r -> {
                        Thread t = new Thread(r, "lead-vehicle-tflite");
                        t.setPriority(Thread.NORM_PRIORITY - 1);
                        return t;
                    });
    private final AtomicBoolean busy = new AtomicBoolean(false);
    private final Object detectorLock = new Object();
    /** If inference wedges, recover so analysis does not stop permanently.
     *  Tiled inference runs 5 passes/frame, so allow more headroom. */
    private static final long BUSY_WATCHDOG_MS = 4000L;

    private volatile long busySinceMs = 0;
    private volatile boolean enabled = false;
    private volatile boolean available = false;
    private volatile String statusDetail = "uninitialized";
    private ObjectDetector objectDetector;
    private ByteBuffer inputBuffer;
    private long lastInferAtMs = 0;
    private long lastJpegAtMs = 0;
    // Letterbox transform for the current tile pass (input-space → source px).
    private float curScale = 1f;
    private float curPadX = 0f;
    private float curPadY = 0f;
    private int curRoiX = 0;
    private int curRoiY = 0;

    private LeadVehicleFrameAnalyzer() {}

    public static LeadVehicleFrameAnalyzer getInstance() {
        return INSTANCE;
    }

    public synchronized void ensureInitialized(Context context) {
        if (objectDetector != null) {
            return;
        }
        try {
            ObjectDetectorOptions options =
                    ObjectDetectorOptions.builder()
                            .setBaseOptions(
                                    BaseOptions.builder().setNumThreads(4).build())
                            .setMaxResults(MAX_RESULTS)
                            .setScoreThreshold(MIN_SCORE)
                            .build();
            objectDetector =
                    ObjectDetector.createFromFileAndOptions(
                            context.getApplicationContext(), MODEL_ASSET, options);
            inputBuffer = ByteBuffer.allocateDirect(INPUT_SIZE * INPUT_SIZE * 3);
            inputBuffer.order(ByteOrder.nativeOrder());
            available = true;
            statusDetail = "ready";
            Log.i(TAG, "EfficientDet-Lite2 loaded (" + MODEL_ASSET + ")");
        } catch (Exception e) {
            available = false;
            statusDetail = e.getMessage() != null ? e.getMessage() : "init_failed";
            Log.e(TAG, "Failed to load object detector", e);
        }
    }

    public void setEnabled(boolean value) {
        enabled = value;
    }

    public boolean isEnabled() {
        return enabled;
    }

    public boolean isAvailable() {
        return available;
    }

    public String getStatusDetail() {
        return statusDetail;
    }

    /**
     * Schedule analysis of the streamed (top-cropped) frame. Detections align
     * 1:1 with the previewed/streamed video. Must not block the capture path.
     */
    public void maybeAnalyze(VideoFrame frame) {
        if (!enabled || !available || objectDetector == null) {
            return;
        }
        long now = System.currentTimeMillis();
        if (now - lastInferAtMs < MIN_INTERVAL_MS) {
            return;
        }
        if (busy.get()) {
            if (busySinceMs > 0 && now - busySinceMs > BUSY_WATCHDOG_MS) {
                Log.w(TAG, "Inference watchdog: clearing wedged busy flag");
                busy.set(false);
                busySinceMs = 0;
            } else {
                if (busySinceMs == 0) {
                    busySinceMs = now;
                }
                return;
            }
        }
        if (!busy.compareAndSet(false, true)) {
            return;
        }
        busySinceMs = now;
        lastInferAtMs = now;

        VideoFrame.Buffer buffer = frame.getBuffer();
        final int rotation = frame.getRotation();
        final long timestampMs = frame.getTimestampNs() / 1_000_000L;
        final boolean includeJpeg = now - lastJpegAtMs >= JPEG_SAMPLE_INTERVAL_MS;
        if (includeJpeg) {
            lastJpegAtMs = now;
        }

        // Analyze exactly the frame that is streamed/previewed (top-cropped by
        // TopCropVideoFrameProcessor) so detections align 1:1 with what the rider
        // and viewers see, and counts reflect vehicles actually in the stream.
        VideoFrame.I420Buffer i420;
        try {
            i420 = buffer.toI420();
        } catch (Exception e) {
            busy.set(false);
            busySinceMs = 0;
            return;
        }
        if (i420 == null) {
            busy.set(false);
            busySinceMs = 0;
            return;
        }

        final int width = i420.getWidth();
        final int height = i420.getHeight();
        final ByteBuffer y = copyPlane(i420.getDataY(), i420.getStrideY(), width, height);
        final ByteBuffer u =
                copyPlane(i420.getDataU(), i420.getStrideU(), (width + 1) / 2, (height + 1) / 2);
        final ByteBuffer v =
                copyPlane(i420.getDataV(), i420.getStrideV(), (width + 1) / 2, (height + 1) / 2);
        i420.release();

        try {
            executor.execute(
                    () -> {
                        try {
                            runInference(y, u, v, width, height, rotation, timestampMs, includeJpeg);
                        } catch (Exception e) {
                            Log.w(TAG, "Inference failed", e);
                        } finally {
                            busy.set(false);
                            busySinceMs = 0;
                        }
                    });
        } catch (Exception e) {
            Log.w(TAG, "Failed to schedule inference", e);
            busy.set(false);
            busySinceMs = 0;
        }
    }

    private void runInference(
            ByteBuffer y,
            ByteBuffer u,
            ByteBuffer v,
            int width,
            int height,
            int rotation,
            long timestampMs,
            boolean includeJpeg) {
        long t0 = System.currentTimeMillis();

        // Single full-frame pass. Tiled inference (4 quadrants + full frame) was
        // too heavy for a device also encoding live video: it thermally throttled
        // the phone and WebRTC collapsed the stream resolution after ~10-20s.
        final int[][] rois = {
            {0, 0, width, height},
        };

        java.util.ArrayList<NormDet> all = new java.util.ArrayList<>();
        for (int[] roi : rois) {
            fillInputFromRoi(y, u, v, width, height, roi[0], roi[1], roi[2], roi[3]);

            TensorImage tensorImage = new TensorImage(DataType.UINT8);
            ImageProperties imageProps =
                    ImageProperties.builder()
                            .setHeight(INPUT_SIZE)
                            .setWidth(INPUT_SIZE)
                            .setColorSpaceType(ColorSpaceType.RGB)
                            .build();
            tensorImage.load(inputBuffer, imageProps);

            List<Detection> results;
            synchronized (detectorLock) {
                if (objectDetector == null) return;
                results = objectDetector.detect(tensorImage);
            }
            for (Detection detection : results) {
                Category best = bestVehicleCategory(detection.getCategories());
                if (best == null || best.getScore() < MIN_SCORE) continue;
                RectF box = detection.getBoundingBox();
                // INPUT space → source px (undo this tile's letterbox) → 0-1 frame.
                float xmin = clamp01((curRoiX + (box.left - curPadX) / curScale) / width);
                float ymin = clamp01((curRoiY + (box.top - curPadY) / curScale) / height);
                float xmax = clamp01((curRoiX + (box.right - curPadX) / curScale) / width);
                float ymax = clamp01((curRoiY + (box.bottom - curPadY) / curScale) / height);
                if (xmax <= xmin || ymax <= ymin) continue;
                all.add(new NormDet(xmin, ymin, xmax, ymax, best.getScore()));
            }
        }

        java.util.List<NormDet> kept = nmsNorm(all);

        long durationMs = System.currentTimeMillis() - t0;
        WritableArray detections = Arguments.createArray();
        for (NormDet d : kept) {
            // Boxes are in the unrotated buffer's 0-1 space. Rotate them into the
            // upright display space so they line up with the video the viewer sees
            // (the frame center is rotation-invariant, which is why only centered
            // vehicles previously appeared aligned).
            float[] r = rotateBoxForDisplay(d.x0, d.y0, d.x1, d.y1, rotation);
            WritableMap det = Arguments.createMap();
            det.putString("vehicleType", "vehicle");
            det.putDouble("confidence", d.score);
            WritableMap boxMap = Arguments.createMap();
            boxMap.putDouble("x", r[0]);
            boxMap.putDouble("y", r[1]);
            boxMap.putDouble("width", r[2] - r[0]);
            boxMap.putDouble("height", r[3] - r[1]);
            det.putMap("boundingBox", boxMap);
            detections.pushMap(det);
        }

        final boolean swap = rotation == 90 || rotation == 270;
        Log.i(
                TAG,
                "tiled detections="
                        + kept.size()
                        + " frame="
                        + width
                        + "x"
                        + height
                        + " rot="
                        + rotation
                        + " dur="
                        + durationMs
                        + "ms");

        WritableMap payload = Arguments.createMap();
        payload.putDouble("timestampMs", timestampMs > 0 ? timestampMs : System.currentTimeMillis());
        payload.putDouble("inferenceDurationMs", durationMs);
        payload.putInt("frameWidth", swap ? height : width);
        payload.putInt("frameHeight", swap ? width : height);
        payload.putInt("rotationDegrees", rotation);
        payload.putArray("detections", detections);
        if (includeJpeg) {
            String jpeg = encodeInputBufferAsJpegBase64();
            if (jpeg != null) {
                payload.putString("imageBase64", jpeg);
            }
        }
        LeadVehicleEmitter.emit("LeadVehicleDetections", payload);
    }

    @Nullable
    private String encodeInputBufferAsJpegBase64() {
        try {
            inputBuffer.rewind();
            int[] pixels = new int[INPUT_SIZE * INPUT_SIZE];
            for (int i = 0; i < pixels.length; i++) {
                int r = inputBuffer.get() & 0xff;
                int g = inputBuffer.get() & 0xff;
                int b = inputBuffer.get() & 0xff;
                pixels[i] = 0xff000000 | (r << 16) | (g << 8) | b;
            }
            Bitmap bitmap =
                    Bitmap.createBitmap(pixels, INPUT_SIZE, INPUT_SIZE, Bitmap.Config.ARGB_8888);
            ByteArrayOutputStream baos = new ByteArrayOutputStream();
            bitmap.compress(Bitmap.CompressFormat.JPEG, JPEG_QUALITY, baos);
            bitmap.recycle();
            return Base64.encodeToString(baos.toByteArray(), Base64.NO_WRAP);
        } catch (Exception e) {
            Log.w(TAG, "JPEG encode failed", e);
            return null;
        }
    }

    /** Detection in 0-1 frame space, produced by a tile or full-frame pass. */
    private static final class NormDet {
        final float x0;
        final float y0;
        final float x1;
        final float y1;
        final float score;

        NormDet(float x0, float y0, float x1, float y1, float score) {
            this.x0 = x0;
            this.y0 = y0;
            this.x1 = x1;
            this.y1 = y1;
            this.score = score;
        }
    }

    /** Greedy NMS across all tile + full-frame detections in 0-1 frame space. */
    private static java.util.List<NormDet> nmsNorm(java.util.List<NormDet> dets) {
        dets.sort((a, b) -> Float.compare(b.score, a.score));
        java.util.ArrayList<NormDet> kept = new java.util.ArrayList<>();
        for (NormDet cand : dets) {
            boolean overlaps = false;
            for (NormDet k : kept) {
                if (iouNorm(cand, k) > NMS_IOU) {
                    overlaps = true;
                    break;
                }
            }
            if (!overlaps) kept.add(cand);
        }
        return kept;
    }

    /**
     * Rotate a 0-1 box from the unrotated buffer into upright display space.
     * `rotation` is the clockwise degrees the frame must be rotated to display.
     * Returns {x0, y0, x1, y1} in display space.
     */
    private static float[] rotateBoxForDisplay(
            float x0, float y0, float x1, float y1, int rotation) {
        float ax;
        float ay;
        float bx;
        float by;
        switch (((rotation % 360) + 360) % 360) {
            case 90:
                ax = 1f - y0;
                ay = x0;
                bx = 1f - y1;
                by = x1;
                break;
            case 180:
                ax = 1f - x0;
                ay = 1f - y0;
                bx = 1f - x1;
                by = 1f - y1;
                break;
            case 270:
                ax = y0;
                ay = 1f - x0;
                bx = y1;
                by = 1f - x1;
                break;
            default:
                ax = x0;
                ay = y0;
                bx = x1;
                by = y1;
                break;
        }
        return new float[] {
            Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by)
        };
    }

    private static float iouNorm(NormDet a, NormDet b) {
        float ix1 = Math.max(a.x0, b.x0);
        float iy1 = Math.max(a.y0, b.y0);
        float ix2 = Math.min(a.x1, b.x1);
        float iy2 = Math.min(a.y1, b.y1);
        float iw = Math.max(0f, ix2 - ix1);
        float ih = Math.max(0f, iy2 - iy1);
        float inter = iw * ih;
        float areaA = Math.max(0f, a.x1 - a.x0) * Math.max(0f, a.y1 - a.y0);
        float areaB = Math.max(0f, b.x1 - b.x0) * Math.max(0f, b.y1 - b.y0);
        float union = areaA + areaB - inter;
        if (union <= 0f) return 0f;
        return inter / union;
    }

    private static Category bestVehicleCategory(List<Category> categories) {
        Category best = null;
        for (Category category : categories) {
            if (mapLabel(category.getLabel()) == null) continue;
            if (best == null || category.getScore() > best.getScore()) {
                best = category;
            }
        }
        return best;
    }

    private static String mapLabel(String label) {
        if (label == null) return null;
        switch (label.toLowerCase()) {
            case "car":
            case "motorcycle":
            case "bus":
            case "truck":
            case "bicycle":
                return "vehicle";
            default:
                return null;
        }
    }

    /**
     * Letterbox a source ROI (roiX,roiY,roiW,roiH) into INPUT_SIZE×INPUT_SIZE
     * preserving aspect ratio, so vehicles are not distorted. Padding is neutral
     * gray. The scale + pad + ROI origin are stored so runInference can map boxes
     * from INPUT space back to source px and then to 0-1 frame space.
     */
    private void fillInputFromRoi(
            ByteBuffer yPlane,
            ByteBuffer uPlane,
            ByteBuffer vPlane,
            int width,
            int height,
            int roiX,
            int roiY,
            int roiW,
            int roiH) {
        final float scale = Math.min((float) INPUT_SIZE / roiW, (float) INPUT_SIZE / roiH);
        curScale = scale;
        curPadX = (INPUT_SIZE - roiW * scale) / 2f;
        curPadY = (INPUT_SIZE - roiH * scale) / 2f;
        curRoiX = roiX;
        curRoiY = roiY;

        inputBuffer.rewind();
        for (int dy = 0; dy < INPUT_SIZE; dy++) {
            float syRoi = (dy + 0.5f - curPadY) / scale - 0.5f;
            float sy = roiY + syRoi;
            boolean rowInside = syRoi >= -0.5f && syRoi <= roiH - 0.5f && sy <= height - 0.5f;
            int y0 = Math.max(0, (int) Math.floor(sy));
            int y1 = Math.min(height - 1, y0 + 1);
            float wy = sy - y0;
            for (int dx = 0; dx < INPUT_SIZE; dx++) {
                float sxRoi = (dx + 0.5f - curPadX) / scale - 0.5f;
                float sx = roiX + sxRoi;
                if (!rowInside || sxRoi < -0.5f || sxRoi > roiW - 0.5f || sx > width - 0.5f) {
                    inputBuffer.put((byte) 114);
                    inputBuffer.put((byte) 114);
                    inputBuffer.put((byte) 114);
                    continue;
                }
                int x0 = Math.max(0, (int) Math.floor(sx));
                int x1 = Math.min(width - 1, x0 + 1);
                float wx = sx - x0;

                int r = sampleRgbChannel(yPlane, uPlane, vPlane, width, height, x0, y0, x1, y1, wx, wy, 0);
                int g = sampleRgbChannel(yPlane, uPlane, vPlane, width, height, x0, y0, x1, y1, wx, wy, 1);
                int b = sampleRgbChannel(yPlane, uPlane, vPlane, width, height, x0, y0, x1, y1, wx, wy, 2);
                inputBuffer.put((byte) r);
                inputBuffer.put((byte) g);
                inputBuffer.put((byte) b);
            }
        }
        inputBuffer.rewind();
    }

    private static int sampleRgbChannel(
            ByteBuffer yPlane,
            ByteBuffer uPlane,
            ByteBuffer vPlane,
            int width,
            int height,
            int x0,
            int y0,
            int x1,
            int y1,
            float wx,
            float wy,
            int channel) {
        float c00 = yuvToRgbChannel(yPlane, uPlane, vPlane, width, x0, y0, channel);
        float c10 = yuvToRgbChannel(yPlane, uPlane, vPlane, width, x1, y0, channel);
        float c01 = yuvToRgbChannel(yPlane, uPlane, vPlane, width, x0, y1, channel);
        float c11 = yuvToRgbChannel(yPlane, uPlane, vPlane, width, x1, y1, channel);
        float top = c00 * (1f - wx) + c10 * wx;
        float bottom = c01 * (1f - wx) + c11 * wx;
        return clampByte(Math.round(top * (1f - wy) + bottom * wy));
    }

    private static float yuvToRgbChannel(
            ByteBuffer yPlane,
            ByteBuffer uPlane,
            ByteBuffer vPlane,
            int width,
            int x,
            int y,
            int channel) {
        int yIndex = y * width + x;
        int uvIndex = (y / 2) * ((width + 1) / 2) + (x / 2);
        int yv = yPlane.get(yIndex) & 0xff;
        int u = uPlane.get(uvIndex) & 0xff;
        int v = vPlane.get(uvIndex) & 0xff;
        int c = yv - 16;
        int d = u - 128;
        int e = v - 128;
        int r = (298 * c + 409 * e + 128) >> 8;
        int g = (298 * c - 100 * d - 208 * e + 128) >> 8;
        int b = (298 * c + 516 * d + 128) >> 8;
        if (channel == 0) return r;
        if (channel == 1) return g;
        return b;
    }

    private static ByteBuffer copyPlane(ByteBuffer src, int stride, int width, int height) {
        ByteBuffer out = ByteBuffer.allocateDirect(width * height);
        byte[] row = new byte[width];
        for (int rowIdx = 0; rowIdx < height; rowIdx++) {
            src.position(rowIdx * stride);
            src.get(row, 0, width);
            out.put(row);
        }
        out.rewind();
        return out;
    }

    private static float clamp01(float v) {
        if (v < 0f) return 0f;
        if (v > 1f) return 1f;
        return v;
    }

    private static int clampByte(int v) {
        if (v < 0) return 0;
        if (v > 255) return 255;
        return v;
    }

    public synchronized void dispose() {
        enabled = false;
        synchronized (detectorLock) {
            if (objectDetector != null) {
                objectDetector.close();
                objectDetector = null;
            }
        }
        available = false;
        statusDetail = "disposed";
    }
}
