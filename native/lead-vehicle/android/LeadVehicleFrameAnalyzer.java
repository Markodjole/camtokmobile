package com.camtok.mobile.leadvehicle;

import android.content.Context;
import android.content.res.AssetFileDescriptor;
import android.util.Log;

import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.WritableArray;
import com.facebook.react.bridge.WritableMap;

import org.tensorflow.lite.Interpreter;
import org.webrtc.VideoFrame;

import java.io.FileInputStream;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.MappedByteBuffer;
import java.nio.channels.FileChannel;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Quantized COCO SSD MobileNet v1 (300×300) on WebRTC frames.
 * Runs off the capture thread; newest-frame-wins when busy.
 */
public final class LeadVehicleFrameAnalyzer {
    private static final String TAG = "LeadVehicleDetect";
    private static final String MODEL_ASSET = "models/coco_ssd_mobilenet_v1.tflite";
    private static final int INPUT_SIZE = 300;
    private static final int NUM_DETECTIONS = 10;
    private static final float MIN_SCORE = 0.55f;
    /** ~18 FPS — enough samples; confidence gate is what blocks hallucinations. */
    private static final long MIN_INTERVAL_MS = 55L;

    /** COCO label indices we care about (1-based in labelmap; 0 = ???). */
    private static final int CLASS_BICYCLE = 2;
    private static final int CLASS_CAR = 3;
    private static final int CLASS_MOTORCYCLE = 4;
    private static final int CLASS_BUS = 6;
    private static final int CLASS_TRUCK = 8;

    private static final LeadVehicleFrameAnalyzer INSTANCE = new LeadVehicleFrameAnalyzer();

    private final ExecutorService executor =
            Executors.newSingleThreadExecutor(
                    r -> {
                        Thread t = new Thread(r, "lead-vehicle-tflite");
                        t.setPriority(Thread.NORM_PRIORITY - 1);
                        return t;
                    });
    private final AtomicBoolean busy = new AtomicBoolean(false);
    private final Object interpreterLock = new Object();
  /** If inference wedges, recover so analysis does not stop permanently. */
    private static final long BUSY_WATCHDOG_MS = 2500L;

    private volatile long busySinceMs = 0;
    private volatile boolean enabled = false;
    private volatile boolean available = false;
    private volatile String statusDetail = "uninitialized";
    private Interpreter interpreter;
    private ByteBuffer inputBuffer;
    private long lastInferAtMs = 0;

    private LeadVehicleFrameAnalyzer() {}

    public static LeadVehicleFrameAnalyzer getInstance() {
        return INSTANCE;
    }

