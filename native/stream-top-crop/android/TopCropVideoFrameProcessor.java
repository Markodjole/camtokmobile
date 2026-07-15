package com.camtok.mobile.streamcrop;

import com.camtok.mobile.leadvehicle.LeadVehicleFrameAnalyzer;
import com.oney.WebRTCModule.videoEffects.VideoFrameProcessor;

import org.webrtc.SurfaceTextureHelper;
import org.webrtc.VideoFrame;

/**
 * Streams the full camera frame (no crop) so viewers see the whole scene and
 * vehicle detection covers every vehicle in view. Runs lead-vehicle detection
 * on the exact frame that is streamed so overlay boxes align 1:1 with the video.
 */
public class TopCropVideoFrameProcessor implements VideoFrameProcessor {
    @Override
    public VideoFrame process(VideoFrame frame, SurfaceTextureHelper textureHelper) {
        VideoFrame.Buffer buffer = frame.getBuffer();
        if (buffer.getWidth() <= 0 || buffer.getHeight() <= 0) {
            return frame;
        }
        // Detect on the full streamed frame; pass it through unchanged. We must
        // return a frame that owns its own buffer reference — returning the input
        // frame directly double-frees its buffer (refcount < 1 crash), so retain
        // the buffer and wrap it in a new VideoFrame the pipeline can release.
        LeadVehicleFrameAnalyzer.getInstance().maybeAnalyze(frame);
        buffer.retain();
        return new VideoFrame(buffer, frame.getRotation(), frame.getTimestampNs());
    }
}
