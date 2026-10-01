# BuddyMac installer

```sh
npx buddymac
```

Downloads BuddyMac to `~/Applications` and opens it. Requires an Apple Silicon Mac running macOS 26 or later and Node.js 20 or later. No Bun installation is needed.

The installer shows download progress and checks a pinned SHA-256 checksum, Francesco Oddo's Apple Developer signature, and macOS Gatekeeper approval. It does not overwrite existing apps or change your app data. To update, quit BuddyMac and move the previous app out of the destination first.

```sh
npx buddymac --no-open
npx buddymac --destination /Applications
npx buddymac --help
```

The app is signed and notarized by Apple, with the notarization ticket included. The installer preserves macOS download protection.

Source and downloads: https://github.com/OxFrancesco/BuddyMac

The installer downloads the notarized app using macOS curl with HTTP/2 and a smaller tar.xz archive. The installed app remains in Applications after Terminal closes.
