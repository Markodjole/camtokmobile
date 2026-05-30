package com.camtok.mobile.streamcrop;

import com.oney.WebRTCModule.videoEffects.VideoFrameProcessor;

import org.webrtc.SurfaceTextureHelper;
import org.webrtc.VideoFrame;

/** Keeps the top 50% of each frame; bottom half is not encoded or sent. */
public class TopCropVideoFrameProcessor implements VideoFrameProcessor {
    private static final float TOP_FRACTION = 0.5f;

    @Override
    public VideoFrame process(VideoFrame frame, SurfaceTextureHelper textureHelper) {
        VideoFrame.Buffer buffer = frame.getBuffer();
        final int width = buffer.getWidth();
        final int height = buffer.getHeight();
        if (width <= 0 || height <= 0) {
            return frame;
        }

        final int cropHeight = Math.max(1, Math.round(height * TOP_FRACTION));
        VideoFrame.Buffer cropped = buffer.cropAndScale(
                0, 0, width, cropHeight, width, cropHeight);
        return new VideoFrame(cropped, frame.getRotation(), frame.getTimestampNs());
    }
}
