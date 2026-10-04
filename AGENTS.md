
<!-- codeview:start -->

## Reference codebases (codeview)

The `resources/` folder contains read-only clones of reference codebases.
If you need to implement code specific to one of these codebases, read the relevant
folder to gather information, feedback, patterns, and templates before writing code.

- `resources/gpuix` — GPUix native React desktop renderer
- `resources/pi` — Official Pi coding agent source — RPC mode, SDK embedding, sessions, extensions, tools, and terminal UI

<!-- codeview:end -->

## Commands

- `bun run typecheck`, `bun run test`, `bun run verify` (native UI walkthrough with fixture stores), `bun run build` (signed app in `dist/BuddyMac.app`).
- `BUDDYMAC_VERIFY_APP="$PWD/dist/BuddyMac.app/Contents/MacOS/BuddyMac" bun run verify` runs the same walkthrough against the packaged app.
- `bun scripts/capture-views.ts [outDir]` screenshots every view, settings panel and compact view with fixture data (default `/private/tmp/buddymac-views`). Run it after any layout change.
- `bun scripts/capture-pill.ts [outDir]` screenshots every state of the native dictation pill (default `/private/tmp/buddymac-pill`). Rebuild the helper with `scripts/build-speech.sh` first.
- Install: stop the running BuddyMac, move `~/Applications/BuddyMac.app` to `dist/BuddyMac.installed-previous.app`, then `ditto dist/BuddyMac.app ~/Applications/BuddyMac.app`.

## UI layout rules

- GPUix `div` is block. Set `display: 'flex'` before `alignItems`, `justifyContent` or `gap`, or they are ignored.
- Spacing tokens live in `space` in `src/ui.tsx`: page padding 28, section gap 24, control height 36, header row 48, text inset 12. Build pages from `Page`, `Header`, `Panel`, `Labeled`, `Row` and `Column`.
- Buttons and fields share the 36px height. List rows inset their text 12px so it lines up with field text; quiet buttons carry the same 12px padding.
- GPUI builds and lays out every mounted element on every frame, including `visibility: 'hidden'` ones. Only the open section is mounted (`src/app.tsx`); typed text that must survive a section switch goes through `useSticky` in `src/sticky.ts`. Prefer one bitmap (`setImagePixels`) or `<virtual-list>` over hundreds of divs. `bun scripts/perf-focus.ts [--visit-all]` measures commit time and CPU.
- `Labeled` has a zero flex basis for side-by-side fields. In a column it collapses, so stacked labels use `Stacked`.
- `<img>` cannot load `.icns`. Dock converts pack artwork to cached PNGs with `iconPreview` in `src/dock.ts`.

## Native and process rules

- GPUI's window is its own delegate. `BuddyMacWindowDelegate` in `native/platform.m` forwards only `NSWindowDelegate` selectors; forwarding everything recursed forever through the Services menu. `src/platform-native.test.ts` covers it.
- `Bun.spawn` does not pick up `process.env` changes made after startup unless `env` is passed. Always pass `env: { ...process.env }` to helpers, or a test can write to the real stores.
- Focus shares NotchFlow's store after the takeover (`~/Library/Application Support/BuddyMac/Focus/location.json`). Packaged, the helper is `Contents/Helpers/BuddyMac Focus.app` (NotchFlow's bundle id and iCloud profile), started through LaunchServices and connected over a Unix socket. A directly spawned child cannot schedule CloudKit exports; LaunchServices gives it the background-task service.
- Never `pkill` the Focus helper by a pattern that also matches the installed app's helper. Never give `open --stdin` a FIFO without a writer: launchd's xpcproxy blocks and queues every later launch of that bundle id until it is killed.
