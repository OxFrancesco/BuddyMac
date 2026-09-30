import AppKit
import ApplicationServices
let expected="org.buddytools.BuddyMacVerificationTarget"
guard AXIsProcessTrusted(), NSWorkspace.shared.frontmostApplication?.bundleIdentifier == expected else { fputs("Focus the verification target with existing Accessibility access first.\n",stderr);exit(1) }
guard let source=CGEventSource(stateID:.privateState),let down=CGEvent(keyboardEventSource:source,virtualKey:0,keyDown:true),let up=CGEvent(keyboardEventSource:source,virtualKey:0,keyDown:false) else {exit(1)}
down.flags=[.maskCommand,.maskShift,.maskControl,.maskAlternate];up.flags=down.flags
down.post(tap:.cghidEventTap);Thread.sleep(forTimeInterval:0.06);up.post(tap:.cghidEventTap)
