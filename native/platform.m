#import <AppKit/AppKit.h>
#import <CoreText/CoreText.h>
#import <ServiceManagement/ServiceManagement.h>
#import <Carbon/Carbon.h>
#import <objc/runtime.h>
#import <ApplicationServices/ApplicationServices.h>

static NSMutableArray<NSString *> *actions;
static NSStatusItem *statusItem;
static NSString *statusTitle;
static NSString *positionKey(NSString *name) { return [@"NSStatusItem Preferred Position " stringByAppendingString:name]; }
// BuddyMac's icon used AppKit's default autosave name, Item-0. A fixed name keeps its place even when the icon is
// rebuilt; the first launch with it carries the old position over so the icon does not move.
static NSString *const mainItemName = @"BuddyMacIcon";
static NSStatusItem *makeMainStatusItem(void) {
    NSUserDefaults *defaults = NSUserDefaults.standardUserDefaults;
    id previous = [defaults objectForKey:positionKey(@"Item-0")];
    if (![defaults objectForKey:positionKey(mainItemName)] && [previous isKindOfClass:NSNumber.class]) [defaults setObject:previous forKey:positionKey(mainItemName)];
    NSStatusItem *item = [[NSStatusBar systemStatusBar] statusItemWithLength:NSVariableStatusItemLength];
    item.autosaveName = mainItemName;
    item.button.image = [NSImage imageWithSystemSymbolName:@"square.grid.2x2" accessibilityDescription:@"BuddyMac"];
    return item;
}
static void applyStatusTitle(void) {
    if (!statusItem) return;
    statusItem.button.title = statusTitle.length ? [@" " stringByAppendingString:statusTitle] : @"";
    statusItem.button.imagePosition = statusTitle.length ? NSImageLeft : NSImageOnly;
    statusItem.button.font = [NSFont monospacedDigitSystemFontOfSize:12 weight:NSFontWeightMedium];
}
static char *nextAction;
static id eventMonitor;

static BOOL completedExternalDrop(NSDragOperation operation, NSPoint point, NSRect origin, NSRect current) {
    return (operation & NSDragOperationCopy) != 0 && !NSPointInRect(point, origin) && !NSPointInRect(point, current);
}

