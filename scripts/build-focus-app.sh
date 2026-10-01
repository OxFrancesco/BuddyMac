#!/bin/zsh
# Distribute the Focus helper with the existing NotchFlow CloudKit container.
set -euo pipefail
cd "${0:A:h}/.."
app="dist/BuddyMac Focus.app"
rm -rf "$app"
profile="${BUDDYMAC_FOCUS_PROFILE:-dist/signing/focus.provisionprofile}"
[[ -f "$profile" ]] || { echo "Download a Developer ID profile for NotchFlow to $profile, or set BUDDYMAC_FOCUS_PROFILE." >&2; exit 1; }
identity="Developer ID Application: Francesco Oddo (G2442WAF29)"
mkdir -p "$app/Contents/MacOS"
cp dist/buddymac-focus "$app/Contents/MacOS/buddymac-focus"
cp "$profile" "$app/Contents/embedded.provisionprofile"
cat > "$app/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>com.avg-francesco.NotchFlow</string>
<key>CFBundleName</key><string>BuddyMac Focus</string>
<key>CFBundleExecutable</key><string>buddymac-focus</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
<key>CFBundleShortVersionString</key><string>0.1.0</string>
<key>CFBundleVersion</key><string>1</string>
<key>LSMinimumSystemVersion</key><string>14.0</string>
<key>LSUIElement</key><true/>
<key>LSBackgroundOnly</key><true/>
</dict></plist>
PLIST
printf 'APPL????' > "$app/Contents/PkgInfo"
codesign --force --sign "$identity" --options runtime --entitlements native/focus/Focus.entitlements --timestamp "$app"
codesign --verify --strict "$app"
probe=$(mktemp -d)
ready=$(print '' | BUDDYMAC_FOCUS_HOME="$probe" "$app/Contents/MacOS/buddymac-focus" serve | head -1 || true)
rm -rf "$probe"
[[ "$ready" == *'"event":"ready"'* ]] || { echo "The signed Focus helper did not start: $ready" >&2; exit 1; }
echo "Built $app"
