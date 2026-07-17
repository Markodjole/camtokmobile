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
     *  flat-out starved the encoder and WebRTC dropped the stream resolution.
     *  ~4 fps keeps the box tight on the lead vehicle; frame prep is
     *  nearest-neighbor (cheap) so the encoder still gets its cores. */
    private static final long MIN_INTERVAL_MS = 250L;
    /** Analysis frames are GPU-downscaled to this max width before CPU readback. */
    private static final int ANALYZE_MAX_DIM = 640;
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
    /** JPEG frame sampling is only for hybrid/server-refine inference; it's
     *  pure extra CPU work (Bitmap + JPEG encode every ~400ms) when nothing
     *  consumes it, which was starving the video encoder alongside detection.
     *  Off by default; JS turns it on only when hybrid mode actually starts. */
    private volatile boolean samplingEnabled = false;
    private ObjectDetector objectDetector;
    private ByteBuffer inputBuffer;
    private long lastInferAtMs = 0;
    private long lastJpegAtMs = 0;
    // Letterbox transform (input-space → upright display-space px).
    private float curScale = 1f;
    private float curPadX = 0f;
    private float curPadY = 0f;
    private int curUprightW = 0;
    private int curUprightH = 0;

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
                                    // 2 threads, not 4: the video encoder needs the
                                    // other cores or WebRTC downscales the stream.
                                    BaseOptions.builder().setNumThreads(2).build())
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

    public void setSamplingEnabled(boolean value) {
        samplingEnabled = value;
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

        final VideoFrame.Buffer buffer = frame.getBuffer();
        final int rotation = frame.getRotation();
        final long timestampMs = frame.getTimestampNs() / 1_000_000L;
        final boolean includeJpeg =
                samplingEnabled && now - lastJpegAtMs >= JPEG_SAMPLE_INTERVAL_MS;
        if (includeJpeg) {
            lastJpegAtMs = now;
        }

        // CRITICAL: do NOT convert/copy on this (capture) thread. toI420 of a
        // 1080p frame + ~3MB of plane copies stalled the capture pipeline 4x/s,
        // which starved the encoder (fps bouncing 10↔30 = glitchy stream even
        // with limited=none). Retain the buffer (cheap refcount) and do all the
        // heavy work on the inference thread.
        buffer.retain();
        try {
            executor.execute(
                    () -> {
                        VideoFrame.I420Buffer i420 = null;
                        try {
                            // Downscale ON THE GPU before toI420: reading back a
                            // full 1920x1072 texture (glReadPixels) runs on the
                            // camera's GL thread and stalls capture — the source
                            // of fps sinking 29→8 over a minute. A ~640px frame
                            // is a 9x smaller readback, and the detector's 448px
                            // input loses nothing.
                            try {
                                final int srcW = buffer.getWidth();
                                final int srcH = buffer.getHeight();
                                if (srcW > ANALYZE_MAX_DIM) {
                                    final int tw = ANALYZE_MAX_DIM;
                                    final int th = Math.max(2, (srcH * ANALYZE_MAX_DIM / srcW) & ~1);
                                    VideoFrame.Buffer scaled =
                                            buffer.cropAndScale(0, 0, srcW, srcH, tw, th);
                                    try {
                                        i420 = scaled.toI420();
                                    } finally {
                                        scaled.release();
                                    }
                                } else {
                                    i420 = buffer.toI420();
                                }
                            } finally {
                                buffer.release();
                            }
                            if (i420 == null) return;
                            final int width = i420.getWidth();
                            final int height = i420.getHeight();
                            ensurePlaneBuffers(width, height);
                            copyPlaneInto(planeY, i420.getDataY(), i420.getStrideY(), width, height);
                            copyPlaneInto(
                                    planeU,
                                    i420.getDataU(),
                                    i420.getStrideU(),
                                    (width + 1) / 2,
                                    (height + 1) / 2);
                            copyPlaneInto(
                                    planeV,
                                    i420.getDataV(),
                                    i420.getStrideV(),
                                    (width + 1) / 2,
                                    (height + 1) / 2);
                            i420.release();
                            i420 = null;
                            runInference(
                                    planeY, planeU, planeV, width, height, rotation, timestampMs, includeJpeg);
                        } catch (Exception e) {
                            Log.w(TAG, "Inference failed", e);
                            if (i420 != null) i420.release();
                        } finally {
                            busy.set(false);
                            busySinceMs = 0;
                        }
                    });
        } catch (Exception e) {
            Log.w(TAG, "Failed to schedule inference", e);
            buffer.release();
            busy.set(false);
            busySinceMs = 0;
        }
    }

    // Reused plane buffers — allocating ~3MB per analyzed frame caused GC/alloc
    // churn on the hot path. Single-threaded executor, so reuse is safe.
    private ByteBuffer planeY;
    private ByteBuffer planeU;
    private ByteBuffer planeV;
    private int planeW = 0;
    private int planeH = 0;

    private void ensurePlaneBuffers(int width, int height) {
        if (planeY != null && planeW == width && planeH == height) return;
        planeY = ByteBuffer.allocateDirect(width * height);
        int cw = (width + 1) / 2;
        int chh = (height + 1) / 2;
        planeU = ByteBuffer.allocateDirect(cw * chh);
        planeV = ByteBuffer.allocateDirect(cw * chh);
        planeW = width;
        planeH = height;
    }

    private static void copyPlaneInto(
            ByteBuffer dst, ByteBuffer src, int stride, int width, int height) {
        dst.clear();
        byte[] row = new byte[width];
        for (int rowIdx = 0; rowIdx < height; rowIdx++) {
            src.position(rowIdx * stride);
            src.get(row, 0, width);
            dst.put(row);
        }
        dst.rewind();
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

        // CRITICAL: rotate the image upright BEFORE inference. The camera buffer
        // arrives rotated (rot=90 in portrait); feeding it as-is asks the model
        // to find cars lying on their side, which it almost never does — that is
        // why detections were ~0 on real traffic. Sampling applies the rotation,
        // so the model sees the same upright scene the viewer sees and boxes come
        // out directly in display space (no post-rotation needed).
        fillInputUpright(y, u, v, width, height, rotation);

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
        java.util.ArrayList<NormDet> all = new java.util.ArrayList<>();
        for (Detection detection : results) {
            Category best = bestVehicleCategory(detection.getCategories());
            if (best == null || best.getScore() < MIN_SCORE) continue;
            RectF box = detection.getBoundingBox();
            // INPUT space → upright display px (undo letterbox) → 0-1.
            float xmin = clamp01(((box.left - curPadX) / curScale) / curUprightW);
            float ymin = clamp01(((box.top - curPadY) / curScale) / curUprightH);
            float xmax = clamp01(((box.right - curPadX) / curScale) / curUprightW);
            float ymax = clamp01(((box.bottom - curPadY) / curScale) / curUprightH);
            if (xmax <= xmin || ymax <= ymin) continue;
            all.add(
                    new NormDet(
                            xmin,
                            ymin,
                            xmax,
                            ymax,
                            best.getScore(),
                            best.getLabel().toLowerCase()));
        }

        java.util.List<NormDet> kept = nmsNorm(all);

        long durationMs = System.currentTimeMillis() - t0;
        WritableArray detections = Arguments.createArray();
        for (NormDet d : kept) {
            WritableMap det = Arguments.createMap();
            // Real COCO class (car / motorcycle / bus / truck / bicycle) so the
            // JS follower can prefer motorcycles over cars.
            det.putString("vehicleType", d.label);
            det.putDouble("confidence", d.score);
            WritableMap boxMap = Arguments.createMap();
            boxMap.putDouble("x", d.x0);
            boxMap.putDouble("y", d.y0);
            boxMap.putDouble("width", d.x1 - d.x0);
            boxMap.putDouble("height", d.y1 - d.y0);
            det.putMap("boundingBox", boxMap);
            detections.pushMap(det);
        }

        final boolean swap = rotation == 90 || rotation == 270;
        Log.i(
                TAG,
                "detections="
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

    /** Detection in 0-1 upright display space. */
    private static final class NormDet {
        final float x0;
        final float y0;
        final float x1;
        final float y1;
        final float score;
        final String label;

        NormDet(float x0, float y0, float x1, float y1, float score, String label) {
            this.x0 = x0;
            this.y0 = y0;
            this.x1 = x1;
            this.y1 = y1;
            this.score = score;
            this.label = label;
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
     * Letterbox the *upright* frame into INPUT_SIZE×INPUT_SIZE, applying the
     * camera rotation during sampling so the model sees the scene the way the
     * viewer does. Padding is neutral gray. Stores scale/pad/upright dims so
     * runInference can map boxes straight back to 0-1 display space.
     */
    private void fillInputUpright(
            ByteBuffer yPlane,
            ByteBuffer uPlane,
            ByteBuffer vPlane,
            int width,
            int height,
            int rotation) {
        final int rot = ((rotation % 360) + 360) % 360;
        final boolean swap = rot == 90 || rot == 270;
        final int uprightW = swap ? height : width;
        final int uprightH = swap ? width : height;
        final float scale =
                Math.min((float) INPUT_SIZE / uprightW, (float) INPUT_SIZE / uprightH);
        curScale = scale;
        curPadX = (INPUT_SIZE - uprightW * scale) / 2f;
        curPadY = (INPUT_SIZE - uprightH * scale) / 2f;
        curUprightW = uprightW;
        curUprightH = uprightH;

        inputBuffer.rewind();
        for (int dy = 0; dy < INPUT_SIZE; dy++) {
            final float ry = (dy + 0.5f - curPadY) / scale;
            final boolean rowInside = ry >= 0f && ry <= uprightH;
            final float v = ry / uprightH;
            for (int dx = 0; dx < INPUT_SIZE; dx++) {
                final float rx = (dx + 0.5f - curPadX) / scale;
                if (!rowInside || rx < 0f || rx > uprightW) {
                    inputBuffer.put((byte) 114);
                    inputBuffer.put((byte) 114);
                    inputBuffer.put((byte) 114);
                    continue;
                }
                final float u = rx / uprightW;
                // Upright display (u,v) → source buffer normalized coords.
                final float sxN;
                final float syN;
                switch (rot) {
                    case 90:
                        sxN = v;
                        syN = 1f - u;
                        break;
                    case 180:
                        sxN = 1f - u;
                        syN = 1f - v;
                        break;
                    case 270:
                        sxN = 1f - v;
                        syN = u;
                        break;
                    default:
                        sxN = u;
                        syN = v;
                        break;
                }
                // Nearest-neighbor + one YUV→RGB conversion per output pixel.
                // Bilinear did 12 conversions/pixel and dominated inference time,
                // which is where the laggy box came from.
                final int xi =
                        Math.min(width - 1, Math.max(0, (int) (sxN * width)));
                final int yi =
                        Math.min(height - 1, Math.max(0, (int) (syN * height)));
                final int uvIndex = (yi / 2) * ((width + 1) / 2) + (xi / 2);
                final int c = (yPlane.get(yi * width + xi) & 0xff) - 16;
                final int d = (uPlane.get(uvIndex) & 0xff) - 128;
                final int e = (vPlane.get(uvIndex) & 0xff) - 128;
                inputBuffer.put((byte) clampByte((298 * c + 409 * e + 128) >> 8));
                inputBuffer.put((byte) clampByte((298 * c - 100 * d - 208 * e + 128) >> 8));
                inputBuffer.put((byte) clampByte((298 * c + 516 * d + 128) >> 8));
            }
        }
        inputBuffer.rewind();
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
