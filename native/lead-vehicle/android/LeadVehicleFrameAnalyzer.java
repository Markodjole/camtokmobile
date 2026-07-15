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
 * MediaPipe EfficientDet-Lite2 int8 (320×320) on WebRTC frames via TFLite Task Vision.
 * All COCO vehicle classes collapse to a single "vehicle" label for downstream logic.
 * Runs off the capture thread; newest-frame-wins when busy.
 */
public final class LeadVehicleFrameAnalyzer {
    private static final String TAG = "LeadVehicleDetect";
    private static final String MODEL_ASSET = "models/efficientdet_lite2.tflite";
    private static final int INPUT_SIZE = 320;
    private static final int MAX_RESULTS = 25;
    /** Native pre-filter; strict vehicle gate runs in JS before overlay/counting. */
    private static final float MIN_SCORE = 0.35f;
    /** Greedy NMS — one box per physical object. */
    private static final float NMS_IOU = 0.45f;
    /** ~25 FPS — vehicle filter drops junk before overlay/counting. */
    private static final long MIN_INTERVAL_MS = 40L;
    /** Road band in display space — skip sky (top) and curb (bottom). */
    private static final float ROAD_BAND_TOP = 0.10f;
    private static final float ROAD_BAND_BOTTOM = 0.92f;
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
    /** If inference wedges, recover so analysis does not stop permanently. */
    private static final long BUSY_WATCHDOG_MS = 2500L;

    private volatile long busySinceMs = 0;
    private volatile boolean enabled = false;
    private volatile boolean available = false;
    private volatile String statusDetail = "uninitialized";
    private ObjectDetector objectDetector;
    private ByteBuffer inputBuffer;
    private long lastInferAtMs = 0;
    private long lastJpegAtMs = 0;

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
     * Schedule analysis of the full camera frame (road band extracted inside).
     * Must not block the WebRTC capture path.
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
        final int fullWidth = buffer.getWidth();
        final int fullHeight = buffer.getHeight();
        final int rotation = frame.getRotation();
        final long timestampMs = frame.getTimestampNs() / 1_000_000L;
        final boolean includeJpeg = now - lastJpegAtMs >= JPEG_SAMPLE_INTERVAL_MS;
        if (includeJpeg) {
            lastJpegAtMs = now;
        }

        RoadBandRect band = roadBandRect(fullWidth, fullHeight, rotation);
        VideoFrame.Buffer roadBuffer =
                buffer.cropAndScale(
                        band.offsetX,
                        band.offsetY,
                        band.cropWidth,
                        band.cropHeight,
                        band.cropWidth,
                        band.cropHeight);
        VideoFrame.I420Buffer i420;
        try {
            i420 = roadBuffer.toI420();
        } catch (Exception e) {
            roadBuffer.release();
            busy.set(false);
            busySinceMs = 0;
            return;
        }
        roadBuffer.release();
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

    private static final class RoadBandRect {
        int offsetX;
        int offsetY;
        int cropWidth;
        int cropHeight;
    }

