package com.camtok.mobile.streamcrop;

import com.oney.WebRTCModule.videoEffects.ProcessorProvider;
import com.oney.WebRTCModule.videoEffects.VideoFrameProcessorFactoryInterface;

public final class StreamTopCropRegistration {
    public static final String EFFECT_NAME = "stream-top-crop";

    private StreamTopCropRegistration() {}

    public static void register() {
        ProcessorProvider.addProcessor(
                EFFECT_NAME,
                new VideoFrameProcessorFactoryInterface() {
                    @Override
                    public com.oney.WebRTCModule.videoEffects.VideoFrameProcessor build() {
                        return new TopCropVideoFrameProcessor();
                    }
                });
    }
}
