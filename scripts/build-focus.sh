#!/bin/zsh
set -euo pipefail
cd "${0:A:h}/.."
mkdir -p dist
swiftc -module-cache-path /private/tmp/buddymac-swift-module-cache -O -swift-version 6 -package-name BuddyMacFocus -module-name NotchFlowCore native/focus/*.swift -o dist/buddymac-focus
swiftc -module-cache-path /private/tmp/buddymac-swift-module-cache -O -swift-version 6 -emit-library native/focus/notifications/Notifications.swift -o dist/libbuddymac-notifications.dylib
