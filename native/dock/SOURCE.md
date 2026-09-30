The native inspector and applier were adapted from `/Volumes/T6-7/Coding/Personal/BuddyDock/native`, commit `6ae920fa679226a7d02652514af8401bb2c0489e`.

BuddyMac removes application relaunch, limits mutation to account-owned application bundles, and compares decoded artwork from the stored icon resource fork. IconServices rasterization produced false mismatches when comparing the same artwork through NSWorkspace.

The TypeScript interface in `src/dock.ts` retains explicit app selection and apply-if-missing behavior without the original generation, credentials, Ghostty configuration, or launchd integration. Managed selections copy their artwork into BuddyMac's own data directory. The original BuddyDock manifest and agent are unchanged.