    /** Display-oriented road band — where traffic actually appears on a bike cam. */
    private static RoadBandRect roadBandRect(int width, int height, int rotation) {
        RoadBandRect r = new RoadBandRect();
        int bandStart;
        int bandKeep;
        if (rotation == 90 || rotation == 270) {
            bandStart = Math.max(0, Math.round(width * ROAD_BAND_TOP));
            bandKeep =
                    Math.max(
                            1,
                            Math.round(width * (ROAD_BAND_BOTTOM - ROAD_BAND_TOP)));
            r.cropHeight = height;
            if (rotation == 90) {
                r.offsetX = bandStart;
            } else {
                r.offsetX = Math.max(0, width - bandStart - bandKeep);
            }
            r.offsetY = 0;
            r.cropWidth = Math.min(bandKeep, width - r.offsetX);
        } else {
            bandStart = Math.max(0, Math.round(height * ROAD_BAND_TOP));
            bandKeep =
                    Math.max(
                            1,
                            Math.round(height * (ROAD_BAND_BOTTOM - ROAD_BAND_TOP)));
            r.offsetX = 0;
            r.offsetY = bandStart;
            r.cropWidth = width;
            r.cropHeight = Math.min(bandKeep, height - bandStart);
        }
        return r;
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
        fillInputFromI420(y, u, v, width, height);

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
        results = nmsVehicleDetections(results);

        long durationMs = System.currentTimeMillis() - t0;
        WritableArray detections = Arguments.createArray();
        for (Detection detection : results) {
            Category best = bestVehicleCategory(detection.getCategories());
            if (best == null || best.getScore() < MIN_SCORE) continue;

            RectF box = detection.getBoundingBox();
            float xmin = normalizeCoord(box.left);
            float ymin = normalizeCoord(box.top);
            float xmax = normalizeCoord(box.right);
            float ymax = normalizeCoord(box.bottom);

            WritableMap det = Arguments.createMap();
            det.putString("vehicleType", "vehicle");
            det.putDouble("confidence", best.getScore());
            WritableMap boxMap = Arguments.createMap();
            boxMap.putDouble("x", xmin);
            boxMap.putDouble("y", ymin);
            boxMap.putDouble("width", Math.max(0, xmax - xmin));
            boxMap.putDouble("height", Math.max(0, ymax - ymin));
            det.putMap("boundingBox", boxMap);
            detections.pushMap(det);
        }

        WritableMap payload = Arguments.createMap();
        payload.putDouble("timestampMs", timestampMs > 0 ? timestampMs : System.currentTimeMillis());
        payload.putDouble("inferenceDurationMs", durationMs);
        payload.putInt("frameWidth", width);
        payload.putInt("frameHeight", height);
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

    private static List<Detection> nmsVehicleDetections(List<Detection> detections) {
        java.util.ArrayList<Detection> vehicles = new java.util.ArrayList<>();
        for (Detection detection : detections) {
            if (bestVehicleCategory(detection.getCategories()) != null) {
                vehicles.add(detection);
            }
        }
        vehicles.sort(
                (a, b) ->
                        Float.compare(
                                bestVehicleCategory(b.getCategories()).getScore(),
                                bestVehicleCategory(a.getCategories()).getScore()));
        java.util.ArrayList<Detection> kept = new java.util.ArrayList<>();
        for (Detection candidate : vehicles) {
            RectF cBox = candidate.getBoundingBox();
            boolean overlaps = false;
            for (Detection keptDet : kept) {
                if (iou(cBox, keptDet.getBoundingBox()) > NMS_IOU) {
                    overlaps = true;
                    break;
                }
            }
            if (!overlaps) kept.add(candidate);
        }
        return kept;
    }

    private static float iou(RectF a, RectF b) {
        float ix1 = Math.max(a.left, b.left);
        float iy1 = Math.max(a.top, b.top);
        float ix2 = Math.min(a.right, b.right);
        float iy2 = Math.min(a.bottom, b.bottom);
        float iw = Math.max(0f, ix2 - ix1);
        float ih = Math.max(0f, iy2 - iy1);
        float inter = iw * ih;
        float areaA = Math.max(0f, a.right - a.left) * Math.max(0f, a.bottom - a.top);
        float areaB = Math.max(0f, b.right - b.left) * Math.max(0f, b.bottom - b.top);
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

    private static float normalizeCoord(float value) {
        if (value > 1f) {
            value /= INPUT_SIZE;
        }
        return clamp01(value);
    }

    private void fillInputFromI420(
            ByteBuffer yPlane, ByteBuffer uPlane, ByteBuffer vPlane, int width, int height) {
        inputBuffer.rewind();
        for (int dy = 0; dy < INPUT_SIZE; dy++) {
            float sy = (dy + 0.5f) * height / INPUT_SIZE - 0.5f;
            int y0 = Math.max(0, (int) Math.floor(sy));
            int y1 = Math.min(height - 1, y0 + 1);
            float wy = sy - y0;
            for (int dx = 0; dx < INPUT_SIZE; dx++) {
                float sx = (dx + 0.5f) * width / INPUT_SIZE - 0.5f;
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
