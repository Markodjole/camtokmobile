#import "TopCropVideoFrameProcessor.h"

#import <WebRTC/RTCVideoCapturer.h>
#import <WebRTC/RTCVideoFrame.h>
#import <WebRTC/RTCVideoFrameBuffer.h>
#import <objc/message.h>

static const float kTopFraction = 0.4f;

static void LeadVehicleMaybeAnalyze(RTCVideoFrame *frame) {
    Class cls = NSClassFromString(@"LeadVehicleFrameAnalyzer");
    if (cls == Nil) {
        return;
    }
    id shared = ((id(*)(id, SEL))objc_msgSend)(cls, NSSelectorFromString(@"shared"));
    if (shared == nil) {
        return;
    }
    SEL sel = NSSelectorFromString(@"maybeAnalyzeFrame:");
    if ([shared respondsToSelector:sel]) {
        ((void(*)(id, SEL, id))objc_msgSend)(shared, sel, frame);
    }
}

@implementation TopCropVideoFrameProcessor

- (RTCVideoFrame *)capturer:(RTCVideoCapturer *)capturer
      didCaptureVideoFrame:(RTCVideoFrame *)frame {
    id<RTCVideoFrameBuffer> buffer = frame.buffer;
    const int width = buffer.width;
    const int height = buffer.height;
    if (width <= 0 || height <= 0) {
        return frame;
    }

    const int rotation = frame.rotation;
    int offsetX = 0;
    int offsetY = 0;
    int cropWidth = width;
    int cropHeight = height;
    int outWidth = width;
    int outHeight = height;

    if (rotation == 90 || rotation == 270) {
        const int keepWidth = MAX(1, (int)lroundf(width * kTopFraction));
        cropHeight = height;
        outHeight = height;
        cropWidth = keepWidth;
        outWidth = keepWidth;
        offsetY = 0;
        offsetX = rotation == 90 ? 0 : width - keepWidth;
    } else {
        offsetX = 0;
        offsetY = 0;
        cropWidth = width;
        outWidth = width;
        cropHeight = MAX(1, (int)lroundf(height * kTopFraction));
        outHeight = cropHeight;
    }

    id<RTCVideoFrameBuffer> cropped =
        [buffer cropAndScaleWith:offsetX
                         offsetY:offsetY
                       cropWidth:cropWidth
                      cropHeight:cropHeight
                      scaleWidth:outWidth
                     scaleHeight:outHeight];

    RTCVideoFrame *out = [[RTCVideoFrame alloc] initWithBuffer:cropped
                                                      rotation:rotation
                                                   timeStampNs:frame.timeStampNs];
    LeadVehicleMaybeAnalyze(out);
    return out;
}

@end
