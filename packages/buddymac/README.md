# BuddyMac installer

```sh
npx buddymac
```

Downloads BuddyMac to `~/Applications` and opens it. Requires an Apple Silicon Mac running macOS 26 or later and Node.js 20 or later. No Bun installation is needed.

The installer checks a pinned SHA-256 checksum and Francesco Oddo's Apple Developer signature. It does not overwrite existing apps or change your app data. To update, quit BuddyMac and move the previous app out of the destination first.

```sh
npx buddymac --no-open
npx buddymac --destination /Applications
npx buddymac --help
```

This early release is signed but not notarized. If macOS blocks the first launch, open System Settings → Privacy & Security → Open Anyway. The installer preserves macOS download protection.

Source and downloads: https://github.com/OxFrancesco/BuddyMac
