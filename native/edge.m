#import <AppKit/AppKit.h>
#import <math.h>

static NSRect shelfFrame(NSRect visible, NSInteger side) {
    CGFloat width = MIN(460, MAX(0, visible.size.width - 12));
    CGFloat height = MIN(620, MAX(0, visible.size.height - 12));
    return NSMakeRect(side == 1 ? NSMinX(visible) + 6 : NSMaxX(visible) - width - 6,
                      NSMidY(visible) - height / 2, width, height);
}

static NSRect edgeBand(NSRect visible, NSInteger side) {
    CGFloat height = MIN(700, visible.size.height);
    return NSMakeRect(side == 1 ? NSMinX(visible) : NSMaxX(visible) - 30,
                      NSMidY(visible) - height / 2, 30, height);
}

@interface BuddyMacEdge : NSObject
@property(nonatomic, weak) NSWindow *window;
@property(nonatomic, strong) NSTimer *timer;
@property(nonatomic, strong) NSNumber *displayID;
@property(nonatomic) NSInteger side;
@property(nonatomic) BOOL pinned;
@property(nonatomic) BOOL autoShow;
@property(nonatomic) BOOL onlyFiles;
@property(nonatomic) BOOL filesActive;
@property(nonatomic) BOOL active;
@property(nonatomic) BOOL revealed;
@property(nonatomic) BOOL requested;
@property(nonatomic) BOOL dismissed;
@property(nonatomic) double holdDelay;
@property(nonatomic) NSTimeInterval lastInside;
@property(nonatomic) NSTimeInterval downSince;
@property(nonatomic) NSPoint downPoint;
@property(nonatomic) BOOL suppressDrag;
@property(nonatomic) BOOL notifiedDrag;
@property(nonatomic) NSInteger pasteboardSeed;
@end

@implementation BuddyMacEdge
- (NSScreen *)screenAt:(NSPoint)point {
    for (NSScreen *screen in NSScreen.screens) if (NSPointInRect(point, screen.frame)) return screen;
    return self.window.screen ?: NSScreen.mainScreen ?: NSScreen.screens.firstObject;
}
- (NSScreen *)attachedScreen {
    for (NSScreen *screen in NSScreen.screens) if ([screen.deviceDescription[@"NSScreenNumber"] isEqual:self.displayID]) return screen;
    return [self screenAt:NSEvent.mouseLocation];
}
- (void)revealOn:(NSScreen *)screen {
    if (!screen || !self.active) return;
    self.displayID = screen.deviceDescription[@"NSScreenNumber"];
    // React prepares the shelf before the panel controller presents the window.
    self.requested = YES;
    self.dismissed = NO;
    self.lastInside = NSDate.timeIntervalSinceReferenceDate;
}
- (void)didDismiss:(NSNotification *)notification {
    if (notification.object == self.window) { self.dismissed = YES; self.revealed = NO; self.requested = NO; }
}
- (void)reconcile {
    if (!self.window) {
        for (NSWindow *candidate in NSApp.windows) {
            if ([candidate.title isEqualToString:@"BuddyMac"] && ![candidate isKindOfClass:NSPanel.class]) { self.window = candidate; break; }
        }
    }
    if (!self.window) return;
    BOOL next = self.side != 0 && self.filesActive;
    if (next && !self.active) {
        self.active = YES;
        self.revealed = NO;
        self.dismissed = NO;
        if (self.pinned) [self revealOn:[self screenAt:NSEvent.mouseLocation]];
    } else if (!next && self.active) {
        self.active = NO;
        self.revealed = NO;
        self.requested = NO;
    }
}
- (void)tick {
    [self reconcile];
    if (!self.active) return;
    if (self.requested) return;
    NSPoint point = NSEvent.mouseLocation;
    NSScreen *screen = [self screenAt:point];
    if (!screen) return;
    NSTimeInterval now = NSDate.timeIntervalSinceReferenceDate;
    BOOL down = (NSEvent.pressedMouseButtons & 1) != 0;
    NSPasteboard *board = [NSPasteboard pasteboardWithName:NSPasteboardNameDrag];
    if (down && self.downSince == 0) {
        self.downSince = now;
        self.downPoint = point;
        self.suppressDrag = self.window.visible && NSPointInRect(point, self.window.frame);
        self.notifiedDrag = NO;
    }
    if (!down) {
        self.downSince = 0;
        self.notifiedDrag = NO;
        self.pasteboardSeed = board.changeCount;
    }
    BOOL movingDrag = down && hypot(point.x - self.downPoint.x, point.y - self.downPoint.y) > 12;
    BOOL fileDrag = board.changeCount != self.pasteboardSeed && [board.types containsObject:NSPasteboardTypeFileURL];
    if (movingDrag && (fileDrag || !self.onlyFiles) && self.autoShow && !self.suppressDrag && !self.notifiedDrag && now - self.downSince >= self.holdDelay) {
        self.notifiedDrag = YES;
        [self revealOn:screen];
    }
    if (!self.window.visible) self.revealed = NO;
    if (!self.revealed) {
        BOOL nearEdge = NSPointInRect(point, edgeBand(screen.visibleFrame, self.side));
        if (self.dismissed) {
            if (!nearEdge) self.dismissed = NO;
            return;
        }
        if (nearEdge) [self revealOn:screen];
        return;
    }
    NSScreen *attached = [self attachedScreen];
    if (![attached.deviceDescription[@"NSScreenNumber"] isEqual:self.displayID]) {
        [self revealOn:attached];
    }
    BOOL inside = NSPointInRect(point, NSInsetRect(self.window.frame, -10, -10))
        || ([screen.deviceDescription[@"NSScreenNumber"] isEqual:self.displayID] && NSPointInRect(point, edgeBand(screen.visibleFrame, self.side)));
    if (inside || movingDrag) self.lastInside = now;
    if (!inside && !down && !self.pinned && now - self.lastInside > 0.55) {
        [self.window orderOut:nil];
        self.revealed = NO;
    }
}
@end

