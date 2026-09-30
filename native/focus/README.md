# Focus service

BuddyMac's GPUix UI calls `src/focus.ts`, which sends JSON over stdin to this bundled Swift service and parses its JSON snapshot response. No original NotchFlow app process is required.

The domain models, SwiftData schema, repository, filters, and analytics were copied from `/Volumes/T6-7/Coding/Personal/NotchFlow/Sources/NotchFlowCore`. The source commit was `722cf18ee81170e492d7d7a264c3a8dc384261bf`, with a clean working tree. The original repository is unchanged. BuddyMac removes starter tasks, adds Codable snapshots, uses its own distributed-notification name, and adds the JSON command service. The original module name `NotchFlowCore` is retained when compiling so imported SwiftData entities have their original identity.

Build with `scripts/build-focus.sh`; outputs are `dist/buddymac-focus` and `dist/libbuddymac-notifications.dylib`. Package and sign both next to the main app executable. `BUDDYMAC_FOCUS_HELPER` overrides the path for development. SwiftData compilation requires the compiler's macro subprocess to run, which may require the build to run outside a restrictive process sandbox.

Storage defaults to `~/Library/Application Support/BuddyMac/Focus/Focus.store`. `BUDDYMAC_FOCUS_HOME` selects an isolated directory. Every command holds the directory's flock while operating. The directory and its store files use private permissions. `BUDDYMAC_FOCUS_TEST_NOW` is a Unix timestamp used by isolated timer tests.

Commands return the complete snapshot. Task and check-in fields use ISO8601 dates. Commands with arguments read one JSON object on stdin:

- `snapshot`
- `task-add`: title, notes, projectName, tags, priority, optional dueDate.
- `task-edit`: same fields plus id. Completion counters and creation date are retained.
- `task-complete`: id, isCompleted.
- `task-delete`, `task-select`: id. Select accepts null for Inbox.
- `task-clear-completed`.
- `task-reorder`: ids, containing each current task exactly once.
- `notification-permission` and `notify` are retained only as disabled-alert test commands. Production notification calls run through the in-process library; invoking these helper commands directly reports that the running BuddyMac app is required.
- `timer-start`, `timer-pause`, `timer-reset`, `timer-skip`, `timer-tick`.
- `settings`: complete settings object.
- `check-in`: day, mood 1 through 5, text.
- `import-original`: optional source path. Default is the original NotchFlow store.

`timer-tick` settles one expired phase using the persisted deadline. One SwiftData save writes the task count, session, and next phase together. Repeated or concurrent ticks do not duplicate the finished session. `src/focus-state.ts` owns the process-wide timer loop and dispatches native notifications/sound when the returned phase changes. Call `startFocusService()` once during app startup and `stopFocusService()` on quit; mounting/unmounting FocusView does not own the loop. Native alert errors remain visible in Focus. Skip does not add a completed session. Timer display can count down locally between helper calls.

Import creates a transactionally consistent SQLite backup with `sqlite3 -readonly`, opens only that temporary copy with the original SwiftData schema, then copies decoded records through the repository. It keeps IDs, historical task references, settings, and check-ins. It pauses the copied timer to avoid two apps counting the same active session. Import refuses to overwrite a populated BuddyMac store. A marker makes a repeated import a no-op. Originals remain untouched.

BuddyMac's store is local-only. It deliberately does not connect to `iCloud.com.avg-francesco.NotchFlow`, does not inherit the existing app's entitlement, and does not sync with the NotchFlow mobile app. Supporting that requires an explicit shared-container/schema migration and a signed CloudKit-capable app. The original iCloud-backed app and its data remain available.

Validation: `bun test src/focus.test.ts` exercises the real SwiftData service with private temporary stores, edits, completed sessions, idempotency, daily check-in updates, import preserving records, unchanged source database bytes, and deletes. Tests print no imported user content.

The Focus view includes Tasks, History, and Check-ins. Task reorder/delete controls are in the editor. History shows completed sessions and nonzero today/week/streak summaries. Prior check-ins can be edited. `native/focus/verify-ui.ts` verifies these flows in a separate GPUix process using synthetic data and disabled notifications. Run it separately from other native UI captures with `bun native/focus/verify-ui.ts`. Its screenshots target `evidence/buddymac-focus-tasks.png`, `evidence/buddymac-focus-history.png`, and `evidence/buddymac-focus-checkins.png`.

## Notification attribution

`src/focus.ts` loads `libbuddymac-notifications.dylib` only when a notification operation is requested. Authorization, scheduling and sound execute inside the actual BuddyMac process, using its app bundle and signing identity. The separate SwiftData executable does not request permission. The native delegate presents foreground notifications; `focusNotificationStatus()` exposes authorization status and delivered Focus notification identifiers without returning notification content.

The C ABI uses `buddymac_notifications_start(jsonCString) -> Int32`, `buddymac_notifications_take(id) -> allocatedCStringOrNull`, `buddymac_notifications_free(pointer)` and `buddymac_notifications_cancel(id)`. Replies are JSON and consumed once. The TypeScript client polls asynchronously and cancels stale reply storage after a two-minute timeout. Scheduling success does not itself prove delivery; compare delivered identifiers before and after sending.

Verify permissions using the signed installed app launched by LaunchServices (`open -n`), then attach automation through redirected stdin/stdout. A direct Bun-spawned GUI can inherit the terminal/controller's responsible-process identity. `BUDDYMAC_FOCUS_DISABLE_ALERTS=1` bypasses both UI permission prompts and the native library for isolated tests. Standalone notification bridge hosts are rejected before calling UserNotifications.

`bun test native/focus/notifications/notifications.test.ts` covers host rejection, the no-prompt test bypass, one-time replies, malformed input and cancellation. The native bridge test does not prove user authorization or visible delivery. Apple's [UNUserNotificationCenter documentation](https://developer.apple.com/documentation/usernotifications/unusernotificationcenter) defines notification handling as app-scoped; its [notificationsNotAllowed error](https://developer.apple.com/documentation/usernotifications/unerror/notificationsnotallowed) denotes missing authorization.

The notification bridge uses a private dispatch queue and callback-based UserNotifications APIs. It does not depend on Swift MainActor, Swift Tasks, or an AppKit run-loop pump supplied by Bun. The delegate also uses the callback presentation method. `bun test native/focus/notifications` builds a separate test dylib with delayed synthetic callbacks and verifies authorization, denial, scheduling errors, delivered-ID filtering and late-reply cancellation without any GUI/main loop. The synthetic backend is compiled only with `NOTIFICATIONS_TESTING` and is absent from the production library.
