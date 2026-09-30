#import <AppKit/AppKit.h>

static NSRect panelFrame(NSRect screen, NSRect visible, CGFloat safeTop, int mode) {
    CGFloat top = MIN(NSMaxY(visible), NSMaxY(screen) - MAX(0, safeTop));
    CGFloat width = MIN(mode == 1 ? 380 : 420, MAX(0, visible.size.width - 16));
    CGFloat height = MIN(mode == 1 ? 150 : 210, MAX(0, top - NSMinY(visible) - 16));
    CGFloat x = MIN(MAX(NSMidX(screen) - width / 2, NSMinX(visible) + 8), NSMaxX(visible) - width - 8);
    return NSMakeRect(x, MAX(NSMinY(visible) + 8, top - height - 8), width, height);
}

static NSRect sidebarFrame(NSRect visible, int edge) {
    NSRect inset = NSInsetRect(visible, 12, 12);
    CGFloat width = MIN(480, MAX(0, inset.size.width));
    return NSMakeRect(edge == 1 ? NSMinX(inset) : NSMaxX(inset) - width, NSMinY(inset), width, inset.size.height);
}

// NotchFlow's hover panel geometry: 52% of the display, 860 to 1100 points wide, hanging from the menu bar.
static NSRect notchFrame(NSRect screen, NSRect visible) {
    CGFloat width = MIN(MIN(MAX(visible.size.width * 0.52, 860), 1100), MAX(0, visible.size.width - 32));
    CGFloat height = MIN(MIN(MAX(screen.size.height * 0.70, 500), 620), MAX(0, visible.size.height - 8));
    CGFloat x = MIN(MAX(NSMidX(screen) - width / 2, NSMinX(screen) + 16), NSMaxX(screen) - width - 16);
    return NSMakeRect(x, NSMaxY(visible) - height, width, height);
}

static __weak NSWindow *panelWindow;
static BOOL originalTitlebarTransparent;
static NSWindowTitleVisibility originalTitleVisibility;
static int panelMode;
static int sidebarEdge = 2;
static NSRect originalFrame;
static NSSize originalMinSize;
static NSSize originalMaxSize;
static NSWindowStyleMask originalStyle;
static NSWindowCollectionBehavior originalBehavior;
static NSInteger originalLevel;
static BOOL originalMovable;
static BOOL originalMovableByBackground;
static BOOL originalHidesOnDeactivate;

static NSWindow *buddyWindow(void) {
    if (panelWindow) return panelWindow;
    for (NSWindow *window in NSApp.windows) {
        if ([window.title isEqualToString:@"BuddyMac"] && ![window isKindOfClass:NSPanel.class]) return window;
    }
    return nil;
}

static void setChrome(NSWindow *window, BOOL hidden) {
    window.titlebarAppearsTransparent = hidden ? YES : originalTitlebarTransparent;
    window.titleVisibility = hidden ? NSWindowTitleHidden : originalTitleVisibility;
    for (NSNumber *kind in @[@(NSWindowCloseButton), @(NSWindowMiniaturizeButton), @(NSWindowZoomButton)]) {
        [window standardWindowButton:(NSWindowButton)kind.integerValue].hidden = hidden;
    }
}

static void restore(NSWindow *window, BOOL display) {
    window.styleMask = originalStyle;
    setChrome(window, NO);
    window.minSize = originalMinSize;
    window.maxSize = originalMaxSize;
    window.collectionBehavior = originalBehavior;
    window.level = originalLevel;
    window.movable = originalMovable;
    window.movableByWindowBackground = originalMovableByBackground;
    window.hidesOnDeactivate = originalHidesOnDeactivate;
    [window setFrame:originalFrame display:display];
    panelMode = 0;
}

static NSScreen *pointerScreen(NSWindow *window) {
    NSPoint pointer = NSEvent.mouseLocation;
    for (NSScreen *screen in NSScreen.screens) if (NSPointInRect(pointer, screen.frame)) return screen;
    return window.screen ?: NSScreen.mainScreen ?: NSScreen.screens.firstObject;
}

