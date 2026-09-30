#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p dist/native
swiftc -O -module-cache-path /private/tmp/buddymac-swift-module-cache native/dock/DockInspector.swift -o dist/native/buddymac-dock-inspector -framework AppKit
swiftc -O -module-cache-path /private/tmp/buddymac-swift-module-cache native/dock/DockApplier.swift -o dist/native/buddymac-dock-applier -framework AppKit
