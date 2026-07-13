#import <React/RCTEventEmitter.h>

NS_ASSUME_NONNULL_BEGIN

@interface LeadVehicleEmitterBridge : NSObject
+ (void)setEmitter:(RCTEventEmitter * _Nullable)emitter;
+ (void)emit:(NSString *)name body:(id)body;
@end

NS_ASSUME_NONNULL_END
