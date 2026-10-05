# BuddyMac installer

```sh
npx buddymac@latest
```

Downloads BuddyMac to `~/Applications` and opens it. Requires an Apple Silicon Mac running macOS 26 or later and Node.js 20 or later. No Bun installation is needed.

BuddyMac starts in the menu bar without a Dock icon. Choose a tool from its menu to open it; closing the window keeps BuddyMac running.

Run the same command to update. The installer downloads and verifies the new app first, then waits for you to quit BuddyMac before replacing it. Your settings and app data stay saved. A current or newer installed version is opened without downloading again.

The installer checks a pinned SHA-256 checksum, Francesco Oddo's Apple Developer signature, and macOS Gatekeeper approval. It keeps the previous app at `~/Applications/.buddymac-previous.app` and restores it if replacement fails. Interrupted replacements are recovered on the next run. The backup is replaced on the next successful update.

```sh
npx buddymac@latest --no-open
npx buddymac@latest --destination /Applications
npx buddymac@latest --help
```

The app is signed and notarized by Apple, with the notarization ticket included. The installer preserves macOS download protection.

Source and downloads: https://github.com/OxFrancesco/BuddyMac

The installer downloads the notarized app using macOS curl with HTTP/2 and a smaller tar.xz archive. The installed app remains in Applications after Terminal closes.
