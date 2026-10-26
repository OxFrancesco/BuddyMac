#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p dist/native
swiftc -O -parse-as-library -swift-version 5 -module-cache-path /private/tmp/buddymac-swift-module-cache native/camera/Camera.swift -o dist/native/buddymac-camera -framework AppKit -framework AVFoundation -framework CoreMedia
