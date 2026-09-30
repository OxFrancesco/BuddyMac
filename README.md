# BuddyMac

A native GPUix app combining BuddyFiles, BuddyTalk, BuddyWrite, NotchFlow, BuddyDock, and Liny. Jesty is excluded.

The interface follows [Francesco's design guidelines](https://oddofrancesco.com/design): black, white, coral, Chakra Petch and IBM Plex Mono. Navigation is immediate. Compact Files, Focus, and Talk views use the same GPUix window.

## Run and build

```sh
bun install
bun run build
open dist/BuddyMac.app
```

The build needs Apple Silicon macOS, Xcode command-line tools, the configured Francesco Oddo Developer ID identity, the vendored OCU app, and BuddyTalk's llama framework for the initial build. The produced app bundles its runtime, fonts, native helpers, agent engine and framework. It runs without the original utility apps.

```sh
bun run typecheck
bun run test
bun run verify
BUDDYMAC_VERIFY_APP="$PWD/dist/BuddyMac.app/Contents/MacOS/BuddyMac" bun run verify
```

`verify` drives the native UI using isolated fixture stores and records `evidence/buddymac-walkthrough.mp4`. It does not record microphone audio, make model requests, or alter installed app icons. `scripts/verify-live-liny.ts` is a separate opt-in provider test; it imports the inspected source profile and sends a synthetic prompt with tools disabled.

## First use

- Talk and Write: open Talk → Settings → Set API key. BuddyMac uses its own Keychain item. Legacy keys stay with their original apps.
- Recording and insertion: macOS grants microphone and Accessibility permissions separately. Enable shortcuts only after disabling overlapping shortcuts in the original apps.
- Files: Settings selects a normal window or a left/right edge shelf.
- Focus and Talk: Compact timer / Compact recorder opens a small floating view; Expand restores the full window.
- Dock: select saved artwork to apply it. Keep selected icons applied enables periodic repair; Stop automatic reapplication disables it.
- Liny: the active personal profile was copied to BuddyMac. Provider login, conversations, and new writes stay in the copied profile. Original data is unchanged.
- Start at login is opt-in. Closing the window keeps the menu-bar app running; Quit is in the menu-bar menu.

Data lives under `~/Library/Application Support/BuddyMac`. Existing utilities and startup settings remain intact. [Workflow coverage](docs/parity.md) lists remaining feature and verification gaps. This is a locally signed build, not a notarized public release.
