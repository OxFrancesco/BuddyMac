# Liny in BuddyMac

BuddyMac embeds the original Liny Gateway, Pi agent loop, sessions, compaction, memory tools, provider authentication, and native computer tools. The GPUix UI uses `src/liny.ts`. A compiled Bun child process exchanges newline-delimited JSON on stdin/stdout. It opens no daemon port and does not launch the original Liny UI.

## Source and local changes

`agent/src` and `agent/vendor` were copied from `/Volumes/T6-7/Coding/Personal/Liny` at commit `3949d3e59b6585ff5a0ed236c8da570375a94f75`. Its agent source was clean; unrelated report/artifact changes were left untouched. Vendored Stagehand keeps its LICENSE. The copied native OCU helper keeps `Contents/Resources/OCU-LICENSE.txt`. Dependency licenses remain in the nested package installation. The unused managed-account daemon, provider, authentication modules, and public account configuration were omitted from BuddyMac. No Clerk key or managed billing endpoint is needed.

Changes to the copied engine:

- Gateway no longer warms computer use or refreshes models at construction.
- Managed Liny provider is not registered. Resuming a managed-provider session does not restore that unavailable provider.
- Automatic memory dreaming is disabled. Loading imported notes never triggers paid inference.
- OCU's socket namespace is `liny:buddymac:<binary>`. The native helper recognizes the `liny:` prefix to append its parent PID and terminate the app-agent when that parent exits. The BuddyMac segment and binary path keep it separate from original Liny.
- `buddymac-contract.ts` validates response payloads and events for the GPUix client.

## Build and packaging

Run `bun install --cwd native/liny/agent`, then `bun native/liny/build.ts`. The nested lockfile pins the engine dependencies. The root package does not need those dependencies.

The packaged app runs `BuddyMac --liny-worker` as a separate process. It embeds the agent in the main executable so both processes share one Bun runtime on disk. Development still uses `dist/buddymac-liny`. Place `dist/buddymac-default-browser` beside the main BuddyMac executable; it reads the configured default browser through NSWorkspace without launching a browser. Copy `ocu/Open Computer Use.app` into `BuddyMac.app/Contents/Resources/Open Computer Use.app`. The worker resolves this bundled helper and starts it only when the model actually executes a computer tool. Ordinary responses do not start OCU. Native macOS permissions still belong to the signed helper.

For development, `BUDDYMAC_LINY_HELPER` selects the compiled worker and `BUDDYMAC_LINY_OCU_BIN` selects its native computer backend. `BUDDYMAC_LINY_HOME` selects an isolated data directory. A process lock prevents two workers from owning that directory.

## Data and account boundaries

Default storage is `~/Library/Application Support/BuddyMac/Liny/profiles/personal`. An import picker lists original profiles from `~/.liny/accounts/user_*` and any legacy local session. Import takes an exact listed ID, rejects traversal/symlinks, copies only that profile to its own destination, and never overwrites an existing destination. Originals remain unchanged. It copies sessions, memory, workflows, and provider configuration. Credentials are excluded by default; the caller must explicitly set `includeCredentials` to copy selected-profile credentials. Managed Liny account tokens are not imported.

Import completion changes an atomic `active-profile.json` pointer. Profiles remain separate. Repeated import of a finished profile selects it without replacing new conversations. A selected profile's Pi session IDs and current-session pointer are preserved. Current writes stay in BuddyMac.

Personal OpenAI Codex OAuth, OpenRouter API key, and Z.ai API key flows use the original engine. API keys remain process-local, matching original Liny; OAuth credentials persist in the selected BuddyMac profile. The UI must present authentication URLs or device codes from events. The GPUix UI opens a provider sign-in URL only after the user chooses Connect and starts its OAuth flow.

## Client contract

`liny` is a lazy singleton. Importing `src/liny.ts` does not start a child process.

- `state()` returns provider/model catalog, selected model/thinking, auth status, and session turn count.
- `snapshot()` returns current session ID and user/assistant messages.
- `sessions()`, `resume(id)`, `reset()` manage real Pi sessions.
- `send(text, images?, { tools: "none" }?)` streams `delta`, `tool.activity`, `turn.done`, and error events through `onEvent`. The returned promise is an acknowledgement, not proof of successful completion. Subscribe before sending, then await `turn.done` or handle `turn.error`. A caught turn failure can still produce an accepted acknowledgement. Pass `{ tools: "none" }` to disable all tool exposure and default-browser queries for that turn. `abort()` remains available during streaming.
- `configure(selection, thinking?)`, `login(provider, auth)`, `logout(provider)` use original provider logic.
- `importSources()`, `importSource(id, includeCredentials=false)` implement explicit migration.
- `close()` stops only this worker and its child tools.

Managed Liny account login, credits, subscription billing, and scheduled memory consolidation are not included. Stagehand selection is not exposed by this client because the original Liny engine routes browser work through native OCU in the macOS default browser. The original Stagehand source/license remain for provenance.

## Verification

`bun test src/liny.test.ts` uses the original Gateway and Pi session storage with a clearly marked synthetic model and synthetic OCU responder. It checks streamed events, disk persistence across worker restart, reset/resume, explicit memory writes, no computer startup at launch/import, selected-profile import, omitted credentials, traversal rejection, and unchanged original fixture files.

These tests do not prove production model inference, OAuth completion, macOS permission grants, or live computer control. No paid model request or action on the user's apps was performed during this verification.

Transport lifecycle regression: `bun test native/liny/transport.test.ts` verifies the actual child environment retains the native parent-monitor prefix, separates installed/development paths from original Liny, and recycles a stalled synthetic helper before its next handshake. It does not prove live native action delivery.

BuddyMac disables the optional OCU software-cursor overlay (`OPEN_COMPUTER_USE_VISUAL_CURSOR=0`). A scoped live test and helper stack sample showed the overlay blocking on an absent bundled reference PNG and its build-machine-path fallback before click dispatch. Native semantic set-value plus value assertion and a separate read passed on the verification receiver; screenshots remain separately permission-dependent. The upstream accessibility typing fallback appends the full current value, so replacement instructions explicitly use `set_value` rather than select-all plus typing.