static BuddyMacEdge *edge;
static NSString *stateJSON;

static void installEdge(void) {
    if (edge) return;
    edge = [BuddyMacEdge new];
    edge.holdDelay = 0.8;
    edge.autoShow = YES;
    edge.onlyFiles = YES;
    [NSNotificationCenter.defaultCenter addObserver:edge selector:@selector(didDismiss:) name:@"BuddyMacWindowDismissed" object:nil];
    edge.pasteboardSeed = [NSPasteboard pasteboardWithName:NSPasteboardNameDrag].changeCount;
    edge.timer = [NSTimer timerWithTimeInterval:0.05 target:edge selector:@selector(tick) userInfo:nil repeats:YES];
    [NSRunLoop.mainRunLoop addTimer:edge.timer forMode:NSRunLoopCommonModes];
}

void buddymac_edge_configure(int side, bool pinned, bool autoShow, double delay, bool onlyFiles) {
    installEdge();
    NSInteger oldSide = edge.side;
    edge.side = side >= 0 && side <= 2 ? side : 0;
    edge.pinned = pinned;
    edge.autoShow = autoShow;
    edge.onlyFiles = onlyFiles;
    edge.holdDelay = MIN(3, MAX(0.2, delay));
    [edge reconcile];
    if (edge.active && (oldSide != edge.side || pinned)) [edge revealOn:[edge attachedScreen]];
}

void buddymac_edge_files_active(bool active) {
    installEdge();
    edge.filesActive = active;
    [edge reconcile];
}

void buddymac_edge_show(void) {
    installEdge();
    [edge revealOn:[edge screenAt:NSEvent.mouseLocation]];
}

void buddymac_edge_presented(void) {
    edge.requested = NO;
    edge.revealed = YES;
    edge.lastInside = NSDate.timeIntervalSinceReferenceDate;
}

int buddymac_edge_side(void) { return (int)edge.side; }

const char *buddymac_edge_state(void) {
    NSDictionary *state = @{@"active": @(edge.active), @"revealed": @(edge.revealed), @"requested": @(edge.requested), @"side": @(edge.side)};
    NSData *data = [NSJSONSerialization dataWithJSONObject:state options:0 error:nil];
    stateJSON = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
    return stateJSON.UTF8String;
}

#ifdef BUDDYMAC_EDGE_TEST_MAIN
int main(void) {
    @autoreleasepool {
        NSArray<NSValue *> *screens = @[[NSValue valueWithRect:NSMakeRect(0, 25, 1440, 875)],
            [NSValue valueWithRect:NSMakeRect(-1920, 0, 1920, 1080)], [NSValue valueWithRect:NSMakeRect(1440, 0, 800, 500)]];
        for (NSValue *value in screens) for (NSInteger side = 1; side <= 2; side++) {
            NSRect visible = value.rectValue;
            NSCAssert(NSContainsRect(visible, shelfFrame(visible, side)), @"Shelf escapes its display");
            NSCAssert(NSContainsRect(visible, edgeBand(visible, side)), @"Hover band escapes its display");
        }
        puts("PASS: left/right shelf and hover geometry on three display layouts");
    }
    return 0;
}
#endif