    public synchronized void ensureInitialized(Context context) {
        if (interpreter != null) {
            return;
        }
        try {
            MappedByteBuffer model = loadModelFile(context.getApplicationContext());
            Interpreter.Options options = new Interpreter.Options();
            options.setNumThreads(2);
            interpreter = new Interpreter(model, options);
            inputBuffer = ByteBuffer.allocateDirect(INPUT_SIZE * INPUT_SIZE * 3);
            inputBuffer.order(ByteOrder.nativeOrder());
            available = true;
            statusDetail = "ready";
            Log.i(TAG, "TFLite model loaded (" + MODEL_ASSET + ")");
        } catch (Exception e) {
            available = false;
            statusDetail = e.getMessage() != null ? e.getMessage() : "init_failed";
            Log.e(TAG, "Failed to load TFLite model", e);
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
     * Schedule analysis of the (already cropped) outgoing stream frame.
     * Must not block the WebRTC capture path.
     */
    public void maybeAnalyze(VideoFrame frame) {
        if (!enabled || !available || interpreter == null) {
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
        final int rotation = frame.getRotation();
        final long timestampMs = frame.getTimestampNs() / 1_000_000L;
        final ByteBuffer y = copyPlane(i420.getDataY(), i420.getStrideY(), width, height);
        final ByteBuffer u = copyPlane(i420.getDataU(), i420.getStrideU(), (width + 1) / 2, (height + 1) / 2);
        final ByteBuffer v = copyPlane(i420.getDataV(), i420.getStrideV(), (width + 1) / 2, (height + 1) / 2);
        i420.release();

        try {
            executor.execute(
                    () -> {
                        try {
                            runInference(y, u, v, width, height, rotation, timestampMs);
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
            long timestampMs) {
        long t0 = System.currentTimeMillis();
        fillInputFromI420(y, u, v, width, height);
        float[][][] boxes = new float[1][NUM_DETECTIONS][4];
        float[][] classes = new float[1][NUM_DETECTIONS];
        float[][] scores = new float[1][NUM_DETECTIONS];
        float[] count = new float[1];

        Object[] inputs = {inputBuffer};
        java.util.Map<Integer, Object> outputs = new java.util.HashMap<>();
        outputs.put(0, boxes);
        outputs.put(1, classes);
        outputs.put(2, scores);
        outputs.put(3, count);

        synchronized (interpreterLock) {
            if (interpreter == null) return;
            interpreter.runForMultipleInputsOutputs(inputs, outputs);
        }

        long durationMs = System.currentTimeMillis() - t0;
        WritableArray detections = Arguments.createArray();
        int n = Math.min(NUM_DETECTIONS, Math.max(0, (int) count[0]));
        for (int i = 0; i < n; i++) {
            float score = scores[0][i];
            if (score < MIN_SCORE) continue;
            int classId = (int) classes[0][i] + 1; // model outputs 0-based class index
            String vehicleType = mapClass(classId);
            if (vehicleType == null) continue;

            // Boxes: [ymin, xmin, ymax, xmax] normalized to the 300×300 input
            float ymin = clamp01(boxes[0][i][0]);
            float xmin = clamp01(boxes[0][i][1]);
            float ymax = clamp01(boxes[0][i][2]);
            float xmax = clamp01(boxes[0][i][3]);
            // Input was filled in display orientation (rotation applied), so box is display NDC.
            WritableMap det = Arguments.createMap();
            det.putString("vehicleType", vehicleType);
            det.putDouble("confidence", score);
            WritableMap box = Arguments.createMap();
            box.putDouble("x", xmin);
            box.putDouble("y", ymin);
            box.putDouble("width", Math.max(0, xmax - xmin));
            box.putDouble("height", Math.max(0, ymax - ymin));
            det.putMap("boundingBox", box);
            detections.pushMap(det);
        }

        WritableMap payload = Arguments.createMap();
        payload.putDouble("timestampMs", timestampMs > 0 ? timestampMs : System.currentTimeMillis());
        payload.putDouble("inferenceDurationMs", durationMs);
        payload.putInt("frameWidth", width);
        payload.putInt("frameHeight", height);
        payload.putInt("rotationDegrees", rotation);
        payload.putArray("detections", detections);
        LeadVehicleEmitter.emit("LeadVehicleDetections", payload);
    }

    private static String mapClass(int cocoLabelIndex) {
        switch (cocoLabelIndex) {
            case CLASS_CAR:
                return "car";
            case CLASS_MOTORCYCLE:
                return "motorcycle";
            case CLASS_BUS:
                return "bus";
            case CLASS_TRUCK:
                return "truck";
            case CLASS_BICYCLE:
                return "bicycle";
            default:
                return null;
        }
    }

    private void fillInputFromI420(
            ByteBuffer yPlane, ByteBuffer uPlane, ByteBuffer vPlane, int width, int height) {
        inputBuffer.rewind();
        for (int dy = 0; dy < INPUT_SIZE; dy++) {
            int sy = dy * height / INPUT_SIZE;
            for (int dx = 0; dx < INPUT_SIZE; dx++) {
                int sx = dx * width / INPUT_SIZE;
                int yIndex = sy * width + sx;
                int uvIndex = (sy / 2) * ((width + 1) / 2) + (sx / 2);
                int y = yPlane.get(yIndex) & 0xff;
                int u = uPlane.get(uvIndex) & 0xff;
                int v = vPlane.get(uvIndex) & 0xff;
                // BT.601 full-range-ish YUV → RGB
                int c = y - 16;
                int d = u - 128;
                int e = v - 128;
                int r = clampByte((298 * c + 409 * e + 128) >> 8);
                int g = clampByte((298 * c - 100 * d - 208 * e + 128) >> 8);
                int b = clampByte((298 * c + 516 * d + 128) >> 8);
                inputBuffer.put((byte) r);
                inputBuffer.put((byte) g);
                inputBuffer.put((byte) b);
            }
        }
        inputBuffer.rewind();
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

    private static MappedByteBuffer loadModelFile(Context context) throws IOException {
        AssetFileDescriptor fd = context.getAssets().openFd(MODEL_ASSET);
        FileInputStream inputStream = new FileInputStream(fd.getFileDescriptor());
        FileChannel fileChannel = inputStream.getChannel();
        long startOffset = fd.getStartOffset();
        long declaredLength = fd.getDeclaredLength();
        MappedByteBuffer mapped =
                fileChannel.map(FileChannel.MapMode.READ_ONLY, startOffset, declaredLength);
        inputStream.close();
        fd.close();
        return mapped;
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
        synchronized (interpreterLock) {
            if (interpreter != null) {
                interpreter.close();
                interpreter = null;
            }
        }
        available = false;
        statusDetail = "disposed";
    }
}
