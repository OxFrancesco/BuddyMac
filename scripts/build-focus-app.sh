#!/bin/zsh
# Wraps the Focus helper in an app bundle that carries NotchFlow's iCloud entitlement, so BuddyMac syncs
# the same CloudKit container as NotchFlow and its phone app. Without NotchFlow's provisioning profile the
# helper still runs, just without iCloud.
set -euo pipefail
cd "${0:A:h}/.."
app="dist/BuddyMac Focus.app"
rm -rf "$app"
profile="${BUDDYMAC_FOCUS_PROFILE:-}"
for candidate in "$HOME/Applications/NotchFlow.app/Contents/embedded.provisionprofile" "/Applications/NotchFlow.app/Contents/embedded.provisionprofile"; do
  [[ -z "$profile" && -f "$candidate" ]] && profile="$candidate"
done
if [[ -z "$profile" ]]; then echo "No NotchFlow provisioning profile found; Focus will run without iCloud." >&2; exit 0; fi
identity=$(security find-identity -v -p codesigning | awk -F'"' '/Apple Development: Francesco Oddo/ {print $2; exit}')
if [[ -z "$identity" ]]; then echo "No Apple Development identity; Focus will run without iCloud." >&2; exit 0; fi
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
codesign --force --sign "$identity" --entitlements native/focus/Focus.entitlements --timestamp=none "$app"
codesign --verify --strict "$app"
probe=$(mktemp -d)
ready=$(print '' | BUDDYMAC_FOCUS_HOME="$probe" "$app/Contents/MacOS/buddymac-focus" serve | head -1 || true)
rm -rf "$probe"
[[ "$ready" == *'"event":"ready"'* ]] || { echo "The signed Focus helper did not start: $ready" >&2; exit 1; }
echo "Built $app"
