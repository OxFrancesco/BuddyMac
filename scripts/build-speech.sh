#!/bin/zsh
set -euo pipefail
cd "${0:A:h}/.."
mkdir -p native/speech/build/Frameworks
if [[ ! -d native/speech/build/Frameworks/llama.framework ]]; then
  llama_source="/Applications/BuddyTalk.app/Contents/Frameworks/llama.framework"
  if [[ ! -d "$llama_source" ]]; then
    print -u2 "Place the llama b10856 macOS framework in native/speech/build/Frameworks/llama.framework before building."
    exit 1
  fi
  cp -R "$llama_source" native/speech/build/Frameworks/
fi
swiftc -swift-version 6 -O -parse-as-library -module-cache-path native/speech/build/ModuleCache \
  native/speech/Core/*.swift native/speech/Platform/*.swift native/speech/Models/*.swift native/speech/*.swift \
  -framework AppKit -framework AVFoundation -framework Security -framework ApplicationServices -framework Carbon -framework ScreenCaptureKit -framework LocalAuthentication \
  -F native/speech/build/Frameworks -framework llama \
  -Xlinker -rpath -Xlinker @executable_path/Frameworks \
  -Xlinker -rpath -Xlinker @executable_path/../Frameworks \
  -o native/speech/build/buddymac-speech
