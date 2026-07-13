package com.camtok.mobile.leadvehicle;

import androidx.annotation.Nullable;

import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.modules.core.DeviceEventManagerModule;

/**
 * Holds a weak handle to the React context so the WebRTC frame processor
 * (no React refs) can emit detection events to JS.
 */
public final class LeadVehicleEmitter {
    private static volatile ReactApplicationContext reactContext;

    private LeadVehicleEmitter() {}

    public static void attach(ReactApplicationContext context) {
        reactContext = context;
    }

    public static void detach(ReactApplicationContext context) {
        if (reactContext == context) {
            reactContext = null;
        }
    }

    @Nullable
    public static ReactApplicationContext getContext() {
        return reactContext;
    }

    public static void emit(String eventName, WritableMap params) {
        ReactApplicationContext ctx = reactContext;
        if (ctx == null || !ctx.hasActiveReactInstance()) {
            return;
        }
        ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
                .emit(eventName, params);
    }
}
