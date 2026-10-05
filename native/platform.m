#import <AppKit/AppKit.h>
#import <CoreText/CoreText.h>
#import <ServiceManagement/ServiceManagement.h>
#import <Carbon/Carbon.h>
#import <objc/runtime.h>

static NSMutableArray<NSString *> *actions;
static NSStatusItem *statusItem;
static NSString *lastAction;
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
static NSString *hotkeyError;
static OSStatus hotkeyPressed(EventHandlerCallRef next, EventRef event, void *context) {
    EventHotKeyID identifier;
    if (GetEventParameter(event, kEventParamDirectObject, typeEventHotKeyID, NULL, sizeof(identifier), NULL, &identifier) != noErr) return eventNotHandledErr;
    NSString *name = hotkeyNames[@(identifier.id)];
    if (!name) return eventNotHandledErr;
    NSData *data = [NSJSONSerialization dataWithJSONObject:@{@"action": @"hotkey", @"id": name} options:0 error:nil];
    [actions addObject:[[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding]];
    return noErr;
}

void buddymac_init(const char *fontDirectory) {
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
}
void buddymac_menu(void) {
    [NSApp setActivationPolicy:NSApplicationActivationPolicyAccessory];
    statusItem=[[NSStatusBar systemStatusBar] statusItemWithLength:NSVariableStatusItemLength];
    statusItem.button.image=[NSImage imageWithSystemSymbolName:@"square.grid.2x2" accessibilityDescription:@"BuddyMac"];
    NSMenu *menu=[NSMenu new];
    NSArray *focusItems=@[@[@"Start or Pause Timer",@"focus-toggle"],@[@"Skip Phase",@"focus-skip"],@[@"Show Focus Panel",@"focus-panel"]];
    for (NSArray *entry in focusItems) {
        NSMenuItem *item=[[NSMenuItem alloc] initWithTitle:entry[0] action:@selector(choose:) keyEquivalent:@""];
        item.target=platform; item.representedObject=entry[1]; [menu addItem:item];
    }
    [menu addItem:[NSMenuItem separatorItem]];
    for (NSString *name in @[@"Files",@"Talk",@"Write",@"Focus",@"Dock",@"Liny",@"Settings"]) {
        NSMenuItem *item=[[NSMenuItem alloc] initWithTitle:name action:@selector(choose:) keyEquivalent:@""];
        item.target=platform; item.representedObject=name; [menu addItem:item];
    }
    [menu addItem:[NSMenuItem separatorItem]];
    NSMenuItem *quit=[[NSMenuItem alloc] initWithTitle:@"Quit BuddyMac" action:@selector(choose:) keyEquivalent:@"q"];
    quit.target=platform; quit.representedObject=@"quit"; [menu addItem:quit]; statusItem.menu=menu;
}
const char *buddymac_next_action(void) {
    if (!actions.count) return "";
    lastAction=actions.firstObject; [actions removeObjectAtIndex:0]; return lastAction.UTF8String;
}
int buddymac_drag(const char *json) {
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
}
void buddymac_copy_text(const char *text) {
    [[NSPasteboard generalPasteboard] clearContents];
    [[NSPasteboard generalPasteboard] setString:[NSString stringWithUTF8String:text] forType:NSPasteboardTypeString];
}

static NSString *secretResult;
const char *buddymac_prompt_secret(void) {
    NSAlert *alert=[NSAlert new]; alert.messageText=@"Provider API key";
    alert.informativeText=@"Enter the API key for the selected provider.";
    [alert addButtonWithTitle:@"Save key"]; [alert addButtonWithTitle:@"Cancel"];
    NSSecureTextField *field=[[NSSecureTextField alloc] initWithFrame:NSMakeRect(0,0,360,26)];
    alert.accessoryView=field; [alert.window setInitialFirstResponder:field];
    secretResult=[alert runModal]==NSAlertFirstButtonReturn ? [field.stringValue copy] : @"";
    return secretResult.UTF8String;
}
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
void buddymac_keep_running(void) {
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
}
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

static NSString *loginError;
bool buddymac_login_enabled(void) { return SMAppService.mainAppService.status == SMAppServiceStatusEnabled; }
const char *buddymac_set_login(bool enabled) { NSError *error=nil; if(enabled) [SMAppService.mainAppService registerAndReturnError:&error]; else [SMAppService.mainAppService unregisterAndReturnError:&error]; loginError=error.localizedDescription ?: @""; return loginError.UTF8String; }


void buddymac_record_shortcut(bool enabled, bool allowFn) { recordingShortcut = enabled; recordingFn = allowFn; }
static NSString *labelResult;
const char *buddymac_key_label(int keyCode) { labelResult = keyLabel((UInt16)keyCode); return labelResult.UTF8String; }

const char *buddymac_register_hotkeys(const char *json) {
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
    hotkeyError = [failed componentsJoinedByString:@","];
    return hotkeyError.UTF8String;
}

static NSString *statusTitle;
void buddymac_status_title(const char *title) {
    statusTitle = [NSString stringWithUTF8String:title];
    if (!statusItem) return;
    statusItem.button.title = statusTitle.length ? [@" " stringByAppendingString:statusTitle] : @"";
    statusItem.button.imagePosition = statusTitle.length ? NSImageLeft : NSImageOnly;
    statusItem.button.font = [NSFont monospacedDigitSystemFontOfSize:12 weight:NSFontWeightMedium];
}

static NSString *pointerJSON;
const char *buddymac_pointer_state(void) {
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
    pointerJSON = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
    return pointerJSON.UTF8String;
}

void buddymac_hide_window(void) { if (platform.mainWindow) [platform.mainWindow orderOut:nil]; }
void buddymac_show_window(void) {
    [NSApp unhideWithoutActivation];
    [NSApp activateIgnoringOtherApps:YES];
    [platform.mainWindow makeKeyAndOrderFront:nil];
}
bool buddymac_window_visible(void) { return platform.mainWindow ? platform.mainWindow.visible : false; }
bool buddymac_window_key(void) { return platform.mainWindow ? platform.mainWindow.keyWindow && NSApp.active : false; }
