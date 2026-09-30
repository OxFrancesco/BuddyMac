#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p dist/native
clang -O2 -fobjc-arc -dynamiclib native/edge.m -o dist/native/libbuddymac-edge.dylib -framework AppKit
