#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p dist/native
swiftc -O -module-cache-path /private/tmp/buddymac-swift-module-cache native/files/Store.swift native/files/main.swift -o dist/native/buddymac-files -framework AppKit
