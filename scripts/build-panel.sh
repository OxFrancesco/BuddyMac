#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p dist/native
clang -O2 -fobjc-arc -dynamiclib native/panel.m -o dist/native/libbuddymac-panel.dylib -framework AppKit -framework CoreGraphics