@interface BuddyMacPlatform : NSObject <NSDraggingSource>
@property(nonatomic, strong) NSArray<NSString *> *dragPaths;
@property(nonatomic, weak) NSWindow *dragWindow;
@property(nonatomic, weak) NSWindow *mainWindow;
@property(nonatomic, strong) NSEvent *dragEvent;
@property(nonatomic) NSRect dragOriginFrame;
@end
@implementation BuddyMacPlatform
- (void)choose:(NSMenuItem *)sender { [actions addObject:sender.representedObject]; }
// Launching BuddyMac again from Spotlight, Raycast or Finder opens Settings: the status item can be hidden behind other menu bar icons.
- (void)reopen:(NSAppleEventDescriptor *)event withReply:(NSAppleEventDescriptor *)reply { [actions addObject:@"Settings"]; }
- (void)hideWindow:(id)sender { [self.mainWindow orderOut:nil]; [[NSNotificationCenter defaultCenter] postNotificationName:@"BuddyMacWindowDismissed" object:self.mainWindow]; }
- (NSDragOperation)draggingSession:(NSDraggingSession *)session sourceOperationMaskForDraggingContext:(NSDraggingContext)context { return NSDragOperationCopy; }
- (BOOL)ignoreModifierKeysForDraggingSession:(NSDraggingSession *)session { return YES; }
- (void)draggingSession:(NSDraggingSession *)session endedAtPoint:(NSPoint)point operation:(NSDragOperation)operation {
    if (self.dragWindow && completedExternalDrop(operation, point, self.dragOriginFrame, self.dragWindow.frame)) {
        NSData *data=[NSJSONSerialization dataWithJSONObject:@{@"action":@"files-drag-completed",@"paths":self.dragPaths ?: @[]} options:0 error:nil];
        [actions addObject:[[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding]];
    }
    self.dragPaths=nil;
    self.dragWindow=nil;
    self.dragEvent=nil;
}
@end
static BuddyMacPlatform *platform;
// Bun calls every buddymac_* function from a thread with no autorelease pool, so anything they autorelease is never
// freed: polling the pointer state ten times a second grew the heap by about 150 MB an hour. Each entry point drains
// its own pool. Strings handed back to Bun are copied out first, because UTF8String's buffer can die with the pool.
static const char *returned(char **slot, NSString *value) { free(*slot); *slot = strdup((value ?: @"").UTF8String); return *slot; }
static BOOL recordingShortcut;
static BOOL recordingFn;

static NSString *keyLabel(UInt16 keyCode) {
    NSDictionary<NSNumber *, NSString *> *named = @{@(kVK_Return): @"Return", @(kVK_Tab): @"Tab", @(kVK_Space): @"Space", @(kVK_Delete): @"Delete",
        @(kVK_Escape): @"Escape", @(kVK_ForwardDelete): @"Forward Delete", @(kVK_LeftArrow): @"←", @(kVK_RightArrow): @"→", @(kVK_DownArrow): @"↓",
        @(kVK_UpArrow): @"↑", @(kVK_Home): @"Home", @(kVK_End): @"End", @(kVK_PageUp): @"Page Up", @(kVK_PageDown): @"Page Down",
        @(kVK_F1): @"F1", @(kVK_F2): @"F2", @(kVK_F3): @"F3", @(kVK_F4): @"F4", @(kVK_F5): @"F5", @(kVK_F6): @"F6", @(kVK_F7): @"F7",
        @(kVK_F8): @"F8", @(kVK_F9): @"F9", @(kVK_F10): @"F10", @(kVK_F11): @"F11", @(kVK_F12): @"F12"};
    NSString *name = named[@(keyCode)];
    if (name) return name;
    TISInputSourceRef source = TISCopyCurrentKeyboardLayoutInputSource();
    CFDataRef layoutData = source ? TISGetInputSourceProperty(source, kTISPropertyUnicodeKeyLayoutData) : NULL;
    if (!layoutData) {
        if (source) CFRelease(source);
        source = TISCopyCurrentASCIICapableKeyboardLayoutInputSource();
        layoutData = source ? TISGetInputSourceProperty(source, kTISPropertyUnicodeKeyLayoutData) : NULL;
    }
    NSString *label = [NSString stringWithFormat:@"Key %d", keyCode];
    if (layoutData) {
        const UCKeyboardLayout *layout = (const UCKeyboardLayout *)CFDataGetBytePtr(layoutData);
        UInt32 deadKeyState = 0;
        UniChar characters[4];
        UniCharCount length = 0;
        if (UCKeyTranslate(layout, keyCode, kUCKeyActionDisplay, 0, LMGetKbdType(), kUCKeyTranslateNoDeadKeysBit, &deadKeyState, 4, &length, characters) == noErr && length > 0) {
            label = [[NSString stringWithCharacters:characters length:length] uppercaseString];
        }
    }
    if (source) CFRelease(source);
    return label;
}

static NSMutableDictionary<NSNumber *, NSString *> *hotkeyNames;
static NSMutableArray<NSValue *> *hotkeyRefs;
static EventHandlerRef hotkeyHandler;
static char *hotkeyError;
static OSStatus hotkeyPressed(EventHandlerCallRef next, EventRef event, void *context) {
    EventHotKeyID identifier;
    if (GetEventParameter(event, kEventParamDirectObject, typeEventHotKeyID, NULL, sizeof(identifier), NULL, &identifier) != noErr) return eventNotHandledErr;
    NSString *name = hotkeyNames[@(identifier.id)];
    if (!name) return eventNotHandledErr;
    NSData *data = [NSJSONSerialization dataWithJSONObject:@{@"action": @"hotkey", @"id": name} options:0 error:nil];
    [actions addObject:[[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding]];
    return noErr;
}

void buddymac_init(const char *fontDirectory) { @autoreleasepool {
    actions=[NSMutableArray new]; platform=[BuddyMacPlatform new];
    if (eventMonitor) [NSEvent removeMonitor:eventMonitor];
    eventMonitor=[NSEvent addLocalMonitorForEventsMatchingMask:NSEventMaskLeftMouseDown | NSEventMaskLeftMouseDragged | NSEventMaskLeftMouseUp | NSEventMaskKeyDown | NSEventMaskFlagsChanged handler:^NSEvent *(NSEvent *event) {
        if (recordingShortcut && recordingFn && event.type == NSEventTypeFlagsChanged && event.keyCode == kVK_Function) {
            NSEventModifierFlags other = event.modifierFlags & (NSEventModifierFlagCommand | NSEventModifierFlagOption | NSEventModifierFlagControl | NSEventModifierFlagShift);
            if ((event.modifierFlags & NSEventModifierFlagFunction) && other == 0) {
                recordingShortcut = NO;
                [actions addObject:@"{\"action\":\"shortcut-recorded\",\"keyCode\":63,\"modifiers\":0,\"label\":\"Fn\"}"];
                return nil;
            }
        }
        if (event.type == NSEventTypeKeyDown && recordingShortcut) {
            NSEventModifierFlags modifiers = event.modifierFlags & (NSEventModifierFlagCommand | NSEventModifierFlagOption | NSEventModifierFlagControl | NSEventModifierFlagShift);
            recordingShortcut = NO;
            NSDictionary *result = event.keyCode == kVK_Escape && modifiers == 0
                ? @{@"action": @"shortcut-cancelled"}
                : @{@"action": @"shortcut-recorded", @"keyCode": @(event.keyCode), @"modifiers": @(modifiers), @"label": keyLabel(event.keyCode)};
            NSData *data = [NSJSONSerialization dataWithJSONObject:result options:0 error:nil];
            [actions addObject:[[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding]];
            return nil;
        }
        if (event.type == NSEventTypeKeyDown && platform.mainWindow && event.window == platform.mainWindow) {
            NSEventModifierFlags modifiers = event.modifierFlags & (NSEventModifierFlagCommand | NSEventModifierFlagOption | NSEventModifierFlagControl | NSEventModifierFlagShift);
            if (modifiers == NSEventModifierFlagCommand && [event.charactersIgnoringModifiers.lowercaseString isEqualToString:@"w"]) {
                [platform hideWindow:nil];
                return nil;
            }
        }
        if (event.type == NSEventTypeLeftMouseUp) platform.dragEvent=nil;
        else if ((event.type == NSEventTypeLeftMouseDown || event.type == NSEventTypeLeftMouseDragged) && [event.window.title isEqualToString:@"BuddyMac"]) platform.dragEvent=event;
        return event;
    }];
    NSString *directory=[NSString stringWithUTF8String:fontDirectory];
    for (NSString *file in [[NSFileManager defaultManager] contentsOfDirectoryAtPath:directory error:nil]) {
        if ([file.pathExtension isEqualToString:@"ttf"]) {
            NSURL *url=[NSURL fileURLWithPath:[directory stringByAppendingPathComponent:file]];
            CTFontManagerRegisterFontsForURL((__bridge CFURLRef)url,kCTFontManagerScopeProcess,NULL);
        }
    }
}}
void buddymac_menu(void) { @autoreleasepool {
    [NSApp setActivationPolicy:NSApplicationActivationPolicyAccessory];
    [[NSAppleEventManager sharedAppleEventManager] setEventHandler:platform andSelector:@selector(reopen:withReply:) forEventClass:kCoreEventClass andEventID:kAEReopenApplication];
    statusItem=makeMainStatusItem();
    NSMenu *menu=[NSMenu new];
    NSArray *focusItems=@[@[@"Start or Pause Timer",@"focus-toggle"],@[@"Skip Phase",@"focus-skip"],@[@"Show Focus Panel",@"focus-panel"]];
    for (NSArray *entry in focusItems) {
        NSMenuItem *item=[[NSMenuItem alloc] initWithTitle:entry[0] action:@selector(choose:) keyEquivalent:@""];
        item.target=platform; item.representedObject=entry[1]; [menu addItem:item];
    }
    NSMenuItem *camera=[[NSMenuItem alloc] initWithTitle:@"Show or Hide Camera Preview" action:@selector(choose:) keyEquivalent:@""];
    camera.target=platform; camera.representedObject=@"camera-preview"; [menu addItem:camera];
    [menu addItem:[NSMenuItem separatorItem]];
    for (NSString *name in @[@"Files",@"Talk",@"Write",@"Focus",@"Dock",@"Menu Bar",@"Camera",@"Settings"]) {
        NSMenuItem *item=[[NSMenuItem alloc] initWithTitle:name action:@selector(choose:) keyEquivalent:@""];
        item.target=platform; item.representedObject=name; [menu addItem:item];
    }
    [menu addItem:[NSMenuItem separatorItem]];
    NSMenuItem *quit=[[NSMenuItem alloc] initWithTitle:@"Quit BuddyMac" action:@selector(choose:) keyEquivalent:@"q"];
    quit.target=platform; quit.representedObject=@"quit"; [menu addItem:quit]; statusItem.menu=menu;
}}
const char *buddymac_next_action(void) { @autoreleasepool {
    if (!actions.count) return "";
    NSString *action=actions.firstObject; [actions removeObjectAtIndex:0]; return returned(&nextAction, action);
}}
int buddymac_drag(const char *json) { @autoreleasepool {
    if (platform.dragPaths) return 0;
    NSData *data=[[NSString stringWithUTF8String:json] dataUsingEncoding:NSUTF8StringEncoding];
    id paths=[NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
    NSEvent *event=platform.dragEvent;
    if (![paths isKindOfClass:[NSArray class]] || ![paths count] || !event || (NSEvent.pressedMouseButtons & 1) == 0) return 0;
    NSWindow *window=event.window;
    if (!window) return 0;
    NSMutableArray *items=[NSMutableArray new];
    NSPoint point=[window.contentView convertPoint:event.locationInWindow fromView:nil];
    for (id path in paths) {
        if (![path isKindOfClass:[NSString class]]) return 0;
        NSURL *url=[NSURL fileURLWithPath:path];
        NSNumber *regular=nil;
        if (![url getResourceValue:&regular forKey:NSURLIsRegularFileKey error:nil] || !regular.boolValue) return 0;
        NSDraggingItem *item=[[NSDraggingItem alloc] initWithPasteboardWriter:url];
        NSImage *icon=[[NSWorkspace sharedWorkspace] iconForFile:path];
        [item setDraggingFrame:NSMakeRect(point.x,point.y,40,40) contents:icon]; [items addObject:item]; point.y-=8;
    }
    platform.dragPaths=paths; platform.dragWindow=window; platform.dragOriginFrame=window.frame;
    NSDraggingSession *session=[window.contentView beginDraggingSessionWithItems:items event:event source:platform];
    session.animatesToStartingPositionsOnCancelOrFail=YES;
    return 1;
}}
void buddymac_copy_text(const char *text) { @autoreleasepool {
    [[NSPasteboard generalPasteboard] clearContents];
    [[NSPasteboard generalPasteboard] setString:[NSString stringWithUTF8String:text] forType:NSPasteboardTypeString];
}}

static char *secretResult;
const char *buddymac_prompt_secret(void) { @autoreleasepool {
    NSAlert *alert=[NSAlert new]; alert.messageText=@"Provider API key";
    alert.informativeText=@"Enter the API key for the selected provider.";
    [alert addButtonWithTitle:@"Save key"]; [alert addButtonWithTitle:@"Cancel"];
    NSSecureTextField *field=[[NSSecureTextField alloc] initWithFrame:NSMakeRect(0,0,360,26)];
    alert.accessoryView=field; [alert.window setInitialFirstResponder:field];
    if (secretResult) memset(secretResult, 0, strlen(secretResult));
    return returned(&secretResult, [alert runModal]==NSAlertFirstButtonReturn ? field.stringValue : @"");
}}
@interface BuddyMacWindowDelegate : NSObject <NSWindowDelegate>
@property(nonatomic,strong) id original;
@end
@implementation BuddyMacWindowDelegate
- (BOOL)windowShouldClose:(NSWindow *)sender { [sender orderOut:nil]; [[NSNotificationCenter defaultCenter] postNotificationName:@"BuddyMacWindowDismissed" object:sender]; return NO; }
// GPUI makes the window its own delegate. Forwarding every selector sent AppKit's responder-chain calls such as
// validRequestorForSendType:returnType: from the window to this proxy and straight back to the window, forever.
// Only NSWindowDelegate callbacks are forwarded.
static BOOL isWindowDelegateSelector(SEL selector) {
    return protocol_getMethodDescription(@protocol(NSWindowDelegate), selector, NO, YES).name != NULL
        || protocol_getMethodDescription(@protocol(NSWindowDelegate), selector, YES, YES).name != NULL;
}
- (BOOL)respondsToSelector:(SEL)selector { return [super respondsToSelector:selector] || (isWindowDelegateSelector(selector) && [self.original respondsToSelector:selector]); }
- (id)forwardingTargetForSelector:(SEL)selector { return isWindowDelegateSelector(selector) && [self.original respondsToSelector:selector] ? self.original : [super forwardingTargetForSelector:selector]; }
@end
static BuddyMacWindowDelegate *windowDelegate;
void buddymac_keep_running(void) { @autoreleasepool {
    NSWindow *window=nil;
    for (NSWindow *candidate in NSApp.windows) if ([candidate.title isEqualToString:@"BuddyMac"]) { window=candidate; break; }
    if (!window || windowDelegate) return;
    platform.mainWindow=window;
    windowDelegate=[BuddyMacWindowDelegate new]; windowDelegate.original=window.delegate; window.delegate=windowDelegate;
    for (NSMenuItem *menu in NSApp.mainMenu.itemArray) for (NSMenuItem *item in menu.submenu.itemArray) {
        if ([item.keyEquivalent.lowercaseString isEqualToString:@"w"] && (item.keyEquivalentModifierMask & NSEventModifierFlagCommand)) {
            item.target=platform;
            item.action=@selector(hideWindow:);
        }
    }
}}
void buddymac_notify(const char *text) {
    NSBeep();
}

#ifdef BUDDYMAC_PLATFORM_TEST_MAIN
@interface BuddyMacTestDelegate : NSObject <NSWindowDelegate>
@property(nonatomic) BOOL resized;
@end
@implementation BuddyMacTestDelegate
- (void)windowDidResize:(NSNotification *)notification { self.resized = YES; }
@end
@interface BuddyMacSelfDelegatingWindow : NSWindow <NSWindowDelegate>
@property(nonatomic) BOOL resized;
@end
@implementation BuddyMacSelfDelegatingWindow
- (void)windowDidResize:(NSNotification *)notification { self.resized = YES; }
@end
int main(void) {
    @autoreleasepool {
        NSRect source = NSMakeRect(100, 100, 400, 600);
        NSRect moved = NSMakeRect(600, 100, 400, 600);
        NSCAssert(!completedExternalDrop(NSDragOperationNone, NSMakePoint(1200, 500), source, source), @"Cancelled drag removed files");
        NSCAssert(!completedExternalDrop(NSDragOperationCopy, NSMakePoint(200, 200), source, source), @"Internal drop removed files");
        NSCAssert(!completedExternalDrop(NSDragOperationCopy, NSMakePoint(700, 200), source, moved), @"Moved-window internal drop removed files");
        NSCAssert(completedExternalDrop(NSDragOperationCopy, NSMakePoint(1200, 500), source, source), @"Successful external copy retained files");
        BuddyMacWindowDelegate *delegate = [BuddyMacWindowDelegate new];
        BuddyMacTestDelegate *original = [BuddyMacTestDelegate new];
        delegate.original = original;
        NSCAssert([delegate respondsToSelector:@selector(windowDidResize:)], @"Original callback is hidden");
        [(id<NSWindowDelegate>)delegate windowDidResize:[NSNotification notificationWithName:NSWindowDidResizeNotification object:nil]];
        NSCAssert(original.resized, @"Original callback was not forwarded");
        [NSApplication sharedApplication];
        [NSApp setActivationPolicy:NSApplicationActivationPolicyProhibited];
        buddymac_init("");
        recordingShortcut = YES;
        recordingFn = YES;
        NSEvent *fnDown = [NSEvent keyEventWithType:NSEventTypeFlagsChanged location:NSZeroPoint modifierFlags:NSEventModifierFlagFunction timestamp:0 windowNumber:0 context:nil characters:@"" charactersIgnoringModifiers:@"" isARepeat:NO keyCode:kVK_Function];
        NSEvent *fnUp = [NSEvent keyEventWithType:NSEventTypeFlagsChanged location:NSZeroPoint modifierFlags:0 timestamp:0 windowNumber:0 context:nil characters:@"" charactersIgnoringModifiers:@"" isARepeat:NO keyCode:kVK_Function];
        [NSApp sendEvent:fnUp];
        NSCAssert(actions.count == 0 && recordingShortcut, @"Fn release was recorded");
        [NSApp sendEvent:fnDown];
        NSCAssert(actions.count == 1 && !recordingShortcut && [actions.firstObject containsString:@"\"label\":\"Fn\""], @"Fn flagsChanged press was not captured by the real AppKit monitor");
        [actions removeAllObjects];
        recordingShortcut = YES;
        recordingFn = NO;
        [NSApp sendEvent:fnDown];
        NSCAssert(actions.count == 0 && recordingShortcut, @"Fn was captured for a shortcut that does not support it");
        recordingShortcut = NO;
        NSWindow *window = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 400, 300) styleMask:NSWindowStyleMaskTitled | NSWindowStyleMaskClosable backing:NSBackingStoreBuffered defer:NO];
        window.releasedWhenClosed = NO;
        window.delegate = delegate;
        __block BOOL closed = NO;
        id observation = [NSNotificationCenter.defaultCenter addObserverForName:NSWindowWillCloseNotification object:window queue:nil usingBlock:^(NSNotification *note) { closed = YES; }];
        [window performClose:nil];
        NSCAssert(!closed && [NSApp.windows containsObject:window], @"Close removed the AppKit window");
        [NSNotificationCenter.defaultCenter removeObserver:observation];
        // GPUI's window is its own delegate. The Services menu walks the responder chain through validRequestor.
        BuddyMacSelfDelegatingWindow *gpuiWindow = [[BuddyMacSelfDelegatingWindow alloc] initWithContentRect:NSMakeRect(0, 0, 400, 300) styleMask:NSWindowStyleMaskTitled backing:NSBackingStoreBuffered defer:NO];
        gpuiWindow.releasedWhenClosed = NO;
        gpuiWindow.delegate = gpuiWindow;
        BuddyMacWindowDelegate *proxy = [BuddyMacWindowDelegate new];
        proxy.original = gpuiWindow;
        gpuiWindow.delegate = proxy;
        (void)[gpuiWindow validRequestorForSendType:NSPasteboardTypeString returnType:nil];
        [(id<NSWindowDelegate>)proxy windowDidResize:[NSNotification notificationWithName:NSWindowDidResizeNotification object:gpuiWindow]];
        NSCAssert(gpuiWindow.resized, @"Self-delegating window lost its resize callback");
        NSCAssert(![proxy respondsToSelector:@selector(validRequestorForSendType:returnType:)], @"Responder-chain selector is forwarded back to the window");
        puts("PASS: Fn press/release through AppKit, drag outcome classification, original delegate forwarding, self-delegating window without recursion, and actual AppKit close veto");
    }
    return 0;
}
#endif

static char *loginError;
bool buddymac_login_enabled(void) { @autoreleasepool { return SMAppService.mainAppService.status == SMAppServiceStatusEnabled; } }
const char *buddymac_set_login(bool enabled) { @autoreleasepool { NSError *error=nil; if(enabled) [SMAppService.mainAppService registerAndReturnError:&error]; else [SMAppService.mainAppService unregisterAndReturnError:&error]; return returned(&loginError, error.localizedDescription); } }


void buddymac_record_shortcut(bool enabled, bool allowFn) { recordingShortcut = enabled; recordingFn = allowFn; }
static char *labelResult;
const char *buddymac_key_label(int keyCode) { @autoreleasepool { return returned(&labelResult, keyLabel((UInt16)keyCode)); } }

const char *buddymac_register_hotkeys(const char *json) { @autoreleasepool {
    if (!hotkeyHandler) {
        EventTypeSpec type = {kEventClassKeyboard, kEventHotKeyPressed};
        InstallApplicationEventHandler(NewEventHandlerUPP(hotkeyPressed), 1, &type, NULL, &hotkeyHandler);
        hotkeyNames = [NSMutableDictionary new];
        hotkeyRefs = [NSMutableArray new];
    }
    for (NSValue *value in hotkeyRefs) UnregisterEventHotKey((EventHotKeyRef)value.pointerValue);
    [hotkeyRefs removeAllObjects];
    [hotkeyNames removeAllObjects];
    NSData *data = [[NSString stringWithUTF8String:json] dataUsingEncoding:NSUTF8StringEncoding];
    id entries = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
    NSMutableArray<NSString *> *failed = [NSMutableArray new];
    if ([entries isKindOfClass:NSArray.class]) {
        UInt32 next = 1;
        for (id entry in entries) {
            if (![entry isKindOfClass:NSDictionary.class] || ![entry[@"id"] isKindOfClass:NSString.class]) continue;
            NSUInteger flags = [entry[@"modifiers"] unsignedIntegerValue];
            UInt32 carbon = ((flags & NSEventModifierFlagCommand) ? cmdKey : 0) | ((flags & NSEventModifierFlagOption) ? optionKey : 0)
                | ((flags & NSEventModifierFlagControl) ? controlKey : 0) | ((flags & NSEventModifierFlagShift) ? shiftKey : 0);
            EventHotKeyID identifier = {'BMac', next};
            EventHotKeyRef reference = NULL;
            if (RegisterEventHotKey((UInt32)[entry[@"keyCode"] unsignedIntValue], carbon, identifier, GetApplicationEventTarget(), 0, &reference) == noErr && reference) {
                [hotkeyRefs addObject:[NSValue valueWithPointer:reference]];
                hotkeyNames[@(next)] = entry[@"id"];
            } else [failed addObject:entry[@"id"]];
            next++;
        }
    }
    return returned(&hotkeyError, [failed componentsJoinedByString:@","]);
}}

void buddymac_status_title(const char *title) { @autoreleasepool {
    statusTitle = [NSString stringWithUTF8String:title];
    applyStatusTitle();
}}

// Menu bar icons. Two extra status items: an arrow that the user clicks, and a divider left of it. Icons the user
// Command-drags left of the divider are hidden by stretching the divider to 10,000 points, which pushes them past
// the left edge of the menu bar. Hiding and showing need no permissions; the Layout tab's list and moves use Accessibility.
static const CGFloat dividerHiddenLength = 10000;
static NSStatusItem *menuBarArrow, *menuBarDivider;
static BOOL menuBarCollapsed;
static NSTimeInterval menuBarAutoHide;
static NSTimer *menuBarTimer, *menuBarPlacement;
static int menuBarPlacementTries;
static BOOL menuBarMoving;
static NSString *const menuBarLayoutKey = @"BuddyMacMenuBarLayout";
static void menuBarCollapse(BOOL collapse);

@interface BuddyMacMenuBar : NSObject
@end
@implementation BuddyMacMenuBar
- (void)arrowClicked:(id)sender { [menuBarPlacement invalidate]; menuBarPlacement = nil; menuBarCollapse(!menuBarCollapsed); }
- (void)placed:(NSTimer *)timer { menuBarPlacement = nil; menuBarCollapse(YES); }
- (void)autoHide:(NSTimer *)timer {
    menuBarTimer = nil;
    if (!menuBarArrow || menuBarCollapsed) return;
    // Wait while the pointer is in the menu bar or a button is held: the user may be Command-dragging an icon or reading one.
    NSPoint point = NSEvent.mouseLocation;
    BOOL inMenuBar = NO;
    for (NSScreen *screen in NSScreen.screens) if (NSPointInRect(point, screen.frame) && point.y >= NSMaxY(screen.visibleFrame)) inMenuBar = YES;
    if (inMenuBar || menuBarMoving || NSEvent.pressedMouseButtons != 0) {
        menuBarTimer = [NSTimer timerWithTimeInterval:2 target:self selector:@selector(autoHide:) userInfo:nil repeats:NO];
        [NSRunLoop.mainRunLoop addTimer:menuBarTimer forMode:NSRunLoopCommonModes];
        return;
    }
    menuBarCollapse(YES);
}
@end
static BuddyMacMenuBar *menuBarTarget;

static NSImage *dividerImage(void) {
    NSImage *image = [NSImage imageWithSize:NSMakeSize(6, 16) flipped:NO drawingHandler:^BOOL(NSRect rect) {
        [NSColor.blackColor setFill];
        NSRectFill(NSMakeRect(2.5, 1, 1, 14));
        return YES;
    }];
    image.template = YES;
    image.accessibilityDescription = @"BuddyMac menu bar divider";
    return image;
}

// New status items start with an empty frame at x = 0, off every menu bar, until macOS moves them in a second or two
// later, sometimes by way of another display. Their order can be read once both sit in the same display's menu bar.
// Status windows hang over the top edge of the screen, so only the horizontal position is compared.
static NSScreen *menuBarScreen(NSWindow *window) {
    if (!window || NSHeight(window.frame) <= 0 || NSMinX(window.frame) == 0) return nil;
    for (NSScreen *screen in NSScreen.screens) if (NSMidX(window.frame) >= NSMinX(screen.frame) && NSMidX(window.frame) < NSMaxX(screen.frame)) return screen;
    return nil;
}
static BOOL menuBarPlaced(void) {
    NSScreen *arrow = menuBarScreen(menuBarArrow.button.window);
    return arrow && arrow == menuBarScreen(menuBarDivider.button.window);
}

// The arrow must stay right of the divider, or collapsing would hide the only way back.
static BOOL menuBarOrderValid(void) {
    NSWindow *arrow = menuBarArrow.button.window, *divider = menuBarDivider.button.window;
    if (!arrow || !divider) return YES;
    return NSMinX(arrow.frame) >= NSMaxX(divider.frame) - 1;
}

static void menuBarScheduleAutoHide(void) {
    [menuBarTimer invalidate]; menuBarTimer = nil;
    if (menuBarCollapsed || menuBarAutoHide <= 0 || !menuBarArrow) return;
    menuBarTimer = [NSTimer timerWithTimeInterval:menuBarAutoHide target:menuBarTarget selector:@selector(autoHide:) userInfo:nil repeats:NO];
    [NSRunLoop.mainRunLoop addTimer:menuBarTimer forMode:NSRunLoopCommonModes];
}

static void menuBarCollapse(BOOL collapse) {
    if (!menuBarArrow || !menuBarDivider) return;
    // Until the items are placed their order is unknown. Show them, and hide once macOS has laid them out.
    BOOL waitForPlacement = collapse && !menuBarCollapsed && !menuBarPlaced();
    if (waitForPlacement) collapse = NO;
    else if (collapse && !menuBarCollapsed && !menuBarOrderValid()) {
        [actions addObject:@"{\"action\":\"menubar-misplaced\"}"];
        collapse = NO;
    }
    menuBarCollapsed = collapse;
    menuBarDivider.length = collapse ? dividerHiddenLength : NSVariableStatusItemLength;
    menuBarDivider.button.image = collapse ? nil : dividerImage();
    menuBarArrow.button.image = [NSImage imageWithSystemSymbolName:collapse ? @"chevron.left" : @"chevron.right" accessibilityDescription:collapse ? @"Show hidden menu bar icons" : @"Hide menu bar icons"];
    menuBarArrow.button.toolTip = collapse ? @"Show hidden icons" : @"Hide icons left of the divider";
    menuBarScheduleAutoHide();
    [menuBarPlacement invalidate]; menuBarPlacement = nil;
    if (!waitForPlacement) menuBarPlacementTries = 0;
    else if (menuBarPlacementTries++ < 100) {
        menuBarPlacement = [NSTimer timerWithTimeInterval:0.1 target:menuBarTarget selector:@selector(placed:) userInfo:nil repeats:NO];
        [NSRunLoop.mainRunLoop addTimer:menuBarPlacement forMode:NSRunLoopCommonModes];
    }
}

// enabled: show the arrow and divider. autoHide: seconds before shown icons hide again, 0 for never. collapse: hide now.
void buddymac_menubar_configure(bool enabled, double autoHide, bool collapse) { @autoreleasepool {
    menuBarAutoHide = autoHide > 0 ? autoHide : 0;
    if (!enabled) {
        [menuBarTimer invalidate]; menuBarTimer = nil;
        [menuBarPlacement invalidate]; menuBarPlacement = nil;
        if (menuBarDivider) [[NSStatusBar systemStatusBar] removeStatusItem:menuBarDivider];
        if (menuBarArrow) [[NSStatusBar systemStatusBar] removeStatusItem:menuBarArrow];
        menuBarDivider = nil; menuBarArrow = nil; menuBarCollapsed = NO;
        return;
    }
    if (!menuBarArrow) {
        if (!menuBarTarget) menuBarTarget = [BuddyMacMenuBar new];
        // Without a saved position macOS puts new status items left of every other icon, which leaves nothing to hide.
        // The first time, lay them out the way Ice does: the arrow at the right end next to the system icons, BuddyMac's
        // icon left of it, then the divider, so every other icon starts on the hidden side. A smaller preferred
        // position is further right. After that, the autosave names keep wherever the user Command-drags them.
        NSUserDefaults *defaults = NSUserDefaults.standardUserDefaults;
        if (statusItem && [defaults integerForKey:menuBarLayoutKey] < 1) {
            [defaults setDouble:0 forKey:positionKey(@"BuddyMacMenuBarArrow")];
            [defaults setDouble:2 forKey:positionKey(@"BuddyMacMenuBarDivider")];
            // Removing a status item can drop its saved position, so the icon's new one is written after removal.
            NSMenu *menu = statusItem.menu;
            [[NSStatusBar systemStatusBar] removeStatusItem:statusItem];
            [defaults setDouble:1 forKey:positionKey(mainItemName)];
            statusItem = makeMainStatusItem();
            statusItem.menu = menu;
            applyStatusTitle();
            [defaults setInteger:1 forKey:menuBarLayoutKey];
        }
        menuBarArrow = [[NSStatusBar systemStatusBar] statusItemWithLength:NSVariableStatusItemLength];
        menuBarArrow.autosaveName = @"BuddyMacMenuBarArrow";
        menuBarArrow.button.target = menuBarTarget;
        menuBarArrow.button.action = @selector(arrowClicked:);
        menuBarDivider = [[NSStatusBar systemStatusBar] statusItemWithLength:NSVariableStatusItemLength];
        menuBarDivider.autosaveName = @"BuddyMacMenuBarDivider";
        menuBarCollapsed = NO;
    }
    menuBarCollapse(collapse || menuBarCollapsed);
}}

// Returns 1 when hidden, 0 when shown, -1 when the arrow and divider are off.
int buddymac_menubar_toggle(void) { @autoreleasepool {
    if (!menuBarArrow) return -1;
    menuBarCollapse(!menuBarCollapsed);
    return menuBarCollapsed ? 1 : 0;
}}
int buddymac_menubar_state(void) { return menuBarArrow ? (menuBarCollapsed ? 1 : 0) : -1; }

// Puts the arrow, BuddyMac's icon and the divider back in their first-use places at the right end of the menu bar.
void buddymac_menubar_reset(void) { @autoreleasepool {
    NSUserDefaults *defaults = NSUserDefaults.standardUserDefaults;
    BOOL enabled = menuBarArrow != nil, collapsed = menuBarCollapsed;
    NSTimeInterval autoHide = menuBarAutoHide;
    if (enabled) buddymac_menubar_configure(false, autoHide, false);
    [defaults setInteger:0 forKey:menuBarLayoutKey];
    if (enabled) buddymac_menubar_configure(true, autoHide, collapsed);
}}

// Layout: every app's menu bar icons, read through Accessibility (AXExtrasMenuBar), and moves across the divider made
// the way a person would, with a Command-drag. On macOS 26 every icon window belongs to Control Centre, so only
// Accessibility tells which app owns an icon. A full read takes a few seconds, so it runs off the main thread.
static dispatch_queue_t layoutQueue;
static NSObject *layoutLock;
static NSString *layoutItems = @"[]";
static BOOL layoutScanning;
static NSInteger layoutScans;
static char *layoutResult;

static NSString *axString(AXUIElementRef element, CFStringRef attribute) {
    CFTypeRef value = NULL;
    if (AXUIElementCopyAttributeValue(element, attribute, &value) != kAXErrorSuccess || !value) return @"";
    NSString *text = CFGetTypeID(value) == CFStringGetTypeID() ? [(__bridge NSString *)value copy] : @"";
    CFRelease(value);
    return [text stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
}

static NSString *iconCache(void) {
    NSString *base = NSSearchPathForDirectoriesInDomains(NSCachesDirectory, NSUserDomainMask, YES).firstObject ?: NSTemporaryDirectory();
    NSString *directory = [base stringByAppendingPathComponent:@"org.buddytools.BuddyMac/menubar-icons"];
    [NSFileManager.defaultManager createDirectoryAtPath:directory withIntermediateDirectories:YES attributes:nil error:nil];
    return directory;
}

// GPUix's <img> reads PNG files, so each app's icon is written once at 64 pixels.
static NSString *appIconPath(NSRunningApplication *app, NSString *bundle) {
    if (!bundle.length) return @"";
    NSString *path = [[iconCache() stringByAppendingPathComponent:bundle] stringByAppendingPathExtension:@"png"];
    if ([NSFileManager.defaultManager fileExistsAtPath:path]) return path;
    NSImage *icon = app.icon;
    if (!icon) return @"";
    NSBitmapImageRep *bitmap = [[NSBitmapImageRep alloc] initWithBitmapDataPlanes:NULL pixelsWide:64 pixelsHigh:64 bitsPerSample:8 samplesPerPixel:4 hasAlpha:YES isPlanar:NO colorSpaceName:NSDeviceRGBColorSpace bytesPerRow:0 bitsPerPixel:0];
    [NSGraphicsContext saveGraphicsState];
    NSGraphicsContext.currentContext = [NSGraphicsContext graphicsContextWithBitmapImageRep:bitmap];
    [icon drawInRect:NSMakeRect(0, 0, 64, 64) fromRect:NSZeroRect operation:NSCompositingOperationCopy fraction:1];
    [NSGraphicsContext restoreGraphicsState];
    NSData *png = [bitmap representationUsingType:NSBitmapImageFileTypePNG properties:@{}];
    return [png writeToFile:path atomically:YES] ? path : @"";
}

typedef NS_ENUM(NSInteger, BarItemRole) { BarItemOther, BarItemIcon, BarItemArrow, BarItemDivider, BarItemFixed };

// Every menu bar icon, left to right, with its AX element, frame and a key that survives a rescan.
static NSArray<NSDictionary *> *readMenuBar(void) {
    NSMutableArray<NSDictionary *> *items = [NSMutableArray new];
    pid_t me = getpid();
    for (NSRunningApplication *app in NSWorkspace.sharedWorkspace.runningApplications) {
        pid_t pid = app.processIdentifier;
        if (pid <= 0) continue;
        AXUIElementRef application = AXUIElementCreateApplication(pid);
        // A hung app must not stall the whole read.
        AXUIElementSetMessagingTimeout(application, 0.25);
        CFTypeRef bar = NULL, children = NULL;
        if (AXUIElementCopyAttributeValue(application, CFSTR("AXExtrasMenuBar"), &bar) == kAXErrorSuccess && bar
            && AXUIElementCopyAttributeValue((AXUIElementRef)bar, kAXChildrenAttribute, &children) == kAXErrorSuccess && children
            && CFGetTypeID(children) == CFArrayGetTypeID()) {
            NSString *bundle = app.bundleIdentifier ?: @"";
            for (id child in (__bridge NSArray *)children) {
                AXUIElementRef element = (__bridge AXUIElementRef)child;
                CGPoint point = CGPointZero; CGSize size = CGSizeZero; CFTypeRef value = NULL;
                if (AXUIElementCopyAttributeValue(element, kAXPositionAttribute, &value) == kAXErrorSuccess && value) { AXValueGetValue((AXValueRef)value, kAXValueTypeCGPoint, &point); CFRelease(value); }
                value = NULL;
                if (AXUIElementCopyAttributeValue(element, kAXSizeAttribute, &value) == kAXErrorSuccess && value) { AXValueGetValue((AXValueRef)value, kAXValueTypeCGSize, &size); CFRelease(value); }
                if (size.width <= 0 || size.height <= 0) continue;
                NSString *description = axString(element, kAXDescriptionAttribute), *title = axString(element, kAXTitleAttribute), *identifier = axString(element, kAXIdentifierAttribute);
                BarItemRole role = BarItemOther;
                if (pid == me) role = [description containsString:@"menu bar icons"] ? BarItemArrow : [description isEqualToString:@"BuddyMac"] ? BarItemIcon : BarItemDivider;
                // The clock and Control Centre are pinned to the right end by macOS.
                else if ([identifier isEqualToString:@"com.apple.menuextra.clock"] || [identifier isEqualToString:@"com.apple.menuextra.controlcenter"]) role = BarItemFixed;
                [items addObject:@{@"element": child, @"pid": @(pid), @"bundle": pid == me ? @"org.buddytools.BuddyMac" : bundle, @"app": app.localizedName ?: bundle,
                    @"description": description, @"title": title, @"identifier": identifier, @"role": @(role), @"iconPath": appIconPath(app, bundle),
                    @"frame": [NSValue valueWithRect:NSMakeRect(point.x, point.y, size.width, size.height)]}];
            }
        }
        if (children) CFRelease(children);
        if (bar) CFRelease(bar);
        CFRelease(application);
    }
    [items sortUsingComparator:^NSComparisonResult(NSDictionary *a, NSDictionary *b) {
        CGFloat x = [a[@"frame"] rectValue].origin.x, y = [b[@"frame"] rectValue].origin.x;
        return x < y ? NSOrderedAscending : x > y ? NSOrderedDescending : NSOrderedSame;
    }];
    // Same app and label can repeat (two Control Centre icons without a label), so the key adds a running count.
    NSMutableDictionary<NSString *, NSNumber *> *seen = [NSMutableDictionary new];
    NSMutableArray<NSDictionary *> *keyed = [NSMutableArray new];
    for (NSDictionary *item in items) {
        NSString *label = [item[@"identifier"] length] ? item[@"identifier"] : item[@"description"];
        NSString *base = [NSString stringWithFormat:@"%@|%@", item[@"bundle"], label];
        NSInteger count = seen[base].integerValue; seen[base] = @(count + 1);
        NSMutableDictionary *copy = [item mutableCopy]; copy[@"key"] = [NSString stringWithFormat:@"%@|%ld", base, (long)count];
        [keyed addObject:copy];
    }
    return keyed;
}

static NSDictionary *barItem(NSArray<NSDictionary *> *items, BarItemRole role) {
    for (NSDictionary *item in items) if ([item[@"role"] integerValue] == role) return item;
    return nil;
}
static NSDictionary *barItemWithKey(NSArray<NSDictionary *> *items, NSString *key) {
    for (NSDictionary *item in items) if ([item[@"key"] isEqualToString:key]) return item;
    return nil;
}
// Hidden icons sit left of the divider's right edge, whether the divider is short (shown) or stretched (hidden).
static BOOL itemHidden(NSDictionary *item, NSDictionary *divider) {
    return divider && NSMidX([item[@"frame"] rectValue]) < NSMaxX([divider[@"frame"] rectValue]);
}

static NSString *layoutJSON(NSArray<NSDictionary *> *items) {
    NSDictionary *divider = barItem(items, BarItemDivider);
    NSMutableArray *rows = [NSMutableArray new];
    for (NSDictionary *item in items) {
        BarItemRole role = [item[@"role"] integerValue];
        if (role == BarItemArrow || role == BarItemDivider || role == BarItemFixed) continue;
        NSString *bundle = item[@"bundle"], *description = item[@"description"], *title = item[@"title"], *app = item[@"app"];
        BOOL system = [bundle hasPrefix:@"com.apple."];
        NSString *name = role == BarItemIcon ? @"BuddyMac" : system && description.length ? description : app.length ? app : bundle;
        NSString *detail = role == BarItemIcon ? @"This app" : system ? app : title.length ? title : description.length && ![description isEqualToString:name] ? description : bundle;
        [rows addObject:@{@"key": item[@"key"], @"name": name ?: @"", @"detail": detail ?: @"", @"bundleId": bundle, @"icon": item[@"iconPath"],
            @"hidden": @(itemHidden(item, divider)), @"own": @(role == BarItemIcon), @"x": @([item[@"frame"] rectValue].origin.x)}];
    }
    NSData *data = [NSJSONSerialization dataWithJSONObject:rows options:0 error:nil];
    return [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
}

static void publishLayout(NSArray<NSDictionary *> *items) {
    NSString *json = layoutJSON(items);
    @synchronized (layoutLock) { layoutItems = json; layoutScans++; }
}

static void layoutSetup(void) {
    if (layoutQueue) return;
    layoutQueue = dispatch_queue_create("org.buddytools.BuddyMac.menubar-layout", DISPATCH_QUEUE_SERIAL);
    layoutLock = [NSObject new];
}

bool buddymac_accessibility(bool prompt) { @autoreleasepool {
    return AXIsProcessTrustedWithOptions((__bridge CFDictionaryRef)@{(__bridge NSString *)kAXTrustedCheckOptionPrompt: @(prompt)});
}}

// Starts a fresh read unless one is running. The result arrives in buddymac_menubar_layout.
void buddymac_menubar_scan(void) { @autoreleasepool {
    layoutSetup();
    if (!AXIsProcessTrusted()) return;
    @synchronized (layoutLock) { if (layoutScanning || menuBarMoving) return; layoutScanning = YES; }
    dispatch_async(layoutQueue, ^{ @autoreleasepool {
        NSArray *items = readMenuBar();
        publishLayout(items);
        @synchronized (layoutLock) { layoutScanning = NO; }
    }});
}}

const char *buddymac_menubar_layout(void) { @autoreleasepool {
    layoutSetup();
    NSString *items; BOOL scanning; NSInteger scans;
    @synchronized (layoutLock) { items = layoutItems; scanning = layoutScanning || menuBarMoving; scans = layoutScans; }
    NSString *json = [NSString stringWithFormat:@"{\"trusted\":%@,\"scanning\":%@,\"moving\":%@,\"scans\":%ld,\"items\":%@}",
        AXIsProcessTrusted() ? @"true" : @"false", scanning ? @"true" : @"false", menuBarMoving ? @"true" : @"false", (long)scans, items];
    return returned(&layoutResult, json);
}}

static void postMouse(CGEventSourceRef source, CGEventType type, CGPoint point) {
    CGEventRef event = CGEventCreateMouseEvent(source, type, point, kCGMouseButtonLeft);
    CGEventSetFlags(event, kCGEventFlagMaskCommand);
    CGEventPost(kCGHIDEventTap, event);
    CFRelease(event);
}
static void postCommand(CGEventSourceRef source, BOOL down) {
    CGEventRef event = CGEventCreateKeyboardEvent(source, (CGKeyCode)kVK_Command, down);
    CGEventSetFlags(event, down ? kCGEventFlagMaskCommand : 0);
    CGEventPost(kCGHIDEventTap, event);
    CFRelease(event);
}

// The top edge, in global top-left coordinates, of the display whose menu bar holds this point.
static CGFloat displayTop(CGFloat x) {
    uint32_t count = 0; CGDirectDisplayID displays[16];
    CGGetActiveDisplayList(16, displays, &count);
    for (uint32_t index = 0; index < count; index++) {
        CGRect bounds = CGDisplayBounds(displays[index]);
        if (x >= CGRectGetMinX(bounds) && x < CGRectGetMaxX(bounds)) return CGRectGetMinY(bounds);
    }
    return 0;
}

static void finishMove(NSArray<NSDictionary *> *items, BOOL wasCollapsed, BOOL ok, NSString *message) {
    if (items) publishLayout(items);
    dispatch_async(dispatch_get_main_queue(), ^{
        menuBarMoving = NO;
        if (wasCollapsed && menuBarArrow) menuBarCollapse(YES);
        NSData *data = [NSJSONSerialization dataWithJSONObject:@{@"action": @"menubar-moved", @"ok": @(ok), @"message": message ?: @""} options:0 error:nil];
        [actions addObject:[[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding]];
    });
}

// Moves one icon to the hidden or the shown side. Returns 1 when started, 0 while another move runs, -1 when the
// arrow and divider are off, -2 without Accessibility. The outcome arrives as a menubar-moved action.
int buddymac_menubar_move(const char *keyText, bool hide) { @autoreleasepool {
    layoutSetup();
    if (!menuBarArrow) return -1;
    if (!AXIsProcessTrusted()) return -2;
    if (menuBarMoving) return 0;
    NSString *key = [NSString stringWithUTF8String:keyText];
    menuBarMoving = YES;
    BOOL wasCollapsed = menuBarCollapsed;
    // Hidden icons are off screen. Show them for the move; they hide again afterwards if they were hidden.
    if (wasCollapsed) menuBarCollapse(NO);
    dispatch_async(layoutQueue, ^{ @autoreleasepool {
        usleep(400000);
        NSArray<NSDictionary *> *items = readMenuBar();
        NSDictionary *item = barItemWithKey(items, key), *divider = barItem(items, BarItemDivider);
        if (!item || !divider) { finishMove(items, wasCollapsed, NO, item ? @"The BuddyMac divider is not in the menu bar." : @"That icon is no longer in the menu bar."); return; }
        if (itemHidden(item, divider) == hide) { finishMove(items, wasCollapsed, YES, @""); return; }
        CGEventRef now = CGEventCreate(NULL);
        CGPoint original = CGEventGetLocation(now);
        CFRelease(now);
        CGEventSourceRef source = CGEventSourceCreate(kCGEventSourceStateCombinedSessionState);
        // An auto-hidden menu bar only takes clicks once it has slid down: rest the pointer on the top edge first.
        CGRect dividerFrame = [divider[@"frame"] rectValue];
        CGPoint reveal = CGPointMake(NSMidX(dividerFrame), displayTop(NSMidX(dividerFrame)) + 1);
        CGWarpMouseCursorPosition(reveal);
        postMouse(source, kCGEventMouseMoved, reveal);
        usleep(1000000);
        items = readMenuBar();
        item = barItemWithKey(items, key); divider = barItem(items, BarItemDivider);
        if (!item || !divider) { CGWarpMouseCursorPosition(original); CFRelease(source); finishMove(items, wasCollapsed, NO, @"The menu bar changed during the move. Try again."); return; }
        CGRect itemFrame = [item[@"frame"] rectValue];
        dividerFrame = [divider[@"frame"] rectValue];
        // Dropping on the divider's left edge puts the icon left of it (hidden); its right edge, right of it (shown).
        CGPoint start = CGPointMake(NSMidX(itemFrame), NSMidY(itemFrame));
        CGPoint end = CGPointMake(hide ? NSMinX(dividerFrame) + 1 : NSMaxX(dividerFrame) - 1, NSMidY(dividerFrame));
        postCommand(source, YES); usleep(50000);
        CGWarpMouseCursorPosition(start); postMouse(source, kCGEventMouseMoved, start); usleep(50000);
        postMouse(source, kCGEventLeftMouseDown, start); usleep(300000);
        for (int step = 1; step <= 12; step++) {
            CGFloat t = step / 12.0;
            postMouse(source, kCGEventLeftMouseDragged, CGPointMake(start.x + (end.x - start.x) * t, start.y + (end.y - start.y) * t));
            usleep(25000);
        }
        usleep(200000);
        postMouse(source, kCGEventLeftMouseUp, end); usleep(50000);
        postCommand(source, NO);
        CGWarpMouseCursorPosition(original);
        CFRelease(source);
        usleep(700000);
        items = readMenuBar();
        item = barItemWithKey(items, key); divider = barItem(items, BarItemDivider);
        BOOL moved = item && divider && itemHidden(item, divider) == hide;
        finishMove(items, wasCollapsed, moved, moved ? @"" : @"macOS did not move that icon. Some system icons cannot move; others can be Command-dragged by hand.");
    }});
    return 1;
}}

static char *pointerJSON;
const char *buddymac_pointer_state(void) { @autoreleasepool {
    NSPoint point = NSEvent.mouseLocation;
    NSMutableArray *screens = [NSMutableArray new];
    for (NSScreen *screen in NSScreen.screens) {
        CGFloat top = 0;
        if (@available(macOS 12.0, *)) top = screen.safeAreaInsets.top;
        [screens addObject:@{@"x": @(screen.frame.origin.x), @"y": @(screen.frame.origin.y), @"width": @(screen.frame.size.width), @"height": @(screen.frame.size.height), @"notch": @(top), @"visibleTop": @(NSMaxY(screen.visibleFrame))}];
    }
    NSWindow *window = platform.mainWindow;
    NSDictionary *state = @{@"x": @(point.x), @"y": @(point.y), @"down": @((NSEvent.pressedMouseButtons & 1) != 0), @"screens": screens,
        @"window": window ? @{@"x": @(window.frame.origin.x), @"y": @(window.frame.origin.y), @"width": @(window.frame.size.width), @"height": @(window.frame.size.height), @"visible": @(window.visible), @"key": @(window.keyWindow)} : @{@"visible": @NO}};
    NSData *data = [NSJSONSerialization dataWithJSONObject:state options:0 error:nil];
    return returned(&pointerJSON, [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding]);
}}

void buddymac_hide_window(void) { @autoreleasepool { if (platform.mainWindow) [platform.mainWindow orderOut:nil]; } }
void buddymac_show_window(void) { @autoreleasepool {
    [NSApp unhideWithoutActivation];
    [NSApp activateIgnoringOtherApps:YES];
    [platform.mainWindow makeKeyAndOrderFront:nil];
}}
bool buddymac_window_visible(void) { @autoreleasepool { return platform.mainWindow ? platform.mainWindow.visible : false; } }
bool buddymac_window_key(void) { @autoreleasepool { return platform.mainWindow ? platform.mainWindow.keyWindow && NSApp.active : false; } }
