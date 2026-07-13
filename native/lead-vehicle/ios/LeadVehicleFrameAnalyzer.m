#import "LeadVehicleFrameAnalyzer.h"

@implementation LeadVehicleFrameAnalyzer {
    BOOL _available;
    NSString *_statusDetail;
}

+ (instancetype)shared {
    static LeadVehicleFrameAnalyzer *instance;
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        instance = [[LeadVehicleFrameAnalyzer alloc] init];
    });
    return instance;
}

- (instancetype)init {
    self = [super init];
    if (self) {
        _enabled = NO;
        _available = NO;
        _statusDetail = @"ios_tflite_pending";
    }
    return self;
}

- (BOOL)isAvailable {
    return _available;
}

- (NSString *)statusDetail {
    return _statusDetail ?: @"unknown";
}

- (void)ensureInitialized {
    NSString *path = [[NSBundle mainBundle] pathForResource:@"coco_ssd_mobilenet_v1"
                                                     ofType:@"tflite"
                                                inDirectory:@"models"];
    if (path.length == 0) {
        path = [[NSBundle mainBundle] pathForResource:@"coco_ssd_mobilenet_v1" ofType:@"tflite"];
    }
    if (path.length == 0) {
        _available = NO;
        _statusDetail = @"model_missing";
        return;
    }
    // Android ships the live TFLite path first. iOS interpreter (TensorFlowLiteObjC)
    // lands in a follow-up once the CocoaPod is linked via prebuild.
    _available = NO;
    _statusDetail = @"ios_interpreter_not_linked";
}

- (void)maybeAnalyzeFrame:(RTCVideoFrame *)frame {
    if (!self.enabled || !_available || frame == nil) {
        return;
    }
}

- (void)dispose {
    self.enabled = NO;
    _available = NO;
    _statusDetail = @"disposed";
}

@end
