#import "StreamTopCropRegistration.h"

#import "ProcessorProvider.h"
#import "TopCropVideoFrameProcessor.h"

@implementation StreamTopCropRegistration

+ (void)registerEffect {
    TopCropVideoFrameProcessor *processor = [[TopCropVideoFrameProcessor alloc] init];
    [ProcessorProvider addProcessor:processor forName:@"stream-top-crop"];
}

+ (void)load {
    [self registerEffect];
}

@end
