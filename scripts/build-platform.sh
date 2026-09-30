#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p dist/native
clang -fobjc-arc -dynamiclib native/platform.m -o dist/native/libbuddymac.dylib -framework AppKit -framework CoreText -framework ServiceManagement -framework Carbon -mmacosx-version-min=14.0
