#import <Foundation/Foundation.h>
#import <WebRTC/RTCVideoFrame.h>

NS_ASSUME_NONNULL_BEGIN

/**
 * iOS on-device vehicle detector.
 * TFLite wiring lands with the lead-vehicle Expo plugin + TensorFlowLiteObjC pod.
 * Until the interpreter loads successfully, reports unavailable and no-ops on frames.
 */
@interface LeadVehicleFrameAnalyzer : NSObject

+ (instancetype)shared;

@property (nonatomic, assign, getter=isEnabled) BOOL enabled;
@property (nonatomic, readonly, getter=isAvailable) BOOL available;
@property (nonatomic, readonly, copy) NSString *statusDetail;

- (void)ensureInitialized;
- (void)maybeAnalyzeFrame:(RTCVideoFrame *)frame;
- (void)dispose;

@end

NS_ASSUME_NONNULL_END
