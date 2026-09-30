# App size reduction

Measured on 2026-09-30. Sizes below are decimal MB; app totals count regular file contents once and exclude symlinks.

| Artifact | Before | After |
| --- | ---: | ---: |
| App bundle | 178.18 MB | 108.68 MB |
| ZIP download | 69.11 MB | 42.59 MB |
| xz-compressed tar download | Not measured | 28.08 MB |

The app bundle is 39.0% smaller. The xz archive is 59.4% smaller than the previous ZIP, but still expands to a 108.68 MB app.

## Changes

- `BuddyMac --liny-worker` starts the agent in a separate process using the same executable as the UI. The app no longer packages `buddymac-liny`, which contained a second Bun runtime. Development still builds that standalone helper.
- The build strips local symbols from the copied GPUix native library before signing. The dependency in `node_modules` stays untouched; exported symbols remain available.
- The app's TypeScript check now includes the imported agent implementation and allows its existing `.ts` imports.

No features were removed or moved to optional downloads. The installed app was left unchanged. The previous built bundle remains in `dist/BuddyMac.previous.app`.

## Verification

- `bun run build`: passed, including the native runtime probe and signature checks.
- `bun run typecheck`: passed.
- `bun run test`: 65 passed, 1 skipped, 0 failed. The skipped check requires a cached S1 model.
- `bun scripts/verify-package.ts`: native loader, synthetic agent response, session persistence after subprocess restart and operation without external Bun on PATH passed.
- Packaged native UI walkthrough: 11 steps passed with isolated stores. The fixture run used direct Focus helper startup and disabled notifications. It did not verify LaunchServices/iCloud, live provider requests, microphone recording, real file dragging or live icon changes.

## Why this is not a fourfold reduction

Fourfold would require a bundle below 44.55 MB. The remaining main executable is 66.55 MB; GPUix is 18.50 MB and the local cleanup framework is 16.97 MB. Removing the duplicate runtime cannot meet that target alone. Replacing the JavaScript runtime or making major components separately installed would be a different project. Moving dependencies outside the app would not reduce total installed storage by the same amount.

## Repeat the measurement

```sh
bun scripts/app-size.ts dist/BuddyMac.app
ditto -c -k --sequesterRsrc --keepParent dist/BuddyMac.app dist/BuddyMac.zip
tar -cJf dist/BuddyMac.tar.xz -C dist BuddyMac.app
```
