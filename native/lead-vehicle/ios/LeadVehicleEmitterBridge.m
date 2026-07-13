#import "LeadVehicleEmitterBridge.h"

@implementation LeadVehicleEmitterBridge

static __weak RCTEventEmitter *sEmitter;

+ (void)setEmitter:(RCTEventEmitter *)emitter {
    sEmitter = emitter;
}

+ (void)emit:(NSString *)name body:(id)body {
    RCTEventEmitter *emitter = sEmitter;
    if (emitter != nil) {
        [emitter sendEventWithName:name body:body];
    }
}

@end
