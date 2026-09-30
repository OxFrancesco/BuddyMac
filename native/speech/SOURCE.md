# Speech and writing service

This executable runs inside BuddyMac. It does not launch BuddyTalk or BuddyWrite.

Adapted from Francesco's BuddyTalk source at commit `b5f8851be21e44400d8bf3db440c5ead4999592f`:

- `Core/` networking, transcription fallback, provider diagnostics, text processing and S1-mini runtime.
- `Platform/` microphone capture, focused-target insertion, permissions, screen capture and Talk shortcuts.
- `Models/AppData.swift`, `MemoryFile.swift` and `ShortcutBindings.swift` preserve the original JSON format and clipboard guarantees.
- `Overlay/` is BuddyTalk's dictation pill (`RecordingOverlay`, `ThinkingOrbView`, `ThinkingOrbGeometry`) with BuddyMac's palette, square corners and IBM Plex Mono. The helper shows it from its own phases once BuddyMac sends `setOverlay`, so isolated helpers never draw it.

Adapted from BuddyGrammar, the BuddyWrite source, at commit `fcc9d004c01565d9e5f8af09f4cdc117f8199a65`:

- Writing settings, profile, note, hotkey and vocabulary models.
- `Platform/WriteHotkeys.swift` now rejects registration failures and filters event signatures so Talk and Write registrations do not intercept each other.

`Storage.swift`, `Service.swift`, `Main.swift` and `src/speech.ts` implement BuddyMac's private stores and JSON-lines connection. Data-dir overrides disable real Keychain access and legacy imports for isolated checks. Keychain status reads only attributes with UI disabled. Key values stay in the native process and are only resolved noninteractively for an explicit cloud operation. If a legacy key needs an authorization dialog, the request fails with instructions to save a key in BuddyMac Talk settings. Startup does not record audio, load model weights, register global shortcuts or call a provider.

Talk snapshots live at `~/Library/Application Support/BuddyMac/Speech/Imported/BuddyTalk-settings.json`; Write's three JSON preference values are in `Imported/BuddyWrite.plist`. Active editable files are `settings.json`, `writing.json`, and `memory.md`. Files are 0600 and the Speech root is 0700. Original stores and model weights remain unchanged. Deleting active history does not delete immutable import snapshots or the original app's history.

The llama b10856 macOS framework is copied from the installed BuddyTalk app into `build/Frameworks/llama.framework`, then packaged in BuddyMac's `Contents/Frameworks`. The build links both development and app-bundle rpaths. The packaged app has no dependency on the original app. The MIT license is included under `ThirdParty/llama-LICENSE`.

S1-mini verifies the pinned file length and SHA-256 before loading. It reads the existing BuddyTalk model when available, or a BuddyMac model explicitly downloaded by the user. It never downloads at launch. Local cleanup failures keep the raw transcript and do not fall back to cloud cleanup. Cloud transcription is still required for Talk recording.

## Verification

Run `scripts/build-speech.sh`, then `bun test src/speech.test.ts`. Tests launch the real helper with synthetic private stores and make no provider or microphone requests. They verify preference/profile/note persistence, history dates and deletion, noninteractive initialization, no-key failure, local-provider fidelity, shortcut conflicts and corrupt-file preservation.

## Remaining parity gaps

- Write's Apple, ElevenLabs and Whisper transcription routes and voice shortcut are preserved in the imported configuration but not activated.
- Local MLX rewriting is preserved as a provider choice and returns an explicit unavailable error. It never silently switches to cloud. The verified installed Write setting is OpenRouter `openai/gpt-5.4-nano`.
- OpenRouter model discovery, profile-specific test previews and Write's updater are not implemented by this helper.
- Unified launch-at-login belongs to the BuddyMac app; the imported Talk launch flag does not register this helper.
- Talk dictation shows the native pill at the bottom of the screen. The GPUix compact recorder still opens explicitly from Talk. `bun scripts/capture-pill.ts` screenshots every pill state through `previewOverlay`.
- An attempted synthetic cloud rewrite was blocked by the legacy Keychain authorization requirement. Noninteractive reads now fail explicitly instead of blocking the helper main loop. Actual microphone capture, cloud provider behavior and insertion into an external app still require live user-driven verification. The subprocess tests do not establish them.

Verified on 2026-09-28: Swift 6 build passed; 5 real subprocess tests passed with 41 assertions; the root TypeScript check passed. A synthetic S1-mini request using the verified existing weights returned `Hello world.` from `um hello world`. First verified load took 22,098 ms; a repeat in a new process with warm caches took 764 ms. Cancellation of a second local request returned the service to idle. These GPU checks required normal host execution because the tool sandbox denied GPU initialization. Neither check used a microphone or network request.