int buddymac_panel_mode(int mode) {
    if (mode < 0 || mode > 4) return -1;
    NSWindow *window = buddyWindow();
    if (!window) return -2;
    if ((window.styleMask & NSWindowStyleMaskFullScreen) != 0) return -3;
    if (mode == 0) {
        if (panelMode == 0) return 1;
        restore(window, YES);
        [window orderFront:nil];
        return 1;
    }
    NSScreen *screen = pointerScreen(window);
    if (!screen) return -4;
    if (panelMode == 0) {
        panelWindow = window;
        originalFrame = window.frame;
        originalMinSize = window.minSize;
        originalMaxSize = window.maxSize;
        originalStyle = window.styleMask;
        originalBehavior = window.collectionBehavior;
        originalLevel = window.level;
        originalMovable = window.movable;
        originalMovableByBackground = window.movableByWindowBackground;
        originalHidesOnDeactivate = window.hidesOnDeactivate;
        originalTitlebarTransparent = window.titlebarAppearsTransparent;
        originalTitleVisibility = window.titleVisibility;
    }
    window.minSize = NSMakeSize(100, 80);
    window.maxSize = NSMakeSize(CGFLOAT_MAX, CGFLOAT_MAX);
    window.styleMask = originalStyle & ~(NSWindowStyleMaskResizable | NSWindowStyleMaskMiniaturizable);
    window.collectionBehavior = NSWindowCollectionBehaviorCanJoinAllSpaces | NSWindowCollectionBehaviorFullScreenAuxiliary | NSWindowCollectionBehaviorIgnoresCycle;
    window.level = NSFloatingWindowLevel;
    window.movable = mode == 2;
    window.movableByWindowBackground = mode == 2;
    if (mode == 3) window.styleMask = originalStyle & ~(NSWindowStyleMaskResizable | NSWindowStyleMaskMiniaturizable | NSWindowStyleMaskClosable);
    if (mode == 4) {
        window.styleMask = (originalStyle | NSWindowStyleMaskFullSizeContentView) & ~(NSWindowStyleMaskResizable | NSWindowStyleMaskMiniaturizable);
        window.level = NSStatusWindowLevel;
        window.collectionBehavior = NSWindowCollectionBehaviorCanJoinAllSpaces | NSWindowCollectionBehaviorFullScreenAuxiliary | NSWindowCollectionBehaviorTransient | NSWindowCollectionBehaviorIgnoresCycle;
    }
    setChrome(window, mode == 4);
    window.hidesOnDeactivate = NO;
    CGFloat safeTop = 0;
    if (@available(macOS 12.0, *)) safeTop = screen.safeAreaInsets.top;
    [window setFrame:mode == 4 ? notchFrame(screen.frame, screen.visibleFrame) : mode == 3 ? sidebarFrame(screen.visibleFrame, sidebarEdge) : panelFrame(screen.frame, screen.visibleFrame, safeTop, mode) display:YES];
    panelMode = mode;
    [NSApp unhideWithoutActivation];
    [window orderFrontRegardless];
    return 1;
}

int buddymac_panel_current_mode(void) { return panelMode; }

void buddymac_panel_sidebar_edge(int edge) { sidebarEdge = edge == 1 ? 1 : 2; }

