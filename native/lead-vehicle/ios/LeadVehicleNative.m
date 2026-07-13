#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

#import "LeadVehicleEmitterBridge.h"
#import "LeadVehicleFrameAnalyzer.h"

@interface LeadVehicleNative : RCTEventEmitter <RCTBridgeModule>
@end

@implementation LeadVehicleNative

RCT_EXPORT_MODULE(LeadVehicleNative);

+ (BOOL)requiresMainQueueSetup {
    return YES;
}

- (NSArray<NSString *> *)supportedEvents {
    return @[ @"LeadVehicleDetections" ];
}

- (void)startObserving {
    [LeadVehicleEmitterBridge setEmitter:self];
}

- (void)stopObserving {
    [LeadVehicleEmitterBridge setEmitter:nil];
}

RCT_EXPORT_METHOD(isAvailable:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
    [[LeadVehicleFrameAnalyzer shared] ensureInitialized];
    resolve(@([[LeadVehicleFrameAnalyzer shared] isAvailable]));
}

RCT_EXPORT_METHOD(getStatus:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
    LeadVehicleFrameAnalyzer *a = [LeadVehicleFrameAnalyzer shared];
    [a ensureInitialized];
    resolve(@{
        @"available": @(a.isAvailable),
        @"enabled": @(a.isEnabled),
        @"detail": a.statusDetail ?: @"",
        @"modelName": @"coco_ssd_mobilenet_v1",
        @"modelVersion": @"1.0_quant_2018_06_29",
    });
}

RCT_EXPORT_METHOD(setEnabled:(BOOL)enabled
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
    LeadVehicleFrameAnalyzer *a = [LeadVehicleFrameAnalyzer shared];
    [a ensureInitialized];
    if (enabled && !a.isAvailable) {
        reject(@"E_UNAVAILABLE", a.statusDetail, nil);
        return;
    }
    a.enabled = enabled;
    resolve([NSNull null]);
}

@end
