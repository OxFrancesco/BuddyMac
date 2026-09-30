# Native verification target

Compile with `bash native/verification/build.sh`. Build does not launch the app.

Artifacts:

- `dist/verification/BuddyMac Verification Target.app`
- `dist/verification/verification-target-ax`

Launch the app executable with `BUDDYMAC_VERIFICATION_OUTPUT_DIR` set to an existing, empty directory beneath `/tmp` or the system temporary directory. Use a new directory for each run. Example:

```sh
verification_output=$(mktemp -d /private/tmp/buddymac-verification-target-XXXXXX)
BUDDYMAC_VERIFICATION_OUTPUT_DIR="$verification_output" \
  "dist/verification/BuddyMac Verification Target.app/Contents/MacOS/VerificationTarget"
```

The window has AppKit screen frame `x=100,y=100,width=600,height=400`, using macOS bottom-left coordinates. Its title is `BuddyMac Verification Target`. The drop destination is content coordinates `x=20,y=225,width=560,height=130`; the editable text is below it. The initial text is `this are a test sentence.` and starts fully selected.

`state.json` records process ID, readiness, current text, selected UTF-16 range, timestamped text/selection snapshots, and each received drop. A successful drop means every received regular file was copied into a new UUID batch directory, reread, and compared byte-for-byte. Each file record includes source path, copied path, size, and both SHA256 digests. Source files are never moved or altered. The receiver accepts copy operations only. Failed or partial copy attempts are recorded with `accepted:false`.

The AX helper permits only this fixture bundle identifier and the supplied PID:

```sh
dist/verification/verification-target-ax "$target_pid" read
dist/verification/verification-target-ax "$target_pid" select-all
dist/verification/verification-target-ax "$target_pid" focus
```

It reports current and selected text. `select-all` focuses the fixture and selects its current text. The helper cannot set text or manipulate any other app. It requires Accessibility access and does not open a permission prompt. Failure is explicit. Use receiver `state.json` to check actual insertion independently of AX reads.

Copy/Paste/Select All menu actions support genuine keyboard events. Closing the fixture window quits only the fixture. Neither binary is included in the BuddyMac product app.

Verification performed by the implementation agent: Swift compilation and ad-hoc signing only. No app launch, physical drag, AX permission prompt or insertion test was performed.

## Physical pointer verification

`dist/verification/verification-pointer list` lists only on-screen packaged BuddyMac and this receiver's windows, with window IDs and CoreGraphics screen bounds. These coordinates use the main display top-left origin, unlike AppKit frame coordinates.

```sh
dist/verification/verification-pointer drag "$buddymac_window_id" "$target_window_id" "$file_row_screen_x" "$file_row_screen_y"
```

The source coordinate must be a visible file row inside the specified BuddyMac window. The receiver drop center is calculated from its fixed layout. Both points must be unobscured and the receiver center must lie outside the BuddyMac window. The command requires existing Accessibility and event-posting access, checks that no mouse button is already held, and never requests permission. It sends a real left-down/drag/up sequence and restores the original pointer position afterward. It reports coordinates only, not success of file delivery. Verify `state.json` has a new accepted drop with matching copied digests, then verify BuddyMac shelf removal independently. Run serially while no human or other agent is using the pointer.

The implementation agent compiled and signature-verified the pointer binary without executing it.
