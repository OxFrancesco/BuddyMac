# BuddyMac

A native GPUix app combining BuddyFiles, BuddyTalk, BuddyWrite, NotchFlow, BuddyDock, and Liny. Jesty is excluded.

The interface follows [Francesco's design guidelines](https://oddofrancesco.com/design): black, white, coral, Chakra Petch and IBM Plex Mono. Navigation is immediate. Compact Files, Focus, and Talk views use the same GPUix window.

## Run and build

Install the app with the [npm package](https://www.npmjs.com/package/buddymac):

```sh
npx buddymac
```

It installs or updates the signed Apple Silicon app in `~/Applications`, verifies the checksum and signing identity, and opens it. Requires macOS 26+ and Node.js 20+. Run the same command to update; quit BuddyMac when prompted. Settings stay saved, and the previous app is kept at `~/Applications/.buddymac-previous.app` for recovery. Current or newer versions skip the download. Use `--no-open` to install without launching, or `--destination <folder>` to choose another location. The release is notarized by Apple and checked by Gatekeeper before installation.

BuddyMac runs in the menu bar without a Dock icon. Choose a tool from its menu to open a window. Closing that window keeps the menu bar, shelves and shortcuts running.

To publish an installer update, run `zsh scripts/notarize.sh` after building. It submits to Apple, staples the ticket, checks Gatekeeper, and creates a ZIP for direct downloads plus a smaller `dist/BuddyMac-darwin-arm64.tar.xz` for the installer. Upload both to a GitHub release, update `packages/buddymac/release.json` with the app version, tar.xz download URL, SHA-256 and byte size, bump the package version, then run `bun publish --cwd packages/buddymac --access public`. Keep the release asset immutable because the installer pins its checksum. Installer versions can advance independently of the app version. Run `node scripts/verify-installer.mjs <version>` for an empty-cache public npm install, or append a packed `.tgz` path to verify a candidate before publishing.

```sh
bun install
bun run build
open dist/BuddyMac.app
```

The build needs Apple Silicon macOS, Xcode command-line tools, the configured Francesco Oddo Developer ID identity, a NotchFlow Developer ID provisioning profile at `dist/signing/focus.provisionprofile` or `BUDDYMAC_FOCUS_PROFILE`, the vendored OCU app, and BuddyTalk's llama framework for the initial build. The produced app bundles its runtime, fonts, native helpers, agent engine and framework. It runs without the original utility apps.

```sh
bun run typecheck
bun run test
bun run verify
BUDDYMAC_VERIFY_APP="$PWD/dist/BuddyMac.app/Contents/MacOS/BuddyMac" bun run verify
bun scripts/verify-package.ts
bun scripts/app-size.ts
```

The packaged UI and Liny agent share one Bun executable. Liny still runs in its own process using `BuddyMac --liny-worker`. The GPUix library has local symbols stripped before signing. `verify-package.ts` checks the packaged native loader, an isolated synthetic Liny reply and session persistence across restart with no external Bun on PATH. `app-size.ts` measures file contents without counting framework symlinks twice.

`verify` drives the native UI using isolated fixture stores and records `evidence/buddymac-walkthrough.mp4`. It does not record microphone audio, make model requests, or alter installed app icons. `scripts/verify-live-liny.ts` is a separate opt-in provider test; it imports the inspected source profile and sends a synthetic prompt with tools disabled.

## First use

Talk cleanup, Write rewriting and voice editing default to `~openai/gpt-luna-latest`. Upgrades migrate the old built-in Gemini defaults once and retain custom selections.

Talk can record Fn as a shortcut. In macOS Keyboard settings, set "Press Globe key to" to "Do Nothing" and allow BuddyMac Accessibility access to use Fn outside the app.

New installations start empty. BuddyMac does not automatically import settings, files, Dock packs, or local model weights from older utilities. Liny profile imports and sharing Focus with NotchFlow are explicit actions.

- Talk and Write: open Talk → Settings → Set API key. BuddyMac uses its own Keychain item. Legacy keys stay with their original apps.
- Recording and insertion: macOS grants microphone and Accessibility permissions separately. Enable shortcuts only after disabling overlapping shortcuts in the original apps.
- Files: Settings selects a normal window or a left/right edge shelf.
- Focus and Talk: Compact timer / Compact recorder opens a small floating view; Expand restores the full window.
- Dock: select saved artwork to apply it. Keep selected icons applied enables periodic repair; Stop automatic reapplication disables it.
- Liny: the active personal profile was copied to BuddyMac. Provider login, conversations, and new writes stay in the copied profile. Original data is unchanged.
- Start at login is opt-in. Closing the window keeps the menu-bar app running; Quit is in the menu-bar menu.

Data lives under `~/Library/Application Support/BuddyMac`. Existing utilities and startup settings remain intact. [Workflow coverage](docs/parity.md) lists remaining feature and verification gaps. Public releases are Developer ID signed and notarized.
