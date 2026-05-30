#import "TopCropVideoFrameProcessor.h"

#import <WebRTC/RTCVideoCapturer.h>
#import <WebRTC/RTCVideoFrame.h>
#import <WebRTC/RTCVideoFrameBuffer.h>

static const float kTopFraction = 0.5f;

@implementation TopCropVideoFrameProcessor

- (RTCVideoFrame *)capturer:(RTCVideoCapturer *)capturer
      didCaptureVideoFrame:(RTCVideoFrame *)frame {
    id<RTCVideoFrameBuffer> buffer = frame.buffer;
    const int width = buffer.width;
    const int height = buffer.height;
    if (width <= 0 || height <= 0) {
        return frame;
    }

    const int cropHeight = MAX(1, (int)lroundf(height * kTopFraction));
    id<RTCVideoFrameBuffer> cropped =
        [buffer cropAndScaleWith:0
                         offsetY:0
                       cropWidth:width
                      cropHeight:cropHeight
                      scaleWidth:width
                     scaleHeight:cropHeight];

    return [[RTCVideoFrame alloc] initWithBuffer:cropped
                                        rotation:frame.rotation
                                     timeStampNs:frame.timeStampNs];
}

@end
