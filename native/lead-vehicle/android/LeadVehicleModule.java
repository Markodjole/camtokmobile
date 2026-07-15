package com.camtok.mobile.leadvehicle;

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
    public void addListener(String eventName) {
        // Required for RN built-in EventEmitter.
    }

    @ReactMethod
    public void removeListeners(Integer count) {
        // Required for RN built-in EventEmitter.
    }
}