/// Puts the full window back after the notch panel borrowed it. If you were in another app, BuddyMac returns
/// behind that app's front window and hands focus back instead of jumping in front of your work.
int buddymac_panel_restore(bool front) {
    NSWindow *window = buddyWindow();
    if (!window) return -2;
    if (panelMode != 0) restore(window, YES);
    if (front) { [window makeKeyAndOrderFront:nil]; return 1; }
    NSInteger below = 0;
    CFArrayRef list = CGWindowListCopyWindowInfo(kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements, kCGNullWindowID);
    if (list) {
        pid_t own = NSProcessInfo.processInfo.processIdentifier;
        for (NSDictionary *info in (__bridge NSArray *)list) {
            if ([info[(id)kCGWindowLayer] integerValue] != 0 || [info[(id)kCGWindowOwnerPID] intValue] == own) continue;
            below = [info[(id)kCGWindowNumber] integerValue];
            break;
        }
        CFRelease(list);
    }
    if (below) [window orderWindow:NSWindowBelow relativeTo:below]; else [window orderFront:nil];
    if (NSApp.active) [NSApp deactivate];
    return 1;
}

int buddymac_panel_hide(void) {
    NSWindow *window = buddyWindow();
    if (!window) return -2;
    if (panelMode != 0) {
        [window orderOut:nil];
        restore(window, NO);
    }
    [window orderOut:nil];
    // A click inside a floating panel activates BuddyMac. Give focus back to the app the user came from.
    // Deactivate rather than hide: a hidden app cannot show the Files shelf at the screen edge.
    if (NSApp.active) [NSApp deactivate];
    return 1;
}

#ifdef BUDDYMAC_PANEL_TEST_MAIN
int main(void) {
    @autoreleasepool {
        NSRect screens[] = { NSMakeRect(0, 0, 1440, 900), NSMakeRect(0, 0, 1728, 1117), NSMakeRect(-1920, 0, 1920, 1080), NSMakeRect(1440, 0, 800, 500) };
        NSRect visible[] = { NSMakeRect(0, 0, 1440, 876), NSMakeRect(0, 0, 1728, 1079), NSMakeRect(-1920, 40, 1920, 1016), NSMakeRect(1440, 40, 800, 436) };
        CGFloat safeInsets[] = { 0, 38, 0, 0 };
        for (int screen = 0; screen < 4; screen++) for (int mode = 1; mode <= 2; mode++) {
            NSRect frame = panelFrame(screens[screen], visible[screen], safeInsets[screen], mode);
            NSCAssert(NSContainsRect(visible[screen], frame), @"Compact panel escaped its display");
            NSCAssert(NSMaxY(frame) <= NSMaxY(screens[screen]) - safeInsets[screen] - 8, @"Compact panel overlaps safe area");
        }
        if (getenv("BUDDYMAC_PANEL_WINDOW_TEST")) {
            [NSApplication sharedApplication];
            [NSApp setActivationPolicy:NSApplicationActivationPolicyProhibited];
            NSWindow *window = [[NSWindow alloc] initWithContentRect:NSMakeRect(100, 100, 1080, 760) styleMask:NSWindowStyleMaskTitled | NSWindowStyleMaskClosable | NSWindowStyleMaskResizable backing:NSBackingStoreBuffered defer:NO];
            window.title = @"BuddyMac";
            window.minSize = NSMakeSize(900, 640);
            NSRect frame = window.frame;
            NSWindowStyleMask style = window.styleMask;
            NSWindowCollectionBehavior behavior = window.collectionBehavior;
            NSCAssert(buddymac_panel_mode(1) == 1 && panelMode == 1, @"Focus panel did not activate");
            NSCAssert(window.frame.size.width <= 380 && window.level == NSFloatingWindowLevel, @"Focus panel geometry or level wrong");
            NSCAssert(buddymac_panel_mode(2) == 1 && panelMode == 2, @"Talk panel did not activate");
            NSCAssert(buddymac_panel_mode(0) == 1 && panelMode == 0, @"Normal mode did not restore");
            NSCAssert(NSEqualRects(window.frame, frame) && NSEqualSizes(window.minSize, NSMakeSize(900, 640)), @"Original window size was lost");
            NSCAssert(window.styleMask == style && window.collectionBehavior == behavior, @"Original window behavior was lost");
            [window orderOut:nil];
        }
        puts("PASS: compact geometry on four display layouts and requested AppKit restoration checks");
    }
    return 0;
}
#endif
