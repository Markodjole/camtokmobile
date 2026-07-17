package com.camtok.mobile.leadvehicle;

import android.content.Context;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.PowerManager;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.bridge.Arguments;
import com.facebook.react.module.annotations.ReactModule;

@ReactModule(name = LeadVehicleModule.NAME)
public class LeadVehicleModule extends ReactContextBaseJavaModule {
    public static final String NAME = "LeadVehicleNative";

    private final ReactApplicationContext reactContext;

    public LeadVehicleModule(ReactApplicationContext reactContext) {
        super(reactContext);
        this.reactContext = reactContext;
        LeadVehicleEmitter.attach(reactContext);
        LeadVehicleFrameAnalyzer.getInstance().ensureInitialized(reactContext);
    }

    @Override
    @NonNull
    public String getName() {
        return NAME;
    }

    @Override
    public void invalidate() {
        LeadVehicleEmitter.detach(reactContext);
        LeadVehicleFrameAnalyzer.getInstance().setEnabled(false);
        try {
            if (wifiLock != null && wifiLock.isHeld()) wifiLock.release();
            if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        } catch (Exception ignored) {
            // releasing best-effort on teardown
        }
        super.invalidate();
    }

    @ReactMethod
    public void isAvailable(Promise promise) {
        LeadVehicleFrameAnalyzer analyzer = LeadVehicleFrameAnalyzer.getInstance();
        analyzer.ensureInitialized(reactContext);
        promise.resolve(analyzer.isAvailable());
    }

    @ReactMethod
    public void getStatus(Promise promise) {
        LeadVehicleFrameAnalyzer analyzer = LeadVehicleFrameAnalyzer.getInstance();
        analyzer.ensureInitialized(reactContext);
        WritableMap map = Arguments.createMap();
        map.putBoolean("available", analyzer.isAvailable());
        map.putBoolean("enabled", analyzer.isEnabled());
        map.putString("detail", analyzer.getStatusDetail());
        map.putString("modelName", "efficientdet_lite0");
        map.putString("modelVersion", "1.0_quant_2018_06_29");
        promise.resolve(map);
    }

    @ReactMethod
    public void setEnabled(boolean enabled, Promise promise) {
        LeadVehicleFrameAnalyzer analyzer = LeadVehicleFrameAnalyzer.getInstance();
        analyzer.ensureInitialized(reactContext);
        if (enabled && !analyzer.isAvailable()) {
            promise.reject("E_UNAVAILABLE", analyzer.getStatusDetail());
            return;
        }
        analyzer.setEnabled(enabled);
        promise.resolve(null);
    }

    @ReactMethod
    public void setSamplingEnabled(boolean enabled, Promise promise) {
        LeadVehicleFrameAnalyzer.getInstance().setSamplingEnabled(enabled);
        promise.resolve(null);
    }

    private WifiManager.WifiLock wifiLock;
    private PowerManager.WakeLock wakeLock;

    /**
     * Hold high-performance network + CPU locks while broadcasting. Vendor
     * power management (HyperOS etc.) batches WiFi transmissions to save
     * power, which real-time video reads as periodic 100-200ms delay spikes
     * and collapses the bitrate — even on flagship hardware. A foreground
     * streaming app is expected to hold these locks; no user settings needed.
     */
    @ReactMethod
    public void setHighPerfNetwork(boolean enabled, Promise promise) {
        try {
            if (enabled) {
                if (wifiLock == null) {
                    WifiManager wm =
                            (WifiManager)
                                    reactContext
                                            .getApplicationContext()
                                            .getSystemService(Context.WIFI_SERVICE);
                    int mode =
                            Build.VERSION.SDK_INT >= 29
                                    ? WifiManager.WIFI_MODE_FULL_LOW_LATENCY
                                    : WifiManager.WIFI_MODE_FULL_HIGH_PERF;
                    wifiLock = wm.createWifiLock(mode, "camtok:broadcast");
                    wifiLock.setReferenceCounted(false);
                }
                wifiLock.acquire();
                if (wakeLock == null) {
                    PowerManager pm =
                            (PowerManager)
                                    reactContext
                                            .getApplicationContext()
                                            .getSystemService(Context.POWER_SERVICE);
                    wakeLock =
                            pm.newWakeLock(
                                    PowerManager.PARTIAL_WAKE_LOCK, "camtok:broadcast");
                    wakeLock.setReferenceCounted(false);
                }
                wakeLock.acquire();
            } else {
                if (wifiLock != null && wifiLock.isHeld()) wifiLock.release();
                if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
            }
            promise.resolve(null);
        } catch (Exception e) {
            promise.reject("E_NET_LOCK", e.getMessage());
        }
    }

    @ReactMethod
    public void addListener(String eventName) {
        // Required for RN built-in EventEmitter.
    }

    @ReactMethod
    public void removeListeners(Integer count) {
        // Required for RN built-in EventEmitter.
    }
}
