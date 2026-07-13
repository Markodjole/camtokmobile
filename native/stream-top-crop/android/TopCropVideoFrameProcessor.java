package com.camtok.mobile.streamcrop;

import com.camtok.mobile.leadvehicle.LeadVehicleFrameAnalyzer;
import com.oney.WebRTCModule.videoEffects.VideoFrameProcessor;

import org.webrtc.SurfaceTextureHelper;
import org.webrtc.VideoFrame;

/**
 * Keeps the top 40% of the frame in display orientation at full width (bottom 60% cut).
 * On phones the buffer is often landscape with rotation 90/270 — cropping buffer
 * height would trim the wide horizontal FOV, so we crop the buffer axis that maps
 * to display height instead.
 *
 * When lead-vehicle detection is enabled, runs TFLite on the cropped outgoing frame
 * off-thread (never opens a second camera).
 */
public class TopCropVideoFrameProcessor implements VideoFrameProcessor {
    private static final float TOP_FRACTION = 0.4f;

    @Override
    public VideoFrame process(VideoFrame frame, SurfaceTextureHelper textureHelper) {
        VideoFrame.Buffer buffer = frame.getBuffer();
        final int width = buffer.getWidth();
        final int height = buffer.getHeight();
        if (width <= 0 || height <= 0) {
            return frame;
        }

        final int rotation = frame.getRotation();
        final int offsetX;
        final int offsetY;
        final int cropWidth;
        final int cropHeight;
        final int outWidth;
        final int outHeight;

        if (rotation == 90 || rotation == 270) {
            // Buffer width → display height. Trim bottom 60% of display by cropping buffer width.
            final int keepWidth = Math.max(1, Math.round(width * TOP_FRACTION));
            cropHeight = height;
            outHeight = height;
            if (rotation == 90) {
                offsetX = 0;
                cropWidth = keepWidth;
                outWidth = keepWidth;
            } else {
                offsetX = width - keepWidth;
                cropWidth = keepWidth;
                outWidth = keepWidth;
            }
            offsetY = 0;
        } else {
            // Buffer height → display height. Trim bottom 60% by cropping buffer height.
            offsetX = 0;
            offsetY = 0;
            cropWidth = width;
            outWidth = width;
            cropHeight = Math.max(1, Math.round(height * TOP_FRACTION));
            outHeight = cropHeight;
        }

        VideoFrame.Buffer cropped = buffer.cropAndScale(
                offsetX, offsetY, cropWidth, cropHeight, outWidth, outHeight);
        VideoFrame out = new VideoFrame(cropped, rotation, frame.getTimestampNs());
        LeadVehicleFrameAnalyzer.getInstance().maybeAnalyze(out);
        return out;
    }
}
