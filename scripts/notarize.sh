#!/bin/zsh
set -euo pipefail
cd "${0:A:h}/.."
app="$PWD/dist/BuddyMac.app"
archive="$PWD/dist/BuddyMac-darwin-arm64.zip"
codesign --verify --deep --strict "$app"
ditto -c -k --sequesterRsrc --keepParent "$app" "$archive"
asc notarization submit --file "$archive" --wait --timeout 1h
xcrun stapler staple "$app"
xcrun stapler validate "$app"
spctl --assess --type execute --verbose=4 "$app"
ditto -c -k --sequesterRsrc --keepParent "$app" "$archive"
shasum -a 256 "$archive"
