# Independent review

The review was requested with model `gpt-5.6-terra`; the worker reported `gpt-6-astra`. Independent review ran, but different-family execution is not confirmed.

Accepted findings:

- Broad hardened-runtime entitlements were applied to all helpers. The build now gives JIT-related entitlements only to the Bun executables. Speech receives audio-input permission; Files, Dock, Focus and browser metadata helpers receive no custom entitlements.
- OAuth documentation said sign-in URLs were not opened. It now describes the actual explicit Connect flow.
- Bundle checks predated the compact-panel and default-browser helper additions. The new installed bundle includes both and passed the native UI run and clean-environment runtime check.
- Screenshot-only log entries could not substantiate full workflow counts. The final checkpoint points to the generated UI JSON and test transcript.

A signature check in the restricted reviewer environment reported an untrusted chain. The same strict/deep verification passed in the approved host environment after signing. The app is locally Developer ID signed, not notarized.

Earlier integration review also found and fixed cross-editor speech results, note-hotkey clipboard races, local-cleanup cancellation, capped-history refresh, warning clearing and asynchronous output replacement.

Still unverified: real microphone capture, external text insertion, physical file delivery, notification delivery, live computer control, and fullscreen/multiple-display interaction. Cloud transcription/rewrite needs a BuddyMac OpenRouter key.
