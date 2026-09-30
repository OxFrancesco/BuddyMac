#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/../.."
app="dist/verification/BuddyMac Verification Target.app"
mkdir -p "$app/Contents/MacOS"
swiftc -O -module-cache-path /private/tmp/buddymac-swift-module-cache native/verification/Target.swift -o "$app/Contents/MacOS/VerificationTarget" -framework AppKit -framework CryptoKit
swiftc -O -module-cache-path /private/tmp/buddymac-swift-module-cache native/verification/TargetAX.swift -o dist/verification/verification-target-ax -framework AppKit -framework ApplicationServices
cat > "$app/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>org.buddytools.BuddyMacVerificationTarget</string><key>CFBundleExecutable</key><string>VerificationTarget</string><key>CFBundleName</key><string>BuddyMac Verification Target</string><key>CFBundlePackageType</key><string>APPL</string><key>NSHighResolutionCapable</key><true/></dict></plist>
PLIST
codesign --force --sign - "$app"
codesign --force --sign - dist/verification/verification-target-ax

swiftc -O -module-cache-path /private/tmp/buddymac-swift-module-cache native/verification/Pointer.swift -o dist/verification/verification-pointer -framework AppKit -framework ApplicationServices
codesign --force --sign - dist/verification/verification-pointer
